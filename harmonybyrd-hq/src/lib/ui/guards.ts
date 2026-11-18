/**
 * Type guards for what the screens render. The record schemas declare every field HQ's build writes
 * (D15), so a valid record already has these shapes. But a stored record that fails validation is
 * shown as stored (with an integrity warning), so the screens never trust a shape they have not
 * checked: anything that does not match is treated as absent (D16, ui-3).
 */
import { EPISTEMIC, type Epistemic, LIFECYCLE_STATES } from "@/lib/domain/schemas";

export type Loose = Record<string, unknown>;

export function isObject(value: unknown): value is Loose {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** The string elements of an array; anything else gives []. */
export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** The plain-object elements of an array; anything else gives []. */
export function objects(value: unknown): Loose[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

export function isEpistemic(value: unknown): value is Epistemic {
  return typeof value === "string" && (EPISTEMIC as readonly string[]).includes(value);
}

export interface SafeCitation {
  source_id: string;
  quote: string;
  locator: string | null;
}

/** Citations with a text source id and quote; a locator that is not text is dropped. */
export function citations(value: unknown): SafeCitation[] {
  return objects(value)
    .filter((c) => typeof c.source_id === "string" && typeof c.quote === "string")
    .map((c) => ({ source_id: c.source_id as string, quote: c.quote as string, locator: str(c.locator) }));
}

export interface SafeClaim {
  text: string;
  epistemic: Epistemic;
  citations: SafeCitation[];
}

/** A claim, or null when the value is not one (no text, or a label HQ does not know). */
export function claim(value: unknown): SafeClaim | null {
  if (!isObject(value) || typeof value.text !== "string" || !isEpistemic(value.epistemic)) return null;
  return { text: value.text, epistemic: value.epistemic, citations: citations(value.citations) };
}

export interface SafeOtherMention {
  merged_id: string | null;
  title: string | null;
  label: string | null;
  status_in_that_source: string | null;
  standing_in_that_source: string | null;
  recorded_from_cluster: string | null;
  why_merged: string | null;
  statement: SafeClaim | null;
  citations: SafeCitation[];
}

/** decision / build `other_mentions` (D15). */
export function otherMentions(value: unknown): SafeOtherMention[] {
  return objects(value).map((m) => ({
    merged_id: str(m.merged_id),
    title: str(m.title),
    label: str(m.label),
    status_in_that_source: str(m.status_in_that_source),
    standing_in_that_source: str(m.standing_in_that_source),
    recorded_from_cluster: str(m.recorded_from_cluster),
    why_merged: str(m.why_merged),
    statement: claim(m.statement),
    citations: citations(m.citations),
  }));
}

export interface SafeSearchResult {
  term: string;
  hits: { source_id: string; count: number }[];
}

/** evidence `search_results` (D15): a term with hits of { source_id, count }. */
export function searchResults(value: unknown): SafeSearchResult[] {
  return objects(value)
    .filter((r) => typeof r.term === "string")
    .map((r) => ({
      term: r.term as string,
      hits: objects(r.hits)
        .filter((h) => typeof h.source_id === "string" && typeof h.count === "number" && Number.isFinite(h.count))
        .map((h) => ({ source_id: h.source_id as string, count: h.count as number })),
    }));
}

export interface SafeCodeRef {
  repository: string;
  ref: string | null;
  commit: string | null;
  path: string | null;
}

/** `code_ref` on a build (D15) or on inbox test evidence. Null unless it names a repository. */
export function codeRef(value: unknown): SafeCodeRef | null {
  if (!isObject(value) || typeof value.repository !== "string") return null;
  return { repository: value.repository, ref: str(value.ref), commit: str(value.commit), path: str(value.path) };
}

export interface SafeLifecycleReport {
  state: string;
  basis: Epistemic | null;
  note: string | null;
  citations: SafeCitation[];
  from_cluster: string | null;
}

/** One entry of module `lifecycle_other_reports` (D15). Entries without a known state are dropped. */
export function lifecycleReports(value: unknown): SafeLifecycleReport[] {
  return objects(value)
    .filter((o) => typeof o.state === "string" && (LIFECYCLE_STATES as readonly string[]).includes(o.state))
    .map((o) => ({
      state: o.state as string,
      basis: isEpistemic(o.basis) ? o.basis : null,
      note: str(o.note),
      citations: citations(o.citations),
      from_cluster: str(o.from_cluster),
    }));
}

/** `hq_checks` on a build or source: { check, result } pairs. */
export function hqChecks(value: unknown): { check: string; result: string }[] {
  return objects(value)
    .filter((c) => typeof c.check === "string" && typeof c.result === "string")
    .map((c) => ({ check: c.check as string, result: c.result as string }));
}
