#!/usr/bin/env python3
"""Generate mutation SQL files against the CURRENT function bodies (pg_get_functiondef + replace).

Each "replace" mutation fails loudly if its target text is not found exactly `count` times, so a
mutation that silently does nothing can never be reported as "survived".
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
MUT = os.path.join(HERE, "mut")
os.makedirs(MUT, exist_ok=True)

SEAL = "hq.tg_record_version_seal()"
VP = "hq._validate_payload(text,text,jsonb)"
SUBMIT = "hq.submit_proposal(text,text,text,integer,bigint,text,text,jsonb,jsonb,text)"
REVIEW = "hq.review_proposal(text,text,text)"
ADMIN = "hq.admin_put_records(jsonb,text,text,text,boolean)"
CHAIN = "hq.verify_chain()"
FD = "hq.record_founder_decision(text,text,text,jsonb,jsonb,jsonb,text)"
QP = "hq._quote_problem(text,text,text)"
LBL = "hq._check_labels(text,jsonb,boolean)"
QT = "hq._check_quotes(jsonb)"
VAT = "hq._validate_against_target(text,jsonb,hq.record_versions)"
WD = "hq.withdraw_proposal(text,text)"
EVO = "hq.tg_proposal_event_order()"
PST = "hq.proposal_status(text)"
LR = "hq.log_refusal(text,text,text,text,jsonb,text)"
LA = "hq.log_access(text,text,text,text,text)"
ES = "hq.end_sessions()"
PES = "hq.tg_passphrase_ends_sessions()"
BR = "hq._begin_revision(text,text,text,uuid)"
SR = "hq._seal_revision(bigint)"
RF = "hq._require_founder(text,text,text)"

# name -> list of steps; a step is ("r", function, old, new, occurrence or None for all) or ("sql", text)
M = {}

def rep(name, fn, old, new, nth=None, expect=None):
    M.setdefault(name, []).append(("r", fn, old, new, nth, expect))

def sql(name, text):
    M.setdefault(name, []).append(("sql", text))

# ---- founder gate (tests-1) ----
rep("m01_founder_role", RF, "if not (v_p.app_role = 'founder' and v_p.kind = 'human') then", "if false then")
rep("m15_amr", RF, "if coalesce(hq.jwt_claims() ->> 'amr', '') <> 'session' then", "if false then")
rep("m18_listcred", "hq.founder_list_credentials()", "if (select hq.current_app_role()) is distinct from 'founder' then", "if false then")

# ---- sealing trigger (tests-3, D3 write context) ----
rep("m02_rule1_seed", SEAL, "if new.origin = 'seed_import' and v_ctx <> 'admin_import' then", "if false then")
rep("m02b_rule1_proposal", SEAL, "elsif new.origin = 'proposal_acceptance' and v_ctx <> 'review_proposal' then", "elsif false then")
rep("m02c_rule1_founder", SEAL, "elsif new.origin = 'founder_decision' and v_ctx <> 'founder_decision' then", "elsif false then")
rep("m02d_rule1_rev_binding", SEAL, """if new.rev is distinct from v_wc.rev or new.created_by is distinct from v_wc.actor
     or new.created_by is distinct from v_revision.created_by then""", "if false then")
rep("m02e_ctx_from_setting", SEAL, "v_ctx := coalesce(v_wc.context, '');", "v_ctx := coalesce(nullif(current_setting('hq.write_context', true), ''), v_wc.context, '');")
rep("m02e_ctx_from_setting", SEAL, """if new.rev is distinct from v_wc.rev or new.created_by is distinct from v_wc.actor
     or new.created_by is distinct from v_revision.created_by then""", "if false then")
rep("m0a_rule0_sealed", SEAL, "if v_revision.content_hash is not null then", "if false then")
rep("m0b_rule0_latest", SEAL, "if new.rev <> (select max(rev) from hq.dataset_revisions) then", "if false then")
rep("m0c_rule0_regress", SEAL, "if v_prev.version is not null and new.rev < v_prev.rev then", "if false then")
rep("m03_rule2", SEAL, """if new.origin in ('proposal_acceptance', 'founder_decision')
     and not""", "if false and not")
rep("m04_rule3", SEAL, "if v_acc_state is not null and v_acc_state <> 'none'", "if false and v_acc_state is not null")
rep("m05_rule4", SEAL, "if new.record_type = 'decision' and new.data ->> 'recorded_in' = 'hq'", "if false and new.record_type = 'decision'")
rep("m06_rule6_partial", SEAL, "array['exact_wording', 'source_id', 'locator', 'source_date', 'attribution']", "array['exact_wording', 'source_id', 'attribution']")
rep("m23_rule5", SEAL, """if new.record_type = 'requirement' and v_prev.version is not null
     and (v_prev.data ->> 'disposition')""", "if false and (v_prev.data ->> 'disposition')")
rep("m25_rule7", SEAL, "and (v_prev.data #>> '{hq_acceptance,state}') in ('accepted', 'rejected')", "and false")
rep("m26_data_id", SEAL, "if new.data ->> 'id' is distinct from new.record_id then", "if false then")
rep("m12_admin_acceptance", ADMIN, "if v_rec -> 'data' ? 'hq_acceptance' or (v_rec ->> 'type' = 'decision' and v_rec #>> '{data,recorded_in}' = 'hq') then", "if false then")
rep("m20_admin_and_rules34", ADMIN, "if v_rec -> 'data' ? 'hq_acceptance' or (v_rec ->> 'type' = 'decision' and v_rec #>> '{data,recorded_in}' = 'hq') then", "if false then")
rep("m20_admin_and_rules34", SEAL, "if v_acc_state is not null and v_acc_state <> 'none'", "if false and v_acc_state is not null")
rep("m20_admin_and_rules34", SEAL, "if new.record_type = 'decision' and new.data ->> 'recorded_in' = 'hq'", "if false and new.record_type = 'decision'")
rep("m21_role_and_rule2", RF, "if not (v_p.app_role = 'founder' and v_p.kind = 'human') then", "if false then")
rep("m21_role_and_rule2", SEAL, """if new.origin in ('proposal_acceptance', 'founder_decision')
     and not""", "if false and not")
rep("m27_begin_twice", BR, "if exists (select from hq._write_context where txid = txid_current()) then", "if false then")
sql("m28_commit_unsealed", "drop trigger write_context_sealed on hq._write_context;")
sql("m29_service_role_writes", """grant insert, update, delete, truncate on all tables in schema hq to service_role;
grant execute on function hq._append_record(text,text,jsonb,boolean,bigint,uuid,text,text) to service_role;
grant execute on function hq._begin_revision(text,text,text,uuid) to service_role;
grant execute on function hq._seal_revision(bigint) to service_role;
grant execute on function hq.admin_put_records(jsonb,text,text,text,boolean) to service_role;""")
sql("m29b_internal_exec_authenticated", """grant execute on function hq._append_record(text,text,jsonb,boolean,bigint,uuid,text,text) to authenticated;
grant execute on function hq._begin_revision(text,text,text,uuid) to authenticated;
grant execute on function hq._seal_revision(bigint) to authenticated;
grant execute on function hq.admin_put_records(jsonb,text,text,text,boolean) to authenticated;
grant execute on function hq.admin_put_source_texts(jsonb) to authenticated;""")

# ---- append-only (tests-5) ----
sql("m13_events_truncate", """drop trigger proposal_events_no_truncate on hq.proposal_events;
drop trigger proposals_no_truncate on hq.proposals;
drop trigger dataset_revisions_no_truncate on hq.dataset_revisions;""")
sql("m14_proposals_update", """drop trigger proposals_append_only on hq.proposals;
create trigger proposals_append_only before delete on hq.proposals for each row execute function hq.tg_append_only();
drop trigger proposal_events_append_only on hq.proposal_events;
create trigger proposal_events_append_only before update on hq.proposal_events for each row execute function hq.tg_append_only();""")
sql("m14b_audit_update", """drop trigger audit_log_append_only on hq.audit_log;
create trigger audit_log_append_only before delete on hq.audit_log for each row execute function hq.tg_append_only();""")
sql("m14c_versions_truncate", "drop trigger record_versions_no_truncate on hq.record_versions;")

# ---- inbox checks (tests-6) ----
rep("m08_protected_wording", "hq.protected_fields()", "array['id', 'exact_wording', 'source_id', 'locator', 'source_date', 'attribution',", "array['id',")
rep("m08b_protected_d1c", "hq.protected_fields()", """'decided_by', 'decided_at', 'verification', 'submitted_by',
               'hq_checks', 'made_by', 'recorded_from_cluster']""", "'decided_by', 'decided_at', 'verification', 'submitted_by']")
rep("m09_submit_stale", SUBMIT, "if p_base_version <> v_cur.version then", "if false then")
rep("m10_review_stale", REVIEW, "or v_cur.version <> v_prop.base_version then", "then")
rep("m16_submit_role", SUBMIT, "if v_p.app_role not in ('founder', 'developer', 'ai_agent') then", "if false then")
rep("m17_submit_scope", SUBMIT, "if v_claims ? 'scopes' and not (v_claims -> 'scopes' ? 'propose') then", "if false then")
rep("m30_update_decision", VP, "if p_target_type = 'decision' then", "if false then")
rep("m31_create_protected", VP, "(v_key = any (hq.protected_fields()) and not (v_key in ('source_id', 'locator', 'source_date', 'attribution', 'exact_wording')))", "false")
rep("m32_creatable_types", VP, "if v_type is null or not (hq.creatable_types() ? v_type) then", "if v_type is null then")
rep("m33_review_revalidate", REVIEW, "perform hq._validate_payload(v_prop.kind, v_prop.target_type, v_prop.payload);", "perform 1;")
rep("m34_requirement_disposition_create", REVIEW, """if v_type = 'requirement' then
      v_data := v_data || jsonb_build_object('disposition', 'unreviewed');""", """if false then
      v_data := v_data || jsonb_build_object('disposition', 'unreviewed');""")

# ---- stage 1: quotation check on proposals (D1a) ----
rep("mq1_check_quotes_call", VP, "perform hq._check_quotes(v_doc);", "perform 1;")
rep("mq2_quote_min_length", QP, "elsif length(v_norm) < 12 then", "elsif false then")
rep("mq3_quote_not_found", QP, "if strpos(v_body, v_norm) = 0 then", "if false then")
rep("mq4_quote_no_text", QP, "if v_body is null then", "if false then")
rep("mq5_wording_min", QP, "if length(replace(v_norm, ' ', '')) < 8 then", "if false then")
rep("mq6_requirement_wording", VP, "v_prob := hq._quote_problem(v_doc ->> 'source_id', v_doc ->> 'exact_wording', 'wording');", "v_prob := null;")
rep("mq7_malformed_citation", QT, """if jsonb_typeof(v_el) is distinct from 'object' or jsonb_typeof(v_el -> 'source_id') is distinct from 'string'
           or jsonb_typeof(v_el -> 'quote') is distinct from 'string' then""", "if false then")
rep("mq8_norm_quote", "hq._norm_quote(text)", "select btrim(regexp_replace(p_text,", "select btrim(regexp_replace(p_text || '',")  # placeholder; replaced below
rep("mq9_deep_citations", QT, "'strict $.** ? (@.type() == \"object\" && @.source_id.type() == \"string\" && @.quote.type() == \"string\")'", "'strict $.citations[*] ? (@.type() == \"object\" && @.source_id.type() == \"string\" && @.quote.type() == \"string\")'")

# ---- stage 1: HQ-only labels (D1b) ----
rep("ml1_hq_labels", LBL, "if v_val in ('verified', 'hq_recommendation') then", "if false then")
# (ml2_label_needs_citation and ml5_merged_citation are gone: ROUND4 H1 replaced the rule "a source label
# needs a citation" with "a source label is set only by an import"; its mutations are mh1* below.)
rep("ml3_loop_standing", LBL, "v_keys := array_append(v_keys, 'standing');", "null;")
rep("ml4_check_labels_call", VP, "perform hq._check_labels(v_type, v_doc, v_op = 'create');", "perform 1;")

# ---- stage 1: protected / build-only / source / evidence fields (D1c, D15) ----
rep("mb1_build_only_update", VP, "if v_key = any (hq.protected_fields() || hq.build_only_fields(v_type)) then", "if v_key = any (hq.protected_fields()) then")
rep("mb2_build_only_create", VP, """or v_key = any (hq.build_only_fields(v_type)) then""", "then")
rep("mb3_build_only_types", "hq.build_only_fields(text)", "select array['recorded_from_cluster'] || case p_type", "select array['recorded_from_cluster'] || case 'none'")
rep("ms1_source_integrity_update", VP, "if v_type = 'source' and v_key = any (hq.source_integrity_fields()) then", "if false then")
rep("ms2_source_create_kind", VP, """if v_doc ->> 'kind' is distinct from 'named_not_accessible' or v_doc ->> 'access' is distinct from 'not_accessible'
         or v_doc ->> 'authority' is distinct from 'referenced_only' then""", "if false then")
rep("ms3_source_create_snapshot", VP, "if v_doc ? v_key then", "if false then")
rep("me1_evidence_type_update", VP, "if v_type = 'evidence' and v_doc ->> 'type' in ('founder_acceptance', 'hq_check') then", "if false then", nth=1, expect=2)
rep("me1b_evidence_type_create", VP, "if v_type = 'evidence' and v_doc ->> 'type' in ('founder_acceptance', 'hq_check') then", "if false then", nth=2, expect=2)
# (0009, H2) the lock became a freeze of the whole record; the mutation removes the freeze.
rep("me2_evidence_lock", VAT, "if p_target_type = 'evidence' and p_cur.data ->> 'verification' in ('hq_verified', 'source_reported') then", "if false then")
rep("me3_evidence_restamp_update", REVIEW, "if v_type = 'evidence' and coalesce(v_cur.data ->> 'verification', '') not in ('hq_verified', 'source_reported') then", "if false then")
rep("me4_evidence_restamp_create", REVIEW, """if v_type = 'evidence' then
      -- A submission is a claim""", """if false then
      -- A submission is a claim""")
rep("mr1_recommendation_made_by", REVIEW, "if v_type = 'recommendation' then", "if false then")

# ---- stage 1: acceptance binding (D2) ----
rep("ma1_binding_check", VAT, "if v_state in ('accepted', 'rejected') then", "if false then")
rep("ma2_binding_submit_call", SUBMIT, "perform hq._validate_against_target(p_target_type, p_payload, v_cur);", "perform 1;")
rep("ma3_binding_review_call", REVIEW, "perform hq._validate_against_target(v_prop.target_type, v_prop.payload, v_cur);", "perform 1;")
rep("ma4_accepted_version", FD, "'accepted_version', v_cur.version + 1));", "'accepted_version', null));")
rep("ma5_binding_rejected", VAT, "if v_state in ('accepted', 'rejected') then", "if v_state in ('accepted') then")
rep("ma5_binding_rejected", SEAL, "and (v_prev.data #>> '{hq_acceptance,state}') in ('accepted', 'rejected')", "and (v_prev.data #>> '{hq_acceptance,state}') in ('accepted')")

# ---- D13 / D11 ----
rep("md1_resolves_exist", FD, "raise exception 'resolves: \"%\" is not a decision or open item in HQ'", "raise notice 'resolves: \"%\" is not a decision or open item in HQ'")
rep("md2_module_ids_exist", FD, "raise exception 'module_ids: \"%\" is not a module in HQ'", "raise notice 'module_ids: \"%\" is not a module in HQ'")
rep("md3_reserved_ids", ADMIN, "if (v_rec ->> 'id') ~ '^[A-Z]{2,5}-HQ-[0-9]+$' or (v_rec #>> '{data,id}') ~ '^[A-Z]{2,5}-HQ-[0-9]+$' then", "if false then")
rep("md4_next_id_skip", "hq._next_id(text,integer)", """exit when not exists (select from hq.record_versions where record_id = v_id)
          and not exists (select from hq.proposals where id = v_id);""", "exit;")

# ---- D4 verify_chain (tests-11, db-5) ----
rep("m24a_chain_link", CHAIN, "when c.prev_hash is distinct from c.expected_prev then 'broken link to previous version'", "when false then 'broken link to previous version'")
rep("m24a_chain_link", CHAIN, "      or c.prev_hash is distinct from c.expected_prev\n", "")
rep("m24b_chain_gap", CHAIN, "when c.version <> coalesce(c.prev_version, 0) + 1 then 'version gap'", "when false then 'version gap'")
rep("m24b_chain_gap", CHAIN, "      or c.version <> coalesce(c.prev_version, 0) + 1\n", "")
rep("m24c_chain_rowhash", CHAIN, "then 'row hash mismatch'", "and false then 'row hash mismatch'")
rep("m24c_chain_rowhash", CHAIN, "or c.row_hash <> encode(", "or false and c.row_hash <> encode(")
rep("m24d_chain_regression", CHAIN, "from chain c where c.prev_rev is not null and c.rev < c.prev_rev", "from chain c where false")
rep("m24e_chain_unsealed", CHAIN, "where d.rev is null or d.content_hash is null", "where false")
rep("m24f_chain_revgap", CHAIN, "from revs r where r.rev <> coalesce(r.prev_rev, 0) + 1", "from revs r where false")
rep("m24g_chain_seal", CHAIN, "r.content_hash is distinct from hq.dataset_hash(r.rev)", "false")
rep("m24h_chain_count", CHAIN, "and r.record_count is distinct from (select count(*)", "and false and r.record_count is distinct from (select count(*)")
rep("m24i_chain_sealchain", CHAIN, "and r.seal_hash is distinct from encode(", "and false and r.seal_hash is distinct from encode(")
rep("m24j_chain_content", CHAIN, "when c.content_hash <> encode(sha256(convert_to(c.data::text, 'UTF8')), 'hex') then 'content hash mismatch'", "when false then 'content hash mismatch'")
rep("m24j_chain_content", CHAIN, "where c.content_hash <> encode(sha256(convert_to(c.data::text, 'UTF8')), 'hex')", "where false")
rep("m24k_seal_unchained", SR, "seal_hash    = hq._seal_hash(v_parent, p_rev, v_hash, v_count)", "seal_hash    = hq._seal_hash(null, p_rev, v_hash, v_count)")

# ---- D6 proposal state machine ----
sql("mps1_event_order_trigger", "drop trigger proposal_events_order on hq.proposal_events;")
rep("mps2_second_submitted", EVO, "if v_last is not null then", "if false then")
rep("mps3_event_after_close", EVO, "elsif v_last is distinct from 'submitted' then", "elsif false then")
rep("mps4_withdraw_lock", WD, "perform pg_advisory_xact_lock(hashtext('hq.dataset.write'));", "perform 1;")
rep("mps5_withdraw_scope", WD, "if v_claims ? 'scopes' and not (v_claims -> 'scopes' ? 'propose') then", "if false then")
rep("mps6_withdraw_role", WD, "if v_p.app_role not in ('founder', 'developer', 'ai_agent') then", "if false then")
rep("mps7_withdraw_active", WD, "select * into v_p from hq.principals where id = hq.current_principal_id() and active;", "select * into v_p from hq.principals where id = hq.current_principal_id();")
rep("mps8_status_visibility", PST, "where exists (", "where true or exists (")
rep("mps9_review_lock", REVIEW, "perform pg_advisory_xact_lock(hashtext('hq.dataset.write'));", "perform 1;")
rep("mps10_withdraw_owner", WD, "if not found or v_prop.submitted_by is distinct from v_p.id then", "if not found then")
rep("mps11_review_status", REVIEW, "if v_status <> 'submitted' then", "if false then")

# ---- D5 audit wrappers ----
sql("mau1_log_event_granted", "grant execute on function hq.log_event(text,text,text,text,jsonb,text) to authenticated, anon, hq_auth, service_role;")
rep("mau2_refusal_outcome", LR, "if p_outcome is null or p_outcome not in ('denied', 'error') then", "if false then")
rep("mau3_refusal_action", LR, "if p_action is null or p_action !~ '^[a-z_]+(\\.[a-z_0-9]+){1,3}$' then", "if false then")
rep("mau4_refusal_size", LR, "if v_detail is not null and pg_column_size(v_detail) > 8192 then", "if false then")
rep("mau5_refusal_anon", LR, "if current_setting('role', true) is distinct from 'anon' then", "if true then")
rep("mau6_refusal_request_id", LR, "if v_request is not null and v_request !~ '^[A-Za-z0-9._-]{1,64}$' then", "if false then")
rep("mau7_refusal_active", LR, "select * into v_p from hq.principals where id = hq.current_principal_id() and active;", "select * into v_p from hq.principals where id = hq.current_principal_id();")
rep("mau8_access_principal", LA, "if v_p.id is null then", "if false then")
rep("mau9_access_anon", LA, "if current_setting('role', true) is distinct from 'anon' then", "if true then")
# (0007, F4) log_access accepts only the actions the application logs; mau10 removes the check.
# (0009, H11) an exact list, with tool./mcp. names from hq.tool_names; LA_ACTIONS is the whole condition.
LA_TOOLS = "or exists (select from hq.tool_names t where p_action in ('tool.' || t.name, 'mcp.' || t.name))"
LA_ACTIONS = """if p_action is null
     or not (p_action in ('api.index', 'api.whoami', 'tools.list', 'integrations.read', 'proposal.read',
                          'session.sign_in', 'session.sign_out', 'session.end_all')
             """ + LA_TOOLS + """) then"""
rep("mau10_access_action", LA, LA_ACTIONS, "if false then")
rep("mau11_access_request_id", LA, "if v_request is not null and v_request !~ '^[A-Za-z0-9._-]{1,64}$' then", "if false then")

# ---- 0007 F1: a proposal cannot introduce a claim of acceptance ----
RAC = "hq._refuse_acceptance_claims(text,jsonb,hq.record_versions)"
rep("mf1a_build_standing", RAC, "if p_type = 'build' and v_after ->> 'standing' = 'accepted_reported'", "if false and v_after ->> 'standing' = 'accepted_reported'")
# Since 0008 the G1a freeze runs first and refuses every case this clause lets through, so removing the
# clause alone changes nothing (an equivalent mutant). The 0007 exemption it encoded, "unless the target
# already had exactly that standing", is now the freeze's own test: mutated there instead.
rep("mf1b_build_standing_unless", RAC, "or v_after ->> 'standing' = 'accepted_reported'\n", "\n")
# (0008, G1b replaced the 0007 lines these targeted; the same breakages, against the current text.)
RAC_POSITIVE = """    if v_fa is not null
       and not coalesce(jsonb_typeof(v_fa) = 'object' and jsonb_typeof(v_fa -> 'state') = 'string'
                        and v_fa ->> 'state' in ('no', 'unknown', 'not_applicable'), false) then"""
RAC_IDENTICAL = "      if v_fa is distinct from v_was then"
rep("mf1c_module_lifecycle", RAC, RAC_POSITIVE, "    if false then")
rep("mf1d_module_identical_state_only", RAC, RAC_IDENTICAL, "      if (v_fa -> 'state') is distinct from (v_was -> 'state') then")
rep("mf1e_top_level_field", RAC, "if v_key = 'founder_accepted' or v_key like '%.founder\\_accepted' then", "if false then")
# The rule removed from one path at a time: submission (update, create) and acceptance (update, create).
rep("mf1f_submit_update", SUBMIT, "perform hq._refuse_acceptance_claims(p_target_type, p_payload, v_cur);", "perform 1;")
rep("mf1g_submit_create", SUBMIT, "perform hq._refuse_acceptance_claims(p_payload ->> 'record_type', p_payload, null::hq.record_versions);", "perform 1;")
rep("mf1h_review_update", REVIEW, "perform hq._refuse_acceptance_claims(v_prop.target_type, v_prop.payload, v_cur);", "perform 1;")
rep("mf1i_review_create", REVIEW, "perform hq._refuse_acceptance_claims(v_prop.payload ->> 'record_type', v_prop.payload, null::hq.record_versions);", "perform 1;")

# ---- 0008 G1a: a build a source reports as accepted is frozen for proposals ----
rep("mg1a_build_freeze_removed", RAC, "if p_type = 'build' and v_update and v_before ->> 'standing' = 'accepted_reported'", "if false and v_before ->> 'standing' = 'accepted_reported'")
# The first ROUND3 G1 text: the statement of a reported build is bound. Mutated so that a proposal
# that sets the statement is let through the freeze.
rep("mf1j_build_statement_binding", RAC, "if p_type = 'build' and v_update and v_before ->> 'standing' = 'accepted_reported'",
    "if p_type = 'build' and v_update and not (v_doc ? 'statement') and v_before ->> 'standing' = 'accepted_reported'")
# ---- 0008 G1b: the whole founder_accepted entry; any state but no / unknown / not_applicable is positive ----
rep("mg1b_four_keys", RAC, RAC_IDENTICAL, """      if jsonb_build_object('state', v_fa -> 'state', 'basis', v_fa -> 'basis', 'note', v_fa -> 'note', 'citations', v_fa -> 'citations')
         is distinct from jsonb_build_object('state', v_was -> 'state', 'basis', v_was -> 'basis', 'note', v_was -> 'note', 'citations', v_was -> 'citations') then""")
rep("mg1b_positive_exact", RAC, RAC_POSITIVE, "    if jsonb_typeof(v_fa) = 'object' and v_fa ->> 'state' in ('yes', 'partial') then")
# ---- 0008 G1c: the database's own check of the values that drive labels ----
CFE = "hq._check_field_enums(text,jsonb,hq.record_versions)"
REV = "hq._refuse_enum_value(text,jsonb,text[])"
rep("mg1c_enum_check_removed", CFE, """  if jsonb_typeof(v_doc) is distinct from 'object' then
    return;
  end if;""", "  return;")
rep("mg1c_enum_value_noop", REV, "if jsonb_typeof(p_value) is distinct from 'string' or not ((p_value #>> '{}') = any (p_allowed)) then", "if false then")
rep("mg1c_enum_create_call", VP, "perform hq._check_field_enums(v_type, p_payload, null::hq.record_versions);", "perform 1;")
rep("mg1c_enum_update_call", VAT, "perform hq._check_field_enums(p_target_type, p_payload, p_cur);", "perform 1;")
rep("mg1c_enum_scope_whole_record", CFE, "v_target := case when v_row.drives_acceptance then v_after else v_scope end;", "v_target := v_after;")
rep("mg1c_enum_acceptance_only_scope", CFE, "v_target := case when v_row.drives_acceptance then v_after else v_scope end;", "v_target := v_scope;")
rep("mg1c_enum_not_object", CFE, """    if jsonb_typeof(v_value) is distinct from 'object' then
      raise exception 'field "%" must be an object', v_parts[1] using errcode = 'HQ422';
    end if;""", "    continue when jsonb_typeof(v_value) is distinct from 'object';")
rep("mg1c_enum_keys", CFE, "if not (v_key = any (v_row.allowed)) then", "if false then")
sql("mg1c_enum_row_deleted", "delete from hq.field_enums where record_type = 'build' and path = 'standing';")
sql("mg1c_enum_row_value_added", "update hq.field_enums set allowed = allowed || 'accepted'::text where record_type = 'build' and path = 'standing';")

# ---- 0008 G2: audit actions bounded ----
# (mg2a_access_families_wide and mg2b_access_words_removed are gone: ROUND4 H11 replaced 0008's families
# and word list with an exact list; its mutations are mh11* below.)
rep("mg2c_refusal_length", LR, "if length(p_action) > 80 then", "if false then")
sql("mg2d_action_size_constraint", "alter table hq.audit_log drop constraint audit_log_action_size;")

# ---- 0007 F3: service_role acts as no one ----
sql("mf3_service_role_founder_decision", "grant execute on function hq.record_founder_decision(text,text,text,jsonb,jsonb,jsonb,text) to service_role;")

# ---- 0007 F4: log_access families, audit detail size ----
rep("mf4_access_any_dotted_action", LA, LA_ACTIONS, "if p_action is null or p_action !~ '^[a-z_]+(\\.[a-z_0-9]+){1,3}$' then")
sql("mf4b_audit_detail_size", "alter table hq.audit_log drop constraint audit_log_detail_size;")

# ---- D7 session epoch ----
rep("mse1_end_sessions_noop", ES, "set session_epoch = session_epoch + 1 where id = v_p.id", "set session_epoch = session_epoch where id = v_p.id")
rep("mse2_end_sessions_token", ES, "if v_p.kind <> 'human' or coalesce(hq.jwt_claims() ->> 'amr', '') <> 'session' then", "if false then")
rep("mse3_passphrase_epoch", PES, "update hq.principals set session_epoch = session_epoch + 1 where id = new.principal_id;", "null;")
rep("mse4_get_principal_epoch", "hq.auth_get_principal(uuid)", "'session_epoch', p.session_epoch)", "'session_epoch', 0)")
rep("mse5_end_sessions_other", ES, "update hq.principals set session_epoch = session_epoch + 1 where id = v_p.id", "update hq.principals set session_epoch = session_epoch + 1 where kind = 'human'")

# ---- credentials, pinned reads ----
rep("m07_expiry", "hq.auth_find_credential(text)", "and (c.expires_at is null or c.expires_at > clock_timestamp())", "")
rep("m11_revoked", "hq.auth_find_credential(text)", "and c.revoked_at is null", "")
rep("m22_records_at", "hq.records_at(bigint)", "where rev <= p_rev", "where true")

# ---- 0009 (ROUND4) ----
CPC = "hq._check_proposal_claims(text,jsonb,hq.record_versions)"
SLP = "hq._source_label_path(jsonb,jsonb,text,text[])"
# H1: a source label is set only by an import.
rep("mh1a_source_label_removed", CPC, "  if v_path is not null then", "  if false then")
rep("mh1b_source_label_compares_label_only", SLP, "      if p_new is distinct from p_old then",
    "      if (p_new -> 'epistemic') is distinct from (p_old -> 'epistemic') or (p_new -> 'basis') is distinct from (p_old -> 'basis') then")
rep("mh1c_source_label_top_level_fields", SLP, "and (p_new -> v_key) is distinct from (p_old -> v_key) then", "and false then")
rep("mh1d_source_label_lists_skipped", SLP, "  elsif jsonb_typeof(p_new) = 'array' then", "  elsif false then")
rep("mh1e_source_label_any_position", SLP, "case when jsonb_typeof(p_old) = 'array' then p_old -> v_i end",
    "case when jsonb_typeof(p_old) = 'array' then (select e from jsonb_array_elements(p_old) e where e = p_new -> v_i limit 1) end")
# L6: a pathway's commission_example is a source label too (only an import sets it).
rep("mh1j_commission_example_settable", SLP, "'founder_statement', 'commission_example']", "'founder_statement']")
rep("mh1f_submit_update_call", SUBMIT, "    perform hq._check_proposal_claims(p_target_type, p_payload, v_cur);", "    perform 1;")
rep("mh1g_submit_create_call", SUBMIT, "    perform hq._check_proposal_claims(p_payload ->> 'record_type', p_payload, null::hq.record_versions);", "    perform 1;")
rep("mh1h_review_update_call", REVIEW, "      perform hq._check_proposal_claims(v_prop.target_type, v_prop.payload, v_cur);", "      perform 1;")
rep("mh1i_review_create_call", REVIEW, "    perform hq._check_proposal_claims(v_prop.payload ->> 'record_type', v_prop.payload, null::hq.record_versions);", "    perform 1;")
# H2: records HQ did not write are frozen (the evidence freeze is me2_evidence_lock above).
rep("mh2a_source_freeze_removed", VAT, "  if p_target_type = 'source'\n     and (coalesce(", "  if false\n     and (coalesce(")
rep("mh2b_source_freeze_access_only", VAT, """(coalesce(jsonb_typeof(p_cur.data -> 'text_snapshot'), 'null') <> 'null'
          or (p_cur.data ->> 'access') is distinct from 'not_accessible'
          or exists (select from hq.source_texts t where t.source_id = p_cur.record_id))""", "((p_cur.data ->> 'access') is distinct from 'not_accessible')")
rep("mh2c_source_freeze_no_stored_text", VAT, "\n          or exists (select from hq.source_texts t where t.source_id = p_cur.record_id)", "")
# H3: implemented and tested.
rep("mh3a_tested_state", CPC, "    if (v_after -> 'implementation_state') = '\"implemented_tested\"'::jsonb\n       and", "    if false\n       and")
# (0010 K2 replaced 0009's rule on a tested requirement's links with a freeze of the whole record; this
# mutant now narrows the freeze back to the links.)
rep("mh3b_tested_links", CPC, "      raise exception 'field \"%\": %', left(v_key, 80), v_tested_frozen using errcode = 'HQ403';",
    "      if v_key in ('linked_evidence_ids', 'linked_build_ids') then raise exception 'field \"%\": %', left(v_key, 80), v_tested_frozen using errcode = 'HQ403'; end if;")
# H4: only declared fields.
rep("mh4a_declared_fields_removed", CPC, "  if v_key is not null then", "  if false then")
sql("mh4b_declared_field_added", "insert into hq.record_fields (record_type, field) values ('build', 'Standing');")
# H5: clearing needs something to clear.
rep("mh5_clear_nothing", FD, "      if v_eff ->> 'state' = 'none'\n         and coalesce(", "      if false\n         and coalesce(")
# H6c: the marker of an unreadable value is never written back.
rep("mh6c_marker", CPC, """  if jsonb_path_exists(v_doc, 'strict $.** ? (@ == "Not a valid value")') then""", "  if false then")
# H11: an exact list of audit actions.
rep("mh11a_tool_names_any", LA, LA_TOOLS, "or p_action ~ '^(tool|mcp)\\.[a-z_]{1,60}$'")
rep("mh11b_session_any_object", LA, "if p_action like 'session.%' and p_object_id is not null and p_object_id is distinct from v_p.handle then", "if false then")
sql("mh11c_tool_name_added", "insert into hq.tool_names (name) values ('sign_off');")
# H12: the tests the verifiers showed missing, and a bounded echo.
rep("mh12a_freeze_any_string", RAC, """
          or not exists (select from hq.field_enums e
                          where e.record_type = 'build' and e.path = 'standing' and (v_after ->> 'standing') = any (e.allowed))""", "")
rep("mh12b_epistemic_one_level", CFE, "'strict $.** ? (@.type() == \"object\")'", "'strict $.* ? (@.type() == \"object\")'")
rep("mh12c_record_type_unbounded", VP, "left(coalesce(v_type, ''), 40)", "coalesce(v_type, '')")

# ---- 0010 (ROUND5) ----
# K1: a loop or pathway a source describes is frozen unless the proposal relabels it.
rep("mk1a_loop_freeze_removed", CPC, "  if v_update and p_type in ('loop', 'pathway') then", "  if false then")
rep("mk1b_loop_freeze_source_labels_only", CPC, "'commission_example', 'verified', 'hq_recommendation'];", "'commission_example'];")
rep("mk1c_loop_freeze_any_relabel", CPC, "(v_after ->> v_key) in ('submitter_claim', 'no_evidence')", "(v_after ->> v_key) is not null")
# K2: a requirement shown as implemented and tested is frozen unless the proposal moves it away.
rep("mk2a_tested_freeze_removed", CPC, "       and (v_after -> 'implementation_state') = '\"implemented_tested\"'::jsonb then\n      select o.k", "       and false then\n      select o.k")
# K3: what identifies a build.
rep("mk3a_build_identity_removed", VP, "      if v_type = 'build' and v_key in ('sha256', 'bytes', 'filename', 'artifact_source_id') then", "      if false then")
rep("mk3b_build_identity_no_artifact", VP, "v_key in ('sha256', 'bytes', 'filename', 'artifact_source_id')", "v_key in ('sha256', 'bytes', 'filename')")
# K4: a module's evidence level.
rep("mk4a_level_update_removed", VP, "      if v_type = 'module' and v_key = 'evidence_level' then", "      if false then")
rep("mk4b_level_create_removed", VP, "  if v_op = 'create' and v_type = 'module' and (v_doc -> 'evidence_level')", "  if false and (v_doc -> 'evidence_level')")
rep("mk4c_level_create_named_only", VP, "(v_doc -> 'evidence_level') is distinct from '\"commission_list_only\"'::jsonb", "(v_doc ->> 'evidence_level') not in ('commission_list_only', 'named_only')")
# K5 (Z19): a second clear straight at the database (the verifier's own3).
rep("mk5_second_clear_allowed", FD, "coalesce(v_cur.data #>> '{hq_acceptance,state}', '') not in ('accepted', 'rejected') then",
    "coalesce(v_cur.data #>> '{hq_acceptance,state}', '') not in ('accepted', 'rejected', 'none') then")

sql("noop", "select 1;")

# mq8: _norm_quote that collapses only ASCII whitespace (as a locale-dependent \\s might).
M["mq8_norm_quote"] = [("sql", r"""create or replace function hq._norm_quote(p_text text) returns text
language sql immutable parallel safe strict as $f$ select btrim(regexp_replace(p_text, '[ \t\n\r]+', ' ', 'g'), ' ') $f$;""")]

HELPER = r"""create or replace function pg_temp.mut_replace(p_fn text, p_old text, p_new text, p_nth integer, p_expect integer) returns void
language plpgsql as $h$
declare d text; n text; cnt integer; pos integer; i integer; start integer := 1;
begin
  d := pg_get_functiondef(p_fn::regprocedure);
  cnt := (length(d) - length(replace(d, p_old, ''))) / greatest(length(p_old), 1);
  if cnt = 0 then raise exception 'mutation target not found in %: %', p_fn, left(p_old, 80); end if;
  if p_expect is not null and cnt <> p_expect then raise exception 'expected % occurrences in %, found %', p_expect, p_fn, cnt; end if;
  if p_nth is null then
    n := replace(d, p_old, p_new);
  else
    for i in 1..p_nth loop
      pos := strpos(substr(d, start), p_old);
      start := start + pos - 1 + (case when i < p_nth then length(p_old) else 0 end);
    end loop;
    n := overlay(d placing p_new from start for length(p_old));
  end if;
  execute n;
end
$h$;
"""

def q(s):
    tag = "$mq$"
    assert tag not in s
    return tag + s + tag

os.makedirs(MUT, exist_ok=True)
# A file this script no longer generates (a mutation retired with the rule it broke) is removed, so the
# runner never picks up a stale one.
for f in os.listdir(MUT):
    if f.endswith(".sql") and f[:-4] not in M:
        os.remove(os.path.join(MUT, f))
for name, steps in M.items():
    out = [HELPER]
    for st in steps:
        if st[0] == "sql":
            out.append(st[1])
        else:
            _, fn, old, new, nth, expect = st
            out.append("select pg_temp.mut_replace(%s, %s, %s, %s, %s);" % (q(fn), q(old), q(new), "null" if nth is None else nth, "null" if expect is None else expect))
    with open(os.path.join(MUT, name + ".sql"), "w") as f:
        f.write("\n".join(out) + "\n")
print(len(M), "mutations written")
