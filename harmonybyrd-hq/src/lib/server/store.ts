/**
 * Loads immutable Dataset snapshots from PostgreSQL.
 *
 * A dataset revision never changes, so a loaded revision is cached for the life of the process.
 * All signed-in roles have identical read access to records (see migration 0004), which is what
 * makes a cache shared between principals safe. If per-record visibility is ever introduced,
 * the cache key must include the role.
 */
import { claimsFor, type Principal } from "@/lib/auth/principal";
import { conformDataset, type DatasetView } from "@/lib/domain/conform";
import { Dataset, type Envelope, type RevisionInfo } from "@/lib/domain/dataset";
import { type AnyRecord, isRecordType, safeParseRecord } from "@/lib/domain/schemas";
import { type Queryer, readAs } from "./db";
import { HqError, notFound } from "./errors";

declare global {
  // eslint-disable-next-line no-var
  var __hqDatasets: Map<string, LoadedDataset> | undefined;
}

export interface IntegrityWarning {
  type: string;
  id: string;
  issues: string[];
}

/**
 * One loaded revision, in its two forms (src/lib/domain/conform.ts). Every read and every derivation
 * uses `ds`, the conformed view, so a stored record of the wrong shape can make no reader fail and can
 * read as nothing it does not validly hold. The write paths use `stored`: a proposal is compared with,
 * based on and checked against the record as stored, and an answer that returns a record that fails
 * validation offers its stored form too. The two are the same object when every record is valid.
 */
export interface LoadedDataset {
  /** The conformed view: what every reader computes on. */
  ds: DatasetView;
  /** The records exactly as stored (valid ones as parsed, with their defaults). */
  stored: Dataset;
  /** Every stored record that fails validation, with its problems. */
  warnings: IntegrityWarning[];
}

export interface DatasetContext extends LoadedDataset {
  /** Latest sealed revision at the time of the request. */
  head: number;
  /** True when the caller asked for a specific revision. */
  pinned: boolean;
}

const MAX_CACHED = 24;

function cache(): Map<string, LoadedDataset> {
  globalThis.__hqDatasets ??= new Map();
  return globalThis.__hqDatasets;
}

/**
 * The key carries the revision's content hash as well as its number, so a snapshot can never be
 * served for a different dataset that happens to reuse the same revision number (for example
 * after a development database is reset while the server keeps running).
 */
function cacheKey(rev: number, contentHash: string): string {
  return `${process.env.DATABASE_URL ?? ""}#${rev}#${contentHash}`;
}

/** Drop every cached snapshot (used by the test harness). */
export function clearDatasetCache(): void {
  cache().clear();
}

export async function headRevision(q: Queryer): Promise<number> {
  const result = await q.query<{ head: string }>("select hq.head_rev() as head");
  return Number(result.rows[0].head);
}

async function loadRevision(q: Queryer, rev: number): Promise<LoadedDataset> {
  const revisionRow = await q.query<{
    rev: string;
    parent_rev: string | null;
    kind: RevisionInfo["kind"];
    summary: string;
    commission_ref: string | null;
    created_at: Date;
    created_by: string;
    record_count: number;
    content_hash: string;
  }>(
    `select r.rev, r.parent_rev, r.kind, r.summary, r.commission_ref, r.created_at, r.record_count, r.content_hash,
            coalesce((select d.handle from hq.principal_directory() d where d.id = r.created_by), 'unknown') as created_by
       from hq.dataset_revisions r where r.rev = $1 and r.content_hash is not null`,
    [rev],
  );
  if (revisionRow.rowCount === 0) throw notFound(`Dataset revision ${rev} does not exist.`);
  const r = revisionRow.rows[0];
  const revision: RevisionInfo = {
    rev: Number(r.rev),
    parent_rev: r.parent_rev === null ? null : Number(r.parent_rev),
    kind: r.kind,
    summary: r.summary,
    commission_ref: r.commission_ref,
    created_at: r.created_at.toISOString(),
    created_by: r.created_by,
    record_count: r.record_count,
    content_hash: r.content_hash,
  };

  const rows = await q.query<{
    record_type: string;
    record_id: string;
    version: number;
    rev: string;
    data: unknown;
    origin: Envelope<AnyRecord>["meta"]["origin"];
    content_hash: string;
    created_at: Date;
    proposal_id: string | null;
    created_by: string;
  }>(
    `select v.record_type, v.record_id, v.version, v.rev, v.data, v.origin, v.content_hash, v.created_at, v.proposal_id,
            coalesce(d.handle, 'unknown') as created_by
       from hq.records_at($1) v
       left join hq.principal_directory() d on d.id = v.created_by
      where not v.deleted`,
    [rev],
  );

  const envelopes: Envelope<AnyRecord>[] = [];
  const warnings: IntegrityWarning[] = [];
  for (const row of rows.rows) {
    if (!isRecordType(row.record_type)) continue;
    const parsed = safeParseRecord(row.record_type, row.data);
    if (!parsed.ok) warnings.push({ type: row.record_type, id: row.record_id, issues: parsed.issues });
    envelopes.push({
      meta: {
        type: row.record_type,
        id: row.record_id,
        version: row.version,
        rev: Number(row.rev),
        origin: row.origin,
        content_hash: row.content_hash,
        created_at: row.created_at.toISOString(),
        created_by: row.created_by,
        proposal_id: row.proposal_id,
      },
      // A record that fails validation is still shown (flagged) rather than silently dropped.
      data: parsed.ok ? parsed.data : (row.data as AnyRecord),
    });
  }
  const stored = new Dataset(revision, envelopes);
  // Worked out once per loaded revision; the cache below keeps both forms.
  return { ds: conformDataset(stored, warnings), stored, warnings };
}

/**
 * The dataset as the given principal may read it, at `rev` (pinned) or at the current head.
 * Runs in a READ ONLY transaction.
 */
export async function getDataset(principal: Principal, rev?: number | null): Promise<DatasetContext> {
  return readAs(claimsFor(principal), async (q) => {
    const head = await headRevision(q);
    if (head === 0) {
      throw new HqError(
        503,
        "no_dataset",
        "No dataset has been imported yet. Run `npm run db:seed` to load an evidence pack.",
      );
    }
    const target = rev ?? head;
    if (!Number.isInteger(target) || target < 1 || target > head) {
      throw notFound(`Dataset revision ${rev} does not exist (head is ${head}).`);
    }
    const seal = await q.query<{ content_hash: string }>(
      "select content_hash from hq.dataset_revisions where rev = $1 and content_hash is not null",
      [target],
    );
    if (seal.rowCount === 0) throw notFound(`Dataset revision ${target} does not exist.`);
    const key = cacheKey(target, seal.rows[0].content_hash);
    const store = cache();
    let loaded = store.get(key);
    if (!loaded) {
      loaded = await loadRevision(q, target);
      store.set(key, loaded);
      if (store.size > MAX_CACHED) store.delete(store.keys().next().value!);
    }
    return { ...loaded, head, pinned: rev != null };
  });
}

export interface VersionHistoryEntry {
  version: number;
  rev: number;
  origin: string;
  deleted: boolean;
  content_hash: string;
  prev_hash: string | null;
  row_hash: string;
  created_at: string;
  created_by: string;
  proposal_id: string | null;
  revision_summary: string;
  commission_ref: string | null;
}

/** Every version of one record up to and including `rev`, oldest first. */
export async function recordHistory(principal: Principal, type: string, id: string, rev: number): Promise<VersionHistoryEntry[]> {
  return readAs(claimsFor(principal), async (q) => {
    const rows = await q.query<{
      version: number;
      rev: string;
      origin: string;
      deleted: boolean;
      content_hash: string;
      prev_hash: string | null;
      row_hash: string;
      created_at: Date;
      created_by: string;
      proposal_id: string | null;
      summary: string;
      commission_ref: string | null;
    }>(
      `select v.version, v.rev, v.origin, v.deleted, v.content_hash, v.prev_hash, v.row_hash, v.created_at, v.proposal_id,
              coalesce(d.handle, 'unknown') as created_by, r.summary, r.commission_ref
         from hq.record_versions v
         join hq.dataset_revisions r on r.rev = v.rev
         left join hq.principal_directory() d on d.id = v.created_by
        where v.record_type = $1 and v.record_id = $2 and v.rev <= $3
        order by v.version`,
      [type, id, rev],
    );
    return rows.rows.map((row) => ({
      version: row.version,
      rev: Number(row.rev),
      origin: row.origin,
      deleted: row.deleted,
      content_hash: row.content_hash,
      prev_hash: row.prev_hash,
      row_hash: row.row_hash,
      created_at: row.created_at.toISOString(),
      created_by: row.created_by,
      proposal_id: row.proposal_id,
      revision_summary: row.summary,
      commission_ref: row.commission_ref,
    }));
  });
}

/** A single historical version of a record (for diffs and pinned reads of superseded versions). */
export async function recordVersion(principal: Principal, type: string, id: string, version: number): Promise<unknown | null> {
  return readAs(claimsFor(principal), async (q) => {
    const rows = await q.query<{ data: unknown }>(
      "select data from hq.record_versions where record_type = $1 and record_id = $2 and version = $3",
      [type, id, version],
    );
    return rows.rows[0]?.data ?? null;
  });
}

export interface ChangeEntry {
  rev: number;
  kind: string;
  summary: string;
  commission_ref: string | null;
  created_at: string;
  created_by: string;
  content_hash: string;
  /** Hash that chains this revision's seal to the one before it (see hq.verify_chain). */
  seal_hash: string | null;
  record_count: number;
  changes: { type: string; id: string; version: number; deleted: boolean; proposal_id: string | null }[];
}

/** Dataset revisions, newest first, each with the record versions it introduced. */
export async function listChanges(principal: Principal, limit = 30): Promise<ChangeEntry[]> {
  return readAs(claimsFor(principal), async (q) => {
    const revisions = await q.query<{
      rev: string;
      kind: string;
      summary: string;
      commission_ref: string | null;
      created_at: Date;
      created_by: string;
      content_hash: string;
      seal_hash: string | null;
      record_count: number;
    }>(
      `select r.rev, r.kind, r.summary, r.commission_ref, r.created_at, r.content_hash, r.seal_hash, r.record_count,
              coalesce(d.handle, 'unknown') as created_by
         from hq.dataset_revisions r
         left join hq.principal_directory() d on d.id = r.created_by
        where r.content_hash is not null
        order by r.rev desc limit $1`,
      [limit],
    );
    if (revisions.rowCount === 0) return [];
    const revs = revisions.rows.map((r) => Number(r.rev));
    const versions = await q.query<{
      rev: string;
      record_type: string;
      record_id: string;
      version: number;
      deleted: boolean;
      proposal_id: string | null;
    }>(
      `select rev, record_type, record_id, version, deleted, proposal_id
         from hq.record_versions where rev = any($1::bigint[]) order by record_type, record_id`,
      [revs],
    );
    const byRev = new Map<number, ChangeEntry["changes"]>();
    for (const v of versions.rows) {
      const list = byRev.get(Number(v.rev)) ?? [];
      list.push({ type: v.record_type, id: v.record_id, version: v.version, deleted: v.deleted, proposal_id: v.proposal_id });
      byRev.set(Number(v.rev), list);
    }
    return revisions.rows.map((r) => ({
      rev: Number(r.rev),
      kind: r.kind,
      summary: r.summary,
      commission_ref: r.commission_ref,
      created_at: r.created_at.toISOString(),
      created_by: r.created_by,
      content_hash: r.content_hash,
      seal_hash: r.seal_hash,
      record_count: r.record_count,
      changes: byRev.get(Number(r.rev)) ?? [],
    }));
  });
}

export interface HeadSeal {
  rev: number;
  content_hash: string;
  /** Links every seal back to revision 1. A copy kept outside the database reveals a rewrite of history and seals together. */
  seal_hash: string | null;
}

/** The seals of the latest sealed revision, or null before the first import. */
export async function headSeal(principal: Principal): Promise<HeadSeal | null> {
  return readAs(claimsFor(principal), async (q) => {
    const rows = await q.query<{ rev: string; content_hash: string; seal_hash: string | null }>(
      "select rev, content_hash, seal_hash from hq.head_seal()",
    );
    const row = rows.rows[0];
    return row ? { rev: Number(row.rev), content_hash: row.content_hash, seal_hash: row.seal_hash } : null;
  });
}

/**
 * Every problem hq.verify_chain() finds: broken version links and hashes, and (since migration 0006) revision
 * seals that no longer match the records, gaps in revision numbering and breaks in the seal chain. Revision
 * problems have record_type "dataset_revision", record_id the revision number and version 0.
 */
export async function chainProblems(principal: Principal): Promise<{ record_type: string; record_id: string; version: number; problem: string }[]> {
  return readAs(claimsFor(principal), async (q) => {
    const rows = await q.query<{ record_type: string; record_id: string; version: number; problem: string }>(
      "select record_type, record_id, version, problem from hq.verify_chain()",
    );
    return rows.rows;
  });
}
