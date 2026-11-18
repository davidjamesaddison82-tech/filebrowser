-- HarmonyByrd HQ · migration 0004 · row-level security, authentication lookups, grants
--
-- Least privilege:
--   anon           no access to HQ data at all
--   authenticated  SELECT on records and revisions; own proposals; nothing writable directly
--   hq_auth        may call the credential lookup functions and nothing else
--   service_role   administrative import and setup (bypasses RLS, as on Supabase)
-- Every write by an API role goes through a SECURITY DEFINER function that re-derives the
-- caller's identity and role from hq.principals.

alter table hq.principals        enable row level security;
alter table hq.login_secrets     enable row level security;
alter table hq.api_credentials   enable row level security;
alter table hq.dataset_revisions enable row level security;
alter table hq.record_versions   enable row level security;
alter table hq.id_counters       enable row level security;
alter table hq.audit_log         enable row level security;
alter table hq.proposals         enable row level security;
alter table hq.proposal_events   enable row level security;

-- Records and revisions: readable by every signed-in, active principal.
create policy records_read on hq.record_versions
  for select to authenticated
  using ((select hq.current_app_role()) is not null);

create policy revisions_read on hq.dataset_revisions
  for select to authenticated
  using ((select hq.current_app_role()) is not null);

-- Principals: a caller sees their own row; the founder sees all.
create policy principals_read on hq.principals
  for select to authenticated
  using (id = (select hq.current_principal_id()) or (select hq.current_app_role()) = 'founder');

-- Proposals are isolated per submitter. One AI client can never read another's inbox items.
create policy proposals_read on hq.proposals
  for select to authenticated
  using (submitted_by = (select hq.current_principal_id()) or (select hq.current_app_role()) = 'founder');

create policy proposal_events_read on hq.proposal_events
  for select to authenticated
  using (exists (
    select from hq.proposals p
     where p.id = proposal_id
       and (p.submitted_by = (select hq.current_principal_id()) or (select hq.current_app_role()) = 'founder')));

-- Audit log: founder only.
create policy audit_read on hq.audit_log
  for select to authenticated
  using ((select hq.current_app_role()) = 'founder');

-- login_secrets, api_credentials, id_counters: RLS enabled and NO policy => no API-role access.

-- ---------------------------------------------------------------------------
-- Public directory of principals (handle, name, kind, role) for attribution in the UI.
-- ---------------------------------------------------------------------------
create function hq.principal_directory()
returns table (id uuid, handle text, display_name text, kind text, app_role text, active boolean)
language sql stable security definer set search_path = hq, pg_catalog as $$
  select p.id, p.handle, p.display_name, p.kind, p.app_role, p.active
    from hq.principals p
   where (select hq.current_app_role()) is not null
$$;

-- ---------------------------------------------------------------------------
-- Authentication lookups (hq_auth only).
-- ---------------------------------------------------------------------------
create function hq.auth_find_credential(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = hq, pg_catalog as $$
declare
  v jsonb;
begin
  update hq.api_credentials c
     set last_used_at = clock_timestamp()
    from hq.principals p
   where c.token_hash = p_token_hash
     and c.principal_id = p.id
     and p.active
     and c.revoked_at is null
     and (c.expires_at is null or c.expires_at > clock_timestamp())
  returning jsonb_build_object(
    'credential_id', c.id, 'label', c.label, 'scopes', to_jsonb(c.scopes),
    'principal_id', p.id, 'handle', p.handle, 'display_name', p.display_name,
    'kind', p.kind, 'app_role', p.app_role) into v;
  return v;
end
$$;

create function hq.auth_find_login(p_handle text) returns jsonb
language sql stable security definer set search_path = hq, pg_catalog as $$
  select jsonb_build_object(
           'principal_id', p.id, 'handle', p.handle, 'display_name', p.display_name,
           'kind', p.kind, 'app_role', p.app_role, 'scheme', s.scheme, 'secret_hash', s.secret_hash)
    from hq.principals p
    join hq.login_secrets s on s.principal_id = p.id
   where p.handle = p_handle and p.active and p.kind = 'human'
$$;

create function hq.auth_get_principal(p_id uuid) returns jsonb
language sql stable security definer set search_path = hq, pg_catalog as $$
  select jsonb_build_object(
           'principal_id', p.id, 'handle', p.handle, 'display_name', p.display_name,
           'kind', p.kind, 'app_role', p.app_role)
    from hq.principals p
   where p.id = p_id and p.active
$$;

-- ---------------------------------------------------------------------------
-- Credential management by the founder (interactive session only).
-- ---------------------------------------------------------------------------
create function hq.founder_register_client(p_handle text, p_display_name text, p_kind text, p_app_role text)
returns jsonb
language plpgsql security definer set search_path = hq, pg_catalog as $$
declare
  v_id uuid;
begin
  perform hq._require_founder('client.register', 'principal', p_handle);
  if p_app_role = 'founder' then
    raise exception 'a founder identity cannot be created from the application' using errcode = 'HQ403';
  end if;
  insert into hq.principals (handle, display_name, kind, app_role)
  values (p_handle, p_display_name, p_kind, p_app_role)
  returning id into v_id;
  perform hq.log_event('client.register', 'principal', p_handle, 'allowed', jsonb_build_object('kind', p_kind, 'app_role', p_app_role));
  return jsonb_build_object('principal_id', v_id, 'handle', p_handle);
end
$$;

create function hq.founder_issue_credential(
  p_handle text, p_label text, p_scopes text[], p_token_prefix text, p_token_hash text, p_expires_at timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = hq, pg_catalog as $$
declare
  v_f   hq.principals;
  v_pid uuid;
  v_id  uuid;
begin
  v_f := hq._require_founder('credential.issue', 'principal', p_handle);
  select id into v_pid from hq.principals where handle = p_handle and active;
  if v_pid is null then
    raise exception 'principal "%" not found', p_handle using errcode = 'HQ404';
  end if;
  insert into hq.api_credentials (principal_id, label, token_prefix, token_hash, scopes, created_by, expires_at)
  values (v_pid, p_label, p_token_prefix, p_token_hash, p_scopes, v_f.id, p_expires_at)
  returning id into v_id;
  perform hq.log_event('credential.issue', 'principal', p_handle, 'allowed',
    jsonb_build_object('credential_id', v_id, 'scopes', to_jsonb(p_scopes), 'label', p_label));
  return jsonb_build_object('credential_id', v_id, 'handle', p_handle, 'token_prefix', p_token_prefix);
end
$$;

create function hq.founder_revoke_credential(p_credential_id uuid) returns jsonb
language plpgsql security definer set search_path = hq, pg_catalog as $$
begin
  perform hq._require_founder('credential.revoke', 'credential', p_credential_id::text);
  update hq.api_credentials set revoked_at = clock_timestamp()
   where id = p_credential_id and revoked_at is null;
  if not found then
    raise exception 'credential not found or already revoked' using errcode = 'HQ404';
  end if;
  perform hq.log_event('credential.revoke', 'credential', p_credential_id::text, 'allowed', null);
  return jsonb_build_object('credential_id', p_credential_id, 'revoked', true);
end
$$;

create function hq.founder_list_credentials()
returns table (credential_id uuid, handle text, display_name text, kind text, app_role text, label text,
               token_prefix text, scopes text[], created_at timestamptz, expires_at timestamptz,
               revoked_at timestamptz, last_used_at timestamptz)
language plpgsql stable security definer set search_path = hq, pg_catalog as $$
begin
  if (select hq.current_app_role()) is distinct from 'founder' then
    raise exception 'founder authority is required to list credentials' using errcode = 'HQ403';
  end if;
  return query
    select c.id, p.handle, p.display_name, p.kind, p.app_role, c.label, c.token_prefix, c.scopes,
           c.created_at, c.expires_at, c.revoked_at, c.last_used_at
      from hq.api_credentials c join hq.principals p on p.id = c.principal_id
     order by c.created_at desc;
end
$$;

-- ---------------------------------------------------------------------------
-- Grants. Start from nothing, then grant exactly what each role needs.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema hq from public, anon, authenticated, hq_auth;
revoke all on all sequences in schema hq from public, anon, authenticated, hq_auth;
revoke execute on all functions in schema hq from public, anon, authenticated, hq_auth;

grant select on hq.record_versions, hq.dataset_revisions, hq.principals,
                hq.proposals, hq.proposal_events, hq.audit_log to authenticated;

grant execute on function
  hq.jwt_claims(), hq.current_principal_id(), hq.current_principal(), hq.current_app_role(),
  hq.current_principal_kind()
  to anon, authenticated, hq_auth, service_role;

grant execute on function
  hq.head_rev(), hq.records_at(bigint), hq.dataset_hash(bigint), hq.verify_chain(),
  hq.principal_directory(), hq.proposal_status(text),
  hq.log_event(text, text, text, text, jsonb, text),
  hq.submit_proposal(text, text, text, integer, bigint, text, text, jsonb, jsonb, text),
  hq.withdraw_proposal(text, text),
  hq.review_proposal(text, text, text),
  hq.record_founder_decision(text, text, text, jsonb, jsonb, jsonb, text),
  hq.founder_register_client(text, text, text, text),
  hq.founder_issue_credential(text, text, text[], text, text, timestamptz),
  hq.founder_revoke_credential(uuid),
  hq.founder_list_credentials()
  to authenticated;

grant execute on function hq.log_event(text, text, text, text, jsonb, text) to anon, hq_auth;

grant execute on function
  hq.auth_find_credential(text), hq.auth_find_login(text), hq.auth_get_principal(uuid)
  to hq_auth;

grant all on all tables in schema hq to service_role;
grant all on all sequences in schema hq to service_role;
grant execute on all functions in schema hq to service_role;
