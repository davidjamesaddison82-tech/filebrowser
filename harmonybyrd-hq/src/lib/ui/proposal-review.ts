import { citedSourceIds, type Dataset } from "@/lib/domain/dataset";

/**
 * What the founder's review screen says about a proposal (F9): the sources a proposed new record
 * cites, and the fields whose change alters what HQ shows as tested, accepted or decided.
 */

/** Fields that state where a record stands. A proposal that sets any of them gets its own line under "Known risks to weigh". */
export const STANDING_FIELDS: readonly string[] = ["lifecycle", "standing", "status", "type", "result"];

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
export function citedSources(ds: Dataset, record: unknown): CitedSource[] {
  return citedSourceIds(record).map((id) => {
    const source = ds.get("source", id);
    return { id, title: source ? source.data.title : null, textHeld: !!source && source.data.text_snapshot != null };
  });
}
