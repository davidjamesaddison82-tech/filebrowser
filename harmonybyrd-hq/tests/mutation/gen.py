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
LA = "hq.log_access(text,text,text,text)"
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
rep("ml2_label_needs_citation", LBL, "if v_val in ('reported', 'design_intention', 'source_recommendation', 'founder_statement')", "if false and v_val in ('reported', 'design_intention', 'source_recommendation', 'founder_statement')")
rep("ml3_loop_standing", LBL, "v_keys := array_append(v_keys, 'standing');", "null;")
rep("ml4_check_labels_call", VP, "perform hq._check_labels(v_type, v_doc, v_op = 'create');", "perform 1;")
rep("ml5_merged_citation", VAT, "if jsonb_typeof(v_set -> v_key) = 'string'", "if false")

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
rep("me2_evidence_lock", VAT, "and v_set ?| array['type', 'result', 'sha256', 'date', 'build_id'] then", "and false then")
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
rep("mau10_access_action", LA, "if p_action is null or p_action !~ '^[a-z_]+(\\.[a-z_0-9]+){1,3}$' then", "if false then")
rep("mau11_access_request_id", LA, "if v_request is not null and v_request !~ '^[A-Za-z0-9._-]{1,64}$' then", "if false then")

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
