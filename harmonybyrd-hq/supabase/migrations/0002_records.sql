-- HarmonyByrd HQ · migration 0002 · append-only versioned records
--
-- Every authoritative record (module, learning loop, requirement, decision, evidence …) is
-- stored as an immutable series of versions. Nothing is ever updated or deleted:
--   * a change appends a new version,
--   * retirement appends a tombstone version,
--   * each write transaction creates exactly one dataset revision,
--   * each version row is hash-chained to its predecessor.
-- A reader can therefore pin any dataset revision and get byte-identical records later.

create table hq.dataset_revisions (
  rev            bigint primary key check (rev >= 1),
  parent_rev     bigint references hq.dataset_revisions(rev),
  kind           text not null check (kind in ('seed_import', 'proposal_acceptance', 'founder_decision')),
  summary        text not null check (length(summary) between 3 and 2000),
  commission_ref text,
  created_by     uuid not null references hq.principals(id),
  created_at     timestamptz not null default clock_timestamp(),
  record_count   integer,
  content_hash   text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$')
);
comment on table hq.dataset_revisions is 'One row per write transaction. content_hash covers every live record version at that revision.';

create table hq.record_versions (
  record_type  text not null check (record_type in (
                 'source', 'module', 'loop', 'pathway', 'requirement', 'decision', 'commission',
                 'build', 'evidence', 'defect', 'open_item', 'recommendation')),
  record_id    text not null check (record_id ~ '^[A-Z]{2,5}-[A-Z0-9][A-Z0-9.-]{0,60}$'),
  version      integer not null check (version >= 1),
  rev          bigint not null references hq.dataset_revisions(rev),
  data         jsonb not null check (jsonb_typeof(data) = 'object'),
  deleted      boolean not null default false,
  content_hash text not null,
  prev_hash    text,
  row_hash     text not null,
  created_by   uuid not null references hq.principals(id),
  origin       text not null check (origin in ('seed_import', 'proposal_acceptance', 'founder_decision')),
  proposal_id  text,
  created_at   timestamptz not null default clock_timestamp(),
  primary key (record_type, record_id, version)
);
create index record_versions_rev_idx on hq.record_versions (rev);
comment on table hq.record_versions is 'Append-only. UPDATE, DELETE and TRUNCATE are rejected by trigger.';

-- ---------------------------------------------------------------------------
-- Append-only enforcement (shared by every history table).
-- ---------------------------------------------------------------------------
create function hq.tg_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'hq.% is append-only: % is not permitted', tg_table_name, tg_op
    using errcode = 'HQ405';
end
$$;

create trigger record_versions_append_only
  before update or delete on hq.record_versions
  for each row execute function hq.tg_append_only();
create trigger record_versions_no_truncate
  before truncate on hq.record_versions
  for each statement execute function hq.tg_append_only();

-- dataset_revisions: the row is inserted first and sealed (hash + count) once at the end of
-- the same transaction. After sealing it can never change again.
create function hq.tg_revision_seal_once() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'hq.dataset_revisions is append-only: DELETE is not permitted' using errcode = 'HQ405';
  end if;
  if old.content_hash is not null then
    raise exception 'dataset revision % is sealed and cannot be changed', old.rev using errcode = 'HQ405';
  end if;
  if new.rev <> old.rev or new.kind <> old.kind or new.summary <> old.summary
     or new.created_by <> old.created_by or new.created_at <> old.created_at
     or new.parent_rev is distinct from old.parent_rev
     or new.commission_ref is distinct from old.commission_ref then
    raise exception 'only the seal (content_hash, record_count) of a dataset revision may be set'
      using errcode = 'HQ405';
  end if;
  return new;
end
$$;
create trigger dataset_revisions_seal_once
  before update or delete on hq.dataset_revisions
  for each row execute function hq.tg_revision_seal_once();
create trigger dataset_revisions_no_truncate
  before truncate on hq.dataset_revisions
  for each statement execute function hq.tg_append_only();

-- ---------------------------------------------------------------------------
-- Sealing trigger: assigns the version number, links the hash chain and enforces the
-- rules that must hold on EVERY write path, whatever function performs the insert.
-- ---------------------------------------------------------------------------
create function hq.tg_record_version_seal() returns trigger
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

create trigger record_version_seal
  before insert on hq.record_versions
  for each row execute function hq.tg_record_version_seal();

-- ---------------------------------------------------------------------------
-- Read helpers (SECURITY INVOKER: row-level security applies to the caller).
-- ---------------------------------------------------------------------------
create function hq.head_rev() returns bigint
language sql stable as $$
  select coalesce(max(rev), 0) from hq.dataset_revisions where content_hash is not null
$$;

-- Every record as it stood at dataset revision p_rev (latest version with rev <= p_rev).
create function hq.records_at(p_rev bigint) returns setof hq.record_versions
language sql stable as $$
  select distinct on (record_type, record_id) *
    from hq.record_versions
   where rev <= p_rev
   order by record_type, record_id, version desc
$$;

-- Deterministic hash of the whole dataset at a revision.
create function hq.dataset_hash(p_rev bigint) returns text
language sql stable as $$
  select encode(sha256(convert_to(coalesce(string_agg(
           r.record_type || ':' || r.record_id || ':' || r.version::text || ':' || r.content_hash,
           E'\n' order by r.record_type, r.record_id), ''), 'UTF8')), 'hex')
    from hq.records_at(p_rev) r
   where not r.deleted
$$;

-- Recompute the hash chain; returns one row per broken link (none when intact).
create function hq.verify_chain()
returns table (record_type text, record_id text, version integer, problem text)
language sql stable as $$
  with chain as (
    select v.*,
           lag(v.row_hash) over (partition by v.record_type, v.record_id order by v.version) as expected_prev,
           lag(v.version)  over (partition by v.record_type, v.record_id order by v.version) as prev_version
      from hq.record_versions v
  )
  select c.record_type, c.record_id, c.version,
         case
           when c.content_hash <> encode(sha256(convert_to(c.data::text, 'UTF8')), 'hex') then 'content hash mismatch'
           when c.prev_hash is distinct from c.expected_prev then 'broken link to previous version'
           when c.version <> coalesce(c.prev_version, 0) + 1 then 'version gap'
           when c.row_hash <> encode(sha256(convert_to(
                  coalesce(c.prev_hash, '') || '|' || c.record_type || '|' || c.record_id || '|' ||
                  c.version::text || '|' || c.rev::text || '|' || c.deleted::text || '|' ||
                  c.content_hash, 'UTF8')), 'hex') then 'row hash mismatch'
         end as problem
    from chain c
   where c.content_hash <> encode(sha256(convert_to(c.data::text, 'UTF8')), 'hex')
      or c.prev_hash is distinct from c.expected_prev
      or c.version <> coalesce(c.prev_version, 0) + 1
      or c.row_hash <> encode(sha256(convert_to(
           coalesce(c.prev_hash, '') || '|' || c.record_type || '|' || c.record_id || '|' ||
           c.version::text || '|' || c.rev::text || '|' || c.deleted::text || '|' ||
           c.content_hash, 'UTF8')), 'hex')
$$;

-- ---------------------------------------------------------------------------
-- Internal write primitives. Never granted to API roles; used only by the SECURITY
-- DEFINER functions in later migrations.
-- ---------------------------------------------------------------------------
create table hq.id_counters (
  prefix text primary key,
  n      bigint not null default 0
);

create function hq._next_id(p_prefix text, p_width integer default 4) returns text
language plpgsql as $$
declare
  v_n bigint;
begin
  insert into hq.id_counters as c (prefix, n) values (p_prefix, 1)
  on conflict (prefix) do update set n = c.n + 1
  returning n into v_n;
  return p_prefix || lpad(v_n::text, p_width, '0');
end
$$;

-- Serialise all writers. Revision numbers are therefore gapless and strictly ordered.
create function hq._begin_revision(p_kind text, p_summary text, p_commission_ref text, p_actor uuid)
returns bigint
language plpgsql as $$
declare
  v_rev bigint;
begin
  perform pg_advisory_xact_lock(hashtext('hq.dataset.write'));
  select coalesce(max(rev), 0) + 1 into v_rev from hq.dataset_revisions;
  insert into hq.dataset_revisions (rev, parent_rev, kind, summary, commission_ref, created_by)
  values (v_rev, nullif(v_rev - 1, 0), p_kind, p_summary, p_commission_ref, p_actor);
  return v_rev;
end
$$;

create function hq._seal_revision(p_rev bigint) returns void
language plpgsql as $$
begin
  update hq.dataset_revisions
     set content_hash = hq.dataset_hash(p_rev),
         record_count = (select count(*) from hq.records_at(p_rev) r where not r.deleted)
   where rev = p_rev;
end
$$;

create function hq._append_record(
  p_type text, p_id text, p_data jsonb, p_deleted boolean,
  p_rev bigint, p_actor uuid, p_origin text, p_proposal text)
returns integer
language plpgsql as $$
declare
  v_version integer;
begin
  insert into hq.record_versions
    (record_type, record_id, version, rev, data, deleted, content_hash, row_hash, created_by, origin, proposal_id)
  values
    (p_type, p_id, 1, p_rev, p_data, p_deleted, '', '', p_actor, p_origin, p_proposal)
  returning version into v_version;
  return v_version;
end
$$;

revoke all on function hq._next_id(text, integer), hq._begin_revision(text, text, text, uuid),
  hq._seal_revision(bigint), hq._append_record(text, text, jsonb, boolean, bigint, uuid, text, text)
  from public;
