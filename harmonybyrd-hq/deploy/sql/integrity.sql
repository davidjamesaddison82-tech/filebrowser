-- HarmonyByrd HQ: structural integrity checks for a live database or a backup restored for testing.
-- Unlike verify-restore.sql (an exact comparison with the preserved database, used once at migration),
-- these checks stay valid as the founder adds records. Each line is "check|value|PASS or FAIL".
--   psql -d <database> -At -f integrity.sql
\pset footer off
select 'records_current|' || count(*) || '|' || case when count(*) >= 1581 then 'PASS' else 'FAIL' end from hq.records_at(hq.head_rev());
select 'source_texts|' || count(*) || '|' || case when count(*) >= 41 then 'PASS' else 'FAIL' end from hq.source_texts;
select 'revisions_sealed|' || count(*) filter (where content_hash is not null) || '/' || count(*) || '|' ||
       case when count(*) filter (where content_hash is null) = 0 then 'PASS' else 'FAIL' end from hq.dataset_revisions;
select 'seals_match_recomputed|' || count(*) filter (where content_hash = hq.dataset_hash(rev)) || '/' || count(*) || '|' ||
       case when count(*) filter (where content_hash is distinct from hq.dataset_hash(rev)) = 0 then 'PASS' else 'FAIL' end from hq.dataset_revisions;
select 'hash_chain_problems|' || count(*) || '|' || case when count(*) = 0 then 'PASS' else 'FAIL' end from hq.verify_chain();
with c as (select q.c from hq.records_at(hq.head_rev()) r, jsonb_path_query(r.data, 'strict $.**.citations[*]') q(c))
select 'citations_naming_unknown_source|' || count(*) || '|' || case when count(*) = 0 then 'PASS' else 'FAIL' end from c
 where not exists (select 1 from hq.records_at(hq.head_rev()) s where s.record_type = 'source' and s.record_id = c.c->>'source_id');
with c as (select q.c from hq.records_at(hq.head_rev()) r, jsonb_path_query(r.data, 'strict $.** ? (@.source_id != null && @.quote != null)') q(c))
select 'quotations_not_verbatim|' || count(*) filter (where hq._quote_problem(c->>'source_id', c->>'quote', null) is not null) || '/' || count(*) || '|' ||
       case when count(*) filter (where hq._quote_problem(c->>'source_id', c->>'quote', null) is not null) = 0 then 'PASS' else 'FAIL' end from c;
select 'requirement_wordings_not_verbatim|' || count(*) filter (where hq._quote_problem(data->>'source_id', data->>'exact_wording', 'wording') is not null) || '|' ||
       case when count(*) filter (where hq._quote_problem(data->>'source_id', data->>'exact_wording', 'wording') is not null) = 0 then 'PASS' else 'FAIL' end
  from hq.records_at(hq.head_rev()) where record_type = 'requirement';
select 'head_revision|' || hq.head_rev() || '|INFO';
select 'head_seal|' || content_hash || '|INFO' from hq.dataset_revisions where rev = hq.head_rev();
