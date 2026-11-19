-- HarmonyByrd HQ · migration 0007 · follow-ups from the re-verification of the review fixes
--
--   F1  A proposal can never introduce a claim of acceptance. At submission and again at acceptance
--       (checked against the target as it stands then), for updates and creates:
--         - a build whose resulting standing is "accepted_reported", unless the target already had
--           exactly that standing;
--         - a module whose resulting lifecycle.founder_accepted.state is "yes" or "partial", unless the
--           target's current lifecycle.founder_accepted is identical (state, basis, note, citations);
--         - on any record type, a top-level field named founder_accepted.
--       (Evidence of type founder_acceptance was already refused by 0005.) A verbatim quotation proves
--       that words are in a source, not that they report an acceptance, so a citation is not enough.
--   F3  service_role cannot act as anyone: EXECUTE is revoked from it on every function in schema hq
--       except the read helpers, from the catalogue, so nothing is missed.
--   F4  hq.log_access accepts only the action families the application logs as allowed. Founder acts
--       are recorded as allowed only by the SECURITY DEFINER functions that perform them. The audit
--       detail gets a size limit for new rows.
--   F7  A record carrying a founder rejection is called a rejection, not an acceptance, in HQ409.
--
-- Every replaced function is a complete CREATE OR REPLACE of its latest body (0005 or 0006) and keeps
-- every rule; each header lists the rules, marked with the migration and item that added them.

-- ---------------------------------------------------------------------------
-- F1. Acceptance claims.
-- ---------------------------------------------------------------------------

-- Refuse (HQ403) a proposal payload that would make HQ show an acceptance nobody recorded.
-- p_type is the record type (the target's for an update, payload.record_type for a create); p_cur is
-- the target's current version for an update and null for a create. The comparison is with the target
-- as it stands when this is called, so review_proposal re-checks against the record at acceptance.
create function hq._refuse_acceptance_claims(p_type text, p_payload jsonb, p_cur hq.record_versions) returns void
language plpgsql stable as $$
declare
  v_update boolean := p_payload ->> 'op' = 'update';
  v_doc    jsonb := case when p_payload ->> 'op' = 'update' then p_payload -> 'set' else p_payload -> 'record' end;
  v_before jsonb := case when p_payload ->> 'op' = 'update' then p_cur.data end;
  v_after  jsonb;
  v_key    text;
  v_fa     jsonb;
  v_was    jsonb;
  v_rule   constant text := 'acceptance is recorded only by a founder decision in HQ or by an import; a proposal cannot assert it';
begin
  if jsonb_typeof(v_doc) is distinct from 'object' then
    return;
  end if;

  -- Any record type: a top-level founder_accepted field (also when spelt as a dotted path).
  for v_key in select jsonb_object_keys(v_doc) loop
    if v_key = 'founder_accepted' or v_key like '%.founder\_accepted' then
      raise exception 'field "%": %', v_key, v_rule using errcode = 'HQ403';
    end if;
  end loop;

  -- The record as it would stand after acceptance (an update merges top-level fields).
  v_after := case when v_update then coalesce(v_before, '{}'::jsonb) || v_doc else v_doc end;

  -- A build reported as accepted.
  if p_type = 'build' and v_after ->> 'standing' = 'accepted_reported'
     and (v_before ->> 'standing') is distinct from 'accepted_reported' then
    raise exception 'build standing "accepted_reported": %', v_rule using errcode = 'HQ403';
  end if;

  -- A module whose lifecycle reports founder acceptance. Replacing the whole lifecycle object, or
  -- giving a lifecycle with only founder_accepted in it, both end up here.
  if p_type = 'module' then
    v_fa := v_after #> '{lifecycle,founder_accepted}';
    if jsonb_typeof(v_fa) = 'object' and v_fa ->> 'state' in ('yes', 'partial') then
      v_was := v_before #> '{lifecycle,founder_accepted}';
      if jsonb_typeof(v_was) is distinct from 'object'
         or jsonb_build_object('state', v_fa -> 'state', 'basis', v_fa -> 'basis', 'note', v_fa -> 'note', 'citations', v_fa -> 'citations')
            is distinct from
            jsonb_build_object('state', v_was -> 'state', 'basis', v_was -> 'basis', 'note', v_was -> 'note', 'citations', v_was -> 'citations') then
        raise exception 'lifecycle.founder_accepted "%": %', v_fa ->> 'state', v_rule using errcode = 'HQ403';
      end if;
    end if;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- (0005) Rules that depend on the target record as it stands. Called by submit_proposal and again by
-- review_proposal, before the stale check (so a proposal refused here stays "submitted").
--   (0005, D2)   a target whose hq_acceptance.state is accepted or rejected cannot be changed by
--                proposal (HQ409); a cleared acceptance (state none) does not block;
--   (0005, D1c)  evidence whose verification is hq_verified or source_reported: type, result,
--                sha256, date and build_id cannot be changed (HQ403);
--   (0005, D1b)  a top-level source-backed label in "set" needs citations on the merged record;
--   (0007, F7)   the HQ409 message says "rejection" for a rejected target, "acceptance" otherwise.
-- ---------------------------------------------------------------------------
create or replace function hq._validate_against_target(p_target_type text, p_payload jsonb, p_cur hq.record_versions) returns void
language plpgsql stable as $$
declare
  v_set    jsonb := p_payload -> 'set';
  v_merged jsonb;
  v_key    text;
  v_state  text := p_cur.data #>> '{hq_acceptance,state}';
begin
  if p_payload ->> 'op' is distinct from 'update' or p_cur.record_id is null then
    return;
  end if;
  if v_state in ('accepted', 'rejected') then
    raise exception '%/% carries a founder % recorded in HQ (%). Record a founder decision that clears it first, or propose a new record.',
      p_target_type, p_cur.record_id, case when v_state = 'rejected' then 'rejection' else 'acceptance' end,
      coalesce(p_cur.data #>> '{hq_acceptance,decision_id}', 'decision unknown')
      using errcode = 'HQ409',
            detail = jsonb_build_object('acceptance', p_cur.data -> 'hq_acceptance')::text;
  end if;
  if p_target_type = 'evidence' and p_cur.data ->> 'verification' in ('hq_verified', 'source_reported')
     and v_set ?| array['type', 'result', 'sha256', 'date', 'build_id'] then
    raise exception 'evidence that a source reports or that HQ''s build checked cannot be rewritten by proposal; submit new evidence instead'
      using errcode = 'HQ403';
  end if;
  v_merged := p_cur.data || v_set;
  foreach v_key in array case when p_target_type = 'loop' then array['epistemic', 'basis', 'standing'] else array['epistemic', 'basis'] end loop
    if jsonb_typeof(v_set -> v_key) = 'string'
       and v_set ->> v_key in ('reported', 'design_intention', 'source_recommendation', 'founder_statement')
       and (jsonb_typeof(v_merged -> 'citations') is distinct from 'array' or jsonb_array_length(v_merged -> 'citations') = 0) then
      raise exception 'a "%" statement must cite at least one source (field "%"); without one, use "submitter_claim"', v_set ->> v_key, v_key
        using errcode = 'HQ422';
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- submit_proposal: the only way into the inbox.
-- Rules:
--   (0003) active principal; role founder, developer or ai_agent; tokens need the propose scope;
--          idempotent replay by key; payload validated (hq._validate_payload); base_rev known;
--          an update names an existing target and the version read, and is refused if stale;
--   (0005)  an update is also checked against the target as it stands (hq._validate_against_target:
--          D2 founder acceptance, D1c evidence rewrite, D1b top-level citations);
--   (0006, D5) no in-transaction "denied" audit (it would be rolled back);
--   (0007, F1) no claim of acceptance (hq._refuse_acceptance_claims), for an update against the
--          target as it stands, for a create on its own.
-- ---------------------------------------------------------------------------
create or replace function hq.submit_proposal(
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
    raise exception 'role "%" may not submit proposals', v_p.app_role using errcode = 'HQ403';
  end if;
  if v_claims ? 'scopes' and not (v_claims -> 'scopes' ? 'propose') then
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
    perform hq._validate_against_target(p_target_type, p_payload, v_cur);
    perform hq._refuse_acceptance_claims(p_target_type, p_payload, v_cur);
    if p_base_version <> v_cur.version then
      raise exception 'stale revision: %/% is at version % (you read version %). Re-read the record and resubmit.',
        p_target_type, p_target_id, v_cur.version, p_base_version
        using errcode = 'HQ409',
              detail = jsonb_build_object('current_version', v_cur.version, 'base_version', p_base_version, 'head_rev', v_head)::text;
    end if;
  else
    perform hq._refuse_acceptance_claims(p_payload ->> 'record_type', p_payload, null::hq.record_versions);
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

-- ---------------------------------------------------------------------------
-- review_proposal: founder only. Accepting applies the proposal as a new record version
-- inside a new dataset revision; a stale proposal is marked and refused.
-- Rules:
--   (0003) active human founder in an interactive session; decision accept/reject/needs_changes;
--          serialised with every writer; only a "submitted" proposal can be reviewed; the payload
--          is re-validated at acceptance (so 0005's payload rules apply here too); a stale update
--          is marked stale and not applied; a created requirement starts "unreviewed"; created
--          evidence is labelled unverified and attributed to its submitter;
--   (0005, D2/D1c/D1b) an update is re-checked against the target as it stands BEFORE the stale
--          check: a target that gained a founder acceptance after submission is refused with
--          HQ409 and the proposal stays "submitted";
--   (0005, D1c) an accepted update to evidence that is not source-reported or HQ-verified keeps it
--          labelled unverified and attributed to this proposal's submitter, exactly as a create;
--          a created recommendation's made_by is "Proposed through the inbox by <handle>";
--   (0007, F1) no claim of acceptance (hq._refuse_acceptance_claims): an update is re-checked against
--          the target as it stands now, BEFORE the stale check (the proposal stays "submitted"); a
--          create is checked on its own.
-- The set_config('hq.write_context', …) calls are inert since 0006 (nothing reads the setting).
-- ---------------------------------------------------------------------------
create or replace function hq.review_proposal(p_id text, p_decision text, p_note text default null) returns jsonb
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
  v_exists  boolean;
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
    v_exists := found and not v_cur.deleted;
    if v_exists then
      perform hq._validate_against_target(v_prop.target_type, v_prop.payload, v_cur);
      perform hq._refuse_acceptance_claims(v_prop.target_type, v_prop.payload, v_cur);
    end if;
    if not v_exists or v_cur.version <> v_prop.base_version then
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
    if v_type = 'evidence' and coalesce(v_cur.data ->> 'verification', '') not in ('hq_verified', 'source_reported') then
      -- Changing a submission keeps it a submission, now attributed to whoever proposed the change.
      v_data := v_data || jsonb_build_object(
        'verification', case when v_sub.kind = 'ai_client' then 'agent_submitted_unverified' else 'submitted_unverified' end,
        'submitted_by', v_sub.handle);
    end if;
  else
    perform hq._refuse_acceptance_claims(v_prop.payload ->> 'record_type', v_prop.payload, null::hq.record_versions);
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
    if v_type = 'recommendation' then
      -- Never left to a default that would name HQ's builder as the author.
      v_data := v_data || jsonb_build_object('made_by', 'Proposed through the inbox by ' || v_sub.handle);
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
-- Sealing trigger: assigns the version number, links the hash chain and enforces the
-- rules that must hold on EVERY write path, whatever function performs the insert.
-- Rules:
--   (0002) data.id equals record_id; the author is a known principal;
--          1 each origin has exactly one write context; 2 proposal acceptances and founder
--          decisions are authored by an active human founder; 3 hq_acceptance is set only by a
--          founder decision; 4 a decision recorded in HQ comes only from a founder decision;
--          5 a requirement's disposition changes only by founder decision; 6 a requirement's
--          original wording and provenance never change;
--   (0005, D2) 7 a record whose current hq_acceptance.state is accepted or rejected cannot get a
--          new version (changed content, or retirement) from anything but a founder decision;
--   (0006, D3) 0 the version goes into an existing, unsealed revision that is the latest one and is
--          no earlier than the record's previous version; Rule 1 reads the write context from
--          hq._write_context (opened by _begin_revision in this transaction), never from a setting;
--          the version's rev and author are the open revision's;
--   (0007, F7) Rule 7's message says "rejection" for a rejected record.
-- ---------------------------------------------------------------------------
create or replace function hq.tg_record_version_seal() returns trigger
language plpgsql as $$
declare
  v_prev      hq.record_versions;
  v_first     hq.record_versions;
  v_actor     hq.principals;
  v_wc        hq._write_context := hq._write_context_now();
  v_ctx       text;
  v_revision  hq.dataset_revisions;
  v_acc_state text;
  v_field     text;
begin
  v_ctx := coalesce(v_wc.context, '');

  select * into v_prev from hq.record_versions
   where record_type = new.record_type and record_id = new.record_id
   order by version desc limit 1;

  new.version      := coalesce(v_prev.version, 0) + 1;
  new.prev_hash    := v_prev.row_hash;
  new.content_hash := encode(sha256(convert_to(new.data::text, 'UTF8')), 'hex');
  new.row_hash     := encode(sha256(convert_to(
                        coalesce(new.prev_hash, '') || '|' || new.record_type || '|' || new.record_id || '|' ||
                        new.version::text || '|' || new.rev::text || '|' || new.deleted::text || '|' ||
                        new.content_hash, 'UTF8')), 'hex');

  if new.data ->> 'id' is distinct from new.record_id then
    raise exception 'record data.id (%) must equal record_id (%)', new.data ->> 'id', new.record_id
      using errcode = 'HQ422';
  end if;

  select * into v_actor from hq.principals where id = new.created_by;
  if not found then
    raise exception 'unknown principal for record write' using errcode = 'HQ403';
  end if;

  -- Rule 0 (0006, D3). A version belongs to the revision being written now. Sealed revisions are
  -- final: reading revision N must give the same records forever.
  select * into v_revision from hq.dataset_revisions where rev = new.rev;
  if not found then
    raise exception 'dataset revision % does not exist', new.rev using errcode = 'HQ403';
  end if;
  if v_revision.content_hash is not null then
    raise exception 'dataset revision % is sealed: nothing can be added to it', new.rev using errcode = 'HQ403';
  end if;
  if new.rev <> (select max(rev) from hq.dataset_revisions) then
    raise exception 'dataset revision % is not the latest revision', new.rev using errcode = 'HQ403';
  end if;
  if v_prev.version is not null and new.rev < v_prev.rev then
    raise exception '%/% already has a version in revision %; a new version cannot go into earlier revision %',
      new.record_type, new.record_id, v_prev.rev, new.rev using errcode = 'HQ403';
  end if;

  -- Rule 1. Each origin has exactly one legitimate write context.
  if new.origin = 'seed_import' and v_ctx <> 'admin_import' then
    raise exception 'seed_import records can only be written by the administrative import function'
      using errcode = 'HQ403';
  elsif new.origin = 'proposal_acceptance' and v_ctx <> 'review_proposal' then
    raise exception 'proposal_acceptance records can only be written by hq.review_proposal'
      using errcode = 'HQ403';
  elsif new.origin = 'founder_decision' and v_ctx <> 'founder_decision' then
    raise exception 'founder_decision records can only be written by hq.record_founder_decision'
      using errcode = 'HQ403';
  end if;
  -- (0006, D3) …and that context opened this very revision, for this author.
  if new.rev is distinct from v_wc.rev or new.created_by is distinct from v_wc.actor
     or new.created_by is distinct from v_revision.created_by then
    raise exception 'a record version must go into the revision this transaction opened (%), by that revision''s author', v_wc.rev
      using errcode = 'HQ403';
  end if;

  -- Rule 2. Anything that changes authoritative records after import is a founder act,
  -- performed by a human founder identity. An AI client can never be the author.
  if new.origin in ('proposal_acceptance', 'founder_decision')
     and not (v_actor.app_role = 'founder' and v_actor.kind = 'human' and v_actor.active) then
    raise exception 'only an active human founder can author % records', new.origin
      using errcode = 'HQ403';
  end if;

  -- Rule 3. HQ-recorded acceptance exists only as the effect of a founder decision.
  v_acc_state := new.data #>> '{hq_acceptance,state}';
  if v_acc_state is not null and v_acc_state <> 'none'
     and (v_prev.version is null
          or (v_prev.data -> 'hq_acceptance') is distinct from (new.data -> 'hq_acceptance'))
     and new.origin <> 'founder_decision' then
    raise exception 'hq_acceptance can only be set by a recorded founder decision'
      using errcode = 'HQ403';
  end if;

  -- Rule 7 (0005, D2). A founder acceptance binds to the content that was accepted. While a record
  -- carries one, only another founder decision may write a new version of it.
  if v_prev.version is not null and new.origin <> 'founder_decision'
     and (v_prev.data #>> '{hq_acceptance,state}') in ('accepted', 'rejected')
     and (new.data is distinct from v_prev.data or new.deleted is distinct from v_prev.deleted) then
    raise exception '%/% carries a founder % recorded in HQ (%); only a founder decision can change it',
      new.record_type, new.record_id,
      case when v_prev.data #>> '{hq_acceptance,state}' = 'rejected' then 'rejection' else 'acceptance' end,
      coalesce(v_prev.data #>> '{hq_acceptance,decision_id}', 'decision unknown')
      using errcode = 'HQ409';
  end if;

  -- Rule 4. A decision recorded in HQ can only come from the founder decision function.
  if new.record_type = 'decision' and new.data ->> 'recorded_in' = 'hq'
     and new.origin <> 'founder_decision' then
    raise exception 'decisions recorded in HQ can only be written by hq.record_founder_decision'
      using errcode = 'HQ403';
  end if;

  -- Rule 5. A requirement's disposition changes only through a founder decision.
  if new.record_type = 'requirement' and v_prev.version is not null
     and (v_prev.data ->> 'disposition') is distinct from (new.data ->> 'disposition')
     and new.origin <> 'founder_decision' then
    raise exception 'a requirement disposition can only be changed by a recorded founder decision'
      using errcode = 'HQ403';
  end if;

  -- Rule 6. The original wording and provenance of a founder requirement are permanent.
  -- A correction is a new requirement that supersedes the old one, never a rewrite.
  if new.record_type = 'requirement' and v_prev.version is not null then
    select * into v_first from hq.record_versions
     where record_type = new.record_type and record_id = new.record_id and version = 1;
    foreach v_field in array array['exact_wording', 'source_id', 'locator', 'source_date', 'attribution'] loop
      if (v_first.data -> v_field) is distinct from (new.data -> v_field) then
        raise exception 'requirement field "%" is immutable (original wording and provenance are preserved)', v_field
          using errcode = 'HQ403';
      end if;
    end loop;
  end if;

  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- F4, F6. hq.log_access: an allowed use, recorded for the application.
-- Rules:
--   (0006, D5) outcome fixed to "allowed"; only an active principal named by the claims, outside anon
--          (HQ401); a request id that is not 1-64 of [A-Za-z0-9._-] is not stored (the detail says so);
--   (0007, F4) the action must be one the application logs as allowed (HQ422):
--            api.<name>, mcp.<tool>, tool.<tool>, tools.list, integrations.read, proposal.read,
--            session.sign_in, session.sign_out, session.end_all.
--          Founder acts (proposal.review, decision.record, credential.*) and proposal.submit /
--          proposal.withdraw are recorded as allowed only by the SECURITY DEFINER functions that
--          perform them, never through this function.
--   (0007, F6) p_request_id is the id the server gave the request. An id the client sent is kept
--          apart, in detail.client_request_id, and only if it is 1-64 of [A-Za-z0-9._-]; it is for
--          the client's own correlation and is never the request id.
-- The 0006 function took four arguments; it is dropped and replaced, so a call with four still works.
-- ---------------------------------------------------------------------------
drop function hq.log_access(text, text, text, text);
create function hq.log_access(p_action text, p_object_type text, p_object_id text, p_request_id text, p_client_request_id text default null)
returns void
language plpgsql security definer set search_path = hq, pg_catalog as $$
declare
  v_p       hq.principals;
  v_request text := p_request_id;
  v_detail  jsonb;
begin
  if current_setting('role', true) is distinct from 'anon' then
    select * into v_p from hq.principals where id = hq.current_principal_id() and active;
  end if;
  if v_p.id is null then
    raise exception 'an allowed access can only be recorded for an active, signed-in principal' using errcode = 'HQ401';
  end if;
  if p_action is null
     or p_action !~ '^(api\.[a-z_.]+|mcp\.[a-z_.]+|tool\.[a-z_]+|tools\.list|integrations\.read|proposal\.read|session\.(sign_in|sign_out|end_all))$' then
    raise exception 'audit action "%" cannot be recorded as allowed here: founder acts and proposals are recorded by the functions that perform them',
      left(coalesce(p_action, ''), 60) using errcode = 'HQ422';
  end if;
  if v_request is not null and v_request !~ '^[A-Za-z0-9._-]{1,64}$' then
    v_request := null;
    v_detail := jsonb_build_object('request_id_refused', true);
  end if;
  if p_client_request_id is not null and p_client_request_id ~ '^[A-Za-z0-9._-]{1,64}$' then
    v_detail := coalesce(v_detail, '{}'::jsonb) || jsonb_build_object('client_request_id', p_client_request_id);
  end if;
  insert into hq.audit_log (principal_id, principal_handle, app_role, client, action, object_type, object_id, outcome, detail, request_id)
  values (v_p.id, v_p.handle, v_p.app_role, left(hq.jwt_claims() ->> 'client', 60),
          p_action, left(p_object_type, 60), left(p_object_id, 120), 'allowed', v_detail, v_request);
end
$$;

-- F4. A size limit on audit detail for every new row, whoever writes it (hq.log_refusal keeps its
-- own, tighter 8192-byte limit). NOT VALID: rows written before this migration are not re-checked.
alter table hq.audit_log
  add constraint audit_log_detail_size check (pg_column_size(detail) <= 16384) not valid;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------
revoke all on function hq._refuse_acceptance_claims(text, jsonb, hq.record_versions)
  from public, anon, authenticated, hq_auth, service_role;
revoke all on function hq._validate_against_target(text, jsonb, hq.record_versions), hq.tg_record_version_seal()
  from public, anon, authenticated, hq_auth, service_role;
revoke all on function
  hq.submit_proposal(text, text, text, integer, bigint, text, text, jsonb, jsonb, text),
  hq.review_proposal(text, text, text),
  hq.log_access(text, text, text, text, text)
  from public, anon, hq_auth;
grant execute on function
  hq.submit_proposal(text, text, text, integer, bigint, text, text, jsonb, jsonb, text),
  hq.review_proposal(text, text, text)
  to authenticated;
grant execute on function hq.log_access(text, text, text, text, text) to authenticated, anon, hq_auth;

-- F3. service_role reads; it acts as no one. 0004 granted it EXECUTE on every function, which let it
-- call the founder functions with forged claims. Revoke EXECUTE on every function in schema hq, read
-- from the catalogue so none is missed, except the read helpers; then grant those explicitly.
-- (PUBLIC is revoked too where a function still had it, since service_role would inherit it.)
do $$
declare
  f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'hq'
              and p.proname not in ('records_at', 'dataset_hash', 'head_rev', 'head_seal', 'verify_chain',
                                    'principal_directory', 'jwt_claims', 'current_principal_id',
                                    'current_principal', 'current_app_role', 'current_principal_kind') loop
    execute format('revoke all on function %s from service_role', f);
    if has_function_privilege('service_role', f, 'execute') then
      raise exception 'service_role still holds EXECUTE on % (through PUBLIC); revoke it from PUBLIC first', f;
    end if;
  end loop;
end
$$;
grant execute on function
  hq.records_at(bigint), hq.dataset_hash(bigint), hq.head_rev(), hq.head_seal(), hq.verify_chain(),
  hq.principal_directory(), hq.jwt_claims(), hq.current_principal_id(), hq.current_principal(),
  hq.current_app_role(), hq.current_principal_kind()
  to service_role;

-- Functions created later. PostgreSQL grants EXECUTE on every new function to PUBLIC, and so to
-- service_role. This migration does not change the database's default privileges: that default
-- belongs to the whole database and to every schema in it, not to HQ, and a per-schema default can
-- only add privileges, never remove one. Instead every migration that creates a function in schema hq
-- must revoke it from PUBLIC and grant it to the roles that need it, as this one does, and
-- tests/db/service-role.test.ts reads the catalogue and fails if service_role (or PUBLIC) can execute
-- any function in schema hq other than the read helpers.
