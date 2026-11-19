import type { DatasetView } from "@/lib/domain/conform";
import { citedSourceIds } from "@/lib/domain/dataset";
import { BUILD_STANDINGS } from "@/lib/domain/schemas";

/**
 * What the founder's review screen says about a proposal (F9): the sources a proposed new record
 * cites, and the fields whose change alters what HQ shows as tested, accepted or decided.
 */

/**
 * Fields that state where a record stands, or what a source is said to say about it (a build's
 * statement is what its reported acceptance rests on, G1a). A proposal that sets any of them gets its
 * own line under "Known risks to weigh".
 */
export const STANDING_FIELDS: readonly string[] = ["lifecycle", "standing", "statement", "status", "type", "result"];

/**
 * The standing fields a proposal sets: for an update, the fields in its `set`; for a create, the
 * fields the proposed record gives a value (null and absent fields set nothing).
 */
export function standingFieldsSet(payload: unknown): string[] {
  const p = (payload ?? {}) as { op?: unknown; set?: unknown; record?: unknown };
  const fields = p.op === "update" ? p.set : p.record;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return [];
  const given = fields as Record<string, unknown>;
  return STANDING_FIELDS.filter((f) => Object.hasOwn(given, f) && given[f] !== null && given[f] !== undefined);
}

export interface CitedSource {
  id: string;
  /** The source's title, or null when HQ holds no source with this id. */
  title: string | null;
  /** Whether HQ holds the source's text, so its quotations can be checked against it. */
  textHeld: boolean;
}

/** The sources a proposed new record cites, in the order it first cites them. */
export function citedSources(ds: DatasetView, record: unknown): CitedSource[] {
  return citedSourceIds(record).map((id) => {
    const source = ds.get("source", id);
    return { id, title: source ? source.data.title : null, textHeld: !!source && source.data.text_snapshot != null };
  });
}

/**
 * What a proposal does to a build that a source reports as accepted (G1a): "withdraws" when it sets the
 * standing to another valid standing; "keeps" when it changes the build and leaves the reported
 * acceptance standing, which the database refuses; null for any other proposal. `standingBefore` is the
 * build's standing before the change.
 */
export function reportedAcceptanceEffect(payload: unknown, targetType: string | null, standingBefore: unknown): "withdraws" | "keeps" | null {
  const p = (payload ?? {}) as { op?: unknown; set?: unknown };
  if (p.op !== "update" || targetType !== "build" || standingBefore !== "accepted_reported") return null;
  const set = p.set && typeof p.set === "object" && !Array.isArray(p.set) ? (p.set as Record<string, unknown>) : {};
  const after = Object.hasOwn(set, "standing") ? set.standing : standingBefore;
  const withdraws = typeof after === "string" && after !== "accepted_reported" && (BUILD_STANDINGS as readonly string[]).includes(after);
  return withdraws ? "withdraws" : "keeps";
}

/**
 * ROUND4 H1, H3: one plain sentence on what any proposal may say, shown on every propose form. A
 * proposal's statement is the submitter's own claim; source labels and "implemented and tested" are not
 * a proposal's to give.
 */
export const SUBMITTER_CLAIM_SENTENCE =
  "Whatever you propose is recorded as your own claim: label a statement submitter_claim (it may quote a source) or no_evidence, because only an import can say that a source reports something, and only an import marks a requirement as implemented and tested (the founder can record it as satisfied by a decision).";
