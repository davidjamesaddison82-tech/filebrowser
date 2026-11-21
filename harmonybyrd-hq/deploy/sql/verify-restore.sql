-- HarmonyByrd HQ: restoration checks. Run as a superuser (or the schema owner) on a restored database:
--   psql -d <database> -At -f verify-restore.sql
-- Every line is "check|value". Compare with expected-results.txt.
\pset footer off
select 'migrations_applied|' || count(*) from hq_meta.schema_migrations;
select 'dataset_revisions|' || count(*) from hq.dataset_revisions;
select 'record_versions|' || count(*) from hq.record_versions;
select 'current_records_total|' || count(*) from hq.records_at(hq.head_rev());
select 'records.' || record_type || '|' || count(*) from hq.records_at(hq.head_rev()) group by record_type order by record_type;
select 'source_texts|' || count(*) from hq.source_texts;
select 'sources_with_text_and_record|' || count(*) from hq.source_texts t where exists (select 1 from hq.records_at(hq.head_rev()) r where r.record_type='source' and r.record_id=t.source_id);
-- Integrity: the stored seal equals a fresh recomputation, and the hash chain reports no breaks.
select 'seal_matches_recomputed|' || (content_hash = hq.dataset_hash(rev)) from hq.dataset_revisions order by rev;
select 'stored_content_hash|' || content_hash from hq.dataset_revisions order by rev;
select 'stored_seal_hash|' || seal_hash from hq.dataset_revisions order by rev;
select 'verify_chain_problems|' || count(*) from hq.verify_chain();
-- Content fingerprint over every version (type, id, version, content hash, row hash).
select 'versions_fingerprint|' || md5(string_agg(record_type||':'||record_id||':'||version||':'||content_hash||':'||row_hash, ',' order by record_type, record_id, version)) from hq.record_versions;
select 'source_texts_fingerprint|' || md5(string_agg(source_id||':'||sha256||':'||chars, ',' order by source_id)) from hq.source_texts;
-- Source lineage: every citation names a source record; every quotation (any object with source_id and quote,
-- at any depth) and every requirement's exact wording is found verbatim in that source's stored text.
with c as (select q.c from hq.records_at(hq.head_rev()) r, jsonb_path_query(r.data, 'strict $.**.citations[*]') q(c))
select 'citations_total|' || count(*) from c;
with c as (select q.c from hq.records_at(hq.head_rev()) r, jsonb_path_query(r.data, 'strict $.**.citations[*]') q(c))
select 'citations_naming_unknown_source|' || count(*) from c where not exists (select 1 from hq.records_at(hq.head_rev()) s where s.record_type='source' and s.record_id = c.c->>'source_id');
with c as (select q.c from hq.records_at(hq.head_rev()) r, jsonb_path_query(r.data, 'strict $.** ? (@.source_id != null && @.quote != null)') q(c))
select 'quotations_checked|' || count(*) || '|not_found_verbatim|' || count(*) filter (where hq._quote_problem(c->>'source_id', c->>'quote', null) is not null) from c;
select 'requirement_wordings_checked|' || count(*) || '|not_found_verbatim|' || count(*) filter (where hq._quote_problem(data->>'source_id', data->>'exact_wording', 'wording') is not null) from hq.records_at(hq.head_rev()) where record_type='requirement';
-- Representative records.
select 'sample.module|' || record_id || '|' || (data->>'name') from hq.records_at(hq.head_rev()) where record_type='module' order by record_id limit 3;
select 'sample.requirement|' || record_id || '|' || left(data->>'exact_wording', 60) || '|' || (data->>'source_id') from hq.records_at(hq.head_rev()) where record_type='requirement' order by record_id limit 3;
select 'acceptance_recorded_in_hq|' || count(*) from hq.records_at(hq.head_rev()) where data #>> '{hq_acceptance,state}' in ('accepted','rejected');
select 'decisions_recorded_in_hq|' || count(*) from hq.records_at(hq.head_rev()) where record_type='decision' and data->>'recorded_in'='hq';
select 'requirements_unreviewed|' || count(*) from hq.records_at(hq.head_rev()) where record_type='requirement' and data->>'disposition'='unreviewed';
select 'builds_reported_accepted|' || count(*) from hq.records_at(hq.head_rev()) where record_type='build' and data->>'standing'='accepted_reported';
