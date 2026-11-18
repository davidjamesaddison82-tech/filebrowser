-- HarmonyByrd HQ · migration 0001 · foundation
-- Roles, schema, identity tables and claim helpers.
--
-- Portable between plain PostgreSQL (>= 14) and Supabase. The three Supabase API roles
-- (anon, authenticated, service_role) are created only when missing, so on Supabase this
-- section is a no-op. Row-level security policies written against these roles behave the
-- same way under PostgREST (which sets `request.jwt.claims` and switches role) and under
-- the HQ application server (which does exactly the same thing per transaction).

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  -- HQ-specific: the only role allowed to look up credential hashes. The application
  -- assumes it for the duration of an authentication check and for nothing else.
  if not exists (select from pg_roles where rolname = 'hq_auth') then
    create role hq_auth nologin noinherit;
  end if;
end
$$;

create schema if not exists hq;
comment on schema hq is
  'HarmonyByrd HQ records. Non-authoritative prototype under commission HB-HQ-P02-R1 until founder acceptance of the HB-AI-P00 / HB-AI-P02 gates is evidenced.';

revoke all on schema hq from public;
grant usage on schema hq to anon, authenticated, service_role, hq_auth;

-- ---------------------------------------------------------------------------
-- Principals: every human and every AI client is a distinct, named identity.
-- ---------------------------------------------------------------------------
create table hq.principals (
  id           uuid primary key default gen_random_uuid(),
  handle       text not null unique check (handle ~ '^[a-z0-9][a-z0-9_-]{1,40}$'),
  display_name text not null,
  kind         text not null check (kind in ('human', 'ai_client', 'service')),
  app_role     text not null check (app_role in ('founder', 'developer', 'ai_agent', 'reader')),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  -- Founder authority can only ever be held by a human identity.
  constraint founder_must_be_human check (app_role <> 'founder' or kind = 'human'),
  -- An AI client can never hold any role other than ai_agent.
  constraint ai_client_role_fixed check (kind <> 'ai_client' or app_role = 'ai_agent')
);
comment on table hq.principals is 'Named identities. app_role is authoritative here; a role named in a token claim is never trusted on its own.';

-- Passphrase verifiers for human sign-in (scrypt, computed by the application server).
create table hq.login_secrets (
  principal_id uuid primary key references hq.principals(id),
  scheme       text not null check (scheme in ('scrypt-v1')),
  secret_hash  text not null,
  updated_at   timestamptz not null default now()
);

-- API credentials for programmatic clients. One row per issued token; only a SHA-256 of
-- the token is stored. There is deliberately no scope that grants approval.
create table hq.api_credentials (
  id            uuid primary key default gen_random_uuid(),
  principal_id  uuid not null references hq.principals(id),
  label         text not null,
  token_prefix  text not null unique,
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  scopes        text[] not null default array['read']::text[]
                check (scopes <@ array['read', 'propose']::text[] and cardinality(scopes) > 0),
  created_at    timestamptz not null default now(),
  created_by    uuid references hq.principals(id),
  expires_at    timestamptz,
  revoked_at    timestamptz,
  last_used_at  timestamptz
);

-- A founder identity may never be reachable through an API token: founder acts require an
-- interactive human session. Enforced here so that no code path can mint such a token.
create function hq.tg_credential_not_for_founder() returns trigger
language plpgsql as $$
declare
  v_role text;
begin
  select app_role into v_role from hq.principals where id = new.principal_id;
  if v_role = 'founder' then
    raise exception 'API credentials cannot be issued to a founder principal'
      using errcode = 'HQ403';
  end if;
  return new;
end
$$;
create trigger credential_not_for_founder
  before insert or update on hq.api_credentials
  for each row execute function hq.tg_credential_not_for_founder();

-- And the reverse: a principal that already holds API credentials cannot be promoted to founder.
create function hq.tg_principal_role_guard() returns trigger
language plpgsql as $$
begin
  if new.app_role = 'founder' and exists (
       select from hq.api_credentials c where c.principal_id = new.id and c.revoked_at is null) then
    raise exception 'A principal holding API credentials cannot be given the founder role'
      using errcode = 'HQ403';
  end if;
  return new;
end
$$;
create trigger principal_role_guard
  before update on hq.principals
  for each row execute function hq.tg_principal_role_guard();

-- ---------------------------------------------------------------------------
-- Claim helpers (same contract as PostgREST: request.jwt.claims is a JSON object).
-- ---------------------------------------------------------------------------
create function hq.jwt_claims() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create function hq.current_principal_id() returns uuid
language plpgsql stable as $$
declare
  v_sub text := hq.jwt_claims() ->> 'sub';
begin
  if v_sub is null or v_sub !~ '^[0-9a-fA-F-]{36}$' then
    return null;
  end if;
  return v_sub::uuid;
end
$$;

-- The principal row for the current request, or no row. SECURITY DEFINER so that policies
-- can consult it without granting table access; it only ever returns the caller's own row.
create function hq.current_principal() returns hq.principals
language sql stable security definer set search_path = hq, pg_catalog as $$
  select p.* from hq.principals p
  where p.id = hq.current_principal_id() and p.active
$$;

create function hq.current_app_role() returns text
language sql stable security definer set search_path = hq, pg_catalog as $$
  select p.app_role from hq.principals p
  where p.id = hq.current_principal_id() and p.active
$$;

create function hq.current_principal_kind() returns text
language sql stable security definer set search_path = hq, pg_catalog as $$
  select p.kind from hq.principals p
  where p.id = hq.current_principal_id() and p.active
$$;

grant execute on function hq.jwt_claims(), hq.current_principal_id(), hq.current_principal(),
  hq.current_app_role(), hq.current_principal_kind() to anon, authenticated, service_role, hq_auth;

-- Raise a uniform "not permitted" error. SQLSTATE HQ403 is mapped to HTTP 403 by the API.
create function hq.deny(p_message text) returns void
language plpgsql as $$
begin
  raise exception '%', p_message using errcode = 'HQ403';
end
$$;
