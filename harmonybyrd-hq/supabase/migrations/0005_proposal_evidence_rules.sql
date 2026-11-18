-- HarmonyByrd HQ · migration 0005 · what the proposal inbox may assert, and acceptance binding
--
-- The inbox is where developers and AI clients make claims. Until now only the pack importer
-- checked quotations, and a proposal could set fields that HQ's screens read as "checked by HQ",
-- "verified" or "accepted". This migration makes the database refuse those proposals, at
-- submission and again when the founder accepts:
--
--   D1a  every quotation in a proposal is checked against the source text stored at import
--        (hq.source_texts, filled by scripts/seed.ts on every import);
--   D1b  HQ's own labels ("verified", "hq_recommendation") cannot be used by a proposal, and the
--        source-backed labels need citations (which D1a then verifies);
--   D1c  fields that carry HQ's own checks, attribution or source integrity are protected;
--   D15  fields only HQ's build writes are protected;
--   D2   a founder acceptance binds to what was accepted: a record carrying one cannot be changed
--        by proposal, and the sealing trigger refuses any non-founder write to such a record;
--   D13  a founder decision may only resolve, and refer to, records that exist;
--   D11  ids of the form XX-HQ-n are issued by HQ only: imports may not use them, and the id
--        counter skips any that already exist.
--
-- Every replaced function is a complete CREATE OR REPLACE of its 0002/0003 body. Each carries a
-- header listing the rules it now enforces, marked with the design section that added them.
-- The write-context mechanism, verify_chain, the audit functions, proposal_status, withdraw
-- locking and sessions are deliberately untouched here; a later migration changes them.

-- ---------------------------------------------------------------------------
-- D1a. Source texts, stored for quotation checks on the proposal path.
-- Owner-only: no API role, and not service_role, may read or write it. The application checks
-- quotations through hq.quotes_ok(), which returns only pass/fail per citation.
-- ---------------------------------------------------------------------------
create table hq.source_texts (
  source_id text primary key check (source_id ~ '^SRC-[A-Z0-9][A-Z0-9.-]{0,60}$'),
  text_norm text not null,
  sha256    text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  chars     integer not null check (chars >= 0),
  loaded_at timestamptz not null default clock_timestamp()
);
comment on table hq.source_texts is
  'Normalised text of each source snapshot, loaded at import. Used only to verify quotations in proposals. Owner-only.';
alter table hq.source_texts enable row level security;
revoke all on table hq.source_texts from public, anon, authenticated, hq_auth, service_role;

-- Same result as normaliseForQuote() in src/lib/domain/quote.ts: every run of JavaScript "\s"
-- whitespace becomes one space, then leading and trailing spaces go. The class is spelt out
-- (JavaScript's \s, ECMA-262 WhiteSpace + LineTerminator) rather than left to the server locale.
create function hq._norm_quote(p_text text) returns text
language sql immutable strict parallel safe as $$
  select btrim(regexp_replace(p_text,
    '[\t\n\v\f\r    -     　﻿]+', ' ', 'g'), ' ')
$$;

-- Why a quotation (p_kind 'quote') or a requirement's exact wording (p_kind 'wording') cannot be
-- verified against p_source_id, or null when it can. Returns {reason, message}; the message names
-- the source and the first 80 characters of the normalised text.
create function hq._quote_problem(p_source_id text, p_text text, p_kind text default 'quote') returns jsonb
language plpgsql stable as $$
declare
  v_norm  text := coalesce(hq._norm_quote(p_text), '');
  v_start text := left(coalesce(hq._norm_quote(p_text), ''), 80);
  v_body  text;
  v_what  text := case when p_kind = 'wording' then 'exact_wording' else 'quotation' end;
begin
  if p_kind = 'wording' then
    if length(replace(v_norm, ' ', '')) < 8 then
      return jsonb_build_object('reason', 'too_short', 'message',
        format('exact_wording quoting %s has fewer than 8 characters other than spaces: "%s"', p_source_id, v_start));
    end if;
  elsif length(v_norm) < 12 then
    return jsonb_build_object('reason', 'too_short', 'message',
      format('quotation from %s is shorter than 12 characters: "%s"', p_source_id, v_start));
  end if;
  select text_norm into v_body from hq.source_texts where source_id = p_source_id;
  if v_body is null then
    return jsonb_build_object('reason', 'no_text', 'message',
      format('%s has no stored text, so this %s cannot be checked: "%s"', coalesce(p_source_id, '(no source)'), v_what, v_start));
  end if;
  if strpos(v_body, v_norm) = 0 then
    return jsonb_build_object('reason', 'not_found', 'message',
      format('%s not found verbatim in %s: "%s"', v_what, p_source_id, v_start));
  end if;
  return null;
end
$$;

-- True only if the normalised quotation is at least 12 characters and occurs in the source's text.
create function hq._quote_ok(p_source_id text, p_quote text) returns boolean
language sql stable as $$
  select p_quote is not null and hq._quote_problem(p_source_id, p_quote, 'quote') is null
$$;

-- Import: upsert the normalised text of each source snapshot. Owner connection only (SECURITY
-- INVOKER; API roles hold no privilege on the table and no EXECUTE on this function).
-- p_texts: [{"source_id":"SRC-…","text_norm":"…","sha256":"<hex>","chars":123}, …]
-- text_norm must already be normalised (scripts/seed.ts uses normaliseForQuote); a text the
-- database would normalise differently is refused, which keeps the two normalisations in step.
create function hq.admin_put_source_texts(p_texts jsonb) returns integer
language plpgsql as $$
declare
  v_item    jsonb;
  v_changed integer := 0;
  v_n       integer;
begin
  if current_user in ('anon', 'authenticated', 'hq_auth', 'service_role') then
    raise exception 'source texts can only be loaded by the import on the owner connection' using errcode = 'HQ403';
  end if;
  if jsonb_typeof(p_texts) is distinct from 'array' then
    raise exception 'source texts must be an array' using errcode = 'HQ422';
  end if;
  for v_item in select * from jsonb_array_elements(p_texts) loop
    if jsonb_typeof(v_item -> 'source_id') is distinct from 'string'
       or jsonb_typeof(v_item -> 'text_norm') is distinct from 'string'
       or jsonb_typeof(v_item -> 'sha256') is distinct from 'string'
       or jsonb_typeof(v_item -> 'chars') is distinct from 'number' then
      raise exception 'each source text needs source_id, text_norm, sha256 and chars' using errcode = 'HQ422';
    end if;
    if hq._norm_quote(v_item ->> 'text_norm') <> (v_item ->> 'text_norm') then
      raise exception 'source text % is not normalised the way the database normalises quotations', v_item ->> 'source_id'
        using errcode = 'HQ422';
    end if;
    insert into hq.source_texts as t (source_id, text_norm, sha256, chars)
    values (v_item ->> 'source_id', v_item ->> 'text_norm', v_item ->> 'sha256', (v_item ->> 'chars')::integer)
    on conflict (source_id) do update
       set text_norm = excluded.text_norm, sha256 = excluded.sha256, chars = excluded.chars, loaded_at = clock_timestamp()
     where t.text_norm is distinct from excluded.text_norm or t.sha256 is distinct from excluded.sha256
        or t.chars is distinct from excluded.chars;
    get diagnostics v_n = row_count;
    v_changed := v_changed + v_n;
  end loop;
  return v_changed;
end
$$;

-- Application-side check before submitting (for a friendly error). Returns the citations that fail,
-- never any source text. Only principals who may submit proposals may call it: the database gives
-- them the same answer when they submit, so this discloses nothing more than submission does.
-- p_items: [{"source_id":"SRC-…","quote":"…","kind":"quote"|"wording"}, …] (at most 500)
-- Returns: [{"index":0,"source_id":"…","reason":"no_text|too_short|not_found","message":"…"}, …]
create function hq.quotes_ok(p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = hq, pg_catalog as $$
declare
  v_p      hq.principals;
  v_claims jsonb := hq.jwt_claims();
  v_item   jsonb;
  v_idx    bigint;
  v_prob   jsonb;
  v_out    jsonb := '[]'::jsonb;
begin
  select * into v_p from hq.principals where id = hq.current_principal_id() and active;
  if not found then
    raise exception 'authentication required' using errcode = 'HQ401';
  end if;
  if v_p.app_role not in ('founder', 'developer', 'ai_agent')
     or (v_claims ? 'scopes' and not (v_claims -> 'scopes' ? 'propose')) then
    raise exception 'only a principal who may submit proposals can check quotations' using errcode = 'HQ403';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 500 then
    raise exception 'quotations to check must be an array of at most 500 items' using errcode = 'HQ422';
  end if;
  for v_item, v_idx in select e, i - 1 from jsonb_array_elements(p_items) with ordinality as x(e, i) loop
    v_prob := hq._quote_problem(v_item ->> 'source_id', coalesce(v_item ->> 'quote', ''),
                                case when v_item ->> 'kind' = 'wording' then 'wording' else 'quote' end);
    if v_prob is not null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('index', v_idx, 'source_id', v_item ->> 'source_id') || v_prob);
    end if;
  end loop;
  return v_out;
end
$$;

-- ---------------------------------------------------------------------------
-- D1c / D15. Protected fields.
-- ---------------------------------------------------------------------------

-- Fields no proposal may set on any record type. 0003's list, plus (0005, D1c) the fields that
-- carry HQ's own checks and attribution: hq_checks, made_by, recorded_from_cluster.
-- Mirrored by PROTECTED_FIELDS in src/lib/domain/schemas.ts.
create or replace function hq.protected_fields() returns text[]
language sql immutable as $$
  select array['id', 'exact_wording', 'source_id', 'locator', 'source_date', 'attribution',
               'disposition', 'disposition_decision_id', 'hq_acceptance', 'recorded_in',
               'decided_by', 'decided_at', 'verification', 'submitted_by',
               'hq_checks', 'made_by', 'recorded_from_cluster']
$$;

-- (0005, D15) Fields only HQ's build writes, per record type. The union over all types is
-- BUILD_ONLY_FIELDS in src/lib/domain/schemas.ts. code_ref is build-only on builds only:
-- test evidence submitted through the inbox legitimately carries a code_ref.
create function hq.build_only_fields(p_type text) returns text[]
language sql immutable as $$
  select array['recorded_from_cluster'] || case p_type
    when 'module'      then array['addenda_from_clusters', 'commission_entry', 'lifecycle_other_reports']
    when 'decision'    then array['other_mentions']
    when 'build'       then array['other_mentions', 'possibly_same_as', 'code_ref']
    when 'evidence'    then array['search_results']
    when 'requirement' then array['linked_tests']
    when 'source'      then array['doc_kind', 'content_kind', 'importance', 'identifiers', 'other_names']
    else array[]::text[]
  end
$$;

-- (0005, D1c) Source fields a proposal may not change on an existing source: they describe the
-- snapshot HQ read and how much authority it carries.
create function hq.source_integrity_fields() returns text[]
language sql immutable as $$
  select array['sha256', 'bytes', 'text_snapshot', 'access', 'kind', 'authority', 'retrieved_at',
               'parts', 'version', 'location']
$$;

-- ---------------------------------------------------------------------------
-- D1a / D1b. What a proposed document may assert.
-- ---------------------------------------------------------------------------

-- (0005, D1b) HQ's own labels are refused anywhere in a proposed document (key "epistemic" or
-- "basis" at any depth; for loops also the top-level "standing"). The source-backed labels need
-- at least one citation on the same object; the top level of an update ("set") is checked
-- against the merged record by hq._validate_against_target instead (p_top_is_record = false).
create function hq._check_labels(p_type text, p_doc jsonb, p_top_is_record boolean) returns void
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
      if v_val in ('reported', 'design_intention', 'source_recommendation', 'founder_statement')
         and (v_obj <> p_doc or p_top_is_record)
         and (jsonb_typeof(v_obj -> 'citations') is distinct from 'array' or jsonb_array_length(v_obj -> 'citations') = 0) then
        raise exception 'a "%" statement must cite at least one source (field "%"); without one, use "submitter_claim"', v_val, v_key
          using errcode = 'HQ422';
      end if;
    end loop;
  end loop;
end
$$;

-- (0005, D1a) Every citation-shaped object (a string source_id and a string quote, at any depth)
-- must verify against the stored source text; every "citations" / "named_in" list must hold only
-- such objects.
create function hq._check_quotes(p_doc jsonb) returns void
language plpgsql stable as $$
declare
  v_obj  jsonb;
  v_list jsonb;
  v_el   jsonb;
  v_prob jsonb;
begin
  for v_obj in select jsonb_path_query(p_doc, 'strict $.** ? (exists(@.citations) || exists(@.named_in))') loop
    foreach v_list in array array[v_obj -> 'citations', v_obj -> 'named_in'] loop
      continue when v_list is null or v_list = 'null'::jsonb;
      if jsonb_typeof(v_list) <> 'array' then
        raise exception 'citations must be a list of {source_id, quote}' using errcode = 'HQ422';
      end if;
      for v_el in select * from jsonb_array_elements(v_list) loop
        if jsonb_typeof(v_el) is distinct from 'object' or jsonb_typeof(v_el -> 'source_id') is distinct from 'string'
           or jsonb_typeof(v_el -> 'quote') is distinct from 'string' then
          raise exception 'each citation needs a source_id and a verbatim quote' using errcode = 'HQ422';
        end if;
      end loop;
    end loop;
  end loop;

  for v_obj in select jsonb_path_query(p_doc,
      'strict $.** ? (@.type() == "object" && @.source_id.type() == "string" && @.quote.type() == "string")') loop
    v_prob := hq._quote_problem(v_obj ->> 'source_id', v_obj ->> 'quote', 'quote');
    if v_prob is not null then
      raise exception '%', v_prob ->> 'message' using errcode = 'HQ422';
    end if;
  end loop;
end
$$;

-- Validate the shape of a proposal payload. Raises HQ422 (invalid) or HQ403 (protected field).
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
--                requirement's exact_wording occurs verbatim in its source's text.
-- Rules that depend on the target's current version are in hq._validate_against_target.
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
end
$$;

-- (0005) Rules that depend on the target record as it stands. Called by submit_proposal and again by
-- review_proposal, before the stale check (so a proposal refused here stays "submitted").
--   (0005, D2)   a target whose hq_acceptance.state is accepted or rejected cannot be changed by
--                proposal (HQ409); a cleared acceptance (state none) does not block;
--   (0005, D1c)  evidence whose verification is hq_verified or source_reported: type, result,
--                sha256, date and build_id cannot be changed (HQ403);
--   (0005, D1b)  a top-level source-backed label in "set" needs citations on the merged record.
create function hq._validate_against_target(p_target_type text, p_payload jsonb, p_cur hq.record_versions) returns void
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
    raise exception '%/% carries a founder acceptance recorded in HQ (%). Record a founder decision that clears it first, or propose a new record.',
      p_target_type, p_cur.record_id, coalesce(p_cur.data #>> '{hq_acceptance,decision_id}', 'decision unknown')
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
--          D2 founder acceptance, D1c evidence rewrite, D1b top-level citations).
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
    perform hq._validate_against_target(p_target_type, p_payload, v_cur);
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
--          a created recommendation's made_by is "Proposed through the inbox by <handle>".
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
-- record_founder_decision: founder only. The single path by which acceptance and
-- requirement dispositions are ever recorded in HQ.
-- Rules:
--   (0003) active human founder in an interactive session; title and exact wording required;
--          effects, resolves and module_ids are arrays; effects set a requirement disposition or
--          an acceptance (accepted / rejected / none) on build, module, evidence, requirement,
--          loop or commission;
--   (0005, D13) checked before anything is written (HQ422 naming the id): every id in resolves
--          exists at head and is a decision or open item; every module_ids entry is an existing
--          module; every effect target exists;
--   (0005, D2)  set_acceptance also stores accepted_version, the record version it wrote.
-- ---------------------------------------------------------------------------
create or replace function hq.record_founder_decision(
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
      raise exception 'resolves: "%" is not a decision or open item in HQ', left(v_ref #>> '{}', 120) using errcode = 'HQ422';
    end if;
  end loop;
  for v_ref in select * from jsonb_array_elements(coalesce(p_module_ids, '[]'::jsonb)) loop
    if jsonb_typeof(v_ref) <> 'string' or not exists (
         select from (select deleted from hq.record_versions
                       where record_id = v_ref #>> '{}' and record_type = 'module'
                       order by version desc limit 1) h
          where not h.deleted) then
      raise exception 'module_ids: "%" is not a module in HQ', left(v_ref #>> '{}', 120) using errcode = 'HQ422';
    end if;
  end loop;
  for v_eff in select * from jsonb_array_elements(coalesce(p_effects, '[]'::jsonb)) loop
    if v_eff ->> 'type' = 'set_requirement_disposition' then
      v_ref := to_jsonb(coalesce(v_eff ->> 'requirement_id', ''));
      if not exists (select from (select deleted from hq.record_versions
                                    where record_type = 'requirement' and record_id = v_eff ->> 'requirement_id'
                                    order by version desc limit 1) h where not h.deleted) then
        raise exception 'effect target requirement "%" does not exist', left(v_ref #>> '{}', 120) using errcode = 'HQ422';
      end if;
    elsif v_eff ->> 'type' = 'set_acceptance' then
      if (v_eff ->> 'record_type') is null
         or (v_eff ->> 'record_type') not in ('build', 'module', 'evidence', 'requirement', 'loop', 'commission') then
        raise exception 'acceptance cannot be recorded on record type "%"', coalesce(v_eff ->> 'record_type', '') using errcode = 'HQ422';
      end if;
      if not exists (select from (select deleted from hq.record_versions
                                    where record_type = v_eff ->> 'record_type' and record_id = v_eff ->> 'record_id'
                                    order by version desc limit 1) h where not h.deleted) then
        raise exception 'effect target %/% does not exist', v_eff ->> 'record_type', left(coalesce(v_eff ->> 'record_id', ''), 120)
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
      -- accepted_version: the version this decision writes, i.e. exactly what was accepted.
      v_data := v_cur.data || jsonb_build_object('hq_acceptance', jsonb_build_object(
                  'state', v_eff ->> 'state', 'decision_id', v_id, 'decided_at', v_now,
                  'decided_by', v_f.handle, 'scope_note', v_eff ->> 'scope_note',
                  'accepted_version', v_cur.version + 1));
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
-- Administrative import (owner only; SECURITY INVOKER on purpose).
-- p_records: [{"type":"module","id":"MOD-…","data":{…}}, …]
-- Rules:
--   (0003) API roles refused; the actor is a known active principal; no record may carry
--          hq_acceptance or be a decision recorded in HQ; records changed through governance are
--          never overwritten (reported as "diverged"); optionally retires missing imported records;
--   (0005, D11) a record id of the form XX-HQ-n (in "id" or in data.id) is refused (HQ422):
--          those ids are issued by HQ itself.
-- ---------------------------------------------------------------------------
create or replace function hq.admin_put_records(
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
    if (v_rec ->> 'id') ~ '^[A-Z]{2,5}-HQ-[0-9]+$' or (v_rec #>> '{data,id}') ~ '^[A-Z]{2,5}-HQ-[0-9]+$' then
      raise exception 'record %/% cannot be imported: ids of this form are issued by HQ itself',
        v_rec ->> 'type', coalesce(v_rec ->> 'id', v_rec #>> '{data,id}') using errcode = 'HQ422';
    end if;
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

-- ---------------------------------------------------------------------------
-- _next_id: the next HQ-issued id for a prefix.
-- Rules:
--   (0002) one counter per prefix in hq.id_counters, zero-padded to p_width;
--   (0005, D11) an id that already exists (a record in hq.record_versions, or a proposal) is
--          skipped, so HQ never appends to a record it did not create.
-- ---------------------------------------------------------------------------
create or replace function hq._next_id(p_prefix text, p_width integer default 4) returns text
language plpgsql as $$
declare
  v_n  bigint;
  v_id text;
begin
  loop
    insert into hq.id_counters as c (prefix, n) values (p_prefix, 1)
    on conflict (prefix) do update set n = c.n + 1
    returning n into v_n;
    v_id := p_prefix || lpad(v_n::text, p_width, '0');
    exit when not exists (select from hq.record_versions where record_id = v_id)
          and not exists (select from hq.proposals where id = v_id);
  end loop;
  return v_id;
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
--          new version (changed content, or retirement) from anything but a founder decision.
-- ---------------------------------------------------------------------------
create or replace function hq.tg_record_version_seal() returns trigger
language plpgsql as $$
declare
  v_prev      hq.record_versions;
  v_first     hq.record_versions;
  v_actor     hq.principals;
  v_ctx       text := coalesce(current_setting('hq.write_context', true), '');
  v_acc_state text;
  v_field     text;
begin
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
    raise exception '%/% carries a founder acceptance recorded in HQ (%); only a founder decision can change it',
      new.record_type, new.record_id, coalesce(v_prev.data #>> '{hq_acceptance,decision_id}', 'decision unknown')
      using errcode = 'HQ409';
  end if;

  -- Rule 4. A decision recorded in HQ can only come from the founder decision function.
  if new.record_type = 'decision' and new.data ->> 'recorded_in' = 'hq'
     and new.origin <> 'founder_decision' then
    raise exception 'decisions recorded in HQ can only be written by hq.record_founder_decision'
      using errcode = 'HQ403';
  end if;

  -- Rule 5. A requirement''s disposition changes only through a founder decision.
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
-- Grants. PostgreSQL grants EXECUTE to PUBLIC on every new function: revoke it, then grant
-- exactly what is needed. Internal helpers run inside SECURITY DEFINER functions (as the owner)
-- and are granted to no API role. CREATE OR REPLACE keeps a function's existing privileges; they
-- are restated here so this file shows the complete picture for everything it touches.
-- ---------------------------------------------------------------------------
revoke all on function
  hq._norm_quote(text),
  hq._quote_problem(text, text, text),
  hq._quote_ok(text, text),
  hq.admin_put_source_texts(jsonb),
  hq.quotes_ok(jsonb),
  hq.build_only_fields(text),
  hq.source_integrity_fields(),
  hq._check_labels(text, jsonb, boolean),
  hq._check_quotes(jsonb),
  hq._validate_against_target(text, jsonb, hq.record_versions)
  from public, anon, authenticated, hq_auth, service_role;

revoke all on function
  hq.protected_fields(), hq._validate_payload(text, text, jsonb), hq._next_id(text, integer),
  hq.admin_put_records(jsonb, text, text, text, boolean), hq.tg_record_version_seal()
  from public, anon, authenticated, hq_auth;

revoke all on function
  hq.submit_proposal(text, text, text, integer, bigint, text, text, jsonb, jsonb, text),
  hq.review_proposal(text, text, text),
  hq.record_founder_decision(text, text, text, jsonb, jsonb, jsonb, text)
  from public, anon, hq_auth;

grant execute on function
  hq.submit_proposal(text, text, text, integer, bigint, text, text, jsonb, jsonb, text),
  hq.review_proposal(text, text, text),
  hq.record_founder_decision(text, text, text, jsonb, jsonb, jsonb, text),
  hq.quotes_ok(jsonb)
  to authenticated;
