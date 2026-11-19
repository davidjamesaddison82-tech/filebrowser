-- HarmonyByrd HQ · migration 0010 · fifth round: a record an import labels is frozen for proposals
--
-- One pattern: a record that carries a positive status from an import is frozen for proposals unless the
-- proposal withdraws that status (0008 did this for a build reported as accepted).
--
--   K1   A loop whose standing, or a pathway whose basis, says a source describes it (reported,
--        design_intention, source_recommendation, founder_statement, commission_example) or is one of
--        HQ's own labels (verified, hq_recommendation) is frozen for proposals (HQ403): any change is
--        refused unless the record a proposal would leave labels it submitter_claim or no_evidence
--        (whichever its type's list allows); then its other fields may change too.
--   K2   A requirement whose implementation_state is implemented_tested is frozen for proposals (HQ403):
--        any change is refused unless the proposal moves it to another valid state; then its other
--        fields may change too. This replaces 0009's narrower rule on its linked evidence and builds.
--   K3   On an update, a build's sha256, bytes, filename and artifact_source_id are protected (HQ403):
--        what identifies a build is set when it is recorded. A build created through the inbox may give
--        them (the build page then says they are the submitter's).
--   K4   On an update, a module's evidence_level is protected (HQ403), and a module created through the
--        inbox must carry the lowest level, "commission_list_only" (the last of EVIDENCE_LEVELS in
--        src/lib/domain/schemas.ts): no source HQ read describes it.
--
-- Both functions are complete CREATE OR REPLACE of their bodies as they stood after 0009 (the latest
-- definition in the database) and keep every rule but the one K2 replaces; the changed lines are marked
-- (0010, K…). Mirrored in src/lib/server/services.ts, in the same order and with the same words.

-- ---------------------------------------------------------------------------
-- hq._validate_payload: as in 0009, and
--   (0010, K3) on an update, a build's sha256, bytes, filename and artifact_source_id are protected;
--   (0010, K4) on an update, a module's evidence_level is protected; a created module must carry
--              evidence_level "commission_list_only" (checked last, after the allowed values).
-- As before 0010: payload shape; protected and build-only fields; a source's snapshot facts; HQ-only
-- evidence types; HQ's own labels (hq._check_labels); quotations (hq._check_quotes); a created
-- requirement's wording; a created record's values that drive labels (hq._check_field_enums); the record
-- type a caller names cut to 40 characters.
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
      -- (0010, K3) What identifies a build.
      if v_type = 'build' and v_key in ('sha256', 'bytes', 'filename', 'artifact_source_id') then
        raise exception 'field "%" is protected and cannot be changed by a proposal: what identifies a build is set when it is recorded; record a new build instead', v_key
          using errcode = 'HQ403';
      end if;
      -- (0010, K4) A module's evidence level.
      if v_type = 'module' and v_key = 'evidence_level' then
        raise exception 'field "evidence_level" is protected and cannot be changed by a proposal: a module''s evidence level says what the sources HQ read hold about it, and only an import sets it'
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

  -- (0010, K4) A module created through the inbox is one no source HQ read describes.
  if v_op = 'create' and v_type = 'module' and (v_doc -> 'evidence_level') is distinct from '"commission_list_only"'::jsonb then
    raise exception 'field "evidence_level": a module created through the inbox is one no source HQ read describes: give evidence_level "commission_list_only"; only an import sets a higher level'
      using errcode = 'HQ403';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- hq._check_proposal_claims: as in 0009 (H6c, H4, H1), and
--   (0010, K2) a requirement made "implemented_tested" that was not: HQ403 (as in 0009, H3); a
--              requirement that is "implemented_tested" and stays so: any change is refused, naming the
--              first field of the proposal in the order PostgreSQL keeps them (HQ403). Moving it to
--              another state (a valid one: hq._check_field_enums answers first) frees its other fields.
--              This replaces 0009's rule on its linked evidence and builds, which it covers.
--   (0010, K1) after H1: a loop whose standing, or a pathway whose basis, is a source label or one of
--              HQ's own labels is frozen unless the resulting label is submitter_claim or no_evidence
--              (HQ403, naming the label field).
-- In order: the marker (HQ422), undeclared fields (HQ422), implemented and tested (HQ403), source labels
-- (HQ403), a loop or pathway a source describes (HQ403). Called by submit_proposal and again by
-- review_proposal, right after hq._refuse_acceptance_claims, as in 0009.
-- ---------------------------------------------------------------------------
create or replace function hq._check_proposal_claims(p_type text, p_payload jsonb, p_cur hq.record_versions) returns void
language plpgsql stable as $$
declare
  v_update boolean := p_payload ->> 'op' = 'update';
  v_doc    jsonb := case when p_payload ->> 'op' = 'update' then p_payload -> 'set' else p_payload -> 'record' end;
  v_before jsonb := case when p_payload ->> 'op' = 'update' then p_cur.data end;
  v_after  jsonb;
  v_key    text;
  v_path   text;
  v_tested constant text := 'record the tests as evidence; only an import marks a requirement as implemented and tested (the founder can record it as satisfied by a decision)';
  -- (0010, K2)
  v_tested_frozen constant text := 'a requirement shown as implemented and tested is changed only by an import; a proposal may move it to another implementation state and then change it';
  -- (0010, K1) the labels that freeze a loop or pathway: what a source says, and HQ's own.
  v_frozen_labels constant text[] := array['reported', 'design_intention', 'source_recommendation', 'founder_statement', 'commission_example', 'verified', 'hq_recommendation'];
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
    -- (0010, K2) A requirement shown as implemented and tested is frozen unless the proposal moves it away.
    if (v_before -> 'implementation_state') = '"implemented_tested"'::jsonb
       and (v_after -> 'implementation_state') = '"implemented_tested"'::jsonb then
      select o.k into v_key from jsonb_object_keys(v_doc) with ordinality as o(k, n) order by o.n limit 1;
      raise exception 'field "%": %', left(v_key, 80), v_tested_frozen using errcode = 'HQ403';
    end if;
  end if;

  -- (0009, H1) A label that says a source reports something is set only by an import.
  v_path := hq._source_label_path(v_after, v_before, null,
              case when p_type = 'loop' then array['epistemic', 'basis', 'standing'] else array['epistemic', 'basis'] end);
  if v_path is not null then
    raise exception 'field "%": a proposal''s claim is the submitter''s own: label it submitter_claim (it may carry quotations). Labels that say a source reports something are set only by an import',
      left(v_path, 80) using errcode = 'HQ403';
  end if;

  -- (0010, K1) A loop or pathway a source describes is frozen unless the proposal relabels it.
  if v_update and p_type in ('loop', 'pathway') then
    v_key := case p_type when 'loop' then 'standing' else 'basis' end;
    if jsonb_typeof(v_before -> v_key) = 'string' and (v_before ->> v_key) = any (v_frozen_labels)
       and not coalesce(jsonb_typeof(v_after -> v_key) = 'string' and (v_after ->> v_key) in ('submitter_claim', 'no_evidence'), false) then
      raise exception 'field "%": a loop or pathway a source describes is changed only by an import; a proposal may relabel it as the submitter''s claim and then change it', v_key
        using errcode = 'HQ403';
    end if;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Grants. CREATE OR REPLACE keeps a function's existing privileges; they are restated here so this file
-- says what holds. The two helpers run inside the SECURITY DEFINER functions and are granted to no API role.
-- ---------------------------------------------------------------------------
revoke all on function
  hq._validate_payload(text, text, jsonb),
  hq._check_proposal_claims(text, jsonb, hq.record_versions)
  from public, anon, authenticated, hq_auth, service_role;
