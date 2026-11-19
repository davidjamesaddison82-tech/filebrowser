/** Build a Dataset straight from the fixture pack on disk (no database). */
import path from "node:path";
import { conformDataset, type DatasetView } from "@/lib/domain/conform";
import { Dataset, type Envelope, type RecordMeta, type RevisionInfo } from "@/lib/domain/dataset";
import { loadPack, type PackRecord } from "@/lib/domain/pack";
import type { AnyRecord } from "@/lib/domain/schemas";

export const FIXTURE_DIR = path.resolve(import.meta.dirname, "..", "..", "data", "packs", "fixture");

const REVISION: RevisionInfo = {
  rev: 1,
  parent_rev: null,
  kind: "seed_import",
  summary: "fixture",
  commission_ref: "FIXTURE",
  created_at: "2031-04-12T00:00:00.000Z",
  created_by: "hq-import",
  record_count: 0,
  content_hash: "0".repeat(64),
};

/**
 * Build a Dataset from records as given (no parsing, so a test can model data that was stored
 * before a rule existed), and return it as every reader sees it: the conformed view, in which a
 * record that fails validation is conformed to its schema (src/lib/domain/conform.ts), as the store
 * does. `meta` overrides envelope fields per record, e.g. to model a record that entered through the
 * proposal inbox ({ origin: "proposal_acceptance" }).
 */
export function datasetFrom(records: PackRecord[], meta?: (record: PackRecord) => Partial<RecordMeta> | undefined): DatasetView {
  return conformDataset(storedDatasetFrom(records, meta));
}

/** The same records as stored, not conformed: for the conformer's own tests. */
export function storedDatasetFrom(records: PackRecord[], meta?: (record: PackRecord) => Partial<RecordMeta> | undefined): Dataset {
  const envelopes: Envelope<AnyRecord>[] = records.map((r) => ({
    meta: {
      type: r.type,
      id: r.id,
      version: 1,
      rev: 1,
      origin: "seed_import",
      content_hash: "0".repeat(64),
      created_at: REVISION.created_at,
      created_by: "hq-import",
      proposal_id: null,
      ...(meta?.(r) ?? {}),
    },
    data: r.data,
  }));
  return new Dataset({ ...REVISION, record_count: envelopes.length }, envelopes);
}

export function fixturePack() {
  return loadPack(FIXTURE_DIR);
}

/** A deep copy of the fixture's validated records, safe to change in a test. */
export function fixtureRecords(): PackRecord[] {
  return structuredClone(fixturePack().records);
}

export function fixtureDataset(): DatasetView {
  return datasetFrom(fixturePack().records);
}
