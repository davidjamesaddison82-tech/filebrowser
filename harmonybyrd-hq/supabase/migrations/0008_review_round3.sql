-- HarmonyByrd HQ · migration 0008 · third round: no way round the acceptance rules from the database
--
--   G1a  A build a source reports as accepted is frozen for proposals. If the target's current standing
--        is "accepted_reported", a proposal is refused (HQ403) unless its resulting standing is another,
--        valid standing (it withdraws the claim). Statement, module, label, artifact, checksum: all at once.
--   G1b  A module's lifecycle.founder_accepted: "identical" is the whole entry (jsonb equality), and any
--        entry other than one whose state is exactly no, unknown or not_applicable is positive.
--   G1c  The database checks the values that drive labels itself. hq.field_enums lists, per record
--        type, the fields and their allowed values (the same lists as src/lib/domain/schemas.ts
--        FIELD_ENUMS; a test compares them). hq._check_field_enums refuses (HQ422) a value outside its
--        list in the record as it would stand: the fields the proposal sets, and always the fields that
--        drive acceptance (build standing, module lifecycle, evidence type). It runs at submission and
--        again at acceptance, on update (from hq._validate_against_target) and create (from
--        hq._validate_payload).
--   G2   Audit actions are bounded: hq.log_access accepts each family with a length limit and no dot
--        inside a name, and refuses any name that reads like a founder act; hq.log_refusal refuses an
--        action over 80 characters; the audit log itself checks the length of new rows.
--
-- Every replaced function is a complete CREATE OR REPLACE of its latest body (0005, 0006 or 0007) and
-- keeps every rule; the changed lines are marked (0008, G…).

-- ---------------------------------------------------------------------------
-- G1c. The values that drive labels.
-- ---------------------------------------------------------------------------

-- path: "field" (a top-level field), "field.*" (the keys of an object field), "field.*.sub" (a field of
-- every entry of an object field), "**.key" (that key in any object at any depth). record_type "*"
-- applies to every type. drives_acceptance: checked in the whole resulting record, not only where the
-- proposal sets it, so an odd value can never stand behind an acceptance label.
create table hq.field_enums (
  record_type       text    not null,
  path              text    not null,
  allowed           text[]  not null check (cardinality(allowed) > 0),
  drives_acceptance boolean not null default false,
  primary key (record_type, path)
);
-- Read by the checks, which run as the owner; no API role needs it.
revoke all on table hq.field_enums from public, anon, authenticated, hq_auth, service_role;

insert into hq.field_enums (record_type, path, allowed, drives_acceptance) values
  ('*',              '**.epistemic',         array['verified', 'reported', 'design_intention', 'source_recommendation', 'founder_statement', 'hq_recommendation', 'submitter_claim', 'no_evidence'], false),
  ('build',          'standing',             array['accepted_reported', 'candidate_not_accepted', 'development', 'superseded', 'withdrawn', 'unknown'], true),
  ('commission',     'status',               array['delivered', 'in_progress', 'proposed', 'closed', 'deferred', 'unknown'], false),
  ('decision',       'recorded_in',          array['source', 'hq'], false),
  ('decision',       'status',               array['issued', 'unissued', 'pending', 'held', 'rejected', 'superseded', 'unknown'], false),
  ('defect',         'severity',             array['blocking', 'major', 'minor', 'unknown'], false),
  ('defect',         'status',               array['open', 'resolved', 'deferred', 'unknown'], false),
  ('evidence',       'type',                 array['automated_test', 'browser_test', 'manual_test', 'hardware_midi_test', 'musical_correctness', 'independent_audit', 'founder_acceptance', 'founder_observation', 'hash_manifest', 'failure_ledger', 'screenshot', 'research_evidence', 'release_reference', 'hq_check', 'other'], true),
  ('evidence',       'verification',         array['hq_verified', 'source_reported', 'submitted_unverified', 'agent_submitted_unverified'], false),
  ('loop',           'standing',             array['verified', 'reported', 'design_intention', 'source_recommendation', 'founder_statement', 'hq_recommendation', 'submitter_claim', 'no_evidence'], false),
  ('module',         'evidence_level',       array['documented_in_sources', 'named_only', 'commission_list_only'], false),
  ('module',         'kind',                 array['module', 'submodule', 'workstream', 'shared_engine', 'programme', 'experiment', 'product'], false),
  ('module',         'lifecycle.*',          array['documented', 'designed', 'prototyped', 'implemented', 'automated_tests', 'browser_tested', 'hardware_tested', 'independently_assessed', 'founder_accepted', 'integrated', 'released', 'learner_validated'], true),
  ('module',         'lifecycle.*.basis',    array['verified', 'reported', 'design_intention', 'source_recommendation', 'founder_statement', 'hq_recommendation', 'submitter_claim', 'no_evidence'], true),
  ('module',         'lifecycle.*.state',    array['yes', 'partial', 'no', 'unknown', 'not_applicable'], true),
  ('open_item',      'kind',                 array['pending_founder_decision', 'blocker', 'unresolved_dependency', 'unverified_claim', 'risk', 'not_authorised', 'missing_evidence', 'source_gap'], false),
  ('pathway',        'basis',                array['reported', 'design_intention', 'commission_example', 'hq_recommendation', 'source_recommendation'], false),
  ('recommendation', 'status',               array['proposed'], false),
  ('requirement',    'attribution',          array['commission_text', 'direct_quote', 'ruling_recorded_by_source', 'restated_by_source'], false),
  ('requirement',    'category',             array['scope', 'pedagogy', 'ui_ux', 'assessment_authority', 'governance', 'testing', 'release', 'privacy', 'technical', 'content', 'other'], false),
  ('requirement',    'disposition',          array['unreviewed', 'active', 'superseded', 'conflicted', 'deferred', 'withdrawn', 'satisfied'], false),
  ('requirement',    'implementation_state', array['no_record', 'not_started', 'in_progress', 'implemented_unverified', 'implemented_tested'], false),
  ('source',         'access',               array['read_full', 'read_partial', 'inventoried_not_ingested', 'not_accessible'], false),
  ('source',         'authority',            array['founder_instrument', 'founder_decision_record', 'decision_preparation', 'design_package', 'assessment_or_research', 'executable_candidate', 'test_or_field_record', 'production_asset', 'referenced_only', 'out_of_scope', 'fixture'], false),
  ('source',         'kind',                 array['claude_artifact_docs', 'claude_artifact_html', 'claude_artifact_design', 'commission_text', 'github_repository', 'google_drive', 'named_not_accessible', 'fixture'], false);

-- One value against its list (HQ422): it must be a JSON string that is one of the allowed values. The
-- refusal names the field and shows the value's first 40 characters.
create function hq._refuse_enum_value(p_field text, p_value jsonb, p_allowed text[]) returns void
language plpgsql immutable as $$
begin
  if jsonb_typeof(p_value) is distinct from 'string' or not ((p_value #>> '{}') = any (p_allowed)) then
    raise exception 'field "%" holds %, which is not one of its allowed values', p_field,
      case when jsonb_typeof(p_value) = 'string' then '"' || left(p_value #>> '{}', 40) || '"' else left(coalesce(p_value::text, 'null'), 40) end
      using errcode = 'HQ422';
  end if;
end
$$;

-- The values that drive labels, in the record a proposal would leave (G1c). p_cur is the target's
-- current version for an update, null for a create. For an update the rows that do not drive
-- acceptance are checked only in the fields the proposal sets, so an odd value imported before this
-- rule does not block an unrelated change; the rows that drive acceptance are checked in the whole
-- resulting record. Mirrored by fieldEnumProblem in src/lib/domain/schemas.ts, in the same order.
create function hq._check_field_enums(p_type text, p_payload jsonb, p_cur hq.record_versions) returns void
language plpgsql stable as $$
declare
  v_update boolean := p_payload ->> 'op' = 'update';
  v_doc    jsonb := case when p_payload ->> 'op' = 'update' then p_payload -> 'set' else p_payload -> 'record' end;
  v_after  jsonb;
  v_scope  jsonb;
  v_row    hq.field_enums;
  v_target jsonb;
  v_parts  text[];
  v_obj    jsonb;
  v_value  jsonb;
  v_key    text;
  v_entry  jsonb;
  v_field  text;
begin
  if jsonb_typeof(v_doc) is distinct from 'object' then
    return;
  end if;
  v_after := case when v_update then coalesce(p_cur.data, '{}'::jsonb) || v_doc else v_doc end;
  v_scope := case when v_update
                  then (select coalesce(jsonb_object_agg(k, v_after -> k), '{}'::jsonb) from jsonb_object_keys(v_doc) k)
                  else v_after end;
  for v_row in select * from hq.field_enums where record_type in (p_type, '*') order by path collate "C" loop
    v_target := case when v_row.drives_acceptance then v_after else v_scope end;
    v_parts := string_to_array(v_row.path, '.');
    if v_parts[1] = '**' then
      for v_obj in select o from jsonb_path_query(v_target, 'strict $.** ? (@.type() == "object")') o loop
        if v_obj ? v_parts[2] then
          perform hq._refuse_enum_value(v_parts[2], v_obj -> v_parts[2], v_row.allowed);
        end if;
      end loop;
      continue;
    end if;
    continue when not (v_target ? v_parts[1]);
    v_value := v_target -> v_parts[1];
    if cardinality(v_parts) = 1 then
      perform hq._refuse_enum_value(v_parts[1], v_value, v_row.allowed);
      continue;
    end if;
    if jsonb_typeof(v_value) is distinct from 'object' then
      raise exception 'field "%" must be an object', v_parts[1] using errcode = 'HQ422';
    end if;
    for v_key, v_entry in select e.key, e.value from jsonb_each(v_value) e loop
      if cardinality(v_parts) = 2 then
        if not (v_key = any (v_row.allowed)) then
          raise exception 'field "%" holds the key "%", which is not one of its allowed keys', v_parts[1], left(v_key, 40)
            using errcode = 'HQ422';
        end if;
        continue;
      end if;
      v_field := v_parts[1] || '.' || v_key;
      if jsonb_typeof(v_entry) is distinct from 'object' then
        raise exception 'field "%" must be an object', v_field using errcode = 'HQ422';
      end if;
      if v_entry ? v_parts[3] then
        perform hq._refuse_enum_value(v_field || '.' || v_parts[3], v_entry -> v_parts[3], v_row.allowed);
      end if;
    end loop;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- (0005) Validate the shape of a proposal payload. Raises HQ422 (invalid) or HQ403 (protected field).
-- Called at submission and again at acceptance. Rules:
--   (0003) op is "update" or "create"; updates need a target, never a decision, and a non-empty
--          "set"; creates name a creatable record type matching the proposal kind;
--   (0003) protected fields (hq.protected_fields) are refused; on create the requirement's
--          original (source_id, locator, source_date, attribution, exact_wording) may be given;
--   (0005, D15)  build-only fields (hq.build_only_fields) are refused in "set" and "record";
--   (0005, D1c)  source update: hq.source_integrity_fields() are refused;
--                source create: only kind named_not_accessible / access not_accessible /
--                authority referenced_only, and no sha256, bytes, text_snapshot or parts;
--                evidence create or update: type founder_acceptance or hq_check is refused;
--   (0005, D1b)  HQ's own labels refused; source-backed labels need citations (hq._check_labels);
--   (0005, D1a)  every quotation verifies against hq.source_texts (hq._check_quotes); a created
--                requirement's exact_wording occurs verbatim in its source's text;
--   (0008, G1c)  a created record's values that drive labels are in their lists (hq._check_field_enums).
-- Rules that depend on the target's current version are in hq._validate_against_target.
-- ---------------------------------------------------------------------------
create or replace function hq._validate_payload(p_kind text, p_target_type text, p_payload jsonb) returns void
language plpgsql as $$
declare
  v_op   text := p_payload ->> 'op';
  v_key  text;
  v_type text;
  v_doc  jsonb;
  v_prob jsonb;
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
    v_type := p_target_type;
    v_doc := p_payload -> 'set';
    for v_key in select jsonb_object_keys(v_doc) loop
      if v_key = any (hq.protected_fields() || hq.build_only_fields(v_type)) then
        raise exception 'field "%" is protected and cannot be changed by a proposal', v_key using errcode = 'HQ403';
      end if;
      if v_type = 'source' and v_key = any (hq.source_integrity_fields()) then
        raise exception 'field "%" is protected and cannot be changed by a proposal: it describes the snapshot HQ read', v_key
          using errcode = 'HQ403';
      end if;
    end loop;
    if p_kind in ('defect_report', 'test_evidence') then
      raise exception '% proposals create a new record; use op "create"', p_kind using errcode = 'HQ422';
    end if;
    if v_type = 'evidence' and v_doc ->> 'type' in ('founder_acceptance', 'hq_check') then
      raise exception 'evidence of type "%" cannot be made by proposal: it is recorded by the founder or by HQ''s build', v_doc ->> 'type'
        using errcode = 'HQ403';
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
    v_doc := p_payload -> 'record';
    for v_key in select jsonb_object_keys(v_doc) loop
      if (v_key = any (hq.protected_fields()) and not (v_key in ('source_id', 'locator', 'source_date', 'attribution', 'exact_wording')))
         or v_key = any (hq.build_only_fields(v_type)) then
        raise exception 'field "%" is protected and cannot be set by a proposal', v_key using errcode = 'HQ403';
      end if;
    end loop;
    if v_type = 'source' then
      if v_doc ->> 'kind' is distinct from 'named_not_accessible' or v_doc ->> 'access' is distinct from 'not_accessible'
         or v_doc ->> 'authority' is distinct from 'referenced_only' then
        raise exception 'a proposal can only add a source that is named but not accessible (kind "named_not_accessible", access "not_accessible", authority "referenced_only"); sources HQ has read come only from an import'
          using errcode = 'HQ403';
      end if;
      foreach v_key in array array['sha256', 'bytes', 'text_snapshot', 'parts'] loop
        if v_doc ? v_key then
          raise exception 'field "%" is protected and cannot be set by a proposal: it describes a snapshot HQ read', v_key
            using errcode = 'HQ403';
        end if;
      end loop;
    end if;
    if v_type = 'evidence' and v_doc ->> 'type' in ('founder_acceptance', 'hq_check') then
      raise exception 'evidence of type "%" cannot be made by proposal: it is recorded by the founder or by HQ''s build', v_doc ->> 'type'
        using errcode = 'HQ403';
    end if;
  end if;

  perform hq._check_labels(v_type, v_doc, v_op = 'create');
  perform hq._check_quotes(v_doc);

  if v_op = 'create' and v_type = 'requirement' then
    if jsonb_typeof(v_doc -> 'exact_wording') is distinct from 'string' or jsonb_typeof(v_doc -> 'source_id') is distinct from 'string' then
      raise exception 'a requirement needs its exact_wording and the source_id it quotes' using errcode = 'HQ422';
    end if;
    v_prob := hq._quote_problem(v_doc ->> 'source_id', v_doc ->> 'exact_wording', 'wording');
    if v_prob is not null then
      raise exception '%', v_prob ->> 'message' using errcode = 'HQ422';
    end if;
  end if;

  -- (0008, G1c) a created record's values that drive labels. An update is checked against its target
  -- in hq._validate_against_target, which knows the record as it stands.
  if v_op = 'create' then
    perform hq._check_field_enums(v_type, p_payload, null::hq.record_versions);
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
--   (0007, F7)   the HQ409 message says "rejection" for a rejected target, "acceptance" otherwise;
--   (0008, G1c)  the values that drive labels are in their lists, in the record as it would stand
--                (hq._check_field_enums).
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
  -- (0008, G1c) the values that drive labels, in the record as it would stand.
  perform hq._check_field_enums(p_target_type, p_payload, p_cur);
end
$$;

-- ---------------------------------------------------------------------------
-- (0007, F1) Refuse (HQ403) a proposal payload that would make HQ show an acceptance nobody recorded.
-- p_type is the record type (the target's for an update, payload.record_type for a create); p_cur is
-- the target's current version for an update and null for a create. The comparison is with the target
-- as it stands when this is called, so review_proposal re-checks against the record at acceptance.
-- Rules:
--   (0007, F1)  any type: a top-level founder_accepted field (also as a dotted path);
--               a build whose resulting standing is accepted_reported unless it already was;
--   (0008, G1a) a build whose current standing is accepted_reported: refused unless the resulting
--               standing is another valid standing (the proposal withdraws the claim);
--   (0007, F1 / 0008, G1b) a module whose resulting lifecycle.founder_accepted is positive (anything
--               but an object whose state is exactly no, unknown or not_applicable), unless the whole
--               entry is identical to the target's current one.
-- ---------------------------------------------------------------------------
create or replace function hq._refuse_acceptance_claims(p_type text, p_payload jsonb, p_cur hq.record_versions) returns void
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
  v_frozen constant text := 'a build reported as accepted is changed only by an import or a founder decision; a proposal may only withdraw the reported acceptance';
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

  -- (0008, G1a) A build a source reports as accepted is frozen for proposals: its statement, module,
  -- label, artifact and every other field stay as imported, unless the proposal withdraws the claim
  -- by giving it another standing that is a valid one. Withdrawing a claim is not asserting one.
  if p_type = 'build' and v_update and v_before ->> 'standing' = 'accepted_reported'
     and (jsonb_typeof(v_after -> 'standing') is distinct from 'string'
          or v_after ->> 'standing' = 'accepted_reported'
          or not exists (select from hq.field_enums e
                          where e.record_type = 'build' and e.path = 'standing' and (v_after ->> 'standing') = any (e.allowed))) then
    raise exception 'build %: %', p_cur.record_id, v_frozen using errcode = 'HQ403';
  end if;

  -- A build reported as accepted.
  if p_type = 'build' and v_after ->> 'standing' = 'accepted_reported'
     and (v_before ->> 'standing') is distinct from 'accepted_reported' then
    raise exception 'build standing "accepted_reported": %', v_rule using errcode = 'HQ403';
  end if;

  -- A module whose lifecycle reports founder acceptance. Replacing the whole lifecycle object, or
  -- giving a lifecycle with only founder_accepted in it, both end up here.
  -- (0008, G1b) "Positive" is any entry that is not an object whose state is exactly no, unknown or
  -- not_applicable ("Yes", "yes ", a missing state, a list all count), and "identical" is the whole
  -- entry: an added key such as scope or hq_confirmed is a change.
  if p_type = 'module' then
    v_fa := v_after #> '{lifecycle,founder_accepted}';
    -- (coalesce: a missing state makes the test NULL, and NULL must count as positive, not as "no".)
    if v_fa is not null
       and not coalesce(jsonb_typeof(v_fa) = 'object' and jsonb_typeof(v_fa -> 'state') = 'string'
                        and v_fa ->> 'state' in ('no', 'unknown', 'not_applicable'), false) then
      v_was := v_before #> '{lifecycle,founder_accepted}';
      if v_fa is distinct from v_was then
        raise exception 'lifecycle.founder_accepted "%": %', coalesce(v_fa ->> 'state', ''), v_rule using errcode = 'HQ403';
      end if;
    end if;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- (0006, D5) hq.log_refusal: a refusal (outcome denied or error). Rules: the action is a dotted
-- lower-case name; the detail is at most 8192 bytes; a request id that is not 1-64 of [A-Za-z0-9._-] is
-- not stored (the detail says so). The principal is recorded only if the claims name an active
-- principal and the caller is not anon; otherwise the principal is left empty and the unverified
-- subject goes into detail.claimed_sub.
--   (0008, G2) the action is at most 80 characters (HQ422).
-- The request id is whatever the caller passes: the database cannot know the application server's id.
-- ---------------------------------------------------------------------------
create or replace function hq.log_refusal(
  p_action text, p_object_type text, p_object_id text, p_outcome text, p_detail jsonb, p_request_id text)
returns void
language plpgsql security definer set search_path = hq, pg_catalog as $$
declare
  v_claims  jsonb := hq.jwt_claims();
  v_p       hq.principals;
  v_detail  jsonb := p_detail;
  v_request text := p_request_id;
begin
  if p_outcome is null or p_outcome not in ('denied', 'error') then
    raise exception 'hq.log_refusal records only the outcomes "denied" and "error"' using errcode = 'HQ422';
  end if;
  -- (0008, G2) bounded, so no caller (anon included) can store an action of any size.
  if length(p_action) > 80 then
    raise exception 'audit action is longer than 80 characters' using errcode = 'HQ422';
  end if;
  if p_action is null or p_action !~ '^[a-z_]+(\.[a-z_0-9]+){1,3}$' then
    raise exception 'audit action "%" is not a valid action name', left(coalesce(p_action, ''), 60) using errcode = 'HQ422';
  end if;
  if v_detail is not null and pg_column_size(v_detail) > 8192 then
    raise exception 'audit detail is larger than 8192 bytes' using errcode = 'HQ422';
  end if;
  if v_detail is not null and jsonb_typeof(v_detail) <> 'object' then
    v_detail := jsonb_build_object('detail', v_detail);
  end if;
  if v_request is not null and v_request !~ '^[A-Za-z0-9._-]{1,64}$' then
    v_request := null;
    v_detail := coalesce(v_detail, '{}'::jsonb) || jsonb_build_object('request_id_refused', true);
  end if;
  if current_setting('role', true) is distinct from 'anon' then
    select * into v_p from hq.principals where id = hq.current_principal_id() and active;
  end if;
  if v_p.id is null and v_claims ? 'sub' then
    v_detail := coalesce(v_detail, '{}'::jsonb) || jsonb_build_object('claimed_sub', left(v_claims ->> 'sub', 80));
  end if;
  insert into hq.audit_log (principal_id, principal_handle, app_role, client, action, object_type, object_id, outcome, detail, request_id)
  values (v_p.id, v_p.handle, v_p.app_role, case when v_p.id is not null then left(v_claims ->> 'client', 60) end,
          p_action, left(p_object_type, 60), left(p_object_id, 120), p_outcome, v_detail, v_request);
end
$$;

-- ---------------------------------------------------------------------------
-- hq.log_access: an allowed use, recorded for the application.
-- Rules:
--   (0006, D5) outcome fixed to "allowed"; only an active principal named by the claims, outside anon
--          (HQ401); a request id that is not 1-64 of [A-Za-z0-9._-] is not stored (the detail says so);
--   (0007, F4) the action must be one the application logs as allowed (HQ422). Founder acts
--          (proposal.review, decision.record, credential.*) and proposal.submit / proposal.withdraw are
--          recorded as allowed only by the SECURITY DEFINER functions that perform them;
--   (0007, F6) p_request_id is the id the server gave the request; an id the client sent is kept apart,
--          in detail.client_request_id, and only if it is 1-64 of [A-Za-z0-9._-];
--   (0008, G2) each family is bounded and has no dot inside a name: api.<1-40 of [a-z_]>,
--          mcp.<1-60>, tool.<1-60>, tools.list, integrations.read, proposal.read, session.sign_in,
--          session.sign_out, session.end_all; and a name that contains review, decision, decide,
--          credential, accept, reject, approve, revoke, issue, withdraw or register is refused, except
--          the two read tools whose names contain one of those words (get_acceptance_status,
--          get_review_items), under tool. and mcp.
-- Someone who reaches the database directly with a valid identity can still record, under their own
-- name, that they used a read or propose tool they did not use (docs/KNOWN-GAPS.md).
-- ---------------------------------------------------------------------------
create or replace function hq.log_access(p_action text, p_object_type text, p_object_id text, p_request_id text, p_client_request_id text default null)
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
     or p_action !~ '^(api\.[a-z_]{1,40}|mcp\.[a-z_]{1,60}|tool\.[a-z_]{1,60}|tools\.list|integrations\.read|proposal\.read|session\.(sign_in|sign_out|end_all))$'
     or (p_action ~ '(review|decision|decide|credential|accept|reject|approve|revoke|issue|withdraw|register)'
         and p_action not in ('tool.get_acceptance_status', 'mcp.get_acceptance_status', 'tool.get_review_items', 'mcp.get_review_items')) then
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

-- (0008, G2) The length of an audit action, for every new row, whoever writes it. NOT VALID: rows
-- written before this migration are not re-checked.
alter table hq.audit_log
  add constraint audit_log_action_size check (length(action) <= 80) not valid;

-- ---------------------------------------------------------------------------
-- Grants. PostgreSQL grants EXECUTE to PUBLIC on every new function: revoke it. The new helpers run
-- inside the SECURITY DEFINER functions and are granted to no API role. CREATE OR REPLACE keeps a
-- function's existing privileges; they are restated here so this file says what holds.
-- ---------------------------------------------------------------------------
revoke all on function
  hq._refuse_enum_value(text, jsonb, text[]),
  hq._check_field_enums(text, jsonb, hq.record_versions),
  hq._validate_payload(text, text, jsonb),
  hq._validate_against_target(text, jsonb, hq.record_versions),
  hq._refuse_acceptance_claims(text, jsonb, hq.record_versions)
  from public, anon, authenticated, hq_auth, service_role;
revoke all on function
  hq.log_refusal(text, text, text, text, jsonb, text),
  hq.log_access(text, text, text, text, text)
  from public, service_role;
grant execute on function
  hq.log_refusal(text, text, text, text, jsonb, text),
  hq.log_access(text, text, text, text, text)
  to authenticated, anon, hq_auth;
