/**
 * An immutable snapshot of every HQ record at one dataset revision.
 *
 * Everything the UI, the REST API and the MCP tools show is computed from a `Dataset` by pure
 * functions (see derive.ts). Because a revision never changes, a Dataset can be cached forever
 * and two clients pinning the same revision are guaranteed to compute identical answers.
 */
import {
  type AnyRecord,
  type BuildRecord,
  type Citation,
  type CommissionRecord,
  type DecisionRecord,
  type DefectRecord,
  type EvidenceRecord,
  type LoopRecord,
  type ModuleRecord,
  type OpenItemRecord,
  type PathwayRecord,
  RECORD_TYPES,
  type RecommendationRecord,
  type RecordOf,
  type RecordType,
  type RequirementRecord,
  type SourceRecord,
} from "./schemas";

export interface RecordMeta {
  type: RecordType;
  id: string;
  version: number;
  /** Dataset revision that introduced this version. */
  rev: number;
  origin: "seed_import" | "proposal_acceptance" | "founder_decision";
  content_hash: string;
  created_at: string;
  created_by: string;
  proposal_id: string | null;
}

export interface Envelope<T> {
  meta: RecordMeta;
  data: T;
}

export interface RevisionInfo {
  rev: number;
  parent_rev: number | null;
  kind: "seed_import" | "proposal_acceptance" | "founder_decision";
  summary: string;
  commission_ref: string | null;
  created_at: string;
  created_by: string;
  record_count: number;
  content_hash: string;
}

export type RecordRef = { type: RecordType; id: string };

export const refKey = (type: string, id: string) => `${type}:${id}`;

type Buckets = { [T in RecordType]: Envelope<RecordOf<T>>[] };

export class Dataset {
  readonly revision: RevisionInfo;
  readonly records: Buckets;
  private readonly index = new Map<string, Envelope<AnyRecord>>();
  private readonly idIndex = new Map<string, Envelope<AnyRecord>>();

  constructor(revision: RevisionInfo, envelopes: Envelope<AnyRecord>[]) {
    this.revision = revision;
    const buckets = Object.fromEntries(RECORD_TYPES.map((t) => [t, []])) as unknown as Buckets;
    const sorted = [...envelopes].sort((a, b) =>
      a.meta.type === b.meta.type ? a.meta.id.localeCompare(b.meta.id) : a.meta.type.localeCompare(b.meta.type),
    );
    for (const envelope of sorted) {
      (buckets[envelope.meta.type] as Envelope<AnyRecord>[]).push(envelope);
      this.index.set(refKey(envelope.meta.type, envelope.meta.id), envelope);
      this.idIndex.set(envelope.meta.id, envelope);
    }
    this.records = buckets;
  }

  get sources(): Envelope<SourceRecord>[] {
    return this.records.source;
  }
  get modules(): Envelope<ModuleRecord>[] {
    return this.records.module;
  }
  get loops(): Envelope<LoopRecord>[] {
    return this.records.loop;
  }
  get pathways(): Envelope<PathwayRecord>[] {
    return this.records.pathway;
  }
  get requirements(): Envelope<RequirementRecord>[] {
    return this.records.requirement;
  }
  get decisions(): Envelope<DecisionRecord>[] {
    return this.records.decision;
  }
  get commissions(): Envelope<CommissionRecord>[] {
    return this.records.commission;
  }
  get builds(): Envelope<BuildRecord>[] {
    return this.records.build;
  }
  get evidence(): Envelope<EvidenceRecord>[] {
    return this.records.evidence;
  }
  get defects(): Envelope<DefectRecord>[] {
    return this.records.defect;
  }
  get openItems(): Envelope<OpenItemRecord>[] {
    return this.records.open_item;
  }
  get recommendations(): Envelope<RecommendationRecord>[] {
    return this.records.recommendation;
  }

  get<T extends RecordType>(type: T, id: string): Envelope<RecordOf<T>> | undefined {
    return this.index.get(refKey(type, id)) as Envelope<RecordOf<T>> | undefined;
  }

  /** Look a record up by id alone (ids are unique across types because of their prefixes). */
  byId(id: string): Envelope<AnyRecord> | undefined {
    return this.idIndex.get(id);
  }

  all(): Envelope<AnyRecord>[] {
    return RECORD_TYPES.flatMap((t) => this.records[t] as Envelope<AnyRecord>[]);
  }

  source(id: string): Envelope<SourceRecord> | undefined {
    return this.get("source", id);
  }

  module(id: string): Envelope<ModuleRecord> | undefined {
    return this.get("module", id);
  }

  moduleName(id: string): string {
    return this.module(id)?.data.name ?? id;
  }
}

// ---------------------------------------------------------------------------
// Citation helpers
// ---------------------------------------------------------------------------

/** Collect every citation anywhere inside a record (including nested claims). */
export function collectCitations(value: unknown, out: Citation[] = []): Citation[] {
  if (Array.isArray(value)) {
    for (const item of value) collectCitations(item, out);
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.source_id === "string" && typeof obj.quote === "string") {
      out.push({ source_id: obj.source_id, quote: obj.quote, locator: (obj.locator as string | null) ?? null });
    }
    for (const [key, child] of Object.entries(obj)) {
      if (key === "source_id" || key === "quote" || key === "locator") continue;
      collectCitations(child, out);
    }
  }
  return out;
}

/** The distinct source ids a record relies on, in first-seen order. */
export function citedSourceIds(record: unknown): string[] {
  const seen = new Set<string>();
  for (const citation of collectCitations(record)) seen.add(citation.source_id);
  const direct = (record as { source_id?: unknown })?.source_id;
  if (typeof direct === "string") seen.add(direct);
  const artifact = (record as { artifact_source_id?: unknown })?.artifact_source_id;
  if (typeof artifact === "string") seen.add(artifact);
  return [...seen];
}

/** Every `*_id` / `*_ids` style reference to another record found at the top level of a record. */
export function outgoingRefs(type: RecordType, data: AnyRecord): string[] {
  const refs = new Set<string>();
  const d = data as Record<string, unknown>;
  const push = (v: unknown) => {
    if (typeof v === "string" && /^[A-Z]{2,5}-/.test(v)) refs.add(v);
  };
  for (const key of [
    "module_id",
    "parent_id",
    "variant_of",
    "build_id",
    "decision_id",
    "duplicate_of",
    "disposition_decision_id",
    "artifact_source_id",
    "source_id",
  ]) {
    push(d[key]);
  }
  for (const key of [
    "module_ids",
    "loop_ids",
    "requirement_ids",
    "depends_on",
    "linked_evidence_ids",
    "linked_build_ids",
    "decision_ids",
    "supersedes",
    "superseded_by",
    "output_source_ids",
    "prerequisite_ids",
    "blocked_by",
    "resolves",
  ]) {
    const list = d[key];
    if (Array.isArray(list)) list.forEach(push);
  }
  if (Array.isArray(d.conflicts_with)) (d.conflicts_with as { id?: unknown }[]).forEach((c) => push(c?.id));
  if (Array.isArray(d.connections)) (d.connections as { to?: unknown }[]).forEach((c) => push(c?.to));
  if (Array.isArray(d.steps)) (d.steps as { module_id?: unknown }[]).forEach((s) => push(s?.module_id));
  refs.delete(data.id);
  void type;
  return [...refs];
}
