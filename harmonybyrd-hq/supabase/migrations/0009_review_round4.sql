-- HarmonyByrd HQ · migration 0009 · fourth round: what a proposal may say
--
--   H1   What enters through the inbox is the submitter's claim. In the record a proposal would leave,
--        every object at any depth that carries "epistemic" or "basis" with a label that says a source
--        reports something (reported, design_intention, source_recommendation, founder_statement) must
--        be identical, as a whole object, to the object at the same path (list positions included) in
--        the target's current record; a top-level label field (a loop's standing, a pathway's basis)
--        may not become such a label unless it already holds exactly that value. Otherwise HQ403. So a
--        create carries no source label at all. A pathway's "commission_example" (the commission gives
--        this pathway as an example) is a claim about a source too and follows the same rule, so a
--        pathway's basis may now also be "submitter_claim" (hq.field_enums). This replaces the rule "a
--        source label needs a citation" (hq._check_labels, hq._validate_against_target), which it
--        makes unreachable.
--        Quotations a proposal carries are still verified (hq._check_quotes).
--   H2   Evidence that a source reports or HQ's build checked, and a source HQ has read, are frozen for
--        proposals (HQ403): they are changed only by an import.
--   H3   A proposal cannot make a requirement "implemented_tested" unless it already is, nor change the
--        linked evidence or builds of one that is (HQ403).
--   H4   A proposal sets only the top-level fields its record type declares (hq.record_fields, the same
--        fields as the record schemas in src/lib/domain/schemas.ts; a test compares them). HQ422.
--   H5   A founder decision cannot clear an acceptance or rejection that is not there (HQ422).
--   H6c  A proposal in which any string value is "Not a valid value" (the text HQ shows for a stored
--        value it cannot read) is refused (HQ422).
--   H11  hq.log_access accepts exactly the actions the application logs as allowed; tool./mcp. names
--        come from hq.tool_names (the names in src/lib/server/tools.ts; a test compares them). A
--        session.* row may name only the caller's own handle.
--   H12  Every caller-supplied value echoed in a refusal of a function replaced here is cut (80
--        characters; a record type 40).
--
-- Every replaced function is a complete CREATE OR REPLACE of its body as it stood after 0008 (the
-- latest definition in the database) and keeps every rule but the one H1 replaces; the changed lines
-- are marked (0009, H…).

-- ---------------------------------------------------------------------------
-- H4. The fields each record type declares (the keys of the record schema's shape in schemas.ts).
-- ---------------------------------------------------------------------------
create table hq.record_fields (
  record_type text not null,
  field       text not null,
  primary key (record_type, field)
);
-- Read by the checks, which run as the owner; no API role needs it.
revoke all on table hq.record_fields from public, anon, authenticated, hq_auth, service_role;

insert into hq.record_fields (record_type, field)
select t.record_type, unnest(t.fields)
  from (values
  ('build', array['artifact_source_id', 'bytes', 'citations', 'code_ref', 'filename', 'hq_acceptance', 'hq_checks', 'id', 'label', 'module_id', 'other_mentions', 'possibly_same_as', 'recorded_from_cluster', 'sha256', 'standing', 'statement']),
  ('commission', array['citations', 'code', 'date', 'hq_acceptance', 'id', 'module_ids', 'output_source_ids', 'recorded_from_cluster', 'scope', 'status', 'title']),
  ('decision', array['citations', 'code', 'commission_code', 'date', 'decided_at', 'decided_by', 'effects', 'exact_text', 'id', 'module_ids', 'other_mentions', 'rationale', 'recorded_from_cluster', 'recorded_in', 'requirement_ids', 'resolves', 'statement', 'status', 'title']),
  ('defect', array['build_id', 'citations', 'id', 'module_ids', 'recorded_from_cluster', 'reported_by', 'reported_via', 'severity', 'statement', 'status', 'title']),
  ('evidence', array['build_id', 'citations', 'code_ref', 'counts', 'date', 'hq_acceptance', 'id', 'module_ids', 'recorded_from_cluster', 'result', 'search_results', 'sha256', 'submitted_by', 'title', 'type', 'verification']),
  ('loop', array['assessment_authority', 'citations', 'concepts', 'feedback_scaffolding', 'hq_acceptance', 'id', 'module_ids', 'name', 'objective', 'recorded_from_cluster', 'retrieval_transfer', 'standing', 'steps', 'student_does', 'success_evidence', 'system_observes', 'variant_of']),
  ('module', array['addenda_from_clusters', 'aliases', 'blockers', 'capabilities', 'citations', 'commission_entry', 'commission_listed', 'connections', 'core_loop', 'evidence_level', 'family', 'hq_acceptance', 'id', 'intended_user', 'kind', 'learner_outcome', 'lifecycle', 'lifecycle_other_reports', 'loop_ids', 'name', 'next_actions', 'objective', 'parent_id', 'recorded_from_cluster', 'summary', 'ui_requirements', 'why_exists']),
  ('open_item', array['citations', 'decision_id', 'id', 'kind', 'module_ids', 'recorded_from_cluster', 'statement', 'title']),
  ('pathway', array['basis', 'citations', 'description', 'id', 'name', 'recorded_from_cluster', 'steps']),
  ('recommendation', array['blocked_by', 'citations', 'id', 'made_by', 'module_ids', 'prerequisite_ids', 'rank', 'rationale', 'recorded_from_cluster', 'status', 'title']),
  ('requirement', array['acceptance_criteria', 'attribution', 'category', 'citations', 'conflicts_with', 'decision_ids', 'depends_on', 'disposition', 'disposition_decision_id', 'duplicate_of', 'exact_wording', 'hq_acceptance', 'id', 'implementation_note', 'implementation_state', 'interpretation', 'linked_build_ids', 'linked_code', 'linked_evidence_ids', 'linked_tests', 'locator', 'module_ids', 'recorded_from_cluster', 'source_date', 'source_id', 'superseded_by', 'supersedes', 'title']),
  ('source', array['access', 'authority', 'authority_note', 'bytes', 'commission_codes', 'content_kind', 'doc_date', 'doc_kind', 'hq_checks', 'id', 'identifiers', 'importance', 'kind', 'location', 'named_in', 'other_names', 'parts', 'prepared_by', 'product_scope', 'recorded_from_cluster', 'retrieved_at', 'sha256', 'summary', 'text_snapshot', 'title', 'updated', 'version'])
  ) as t(record_type, fields);

-- ---------------------------------------------------------------------------
-- H11. The names of the tools in the registry (src/lib/server/tools.ts TOOLS).
-- ---------------------------------------------------------------------------
create table hq.tool_names (
  name text primary key check (name ~ '^[a-z_]{1,60}$')
);
revoke all on table hq.tool_names from public, anon, authenticated, hq_auth, service_role;

insert into hq.tool_names (name) values
  ('find_outstanding_requirements'),
  ('get_acceptance_status'),
  ('get_development_dependencies'),
  ('get_ecosystem_overview'),
  ('get_learning_loop'),
  ('get_module_brief'),
  ('get_recent_changes'),
  ('get_record'),
  ('get_review_items'),
  ('get_source_lineage'),
  ('list_learning_loops'),
  ('list_my_proposals'),
  ('list_sources'),
  ('record_test_evidence'),
  ('search_founder_requirements'),
  ('search_records'),
  ('submit_change_proposal'),
  ('submit_defect_report');

-- ---------------------------------------------------------------------------
-- H1. A pathway created by proposal is the submitter's claim: its basis may be "submitter_claim"
-- (PATHWAY_BASES in src/lib/domain/schemas.ts; tests/db/field-enums.test.ts compares the two).
-- ---------------------------------------------------------------------------
update hq.field_enums set allowed = allowed || 'submitter_claim'::text where record_type = 'pathway' and path = 'basis';

-- ---------------------------------------------------------------------------
-- H1. The first object (or top-level label field) in p_new, at any depth, whose source label is not
-- what the target holds at the same path. p_old is the value at the same path in the target's current
-- record (null for a create, or where the target has nothing there). Returns its path ("statement",
-- "lifecycle.prototyped", "capabilities[2]", "standing"), or null. Objects are visited key by key in
-- the order PostgreSQL keeps them (shorter keys first), lists in order. Mirrored by
-- sourceLabelProblem in src/lib/server/services.ts, in the same order.
-- ---------------------------------------------------------------------------
create function hq._source_label_path(p_new jsonb, p_old jsonb, p_path text, p_label_keys text[]) returns text
language plpgsql immutable as $$
declare
  -- The labels that say a source reports something; a pathway's commission_example (the commission
  -- gives it as an example) is one of them.
  v_labels constant text[] := array['reported', 'design_intention', 'source_recommendation', 'founder_statement', 'commission_example'];
  v_key    text;
  v_val    jsonb;
  v_i      integer;
  v_found  text;
begin
  if jsonb_typeof(p_new) = 'object' then
    if p_path is null then
      -- The record itself: each top-level label field is compared by its value.
      foreach v_key in array p_label_keys loop
        if jsonb_typeof(p_new -> v_key) = 'string' and (p_new ->> v_key) = any (v_labels)
           and (p_new -> v_key) is distinct from (p_old -> v_key) then
          return v_key;
        end if;
      end loop;
    elsif (jsonb_typeof(p_new -> 'epistemic') = 'string' and (p_new ->> 'epistemic') = any (v_labels))
       or (jsonb_typeof(p_new -> 'basis') = 'string' and (p_new ->> 'basis') = any (v_labels)) then
      -- An object that says a source reports something: the whole object, as the target holds it.
      if p_new is distinct from p_old then
        return p_path;
      end if;
      return null;
    end if;
    for v_key, v_val in select e.key, e.value from jsonb_each(p_new) e loop
      v_found := hq._source_label_path(v_val, case when jsonb_typeof(p_old) = 'object' then p_old -> v_key end,
                                       case when p_path is null then v_key else p_path || '.' || v_key end, p_label_keys);
      if v_found is not null then
        return v_found;
      end if;
    end loop;
  elsif jsonb_typeof(p_new) = 'array' then
    for v_i in 0 .. jsonb_array_length(p_new) - 1 loop
      v_found := hq._source_label_path(p_new -> v_i, case when jsonb_typeof(p_old) = 'array' then p_old -> v_i end,
                                       coalesce(p_path, '') || '[' || v_i || ']', p_label_keys);
      if v_found is not null then
        return v_found;
      end if;
    end loop;
  end if;
  return null;
end
$$;

-- ---------------------------------------------------------------------------
-- H6c, H4, H3, H1: what a proposal may say, in the record it would leave. p_type is the record type
-- (the target's for an update, payload.record_type for a create); p_cur is the target's current version
-- for an update and null for a create. Called by submit_proposal and again by review_proposal, right
-- after hq._refuse_acceptance_claims (so every earlier refusal answers first, as before). In order:
--   (0009, H6c) any string value "Not a valid value" in the proposal: HQ422;
--   (0009, H4)  a top-level key the record type does not declare (hq.record_fields): HQ422;
--   (0009, H3)  a requirement made "implemented_tested" that was not, or the linked evidence or builds
--               of one that is changed: HQ403;
--   (0009, H1)  a source label anywhere in the resulting record that the target does not hold, as a
--               whole object, at the same path: HQ403.
-- Mirrored by inboxClaimProblem in src/lib/server/services.ts, in the same order, with the same words.
-- ---------------------------------------------------------------------------
create function hq._check_proposal_claims(p_type text, p_payload jsonb, p_cur hq.record_versions) returns void
language plpgsql stable as $$
declare
  v_update boolean := p_payload ->> 'op' = 'update';
  v_doc    jsonb := case when p_payload ->> 'op' = 'update' then p_payload -> 'set' else p_payload -> 'record' end;
  v_before jsonb := case when p_payload ->> 'op' = 'update' then p_cur.data end;
  v_after  jsonb;
  v_key    text;
  v_path   text;
  v_tested constant text := 'record the tests as evidence; only an import marks a requirement as implemented and tested (the founder can record it as satisfied by a decision)';
begin
  if jsonb_typeof(v_doc) is distinct from 'object' then
    return;
  end if;
  v_after := case when v_update then coalesce(v_before, '{}'::jsonb) || v_doc else v_doc end;

  -- (0009, H6c) The text HQ shows in place of a stored value it cannot read is never written back.
  if jsonb_path_exists(v_doc, 'strict $.** ? (@ == "Not a valid value")') then
    raise exception 'a proposal cannot contain the text "Not a valid value": HQ shows it in place of a stored value it cannot read. Give the value itself'
      using errcode = 'HQ422';
  end if;

  -- (0009, H4) Only the fields the record type declares. Imports stay loose; proposals do not.
  select o.k into v_key from jsonb_object_keys(v_doc) with ordinality as o(k, n)
   where not exists (select from hq.record_fields f where f.record_type = p_type and f.field = o.k)
   order by o.n limit 1;
  if v_key is not null then
    raise exception 'field "%" is not a field of a % record', left(v_key, 60), left(coalesce(p_type, ''), 40)
      using errcode = 'HQ422';
  end if;

  -- (0009, H3) "Implemented and tested" is not a proposal's to say.
  if p_type = 'requirement' then
    if (v_after -> 'implementation_state') = '"implemented_tested"'::jsonb
       and (v_before -> 'implementation_state') is distinct from '"implemented_tested"'::jsonb then
      raise exception 'field "implementation_state": %', v_tested using errcode = 'HQ403';
    end if;
    if (v_before -> 'implementation_state') = '"implemented_tested"'::jsonb then
      foreach v_key in array array['linked_evidence_ids', 'linked_build_ids'] loop
        if v_doc ? v_key and (v_doc -> v_key) is distinct from (v_before -> v_key) then
          raise exception 'field "%": %', v_key, v_tested using errcode = 'HQ403';
        end if;
      end loop;
    end if;
  end if;

  -- (0009, H1) A label that says a source reports something is set only by an import.
  v_path := hq._source_label_path(v_after, v_before, null,
              case when p_type = 'loop' then array['epistemic', 'basis', 'standing'] else array['epistemic', 'basis'] end);
  if v_path is not null then
    raise exception 'field "%": a proposal''s claim is the submitter''s own: label it submitter_claim (it may carry quotations). Labels that say a source reports something are set only by an import',
      left(v_path, 80) using errcode = 'HQ403';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- (0005) Quotation problems. (0009, H12) The source id a caller gives is cut to 80 characters in every
-- message (the quotation was already cut to 80).
-- ---------------------------------------------------------------------------
create or replace function hq._quote_problem(p_source_id text, p_text text, p_kind text default 'quote') returns jsonb
language plpgsql stable as $$
declare
  v_norm  text := coalesce(hq._norm_quote(p_text), '');
  v_start text := left(coalesce(hq._norm_quote(p_text), ''), 80);
  v_src   text := left(p_source_id, 80);
  v_body  text;
  v_what  text := case when p_kind = 'wording' then 'exact_wording' else 'quotation' end;
begin
  if p_kind = 'wording' then
    if length(replace(v_norm, ' ', '')) < 8 then
      return jsonb_build_object('reason', 'too_short', 'message',
        format('exact_wording quoting %s has fewer than 8 characters other than spaces: "%s"', v_src, v_start));
    end if;
  elsif length(v_norm) < 12 then
    return jsonb_build_object('reason', 'too_short', 'message',
      format('quotation from %s is shorter than 12 characters: "%s"', v_src, v_start));
  end if;
  select text_norm into v_body from hq.source_texts where source_id = p_source_id;
  if v_body is null then
    return jsonb_build_object('reason', 'no_text', 'message',
      format('%s has no stored text, so this %s cannot be checked: "%s"', coalesce(v_src, '(no source)'), v_what, v_start));
  end if;
  if strpos(v_body, v_norm) = 0 then
    return jsonb_build_object('reason', 'not_found', 'message',
      format('%s not found verbatim in %s: "%s"', v_what, v_src, v_start));
  end if;
  return null;
end
$$;

-- ---------------------------------------------------------------------------
-- (0005, D1b) HQ's own labels (verified, hq_recommendation) anywhere in a proposal are refused (HQ403):
-- keys "epistemic" and "basis" in any object, and a loop's top-level "standing".
--   (0009, H1) the rule "a source label needs a citation" is gone: a source label is now refused
--              unless the target already holds it, identically (hq._check_proposal_claims).
-- p_top_is_record is kept for the callers' signature; it no longer changes anything.
-- ---------------------------------------------------------------------------
create or replace function hq._check_labels(p_type text, p_doc jsonb, p_top_is_record boolean) returns void
language plpgsql stable as $$
declare
  v_obj  jsonb;
  v_key  text;
  v_val  text;
  v_keys text[];
begin
  for v_obj in select jsonb_path_query(p_doc, 'strict $.** ? (exists(@.epistemic) || exists(@.basis) || exists(@.standing))') loop
    v_keys := array['epistemic', 'basis'];
    if p_type = 'loop' and v_obj = p_doc then
      v_keys := array_append(v_keys, 'standing');
    end if;
    foreach v_key in array v_keys loop
      continue when jsonb_typeof(v_obj -> v_key) is distinct from 'string';
      v_val := v_obj ->> v_key;
      if v_val in ('verified', 'hq_recommendation') then
        raise exception 'the label "%" is HQ''s own and cannot be used in a proposal (field "%"); use "submitter_claim"', v_val, v_key
          using errcode = 'HQ403';
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
--   (0005, D1b)  HQ's own labels refused (hq._check_labels);
--   (0005, D1a)  every quotation verifies against hq.source_texts (hq._check_quotes); a created
--                requirement's exact_wording occurs verbatim in its source's text;
--   (0008, G1c)  a created record's values that drive labels are in their lists (hq._check_field_enums);
--   (0009, H12)  the record type a caller names is cut to 40 characters in the refusal.
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
      -- (0009, H12) the caller's record type, cut to 40 characters.
      raise exception 'payload.record_type "%" cannot be created by proposal', left(coalesce(v_type, ''), 40) using errcode = 'HQ403';
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
--   (0009, H2)   evidence whose verification is hq_verified or source_reported is frozen: any change
--                is refused (HQ403). (Before 0009 only type, result, sha256, date and build_id were.)
--   (0009, H2)   a source HQ has read (a stored text, a text snapshot, or access other than
--                not_accessible) is frozen the same way;
--   (0009, H1)   the rule "a top-level source label in set needs citations on the merged record" is
--                gone: hq._check_proposal_claims refuses any source label the target does not hold;
--   (0007, F7)   the HQ409 message says "rejection" for a rejected target, "acceptance" otherwise;
--   (0008, G1c)  the values that drive labels are in their lists, in the record as it would stand
--                (hq._check_field_enums).
-- ---------------------------------------------------------------------------
create or replace function hq._validate_against_target(p_target_type text, p_payload jsonb, p_cur hq.record_versions) returns void
language plpgsql stable as $$
declare
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
  -- (0009, H2) Records HQ did not write are not rewritten by proposal.
  if p_target_type = 'evidence' and p_cur.data ->> 'verification' in ('hq_verified', 'source_reported') then
    raise exception 'evidence that a source reports or HQ''s build checked is changed only by an import; submit new evidence instead'
      using errcode = 'HQ403';
  end if;
  if p_target_type = 'source'
     and (coalesce(jsonb_typeof(p_cur.data -> 'text_snapshot'), 'null') <> 'null'
          or (p_cur.data ->> 'access') is distinct from 'not_accessible'
          or exists (select from hq.source_texts t where t.source_id = p_cur.record_id)) then
    raise exception 'a source HQ has read is changed only by an import; a proposal can change a source that is only named'
      using errcode = 'HQ403';
  end if;
  -- (0008, G1c) the values that drive labels, in the record as it would stand.
  perform hq._check_field_enums(p_target_type, p_payload, p_cur);
end
$$;

-- ---------------------------------------------------------------------------
-- (0007, F1) Refuse (HQ403) a proposal payload that would make HQ show an acceptance nobody recorded.
-- As in 0008 (G1a, G1b), and (0009, H12) a top-level key the caller names is cut to 80 characters in
-- the refusal. Rules:
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
      raise exception 'field "%": %', left(v_key, 80), v_rule using errcode = 'HQ403';
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
        raise exception 'lifecycle.founder_accepted "%": %', left(coalesce(v_fa ->> 'state', ''), 40), v_rule using errcode = 'HQ403';
      end if;
    end if;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- hq.submit_proposal: as in 0005/0006, and
--   (0009, H1/H3/H4/H6c) hq._check_proposal_claims after the acceptance rules, on update and create;
--   (0009, H12) the target type and id a caller names are cut in the not-found refusal.
-- ---------------------------------------------------------------------------
create or replace function hq.submit_proposal(p_kind text, p_target_type text, p_target_id text, p_base_version integer, p_base_rev bigint, p_title text, p_rationale text, p_payload jsonb, p_evidence jsonb default '[]'::jsonb, p_idempotency_key text default null::text)
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
      raise exception 'target %/% does not exist', left(p_target_type, 40), left(p_target_id, 80) using errcode = 'HQ404';
    end if;
    if p_base_version is null then
      raise exception 'base_version is required: state which version of the record you read' using errcode = 'HQ422';
    end if;
    perform hq._validate_against_target(p_target_type, p_payload, v_cur);
    perform hq._refuse_acceptance_claims(p_target_type, p_payload, v_cur);
    perform hq._check_proposal_claims(p_target_type, p_payload, v_cur);
    if p_base_version <> v_cur.version then
      raise exception 'stale revision: %/% is at version % (you read version %). Re-read the record and resubmit.',
        p_target_type, left(p_target_id, 80), v_cur.version, p_base_version
        using errcode = 'HQ409',
              detail = jsonb_build_object('current_version', v_cur.version, 'base_version', p_base_version, 'head_rev', v_head)::text;
    end if;
  else
    perform hq._refuse_acceptance_claims(p_payload ->> 'record_type', p_payload, null::hq.record_versions);
    perform hq._check_proposal_claims(p_payload ->> 'record_type', p_payload, null::hq.record_versions);
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
-- hq.review_proposal: as in 0005/0007, and
--   (0009, H1/H3/H4/H6c) hq._check_proposal_claims after the acceptance rules, on update and create,
--                        against the target as it stands at acceptance, before the stale check;
--   (0009, H12) the proposal id a caller names is cut in the refusals.
-- ---------------------------------------------------------------------------
create or replace function hq.review_proposal(p_id text, p_decision text, p_note text default null::text)
returns jsonb
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
  v_f := hq._require_founder('proposal.review', 'proposal', left(p_id, 80));

  if p_decision not in ('accept', 'reject', 'needs_changes') then
    raise exception 'decision must be accept, reject or needs_changes' using errcode = 'HQ422';
  end if;

  perform pg_advisory_xact_lock(hashtext('hq.dataset.write'));
  select * into v_prop from hq.proposals where id = p_id;
  if not found then
    raise exception 'proposal % not found', left(p_id, 80) using errcode = 'HQ404';
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
      perform hq._check_proposal_claims(v_prop.target_type, v_prop.payload, v_cur);
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
    perform hq._check_proposal_claims(v_prop.payload ->> 'record_type', v_prop.payload, null::hq.record_versions);
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
-- hq.withdraw_proposal: as in 0006. (0009, H12) the proposal id a caller names is cut in the refusal.
-- ---------------------------------------------------------------------------
create or replace function hq.withdraw_proposal(p_id text, p_note text default null::text)
returns jsonb
language plpgsql security definer set search_path = hq, pg_catalog as $$
declare
  v_p      hq.principals;
  v_claims jsonb := hq.jwt_claims();
  v_prop   hq.proposals;
  v_status text;
begin
  select * into v_p from hq.principals where id = hq.current_principal_id() and active;
  if not found then
    raise exception 'authentication required' using errcode = 'HQ401';
  end if;
  if v_p.app_role not in ('founder', 'developer', 'ai_agent') then
    raise exception 'role "%" may not withdraw proposals', v_p.app_role using errcode = 'HQ403';
  end if;
  if v_claims ? 'scopes' and not (v_claims -> 'scopes' ? 'propose') then
    raise exception 'this credential does not carry the "propose" scope' using errcode = 'HQ403';
  end if;
  select * into v_prop from hq.proposals where id = p_id;
  if not found or v_prop.submitted_by is distinct from v_p.id then
    raise exception 'proposal % not found for this principal', left(p_id, 80) using errcode = 'HQ404';
  end if;

  perform pg_advisory_xact_lock(hashtext('hq.dataset.write'));
  v_status := hq._proposal_status(p_id);
  if v_status is distinct from 'submitted' then
    raise exception 'proposal % is % and can no longer be withdrawn', p_id, coalesce(v_status, 'unknown') using errcode = 'HQ409';
  end if;
  insert into hq.proposal_events (proposal_id, event, actor, note) values (p_id, 'withdrawn', v_p.id, p_note);
  perform hq.log_event('proposal.withdraw', 'proposal', p_id, 'allowed', null);
  return hq._proposal_json(v_prop);
end
$$;

-- ---------------------------------------------------------------------------
-- hq.founder_issue_credential: as in 0004. (0009, H12) the handle a caller names is cut in the refusal.
-- ---------------------------------------------------------------------------
create or replace function hq.founder_issue_credential(p_handle text, p_label text, p_scopes text[], p_token_prefix text, p_token_hash text, p_expires_at timestamp with time zone default null::timestamp with time zone)
returns jsonb
language plpgsql security definer set search_path = hq, pg_catalog as $$
declare
  v_f   hq.principals;
  v_pid uuid;
  v_id  uuid;
begin
  v_f := hq._require_founder('credential.issue', 'principal', left(p_handle, 80));
  select id into v_pid from hq.principals where handle = p_handle and active;
  if v_pid is null then
    raise exception 'principal "%" not found', left(p_handle, 80) using errcode = 'HQ404';
  end if;
  insert into hq.api_credentials (principal_id, label, token_prefix, token_hash, scopes, created_by, expires_at)
  values (v_pid, p_label, p_token_prefix, p_token_hash, p_scopes, v_f.id, p_expires_at)
  returning id into v_id;
  perform hq.log_event('credential.issue', 'principal', p_handle, 'allowed',
    jsonb_build_object('credential_id', v_id, 'scopes', to_jsonb(p_scopes), 'label', p_label));
  return jsonb_build_object('credential_id', v_id, 'handle', p_handle, 'token_prefix', p_token_prefix);
end
$$;

-- ---------------------------------------------------------------------------
-- hq.record_founder_decision: as in 0005/0007, and
--   (0009, H5)  a set_acceptance effect with state "none" on a record whose current hq_acceptance is
--               not accepted or rejected is refused (HQ422): there is nothing to clear. The record is
--               read as it stands when the effect is applied, so an earlier effect of the same decision
--               counts;
--   (0009, H12) every value a caller names is cut in the refusals (80 characters; a type 40).
-- ---------------------------------------------------------------------------
create or replace function hq.record_founder_decision(p_title text, p_exact_text text, p_rationale text default null::text, p_effects jsonb default '[]'::jsonb, p_resolves jsonb default '[]'::jsonb, p_module_ids jsonb default '[]'::jsonb, p_commission_ref text default null::text)
returns jsonb
language plpgsql security definer set search_path = hq, pg_catalog as $$
declare
  v_f      hq.principals;
  v_rev    bigint;
  v_id     text;
  v_now    timestamptz := clock_timestamp();
  v_eff    jsonb;
  v_ref    jsonb;
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

  -- D13: every reference names a record that exists, of the right type, before anything is written.
  -- (The write lock is taken here so nothing can change between this check and the writes.)
  perform pg_advisory_xact_lock(hashtext('hq.dataset.write'));
  for v_ref in select * from jsonb_array_elements(coalesce(p_resolves, '[]'::jsonb)) loop
    if jsonb_typeof(v_ref) <> 'string' or not exists (
         select from (select distinct on (record_type) deleted from hq.record_versions
                       where record_id = v_ref #>> '{}' and record_type in ('decision', 'open_item')
                       order by record_type, version desc) h
          where not h.deleted) then
      raise exception 'resolves: "%" is not a decision or open item in HQ', left(v_ref #>> '{}', 80) using errcode = 'HQ422';
    end if;
  end loop;
  for v_ref in select * from jsonb_array_elements(coalesce(p_module_ids, '[]'::jsonb)) loop
    if jsonb_typeof(v_ref) <> 'string' or not exists (
         select from (select deleted from hq.record_versions
                       where record_id = v_ref #>> '{}' and record_type = 'module'
                       order by version desc limit 1) h
          where not h.deleted) then
      raise exception 'module_ids: "%" is not a module in HQ', left(v_ref #>> '{}', 80) using errcode = 'HQ422';
    end if;
  end loop;
  for v_eff in select * from jsonb_array_elements(coalesce(p_effects, '[]'::jsonb)) loop
    if v_eff ->> 'type' = 'set_requirement_disposition' then
      v_ref := to_jsonb(coalesce(v_eff ->> 'requirement_id', ''));
      if not exists (select from (select deleted from hq.record_versions
                                    where record_type = 'requirement' and record_id = v_eff ->> 'requirement_id'
                                    order by version desc limit 1) h where not h.deleted) then
        raise exception 'effect target requirement "%" does not exist', left(v_ref #>> '{}', 80) using errcode = 'HQ422';
      end if;
    elsif v_eff ->> 'type' = 'set_acceptance' then
      if (v_eff ->> 'record_type') is null
         or (v_eff ->> 'record_type') not in ('build', 'module', 'evidence', 'requirement', 'loop', 'commission') then
        raise exception 'acceptance cannot be recorded on record type "%"', left(coalesce(v_eff ->> 'record_type', ''), 40) using errcode = 'HQ422';
      end if;
      if not exists (select from (select deleted from hq.record_versions
                                    where record_type = v_eff ->> 'record_type' and record_id = v_eff ->> 'record_id'
                                    order by version desc limit 1) h where not h.deleted) then
        raise exception 'effect target %/% does not exist', v_eff ->> 'record_type', left(coalesce(v_eff ->> 'record_id', ''), 80)
          using errcode = 'HQ422';
      end if;
    end if;
  end loop;

  v_rev := hq._begin_revision('founder_decision', 'Founder decision — ' || p_title, p_commission_ref, v_f.id);
  v_id := hq._next_id('FD-HQ-', 4);
  perform set_config('hq.write_context', 'founder_decision', true);

  for v_eff in select * from jsonb_array_elements(coalesce(p_effects, '[]'::jsonb)) loop
    if v_eff ->> 'type' = 'set_requirement_disposition' then
      if (v_eff ->> 'disposition') not in ('unreviewed', 'active', 'superseded', 'conflicted', 'deferred', 'withdrawn', 'satisfied') then
        raise exception 'unknown disposition "%"', left(v_eff ->> 'disposition', 40) using errcode = 'HQ422';
      end if;
      select * into v_cur from hq.record_versions
       where record_type = 'requirement' and record_id = v_eff ->> 'requirement_id'
       order by version desc limit 1;
      if not found or v_cur.deleted then
        raise exception 'requirement % not found', left(v_eff ->> 'requirement_id', 80) using errcode = 'HQ404';
      end if;
      v_data := v_cur.data || jsonb_build_object('disposition', v_eff ->> 'disposition', 'disposition_decision_id', v_id);
      v_ver := hq._append_record('requirement', v_cur.record_id, v_data, false, v_rev, v_f.id, 'founder_decision', null);
      v_applied := v_applied || jsonb_build_object('record_type', 'requirement', 'record_id', v_cur.record_id, 'version', v_ver);

    elsif v_eff ->> 'type' = 'set_acceptance' then
      if (v_eff ->> 'state') not in ('accepted', 'rejected', 'none') then
        raise exception 'unknown acceptance state "%"', left(v_eff ->> 'state', 40) using errcode = 'HQ422';
      end if;
      if (v_eff ->> 'record_type') not in ('build', 'module', 'evidence', 'requirement', 'loop', 'commission') then
        raise exception 'acceptance cannot be recorded on record type "%"', left(v_eff ->> 'record_type', 40) using errcode = 'HQ422';
      end if;
      select * into v_cur from hq.record_versions
       where record_type = v_eff ->> 'record_type' and record_id = v_eff ->> 'record_id'
       order by version desc limit 1;
      if not found or v_cur.deleted then
        raise exception '%/% not found', v_eff ->> 'record_type', left(v_eff ->> 'record_id', 80) using errcode = 'HQ404';
      end if;
      -- (0009, H5) Clearing needs something to clear.
      if v_eff ->> 'state' = 'none'
         and coalesce(v_cur.data #>> '{hq_acceptance,state}', '') not in ('accepted', 'rejected') then
        raise exception 'there is no acceptance or rejection recorded in HQ on % to clear', left(v_cur.record_id, 80)
          using errcode = 'HQ422';
      end if;
      -- accepted_version: the version this decision writes, i.e. exactly what was accepted.
      v_data := v_cur.data || jsonb_build_object('hq_acceptance', jsonb_build_object(
                  'state', v_eff ->> 'state', 'decision_id', v_id, 'decided_at', v_now,
                  'decided_by', v_f.handle, 'scope_note', v_eff ->> 'scope_note',
                  'accepted_version', v_cur.version + 1));
      v_ver := hq._append_record(v_cur.record_type, v_cur.record_id, v_data, false, v_rev, v_f.id, 'founder_decision', null);
      v_applied := v_applied || jsonb_build_object('record_type', v_cur.record_type, 'record_id', v_cur.record_id, 'version', v_ver);

    else
      raise exception 'unknown decision effect type "%"', left(coalesce(v_eff ->> 'type', ''), 40) using errcode = 'HQ422';
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
-- hq.log_access: an allowed use, recorded for the application.
-- Rules:
--   (0006, D5) outcome fixed to "allowed"; only an active principal named by the claims, outside anon
--          (HQ401); a request id that is not 1-64 of [A-Za-z0-9._-] is not stored (the detail says so);
--   (0007, F4) founder acts (proposal.review, decision.record, credential.*) and proposal.submit /
--          proposal.withdraw are recorded as allowed only by the SECURITY DEFINER functions that
--          perform them;
--   (0007, F6) p_request_id is the id the server gave the request; an id the client sent is kept apart,
--          in detail.client_request_id, and only if it is 1-64 of [A-Za-z0-9._-];
--   (0009, H11) the action is EXACTLY one the application logs as allowed: api.index, api.whoami,
--          tools.list, integrations.read, proposal.read, session.sign_in, session.sign_out,
--          session.end_all, or tool.<name> / mcp.<name> for a name in hq.tool_names. (0008's families
--          and its list of refused words are gone.) Anything else: HQ422, nothing written;
--   (0009, H11) a session.* row names, if anything, the caller's own handle (HQ422 otherwise).
-- Someone who reaches the database directly with a valid identity can still record, under their own
-- name, that they used one of these names when they did not (docs/KNOWN-GAPS.md).
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
     or not (p_action in ('api.index', 'api.whoami', 'tools.list', 'integrations.read', 'proposal.read',
                          'session.sign_in', 'session.sign_out', 'session.end_all')
             or exists (select from hq.tool_names t where p_action in ('tool.' || t.name, 'mcp.' || t.name))) then
    raise exception 'audit action "%" cannot be recorded as allowed here: founder acts and proposals are recorded by the functions that perform them',
      left(coalesce(p_action, ''), 60) using errcode = 'HQ422';
  end if;
  if p_action like 'session.%' and p_object_id is not null and p_object_id is distinct from v_p.handle then
    raise exception 'a session event can only name the caller''s own handle' using errcode = 'HQ422';
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

-- ---------------------------------------------------------------------------
-- Grants. PostgreSQL grants EXECUTE to PUBLIC on every new function: revoke it. The helpers run inside
-- the SECURITY DEFINER functions and are granted to no API role. CREATE OR REPLACE keeps a function's
-- existing privileges; they are restated here so this file says what holds.
-- ---------------------------------------------------------------------------
revoke all on function
  hq._source_label_path(jsonb, jsonb, text, text[]),
  hq._check_proposal_claims(text, jsonb, hq.record_versions),
  hq._quote_problem(text, text, text),
  hq._check_labels(text, jsonb, boolean),
  hq._validate_payload(text, text, jsonb),
  hq._validate_against_target(text, jsonb, hq.record_versions),
  hq._refuse_acceptance_claims(text, jsonb, hq.record_versions)
  from public, anon, authenticated, hq_auth, service_role;
revoke all on function
  hq.submit_proposal(text, text, text, integer, bigint, text, text, jsonb, jsonb, text),
  hq.review_proposal(text, text, text),
  hq.withdraw_proposal(text, text),
  hq.founder_issue_credential(text, text, text[], text, text, timestamp with time zone),
  hq.record_founder_decision(text, text, text, jsonb, jsonb, jsonb, text),
  hq.log_access(text, text, text, text, text)
  from public, service_role;
grant execute on function
  hq.submit_proposal(text, text, text, integer, bigint, text, text, jsonb, jsonb, text),
  hq.review_proposal(text, text, text),
  hq.withdraw_proposal(text, text),
  hq.founder_issue_credential(text, text, text[], text, text, timestamp with time zone),
  hq.record_founder_decision(text, text, text, jsonb, jsonb, jsonb, text)
  to authenticated;
grant execute on function hq.log_access(text, text, text, text, text) to authenticated, anon, hq_auth;
