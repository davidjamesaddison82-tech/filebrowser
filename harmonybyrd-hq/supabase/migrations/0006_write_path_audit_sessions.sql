-- HarmonyByrd HQ · migration 0006 · write path, chain verification, audit log, proposal states, sessions
--
--   D3  The write context is no longer a setting any session can change. _begin_revision records it
--       in an owner-only table keyed by the transaction id; the sealing trigger reads it from there and
--       also requires the version to go into the open, unsealed, latest revision, by that revision's
--       author. service_role keeps SELECT only, and no API role (nor service_role) may execute the
--       internal primitives or the imports: imports run on the owner connection.
--       An owner or superuser can still bypass all of this (disable triggers, edit rows). What they
--       change is then visible to verify_chain only when compared with a seal kept outside the database.
--   D4  verify_chain also checks the revision seals (content hash, record count, numbering) and a new
--       seal chain (dataset_revisions.seal_hash); hq.head_seal() gives the value to keep outside.
--   D5  hq.log_event is no longer callable by API roles. Two narrow wrappers replace it for the
--       application: hq.log_refusal (denied / error only) and hq.log_access (allowed, active principal).
--       Refusals raised inside a database function cannot be audited there (the raise rolls the audit
--       row back), so the dead "denied" calls are removed from the bodies replaced here; the application
--       records refusals in a separate transaction.
--   D6  Proposal events form a state machine: "submitted" first, then exactly one closing event.
--       withdraw_proposal takes the dataset write lock (as review_proposal does) and checks the caller
--       as submit_proposal does; proposal_status answers only the submitter and the founder.
--   D7  principals.session_epoch: hq.end_sessions() increments it, ending every session signed with
--       the earlier value. Changing a passphrase increments it too.
--
-- Functions replaced here start from their latest body (0005 where 0005 replaced them) and keep every
-- rule; each header lists the rules, marked with the migration and design section that added them.
-- The 0005 bodies of review_proposal, record_founder_decision and admin_put_records still call
-- set_config('hq.write_context', …): those calls are now inert (nothing reads the setting).

-- ---------------------------------------------------------------------------
-- D3. The write context, bound to the transaction.
-- ---------------------------------------------------------------------------
create table hq._write_context (
  txid    bigint primary key,
  context text not null check (context in ('admin_import', 'review_proposal', 'founder_decision')),
  actor   uuid references hq.principals(id),
  rev     bigint not null references hq.dataset_revisions(rev)
);
comment on table hq._write_context is
  'The dataset revision a transaction has open, and which write path opened it. Written by hq._begin_revision, removed by hq._seal_revision. Owner-only.';
alter table hq._write_context enable row level security;
revoke all on table hq._write_context from public, anon, authenticated, hq_auth, service_role;

-- A revision opened in a transaction must be sealed in that transaction: checked at commit.
-- SECURITY DEFINER because a deferred trigger runs at COMMIT as the session's role (e.g. authenticated),
-- outside the SECURITY DEFINER function that opened the revision.
create function hq.tg_write_context_sealed() returns trigger
language plpgsql security definer set search_path = hq, pg_catalog as $$
begin
  if exists (select from hq._write_context where txid = new.txid) then
    raise exception 'dataset revision % was opened but not sealed; the transaction cannot commit', new.rev
      using errcode = 'HQ409';
  end if;
  return null;
end
$$;
create constraint trigger write_context_sealed
  after insert on hq._write_context
  deferrable initially deferred
  for each row execute function hq.tg_write_context_sealed();

-- The current transaction's write context, or a row of nulls. SECURITY DEFINER so the sealing trigger
-- can read the owner-only table whoever inserts; granted to no one (legitimate writers run as the owner).
create function hq._write_context_now() returns hq._write_context
language sql stable security definer set search_path = hq, pg_catalog as $$
  select * from hq._write_context where txid = txid_current()
$$;

-- Seal chain link: sha256 of parent seal | rev | content hash | record count.
create function hq._seal_hash(p_parent text, p_rev bigint, p_content_hash text, p_record_count integer) returns text
language sql immutable as $$
  select encode(sha256(convert_to(
    coalesce(p_parent, '') || '|' || p_rev::text || '|' || p_content_hash || '|' || p_record_count::text, 'UTF8')), 'hex')
$$;

-- ---------------------------------------------------------------------------
-- _begin_revision: open the next dataset revision.
-- Rules:
--   (0002) serialised on the dataset write lock; revisions are gapless;
--   (0006, D3) the write context (derived from the revision kind) and the author are recorded for this
--          transaction; only one revision may be open per transaction.
-- ---------------------------------------------------------------------------
create or replace function hq._begin_revision(p_kind text, p_summary text, p_commission_ref text, p_actor uuid)
returns bigint
language plpgsql as $$
declare
  v_rev bigint;
  v_ctx text := case p_kind
                  when 'seed_import' then 'admin_import'
                  when 'proposal_acceptance' then 'review_proposal'
                  when 'founder_decision' then 'founder_decision'
                end;
begin
  perform pg_advisory_xact_lock(hashtext('hq.dataset.write'));
  if v_ctx is null then
    raise exception 'unknown dataset revision kind "%"', coalesce(p_kind, '') using errcode = 'HQ422';
  end if;
  if exists (select from hq._write_context where txid = txid_current()) then
    raise exception 'a dataset revision is already open in this transaction' using errcode = 'HQ409';
  end if;
  select coalesce(max(rev), 0) + 1 into v_rev from hq.dataset_revisions;
  insert into hq.dataset_revisions (rev, parent_rev, kind, summary, commission_ref, created_by)
  values (v_rev, nullif(v_rev - 1, 0), p_kind, p_summary, p_commission_ref, p_actor);
  insert into hq._write_context (txid, context, actor, rev) values (txid_current(), v_ctx, p_actor, v_rev);
  return v_rev;
end
$$;

-- ---------------------------------------------------------------------------
-- _seal_revision: seal the revision this transaction opened.
-- Rules:
--   (0002) content_hash = hq.dataset_hash(rev), record_count = live records at rev;
--   (0006, D3) only the revision this transaction opened can be sealed; the write context ends here;
--   (0006, D4) seal_hash links this seal to its parent's.
-- ---------------------------------------------------------------------------
create or replace function hq._seal_revision(p_rev bigint) returns void
language plpgsql as $$
declare
  v_hash   text;
  v_count  integer;
  v_parent text;
begin
  delete from hq._write_context where txid = txid_current() and rev = p_rev;
  if not found then
    raise exception 'dataset revision % is not open in this transaction', p_rev using errcode = 'HQ409';
  end if;
  v_hash := hq.dataset_hash(p_rev);
  select count(*) into v_count from hq.records_at(p_rev) r where not r.deleted;
  select p.seal_hash into v_parent
    from hq.dataset_revisions r join hq.dataset_revisions p on p.rev = r.parent_rev
   where r.rev = p_rev;
  update hq.dataset_revisions
     set content_hash = v_hash,
         record_count = v_count,
         seal_hash    = hq._seal_hash(v_parent, p_rev, v_hash, v_count)
   where rev = p_rev;
end
$$;

-- ---------------------------------------------------------------------------
-- D4. The seal chain. Existing sealed revisions are linked in order (the seal-once trigger is
-- suspended for this backfill only; it changes nothing but the new column).
-- ---------------------------------------------------------------------------
alter table hq.dataset_revisions
  add column seal_hash text check (seal_hash is null or seal_hash ~ '^[0-9a-f]{64}$');
comment on column hq.dataset_revisions.seal_hash is
  'sha256 of the parent revision''s seal_hash | rev | content_hash | record_count. Keep the head value outside the database to detect a rewrite.';

alter table hq.dataset_revisions disable trigger dataset_revisions_seal_once;
do $$
declare
  r record;
begin
  for r in select d.rev, d.parent_rev, d.content_hash, d.record_count
             from hq.dataset_revisions d where d.content_hash is not null order by d.rev loop
    update hq.dataset_revisions
       set seal_hash = hq._seal_hash((select p.seal_hash from hq.dataset_revisions p where p.rev = r.parent_rev),
                                     r.rev, r.content_hash, r.record_count)
     where rev = r.rev;
  end loop;
end
$$;
alter table hq.dataset_revisions enable trigger dataset_revisions_seal_once;

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
--          the version's rev and author are the open revision's.
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
-- D4. verify_chain: one row per problem found (none when everything is consistent). Same columns as
-- before. Revision-level problems use record_type 'dataset_revision', record_id = rev, version 0.
-- Checks:
--   (0002) per version: content hash, link to the previous version, version gap, row hash;
--   (0006, D4) per version: revision regression (rev lower than the previous version's), version in
--          an unsealed or missing revision;
--          per revision: seal mismatch (content_hash <> dataset_hash), record count mismatch,
--          revision gap (numbering does not run 1, 2, 3 …), seal chain mismatch (seal_hash).
-- SECURITY INVOKER: it reads what the caller may read. This shows the stored history is consistent
-- with itself; a consistent rewrite of history AND seals is detected only by comparing the head seal
-- (hq.head_seal) with a copy kept outside the database.
-- ---------------------------------------------------------------------------
create or replace function hq.verify_chain()
returns table (record_type text, record_id text, version integer, problem text)
language sql stable as $$
  with chain as (
    select v.*,
           lag(v.row_hash) over (partition by v.record_type, v.record_id order by v.version) as expected_prev,
           lag(v.version)  over (partition by v.record_type, v.record_id order by v.version) as prev_version,
           lag(v.rev)      over (partition by v.record_type, v.record_id order by v.version) as prev_rev
      from hq.record_versions v
  ),
  revs as (
    select d.*,
           lag(d.rev) over (order by d.rev) as prev_rev,
           (select p.seal_hash from hq.dataset_revisions p where p.rev = d.parent_rev) as parent_seal
      from hq.dataset_revisions d
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
         end
    from chain c
   where c.content_hash <> encode(sha256(convert_to(c.data::text, 'UTF8')), 'hex')
      or c.prev_hash is distinct from c.expected_prev
      or c.version <> coalesce(c.prev_version, 0) + 1
      or c.row_hash <> encode(sha256(convert_to(
           coalesce(c.prev_hash, '') || '|' || c.record_type || '|' || c.record_id || '|' ||
           c.version::text || '|' || c.rev::text || '|' || c.deleted::text || '|' ||
           c.content_hash, 'UTF8')), 'hex')
  union all
  select c.record_type, c.record_id, c.version, 'revision regression'
    from chain c where c.prev_rev is not null and c.rev < c.prev_rev
  union all
  select v.record_type, v.record_id, v.version, 'version in unsealed or missing revision'
    from hq.record_versions v left join hq.dataset_revisions d on d.rev = v.rev
   where d.rev is null or d.content_hash is null
  union all
  select 'dataset_revision', r.rev::text, 0, 'revision gap'
    from revs r where r.rev <> coalesce(r.prev_rev, 0) + 1
  union all
  select 'dataset_revision', r.rev::text, 0, 'revision seal mismatch'
    from revs r where r.content_hash is not null and r.content_hash is distinct from hq.dataset_hash(r.rev)
  union all
  select 'dataset_revision', r.rev::text, 0, 'revision record count mismatch'
    from revs r
   where r.content_hash is not null
     and r.record_count is distinct from (select count(*) from hq.records_at(r.rev) x where not x.deleted)
  union all
  select 'dataset_revision', r.rev::text, 0, 'seal chain mismatch'
    from revs r
   where r.content_hash is not null
     and r.seal_hash is distinct from encode(sha256(convert_to(
           coalesce(r.parent_seal, '') || '|' || r.rev::text || '|' || r.content_hash || '|' || r.record_count::text,
           'UTF8')), 'hex')
$$;

-- The latest sealed revision and its seals: the value to keep outside the database.
create function hq.head_seal() returns table (rev bigint, content_hash text, seal_hash text)
language sql stable as $$
  select d.rev, d.content_hash, d.seal_hash from hq.dataset_revisions d where d.rev = hq.head_rev()
$$;

-- ---------------------------------------------------------------------------
-- D5. Audit log writers for the application.
-- ---------------------------------------------------------------------------

-- A refusal (outcome denied or error). Rules: the action is a dotted lower-case name; the detail is
-- at most 8192 bytes; a request id that is not 1-64 of [A-Za-z0-9._-] is not stored (the detail says
-- so). The principal is recorded only if the claims name an active principal and the caller is not
-- anon; otherwise the principal is left empty and the unverified subject goes into detail.claimed_sub.
create function hq.log_refusal(
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

-- A use of HQ that was allowed (outcome fixed to "allowed"). Only an active principal named by the
-- claims, outside anon, can be recorded; the action and request id follow the hq.log_refusal rules.
create function hq.log_access(p_action text, p_object_type text, p_object_id text, p_request_id text)
returns void
language plpgsql security definer set search_path = hq, pg_catalog as $$
declare
  v_p       hq.principals;
  v_request text := p_request_id;
  v_detail  jsonb;
begin
  if p_action is null or p_action !~ '^[a-z_]+(\.[a-z_0-9]+){1,3}$' then
    raise exception 'audit action "%" is not a valid action name', left(coalesce(p_action, ''), 60) using errcode = 'HQ422';
  end if;
  if current_setting('role', true) is distinct from 'anon' then
    select * into v_p from hq.principals where id = hq.current_principal_id() and active;
  end if;
  if v_p.id is null then
    raise exception 'an allowed access can only be recorded for an active, signed-in principal' using errcode = 'HQ401';
  end if;
  if v_request is not null and v_request !~ '^[A-Za-z0-9._-]{1,64}$' then
    v_request := null;
    v_detail := jsonb_build_object('request_id_refused', true);
  end if;
  insert into hq.audit_log (principal_id, principal_handle, app_role, client, action, object_type, object_id, outcome, detail, request_id)
  values (v_p.id, v_p.handle, v_p.app_role, left(hq.jwt_claims() ->> 'client', 60),
          p_action, left(p_object_type, 60), left(p_object_id, 120), 'allowed', v_detail, v_request);
end
$$;

-- ---------------------------------------------------------------------------
-- _require_founder: an active human founder in an interactive session, or HQ401 / HQ403.
-- Rules:
--   (0003) active principal; app_role founder and kind human; claims amr "session";
--   (0006, D5) no in-transaction "denied" audit: the raise would roll it back. The application
--          records the refusal in its own transaction.
-- ---------------------------------------------------------------------------
create or replace function hq._require_founder(p_action text, p_object_type text, p_object_id text) returns hq.principals
language plpgsql security definer set search_path = hq, pg_catalog as $$
declare
  v_p hq.principals;
begin
  select * into v_p from hq.principals where id = hq.current_principal_id() and active;
  if not found then
    raise exception 'authentication required' using errcode = 'HQ401';
  end if;
  if not (v_p.app_role = 'founder' and v_p.kind = 'human') then
    raise exception 'founder authority is required for %; "%" (% / %) cannot perform it',
      p_action, v_p.handle, v_p.kind, v_p.app_role using errcode = 'HQ403';
  end if;
  -- Founder acts require an interactive session, never an API token.
  if coalesce(hq.jwt_claims() ->> 'amr', '') <> 'session' then
    raise exception 'founder acts require an interactive founder session' using errcode = 'HQ403';
  end if;
  return v_p;
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
--   (0006, D5) no in-transaction "denied" audit (it would be rolled back); the body is otherwise 0005's.
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
    if p_base_version <> v_cur.version then
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
-- D6. Proposal states.
-- ---------------------------------------------------------------------------

-- The latest event of a proposal, with no visibility check: for use inside HQ's own functions only.
create function hq._proposal_status(p_id text) returns text
language sql stable as $$
  select e.event from hq.proposal_events e where e.proposal_id = p_id order by e.id desc limit 1
$$;

-- A proposal's status as the caller may know it: null unless the caller is the proposal's submitter
-- (an active principal) or an active human founder in an interactive session. Null is also the answer
-- for a proposal that does not exist, so the function reveals nothing about other callers' proposals.
create or replace function hq.proposal_status(p_id text) returns text
language sql stable security definer set search_path = hq, pg_catalog as $$
  select hq._proposal_status(p_id)
   where exists (
     select from hq.proposals p
       join hq.principals c on c.id = hq.current_principal_id() and c.active
      where p.id = p_id
        and (p.submitted_by = c.id
             or (c.app_role = 'founder' and c.kind = 'human' and hq.jwt_claims() ->> 'amr' = 'session')))
$$;

-- Event order, whoever writes: "submitted" only as the first event; any other event only while the
-- latest is "submitted" (every other event closes the proposal). The proposal row is locked first,
-- so concurrent writers are serialised even if they skip the dataset write lock.
create function hq.tg_proposal_event_order() returns trigger
language plpgsql security definer set search_path = hq, pg_catalog as $$
declare
  v_last text;
begin
  perform 1 from hq.proposals where id = new.proposal_id for update;
  select e.event into v_last from hq.proposal_events e where e.proposal_id = new.proposal_id order by e.id desc limit 1;
  if new.event = 'submitted' then
    if v_last is not null then
      raise exception 'proposal % already has a history; "submitted" can only be its first event', new.proposal_id
        using errcode = 'HQ409';
    end if;
  elsif v_last is distinct from 'submitted' then
    raise exception 'proposal % is % and cannot also be %', new.proposal_id, coalesce(v_last, 'not submitted'), new.event
      using errcode = 'HQ409';
  end if;
  return new;
end
$$;
create trigger proposal_events_order
  before insert on hq.proposal_events
  for each row execute function hq.tg_proposal_event_order();

-- ---------------------------------------------------------------------------
-- withdraw_proposal: the submitter takes back a proposal that has not been reviewed.
-- Rules:
--   (0003) only the submitter; only a "submitted" proposal;
--   (0006, D6) the caller is an active principal with a proposing role (founder, developer, ai_agent)
--          and, for an API token, the propose scope; the status is read under the dataset write lock
--          that review_proposal holds, so a withdrawal and an acceptance can never both succeed.
-- ---------------------------------------------------------------------------
create or replace function hq.withdraw_proposal(p_id text, p_note text default null) returns jsonb
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
    raise exception 'proposal % not found for this principal', p_id using errcode = 'HQ404';
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
-- D7. Sessions can be ended.
-- ---------------------------------------------------------------------------
alter table hq.principals add column session_epoch integer not null default 0;
comment on column hq.principals.session_epoch is
  'A session is valid only while the epoch it was signed with equals this value. hq.end_sessions() and a passphrase change increment it.';

create or replace function hq.auth_find_login(p_handle text) returns jsonb
language sql stable security definer set search_path = hq, pg_catalog as $$
  select jsonb_build_object(
           'principal_id', p.id, 'handle', p.handle, 'display_name', p.display_name,
           'kind', p.kind, 'app_role', p.app_role, 'scheme', s.scheme, 'secret_hash', s.secret_hash,
           'session_epoch', p.session_epoch)
    from hq.principals p
    join hq.login_secrets s on s.principal_id = p.id
   where p.handle = p_handle and p.active and p.kind = 'human'
$$;

create or replace function hq.auth_get_principal(p_id uuid) returns jsonb
language sql stable security definer set search_path = hq, pg_catalog as $$
  select jsonb_build_object(
           'principal_id', p.id, 'handle', p.handle, 'display_name', p.display_name,
           'kind', p.kind, 'app_role', p.app_role, 'session_epoch', p.session_epoch)
    from hq.principals p
   where p.id = p_id and p.active
$$;

-- End every session of the caller (sign out everywhere). Only a person signed in interactively.
create function hq.end_sessions() returns void
language plpgsql security definer set search_path = hq, pg_catalog as $$
declare
  v_p     hq.principals;
  v_epoch integer;
begin
  select * into v_p from hq.principals where id = hq.current_principal_id() and active;
  if not found then
    raise exception 'authentication required' using errcode = 'HQ401';
  end if;
  if v_p.kind <> 'human' or coalesce(hq.jwt_claims() ->> 'amr', '') <> 'session' then
    raise exception 'only a person signed in to HQ can end their sessions' using errcode = 'HQ403';
  end if;
  update hq.principals set session_epoch = session_epoch + 1 where id = v_p.id
  returning session_epoch into v_epoch;
  perform hq.log_event('session.end_all', 'principal', v_p.handle, 'allowed', jsonb_build_object('session_epoch', v_epoch));
end
$$;

-- A new passphrase ends the sessions signed in with the old one.
create function hq.tg_passphrase_ends_sessions() returns trigger
language plpgsql security definer set search_path = hq, pg_catalog as $$
begin
  if new.secret_hash is distinct from old.secret_hash then
    update hq.principals set session_epoch = session_epoch + 1 where id = new.principal_id;
  end if;
  return null;
end
$$;
create trigger passphrase_ends_sessions
  after update of secret_hash on hq.login_secrets
  for each row execute function hq.tg_passphrase_ends_sessions();

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------

-- D3. service_role reads; it no longer writes any table directly.
revoke insert, update, delete, truncate, references, trigger on all tables in schema hq from service_role;
revoke usage, update on all sequences in schema hq from service_role;

-- D3. Internal primitives (every hq._* function) run only inside HQ's own functions, as the owner.
do $$
declare
  f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'hq' and left(p.proname, 1) = '_' loop
    execute format('revoke all on function %s from public, anon, authenticated, hq_auth, service_role', f);
  end loop;
end
$$;

-- D3. Imports run on the owner connection only.
revoke all on function hq.admin_put_records(jsonb, text, text, text, boolean), hq.admin_put_source_texts(jsonb)
  from public, anon, authenticated, hq_auth, service_role;

-- D5. The free-form audit writer is internal.
revoke all on function hq.log_event(text, text, text, text, jsonb, text)
  from public, anon, authenticated, hq_auth, service_role;

-- Trigger functions are never called directly.
revoke all on function hq.tg_write_context_sealed(), hq.tg_record_version_seal(), hq.tg_proposal_event_order(),
  hq.tg_passphrase_ends_sessions()
  from public, anon, authenticated, hq_auth, service_role;

revoke all on function
  hq.log_refusal(text, text, text, text, jsonb, text), hq.log_access(text, text, text, text),
  hq.head_seal(), hq.end_sessions(), hq.verify_chain(), hq.proposal_status(text),
  hq.withdraw_proposal(text, text), hq.submit_proposal(text, text, text, integer, bigint, text, text, jsonb, jsonb, text)
  from public;

grant execute on function hq.log_refusal(text, text, text, text, jsonb, text), hq.log_access(text, text, text, text)
  to authenticated, anon, hq_auth;

grant execute on function
  hq.head_seal(), hq.verify_chain(), hq.end_sessions(), hq.proposal_status(text),
  hq.withdraw_proposal(text, text),
  hq.submit_proposal(text, text, text, integer, bigint, text, text, jsonb, jsonb, text)
  to authenticated;

revoke all on function hq.auth_find_login(text), hq.auth_get_principal(uuid) from public, anon, authenticated;
grant execute on function hq.auth_find_login(text), hq.auth_get_principal(uuid) to hq_auth;
