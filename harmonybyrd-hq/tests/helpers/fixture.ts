/** Build a Dataset straight from the fixture pack on disk (no database). */
import path from "node:path";
import { Dataset, type Envelope, type RevisionInfo } from "@/lib/domain/dataset";
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

export function datasetFrom(records: PackRecord[]): Dataset {
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
    },
    data: r.data,
  }));
  return new Dataset({ ...REVISION, record_count: envelopes.length }, envelopes);
}

export function fixturePack() {
  return loadPack(FIXTURE_DIR);
}

export function fixtureDataset(): Dataset {
  return datasetFrom(fixturePack().records);
}
