/**
 * Evidence packs.
 *
 * A pack is a directory of JSON records plus the text snapshot of every source the records
 * quote. A pack is only importable if every record validates and every quotation is found,
 * verbatim, in the snapshot of the source it cites. That check is what stops a record, build,
 * test result or founder decision from being manufactured: a claim with no matching source
 * text does not get in.
 *
 *   <pack>/manifest.json
 *   <pack>/records/<record_type>.json      arrays of records
 *   <pack>/source-text/<SOURCE-ID>.md      text snapshots used for quote verification
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { collectCitations, outgoingRefs } from "./dataset";
import { normaliseForQuote, quoteProblem, wordingProblem } from "./quote";
import { type AnyRecord, type BuildRecord, RECORD_TYPES, type RecordType, safeParseRecord } from "./schemas";

export { MIN_QUOTE_CHARS, MIN_WORDING_NON_SPACE_CHARS, normaliseForQuote, quoteProblem, wordingProblem } from "./quote";

/**
 * Ids of this form (FD-HQ-0001, EV-HQ-12 …) are issued by HQ itself when the founder accepts a
 * proposal or records a decision. A pack that used one would merge two unrelated records into one
 * history, so the pack gate refuses them (the database refuses them too).
 */
export const RESERVED_ID = /^[A-Z]{2,5}-HQ-[0-9]+$/;

export interface PackManifest {
  pack_id: string;
  title: string;
  kind: "evidence" | "fixture";
  version: string;
  generated_at: string;
  generator: string;
  commission_ref?: string | null;
  notes?: string;
}

export interface PackRecord {
  type: RecordType;
  id: string;
  data: AnyRecord;
}

export interface PackProblem {
  severity: "error" | "warning";
  type: string;
  id: string;
  message: string;
}

export interface LoadedPack {
  dir: string;
  manifest: PackManifest;
  records: PackRecord[];
  problems: PackProblem[];
  stats: {
    records: Record<string, number>;
    citations: number;
    citations_verified: number;
    sources_with_text: number;
    content_sha256: string;
  };
}

export class SourceTexts {
  private cache = new Map<string, string | null>();
  constructor(private readonly dir: string) {}

  has(sourceId: string): boolean {
    return this.get(sourceId) !== null;
  }

  get(sourceId: string): string | null {
    if (!this.cache.has(sourceId)) {
      const file = path.join(this.dir, `${sourceId}.md`);
      this.cache.set(sourceId, existsSync(file) ? normaliseForQuote(readFileSync(file, "utf8")) : null);
    }
    return this.cache.get(sourceId) ?? null;
  }

  /** True when the quotation occurs in the source. An empty quotation is never "contained": every text contains "". */
  contains(sourceId: string, quote: string): boolean {
    const text = this.get(sourceId);
    const normalised = normaliseForQuote(quote);
    return text !== null && normalised !== "" && text.includes(normalised);
  }

  count(): number {
    return existsSync(this.dir) ? readdirSync(this.dir).filter((f) => f.endsWith(".md")).length : 0;
  }
}

/** Validate a set of records: schema, verbatim quotes, and references. */
export function validateRecords(
  records: { type: string; data: unknown }[],
  texts: SourceTexts,
  options: { knownIds?: Set<string>; requireSourceText?: (sourceId: string) => boolean } = {},
): { valid: PackRecord[]; problems: PackProblem[]; citations: number; verified: number } {
  const problems: PackProblem[] = [];
  const valid: PackRecord[] = [];
  const seen = new Set<string>();
  let citations = 0;
  let verified = 0;

  for (const raw of records) {
    const rawId = (raw.data as { id?: unknown })?.id;
    const id = typeof rawId === "string" ? rawId : "(no id)";
    if (!(RECORD_TYPES as readonly string[]).includes(raw.type)) {
      problems.push({ severity: "error", type: raw.type, id, message: `unknown record type "${raw.type}"` });
      continue;
    }
    const type = raw.type as RecordType;
    const parsed = safeParseRecord(type, raw.data);
    if (!parsed.ok) {
      for (const issue of parsed.issues) problems.push({ severity: "error", type, id, message: issue });
      continue;
    }
    if (seen.has(parsed.data.id)) {
      problems.push({ severity: "error", type, id, message: "duplicate record id" });
      continue;
    }
    seen.add(parsed.data.id);
    if (RESERVED_ID.test(parsed.data.id)) {
      problems.push({ severity: "error", type, id, message: "ids of this form are issued by HQ itself; a pack cannot use one" });
      continue;
    }
    if ("hq_acceptance" in (raw.data as object)) {
      problems.push({ severity: "error", type, id, message: "hq_acceptance cannot be supplied by a pack; it is recorded only by founder decision" });
      continue;
    }
    if (type === "decision" && (parsed.data as { recorded_in?: string }).recorded_in === "hq") {
      problems.push({ severity: "error", type, id, message: "a decision recorded in HQ cannot be supplied by a pack" });
      continue;
    }
    // F1: a build reported as accepted must quote the source that reports it.
    if (type === "build" && (parsed.data as BuildRecord).standing === "accepted_reported") {
      const statement = (parsed.data as BuildRecord).statement;
      if (statement.citations.length === 0) {
        problems.push({ severity: "error", type, id, message: 'standing "accepted_reported" needs a statement that quotes the source reporting the acceptance; it has no citation' });
        continue;
      }
      if (statement.epistemic !== "reported" && statement.epistemic !== "founder_statement") {
        problems.push({
          severity: "warning",
          type,
          id,
          message: `standing "accepted_reported" with a statement labelled "${statement.epistemic}": HQ shows it as an acceptance claimed with no source quoted (use "reported" or "founder_statement")`,
        });
      }
    }

    let recordOk = true;
    for (const citation of collectCitations(parsed.data)) {
      citations += 1;
      // The schema checks declared citations; this also covers citation-shaped objects in undeclared fields.
      const weak = quoteProblem(citation.quote);
      if (weak) {
        problems.push({ severity: "error", type, id, message: `citation of ${citation.source_id}: ${weak}` });
        recordOk = false;
        continue;
      }
      if (!texts.has(citation.source_id)) {
        const mustHave = options.requireSourceText ? options.requireSourceText(citation.source_id) : true;
        problems.push({
          severity: mustHave ? "error" : "warning",
          type,
          id,
          message: `cites ${citation.source_id}, which has no text snapshot to verify against`,
        });
        if (mustHave) recordOk = false;
        continue;
      }
      if (!texts.contains(citation.source_id, citation.quote)) {
        problems.push({
          severity: "error",
          type,
          id,
          message: `quote not found verbatim in ${citation.source_id}: "${normaliseForQuote(citation.quote).slice(0, 110)}"`,
        });
        recordOk = false;
      } else {
        verified += 1;
      }
    }

    // A founder requirement's original wording is itself a quotation of its source.
    if (type === "requirement") {
      const r = parsed.data as { exact_wording: string; source_id: string };
      citations += 1;
      const weak = wordingProblem(r.exact_wording);
      if (weak) {
        problems.push({ severity: "error", type, id, message: weak });
        recordOk = false;
      } else if (!texts.contains(r.source_id, r.exact_wording)) {
        problems.push({
          severity: "error",
          type,
          id,
          message: `exact_wording not found verbatim in ${r.source_id}: "${normaliseForQuote(r.exact_wording).slice(0, 110)}"`,
        });
        recordOk = false;
      } else {
        verified += 1;
      }
    }

    if (recordOk) valid.push({ type, id: parsed.data.id, data: parsed.data });
  }

  // Referential integrity across the validated set.
  const ids = new Set<string>([...(options.knownIds ?? []), ...valid.map((r) => r.id)]);
  for (const record of valid) {
    for (const ref of outgoingRefs(record.type, record.data)) {
      if (!ids.has(ref)) {
        problems.push({ severity: "warning", type: record.type, id: record.id, message: `refers to ${ref}, which is not in the pack` });
      }
    }
    for (const citation of collectCitations(record.data)) {
      if (!ids.has(citation.source_id)) {
        problems.push({ severity: "error", type: record.type, id: record.id, message: `cites ${citation.source_id}, which has no source record` });
      }
    }
  }

  return { valid, problems, citations, verified };
}

/** Canonical JSON (sorted keys) so the pack hash does not depend on file formatting. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function packContentHash(records: PackRecord[]): string {
  const sorted = [...records].sort((a, b) => (a.type + a.id < b.type + b.id ? -1 : 1));
  const hash = createHash("sha256");
  for (const record of sorted) hash.update(`${record.type}:${record.id}:${canonicalJson(record.data)}\n`);
  return hash.digest("hex");
}

export function loadPack(dir: string): LoadedPack {
  const manifestFile = path.join(dir, "manifest.json");
  if (!existsSync(manifestFile)) throw new Error(`No evidence pack at ${dir} (manifest.json not found).`);
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as PackManifest;
  const texts = new SourceTexts(path.join(dir, "source-text"));

  const raw: { type: string; data: unknown }[] = [];
  const recordsDir = path.join(dir, "records");
  for (const type of RECORD_TYPES) {
    const file = path.join(recordsDir, `${type}.json`);
    if (!existsSync(file)) continue;
    const list = JSON.parse(readFileSync(file, "utf8")) as unknown[];
    for (const data of list) raw.push({ type, data });
  }

  const { valid, problems, citations, verified } = validateRecords(raw, texts);
  const counts: Record<string, number> = {};
  for (const record of valid) counts[record.type] = (counts[record.type] ?? 0) + 1;

  return {
    dir,
    manifest,
    records: valid,
    problems,
    stats: {
      records: counts,
      citations,
      citations_verified: verified,
      sources_with_text: texts.count(),
      content_sha256: packContentHash(valid),
    },
  };
}
