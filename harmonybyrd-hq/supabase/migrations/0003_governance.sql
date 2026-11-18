-- HarmonyByrd HQ · migration 0003 · proposal inbox, founder decisions, audit log
--
-- Governance model
--   * Anyone with the developer or ai_agent role may SUBMIT a proposal. A proposal is held in
--     an isolated inbox and changes nothing in the authoritative records.
--   * Only an active HUMAN FOUNDER may review a proposal or record a decision. Those two
--     functions are the only code paths that append authoritative record versions after import.
--   * Stale proposals (the target moved on since the proposer read it) are refused explicitly,
--     both at submission and at review.
--   * Everything is append-only; a proposal's status is the latest event in its event log.

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table hq.audit_log (
  id               bigint generated always as identity primary key,
  at               timestamptz not null default clock_timestamp(),
  principal_id     uuid,
  principal_handle text,
  app_role         text,
  client           text,
  action           text not null,
  object_type      text,
  object_id        text,
  outcome          text not null check (outcome in ('allowed', 'denied', 'error')),
  detail           jsonb,
  request_id       text
);
create index audit_log_at_idx on hq.audit_log (at desc);
create trigger audit_log_append_only
  before update or delete on hq.audit_log
  for each row execute function hq.tg_append_only();
create trigger audit_log_no_truncate
  before truncate on hq.audit_log
  for each statement execute function hq.tg_append_only();

-- Identity is always taken from the request claims, never from an argument.
create function hq.log_event(
  p_action text, p_object_type text, p_object_id text, p_outcome text,
  p_detail jsonb default null, p_request_id text default null)
returns void
language plpgsql security definer set search_path = hq, pg_catalog as $$
declare
  v_p hq.principals;
begin
  select * into v_p from hq.principals where id = hq.current_principal_id();
  insert into hq.audit_log (principal_id, principal_handle, app_role, client, action, object_type, object_id, outcome, detail, request_id)
  values (v_p.id, v_p.handle, v_p.app_role, hq.jwt_claims() ->> 'client', left(p_action, 120), left(p_object_type, 60),
          left(p_object_id, 120), p_outcome, p_detail, left(p_request_id, 80));
end
$$;

-- ---------------------------------------------------------------------------
-- Proposal inbox
-- ---------------------------------------------------------------------------
create table hq.proposals (
  id              text primary key check (id ~ '^PROP-[0-9]{6}$'),
  kind            text not null check (kind in ('change_proposal', 'defect_report', 'test_evidence', 'classification', 'reconciliation')),
  target_type     text,
  target_id       text,
  base_version    integer,
  base_rev        bigint not null,
  title           text not null check (length(title) between 3 and 200),
  rationale       text not null check (length(rationale) between 3 and 8000),
  payload         jsonb not null check (jsonb_typeof(payload) = 'object'),
  evidence        jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  submitted_by    uuid not null references hq.principals(id),
  client          text,
  idempotency_key text,
  submitted_at    timestamptz not null default clock_timestamp(),
  unique (submitted_by, idempotency_key),
  check ((target_type is null) = (target_id is null))
);
create trigger proposals_append_only
  before update or delete on hq.proposals
  for each row execute function hq.tg_append_only();
create trigger proposals_no_truncate
  before truncate on hq.proposals
  for each statement execute function hq.tg_append_only();

create table hq.proposal_events (
  id            bigint generated always as identity primary key,
  proposal_id   text not null references hq.proposals(id),
  event         text not null check (event in ('submitted', 'accepted', 'rejected', 'needs_changes', 'withdrawn', 'marked_stale')),
  actor         uuid not null references hq.principals(id),
  note          text,
  resulting_rev bigint references hq.dataset_revisions(rev),
  detail        jsonb,
  at            timestamptz not null default clock_timestamp()
);
create index proposal_events_proposal_idx on hq.proposal_events (proposal_id, id);
create trigger proposal_events_append_only
  before update or delete on hq.proposal_events
  for each row execute function hq.tg_append_only();
create trigger proposal_events_no_truncate
  before truncate on hq.proposal_events
  for each statement execute function hq.tg_append_only();

create function hq.proposal_status(p_id text) returns text
language sql stable security definer set search_path = hq, pg_catalog as $$
  select e.event from hq.proposal_events e where e.proposal_id = p_id order by e.id desc limit 1
$$;

-- Fields no proposal may set. Founder-governed fields change only through a recorded
-- founder decision; identity and original wording never change at all.
create function hq.protected_fields() returns text[]
language sql immutable as $$
  select array['id', 'exact_wording', 'source_id', 'locator', 'source_date', 'attribution',
               'disposition', 'disposition_decision_id', 'hq_acceptance', 'recorded_in',
               'decided_by', 'decided_at', 'verification', 'submitted_by']
$$;

create function hq.creatable_types() returns jsonb
language sql immutable as $$
  select '{"defect":"DEF-HQ-","evidence":"EV-HQ-","open_item":"OPEN-HQ-","recommendation":"REC-HQ-",
           "requirement":"FR-HQ-","module":"MOD-HQ-","loop":"LOOP-HQ-","pathway":"PATH-HQ-",
           "commission":"COM-HQ-","build":"BLD-HQ-","source":"SRC-HQ-"}'::jsonb
$$;

create function hq._proposal_json(p hq.proposals) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'kind', p.kind, 'target_type', p.target_type, 'target_id', p.target_id,
    'base_version', p.base_version, 'base_rev', p.base_rev, 'title', p.title, 'rationale', p.rationale,
    'payload', p.payload, 'evidence', p.evidence, 'submitted_by', p.submitted_by, 'client', p.client,
    'submitted_at', p.submitted_at, 'status', hq.proposal_status(p.id))
$$;

-- Validate the shape of a proposal payload. Raises HQ422 (invalid) or HQ403 (protected field).
create function hq._validate_payload(p_kind text, p_target_type text, p_payload jsonb) returns void
language plpgsql as $$
declare
  v_op   text := p_payload ->> 'op';
  v_key  text;
  v_type text;
begin
  if v_op is null or v_op not in ('update', 'create') then
    raise exception 'payload.op must be "update" or "create"' using errcode = 'HQ422';
  end if;

  if v_op = 'update' then
    if p_target_type is null then
      raise exception 'an update proposal needs a target record' using errcode = 'HQ422';
    end if;
    if p_target_type = 'decision' then
      raise exception 'decision records cannot be changed by proposal; they are written only by a founder decision'
        using errcode = 'HQ403';
    end if;
    if jsonb_typeof(p_payload -> 'set') is distinct from 'object' or p_payload -> 'set' = '{}'::jsonb then
      raise exception 'payload.set must be a non-empty object of top-level fields' using errcode = 'HQ422';
    end if;
    for v_key in select jsonb_object_keys(p_payload -> 'set') loop
      if v_key = any (hq.protected_fields()) then
        raise exception 'field "%" is protected and cannot be changed by a proposal', v_key using errcode = 'HQ403';
      end if;
    end loop;
    if p_kind in ('defect_report', 'test_evidence') then
      raise exception '% proposals create a new record; use op "create"', p_kind using errcode = 'HQ422';
    end if;
  else
    v_type := p_payload ->> 'record_type';
    if v_type is null or not (hq.creatable_types() ? v_type) then
      raise exception 'payload.record_type "%" cannot be created by proposal', coalesce(v_type, '') using errcode = 'HQ403';
    end if;
    if p_kind = 'defect_report' and v_type <> 'defect' then
      raise exception 'a defect_report must create a defect record' using errcode = 'HQ422';
    end if;
    if p_kind = 'test_evidence' and v_type <> 'evidence' then
      raise exception 'a test_evidence submission must create an evidence record' using errcode = 'HQ422';
    end if;
    if jsonb_typeof(p_payload -> 'record') is distinct from 'object' then
      raise exception 'payload.record must be an object' using errcode = 'HQ422';
    end if;
    for v_key in select jsonb_object_keys(p_payload -> 'record') loop
      if v_key = any (hq.protected_fields()) and not (v_key in ('source_id', 'locator', 'source_date', 'attribution', 'exact_wording')) then
        raise exception 'field "%" is protected and cannot be set by a proposal', v_key using errcode = 'HQ403';
      end if;
    end loop;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- submit_proposal: the only way into the inbox.
-- ---------------------------------------------------------------------------
create function hq.submit_proposal(
  p_kind text, p_target_type text, p_target_id text, p_base_version integer, p_base_rev bigint,
  p_title text, p_rationale text, p_payload jsonb, p_evidence jsonb default '[]'::jsonb,
  p_idempotency_key text default null)
returns jsonb
language plpgsql security definer set search_path = hq, pg_catalog as $$
declare
  v_p       hq.principals;
  v_claims  jsonb := hq.jwt_claims();
  v_head    bigint;
  v_cur     hq.record_versions;
  v_prop    hq.proposals;
  v_id      text;
begin
  select * into v_p from hq.principals where id = hq.current_principal_id() and active;
  if not found then
    raise exception 'authentication required' using errcode = 'HQ401';
  end if;
  if v_p.app_role not in ('founder', 'developer', 'ai_agent') then
    perform hq.log_event('proposal.submit', p_target_type, p_target_id, 'denied', jsonb_build_object('reason', 'role'));
    raise exception 'role "%" may not submit proposals', v_p.app_role using errcode = 'HQ403';
  end if;
  if v_claims ? 'scopes' and not (v_claims -> 'scopes' ? 'propose') then
    perform hq.log_event('proposal.submit', p_target_type, p_target_id, 'denied', jsonb_build_object('reason', 'scope'));
    raise exception 'this credential does not carry the "propose" scope' using errcode = 'HQ403';
  end if;

  if p_idempotency_key is not null then
    select * into v_prop from hq.proposals where submitted_by = v_p.id and idempotency_key = p_idempotency_key;
    if found then
      return hq._proposal_json(v_prop) || jsonb_build_object('idempotent_replay', true);
    end if;
  end if;

  perform hq._validate_payload(p_kind, p_target_type, p_payload);

  v_head := hq.head_rev();
  if p_base_rev is null or p_base_rev < 1 or p_base_rev > v_head then
    raise exception 'base_rev % is not a known dataset revision (head is %)', p_base_rev, v_head using errcode = 'HQ422';
  end if;

  if p_payload ->> 'op' = 'update' then
    select * into v_cur from hq.record_versions
     where record_type = p_target_type and record_id = p_target_id
     order by version desc limit 1;
    if not found or v_cur.deleted then
      raise exception 'target %/% does not exist', p_target_type, p_target_id using errcode = 'HQ404';
    end if;
    if p_base_version is null then
      raise exception 'base_version is required: state which version of the record you read' using errcode = 'HQ422';
    end if;
    if p_base_version <> v_cur.version then
      perform hq.log_event('proposal.submit', p_target_type, p_target_id, 'denied',
        jsonb_build_object('reason', 'stale', 'base_version', p_base_version, 'current_version', v_cur.version));
      raise exception 'stale revision: %/% is at version % (you read version %). Re-read the record and resubmit.',
        p_target_type, p_target_id, v_cur.version, p_base_version
        using errcode = 'HQ409',
              detail = jsonb_build_object('current_version', v_cur.version, 'base_version', p_base_version, 'head_rev', v_head)::text;
    end if;
  end if;

  v_id := hq._next_id('PROP-', 6);
  insert into hq.proposals (id, kind, target_type, target_id, base_version, base_rev, title, rationale,
                            payload, evidence, submitted_by, client, idempotency_key)
  values (v_id, p_kind, p_target_type, p_target_id, p_base_version, p_base_rev, p_title, p_rationale,
          p_payload, coalesce(p_evidence, '[]'::jsonb), v_p.id, v_claims ->> 'client', p_idempotency_key)
  returning * into v_prop;
  insert into hq.proposal_events (proposal_id, event, actor) values (v_id, 'submitted', v_p.id);
  perform hq.log_event('proposal.submit', p_target_type, coalesce(p_target_id, v_id), 'allowed',
    jsonb_build_object('proposal_id', v_id, 'kind', p_kind));
  return hq._proposal_json(v_prop);
end
$$;

create function hq.withdraw_proposal(p_id text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = hq, pg_catalog as $$
declare
  v_pid  uuid := hq.current_principal_id();
  v_prop hq.proposals;
begin
  select * into v_prop from hq.proposals where id = p_id;
  if not found or v_prop.submitted_by is distinct from v_pid then
    raise exception 'proposal % not found for this principal', p_id using errcode = 'HQ404';
  end if;
  if hq.proposal_status(p_id) <> 'submitted' then
    raise exception 'proposal % is % and can no longer be withdrawn', p_id, hq.proposal_status(p_id) using errcode = 'HQ409';
  end if;
  insert into hq.proposal_events (proposal_id, event, actor, note) values (p_id, 'withdrawn', v_pid, p_note);
  perform hq.log_event('proposal.withdraw', 'proposal', p_id, 'allowed', null);
  return hq._proposal_json(v_prop);
end
$$;

-- Require an active human founder for the current request, or raise HQ403 and log the denial.
create function hq._require_founder(p_action text, p_object_type text, p_object_id text) returns hq.principals
language plpgsql security definer set search_path = hq, pg_catalog as $$
declare
  v_p hq.principals;
begin
  select * into v_p from hq.principals where id = hq.current_principal_id() and active;
  if not found then
    raise exception 'authentication required' using errcode = 'HQ401';
  end if;
  if not (v_p.app_role = 'founder' and v_p.kind = 'human') then
    perform hq.log_event(p_action, p_object_type, p_object_id, 'denied',
      jsonb_build_object('reason', 'founder authority required', 'attempted_by_role', v_p.app_role, 'attempted_by_kind', v_p.kind));
    raise exception 'founder authority is required for %; "%" (% / %) cannot perform it',
      p_action, v_p.handle, v_p.kind, v_p.app_role using errcode = 'HQ403';
  end if;
  -- Founder acts require an interactive session, never an API token.
  if coalesce(hq.jwt_claims() ->> 'amr', '') <> 'session' then
    perform hq.log_event(p_action, p_object_type, p_object_id, 'denied', jsonb_build_object('reason', 'interactive session required'));
    raise exception 'founder acts require an interactive founder session' using errcode = 'HQ403';
  end if;
  return v_p;
end
$$;

-- ---------------------------------------------------------------------------
-- review_proposal: founder only. Accepting applies the proposal as a new record version
-- inside a new dataset revision; a stale proposal is marked and refused.
-- ---------------------------------------------------------------------------
create function hq.review_proposal(p_id text, p_decision text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = hq, pg_catalog as $$
declare
  v_f       hq.principals;
  v_prop    hq.proposals;
  v_status  text;
  v_cur     hq.record_versions;
  v_data    jsonb;
  v_rev     bigint;
  v_type    text;
  v_new_id  text;
  v_version integer;
  v_sub     hq.principals;
begin
  v_f := hq._require_founder('proposal.review', 'proposal', p_id);

  if p_decision not in ('accept', 'reject', 'needs_changes') then
    raise exception 'decision must be accept, reject or needs_changes' using errcode = 'HQ422';
  end if;

  perform pg_advisory_xact_lock(hashtext('hq.dataset.write'));
  select * into v_prop from hq.proposals where id = p_id;
  if not found then
    raise exception 'proposal % not found', p_id using errcode = 'HQ404';
  end if;
  v_status := hq.proposal_status(p_id);
  if v_status <> 'submitted' then
    raise exception 'proposal % is already % and cannot be reviewed again', p_id, v_status using errcode = 'HQ409';
  end if;

  if p_decision in ('reject', 'needs_changes') then
    insert into hq.proposal_events (proposal_id, event, actor, note)
    values (p_id, case p_decision when 'reject' then 'rejected' else 'needs_changes' end, v_f.id, p_note);
    perform hq.log_event('proposal.review', 'proposal', p_id, 'allowed', jsonb_build_object('decision', p_decision));
    return hq._proposal_json(v_prop);
  end if;

  -- accept
  perform hq._validate_payload(v_prop.kind, v_prop.target_type, v_prop.payload);
  select * into v_sub from hq.principals where id = v_prop.submitted_by;

  if v_prop.payload ->> 'op' = 'update' then
    select * into v_cur from hq.record_versions
     where record_type = v_prop.target_type and record_id = v_prop.target_id
     order by version desc limit 1;
    if not found or v_cur.deleted or v_cur.version <> v_prop.base_version then
      insert into hq.proposal_events (proposal_id, event, actor, note, detail)
      values (p_id, 'marked_stale', v_f.id,
              'The target record changed after this proposal was written; it must be re-read and resubmitted.',
              jsonb_build_object('base_version', v_prop.base_version, 'current_version', v_cur.version));
      perform hq.log_event('proposal.review', 'proposal', p_id, 'denied',
        jsonb_build_object('reason', 'stale', 'base_version', v_prop.base_version, 'current_version', v_cur.version));
      return hq._proposal_json(v_prop) || jsonb_build_object(
        'conflict', true, 'base_version', v_prop.base_version, 'current_version', v_cur.version);
    end if;
    v_data := v_cur.data || (v_prop.payload -> 'set');
    v_type := v_prop.target_type;
    v_new_id := v_prop.target_id;
  else
    v_type := v_prop.payload ->> 'record_type';
    v_new_id := hq._next_id(hq.creatable_types() ->> v_type, 4);
    v_data := (v_prop.payload -> 'record') || jsonb_build_object('id', v_new_id);
    if v_type = 'requirement' then
      v_data := v_data || jsonb_build_object('disposition', 'unreviewed');
    end if;
    if v_type = 'evidence' then
      -- A submission is a claim, not a verification. It stays labelled as such.
      v_data := v_data || jsonb_build_object(
        'verification', case when v_sub.kind = 'ai_client' then 'agent_submitted_unverified' else 'submitted_unverified' end,
        'submitted_by', v_sub.handle);
    end if;
  end if;

  v_rev := hq._begin_revision('proposal_acceptance',
             'Accepted ' || p_id || ' — ' || v_prop.title, v_prop.payload ->> 'commission_ref', v_f.id);
  perform set_config('hq.write_context', 'review_proposal', true);
  v_version := hq._append_record(v_type, v_new_id, v_data, false, v_rev, v_f.id, 'proposal_acceptance', p_id);
  perform set_config('hq.write_context', '', true);
  perform hq._seal_revision(v_rev);

  insert into hq.proposal_events (proposal_id, event, actor, note, resulting_rev, detail)
  values (p_id, 'accepted', v_f.id, p_note, v_rev,
          jsonb_build_object('record_type', v_type, 'record_id', v_new_id, 'version', v_version));
  perform hq.log_event('proposal.review', 'proposal', p_id, 'allowed',
    jsonb_build_object('decision', 'accept', 'rev', v_rev, 'record_type', v_type, 'record_id', v_new_id, 'version', v_version));
  return hq._proposal_json(v_prop) || jsonb_build_object(
    'resulting_rev', v_rev, 'record_type', v_type, 'record_id', v_new_id, 'version', v_version);
end
$$;

-- ---------------------------------------------------------------------------
-- record_founder_decision: founder only. The single path by which acceptance and
-- requirement dispositions are ever recorded in HQ.
--
-- p_effects is an array of:
--   {"type":"set_requirement_disposition","requirement_id":"FR-…","disposition":"active|superseded|conflicted|deferred|withdrawn|satisfied"}
--   {"type":"set_acceptance","record_type":"build|module|evidence|requirement|loop|commission","record_id":"…",
--    "state":"accepted|rejected|none","scope_note":"…"}
-- ---------------------------------------------------------------------------
create function hq.record_founder_decision(
  p_title text, p_exact_text text, p_rationale text default null,
  p_effects jsonb default '[]'::jsonb, p_resolves jsonb default '[]'::jsonb,
  p_module_ids jsonb default '[]'::jsonb, p_commission_ref text default null)
returns jsonb
language plpgsql security definer set search_path = hq, pg_catalog as $$
declare
  v_f      hq.principals;
  v_rev    bigint;
  v_id     text;
  v_now    timestamptz := clock_timestamp();
  v_eff    jsonb;
  v_cur    hq.record_versions;
  v_data   jsonb;
  v_applied jsonb := '[]'::jsonb;
  v_ver    integer;
begin
  v_f := hq._require_founder('decision.record', 'decision', null);

  if p_title is null or length(trim(p_title)) < 3 then
    raise exception 'a decision needs a title' using errcode = 'HQ422';
  end if;
  if p_exact_text is null or length(trim(p_exact_text)) < 3 then
    raise exception 'a decision needs the founder''s exact wording' using errcode = 'HQ422';
  end if;
  if jsonb_typeof(coalesce(p_effects, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_resolves, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_module_ids, '[]'::jsonb)) <> 'array' then
    raise exception 'effects, resolves and module_ids must be arrays' using errcode = 'HQ422';
  end if;

  v_rev := hq._begin_revision('founder_decision', 'Founder decision — ' || p_title, p_commission_ref, v_f.id);
  v_id := hq._next_id('FD-HQ-', 4);
  perform set_config('hq.write_context', 'founder_decision', true);

  for v_eff in select * from jsonb_array_elements(coalesce(p_effects, '[]'::jsonb)) loop
    if v_eff ->> 'type' = 'set_requirement_disposition' then
      if (v_eff ->> 'disposition') not in ('unreviewed', 'active', 'superseded', 'conflicted', 'deferred', 'withdrawn', 'satisfied') then
        raise exception 'unknown disposition "%"', v_eff ->> 'disposition' using errcode = 'HQ422';
      end if;
      select * into v_cur from hq.record_versions
       where record_type = 'requirement' and record_id = v_eff ->> 'requirement_id'
       order by version desc limit 1;
      if not found or v_cur.deleted then
        raise exception 'requirement % not found', v_eff ->> 'requirement_id' using errcode = 'HQ404';
      end if;
      v_data := v_cur.data || jsonb_build_object('disposition', v_eff ->> 'disposition', 'disposition_decision_id', v_id);
      v_ver := hq._append_record('requirement', v_cur.record_id, v_data, false, v_rev, v_f.id, 'founder_decision', null);
      v_applied := v_applied || jsonb_build_object('record_type', 'requirement', 'record_id', v_cur.record_id, 'version', v_ver);

    elsif v_eff ->> 'type' = 'set_acceptance' then
      if (v_eff ->> 'state') not in ('accepted', 'rejected', 'none') then
        raise exception 'unknown acceptance state "%"', v_eff ->> 'state' using errcode = 'HQ422';
      end if;
      if (v_eff ->> 'record_type') not in ('build', 'module', 'evidence', 'requirement', 'loop', 'commission') then
        raise exception 'acceptance cannot be recorded on record type "%"', v_eff ->> 'record_type' using errcode = 'HQ422';
      end if;
      select * into v_cur from hq.record_versions
       where record_type = v_eff ->> 'record_type' and record_id = v_eff ->> 'record_id'
       order by version desc limit 1;
      if not found or v_cur.deleted then
        raise exception '%/% not found', v_eff ->> 'record_type', v_eff ->> 'record_id' using errcode = 'HQ404';
      end if;
      v_data := v_cur.data || jsonb_build_object('hq_acceptance', jsonb_build_object(
                  'state', v_eff ->> 'state', 'decision_id', v_id, 'decided_at', v_now,
                  'decided_by', v_f.handle, 'scope_note', v_eff ->> 'scope_note'));
      v_ver := hq._append_record(v_cur.record_type, v_cur.record_id, v_data, false, v_rev, v_f.id, 'founder_decision', null);
      v_applied := v_applied || jsonb_build_object('record_type', v_cur.record_type, 'record_id', v_cur.record_id, 'version', v_ver);

    else
      raise exception 'unknown decision effect type "%"', coalesce(v_eff ->> 'type', '') using errcode = 'HQ422';
    end if;
  end loop;

  v_data := jsonb_build_object(
    'id', v_id, 'code', null, 'title', trim(p_title), 'status', 'issued', 'recorded_in', 'hq',
    'exact_text', p_exact_text, 'rationale', p_rationale, 'date', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD'),
    'decided_by', v_f.handle, 'decided_at', v_now, 'module_ids', coalesce(p_module_ids, '[]'::jsonb),
    'resolves', coalesce(p_resolves, '[]'::jsonb), 'effects', coalesce(p_effects, '[]'::jsonb),
    'commission_code', p_commission_ref, 'citations', '[]'::jsonb,
    -- First-hand for HQ: the decision was made here, by an authenticated founder session.
    'statement', jsonb_build_object('text', trim(p_title), 'epistemic', 'verified', 'citations', '[]'::jsonb));
  perform hq._append_record('decision', v_id, v_data, false, v_rev, v_f.id, 'founder_decision', null);
  perform set_config('hq.write_context', '', true);
  perform hq._seal_revision(v_rev);

  perform hq.log_event('decision.record', 'decision', v_id, 'allowed', jsonb_build_object('rev', v_rev, 'effects', v_applied));
  return jsonb_build_object('decision_id', v_id, 'rev', v_rev, 'applied', v_applied);
end
$$;

-- ---------------------------------------------------------------------------
-- Administrative import (service role / owner only; SECURITY INVOKER on purpose —
-- API roles hold no INSERT privilege, so they could not use it even if granted).
--
-- p_records: [{"type":"module","id":"MOD-…","data":{…}}, …]
-- Records that were later changed through governance are never overwritten by an import;
-- they are reported back as "diverged".
-- ---------------------------------------------------------------------------
create function hq.admin_put_records(
  p_records jsonb, p_summary text, p_commission_ref text, p_actor_handle text,
  p_retire_missing boolean default false)
returns jsonb
language plpgsql as $$
declare
  v_actor    uuid;
  v_rec      jsonb;
  v_cur      hq.record_versions;
  v_changes  jsonb := '[]'::jsonb;
  v_diverged jsonb := '[]'::jsonb;
  v_retire   jsonb := '[]'::jsonb;
  v_rev      bigint;
  v_item     jsonb;
  v_unchanged integer := 0;
begin
  if current_user in ('anon', 'authenticated', 'hq_auth') then
    raise exception 'administrative import is not available to API roles' using errcode = 'HQ403';
  end if;
  select id into v_actor from hq.principals where handle = p_actor_handle and active;
  if v_actor is null then
    raise exception 'import actor "%" is not a known principal', p_actor_handle using errcode = 'HQ422';
  end if;
  perform pg_advisory_xact_lock(hashtext('hq.dataset.write'));

  for v_rec in select * from jsonb_array_elements(p_records) loop
    if v_rec -> 'data' ? 'hq_acceptance' or (v_rec ->> 'type' = 'decision' and v_rec #>> '{data,recorded_in}' = 'hq') then
      raise exception 'record %/% carries HQ-recorded founder authority, which cannot be imported',
        v_rec ->> 'type', v_rec ->> 'id' using errcode = 'HQ403';
    end if;
    select * into v_cur from hq.record_versions
     where record_type = v_rec ->> 'type' and record_id = v_rec ->> 'id'
     order by version desc limit 1;
    if found and v_cur.origin <> 'seed_import' then
      if v_cur.data is distinct from (v_rec -> 'data') then
        v_diverged := v_diverged || jsonb_build_object('type', v_rec ->> 'type', 'id', v_rec ->> 'id', 'version', v_cur.version);
      end if;
    elsif found and not v_cur.deleted and v_cur.data = (v_rec -> 'data') then
      v_unchanged := v_unchanged + 1;
    else
      v_changes := v_changes || v_rec;
    end if;
  end loop;

  if p_retire_missing then
    for v_cur in
      select r.* from hq.records_at(hq.head_rev()) r
       where not r.deleted and r.origin = 'seed_import'
         and not exists (select from jsonb_array_elements(p_records) x
                          where x ->> 'type' = r.record_type and x ->> 'id' = r.record_id)
    loop
      v_retire := v_retire || jsonb_build_object('type', v_cur.record_type, 'id', v_cur.record_id, 'data', v_cur.data);
    end loop;
  end if;

  if jsonb_array_length(v_changes) = 0 and jsonb_array_length(v_retire) = 0 then
    return jsonb_build_object('rev', hq.head_rev(), 'changed', 0, 'retired', 0, 'unchanged', v_unchanged, 'diverged', v_diverged);
  end if;

  v_rev := hq._begin_revision('seed_import', p_summary, p_commission_ref, v_actor);
  perform set_config('hq.write_context', 'admin_import', true);
  for v_item in select * from jsonb_array_elements(v_changes) loop
    perform hq._append_record(v_item ->> 'type', v_item ->> 'id', v_item -> 'data', false, v_rev, v_actor, 'seed_import', null);
  end loop;
  for v_item in select * from jsonb_array_elements(v_retire) loop
    perform hq._append_record(v_item ->> 'type', v_item ->> 'id', v_item -> 'data', true, v_rev, v_actor, 'seed_import', null);
  end loop;
  perform set_config('hq.write_context', '', true);
  perform hq._seal_revision(v_rev);

  return jsonb_build_object('rev', v_rev, 'changed', jsonb_array_length(v_changes),
    'retired', jsonb_array_length(v_retire), 'unchanged', v_unchanged, 'diverged', v_diverged);
end
$$;
