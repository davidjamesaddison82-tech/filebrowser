import Link from "@/components/pin-link";

import type { DatasetView } from "@/lib/domain/conform";
import type { LifecycleRow } from "@/lib/domain/derive";
import { LIFECYCLE_DIMENSIONS, LIFECYCLE_LABEL, type ModuleRecord } from "@/lib/domain/schemas";
import { isObject, lifecycleReports, type SafeLifecycleReport } from "@/lib/ui/guards";
import { NOT_VALID } from "@/lib/ui/format";
import { recordHref } from "@/lib/ui/links";
import { Chip, Citations, EpistemicChip, NOT_COUNTED, NotCountedChip } from "./ui";

const GLYPH: Record<string, { glyph: string; label: string }> = {
  yes: { glyph: "●", label: "Yes" },
  partial: { glyph: "◐", label: "Partly" },
  no: { glyph: "✕", label: "No" },
  unknown: { glyph: "?", label: "Unknown" },
  not_applicable: { glyph: "–", label: "Not applicable" },
};

/** A stored state outside the list (a number, a list, a word the list does not hold): said as such, never read as "unknown" (G1f). */
const INVALID = { glyph: "!", label: NOT_VALID };

/** The glyph and words for a state, or "Not a valid value" for anything that is not one of the listed states. */
function glyphOf(state: unknown): { glyph: string; label: string; valid: boolean } {
  return typeof state === "string" && Object.hasOwn(GLYPH, state) ? { ...GLYPH[state], valid: true } : { ...INVALID, valid: false };
}

export function LifecycleDot({ state, title }: { state: unknown; title?: string }) {
  const g = glyphOf(state);
  return (
    <span className={`lc-dot lc-${g.valid ? String(state) : "invalid"}`} title={title ?? g.label} role="img" aria-label={title ?? g.label}>
      {g.glyph}
    </span>
  );
}

export function LifecycleLegend() {
  return (
    <div className="row small muted" style={{ gap: 14 }}>
      {Object.entries(GLYPH).map(([state, g]) => (
        <span key={state} className="row" style={{ gap: 5 }}>
          <LifecycleDot state={state} /> {g.label}
        </span>
      ))}
      <span>Each column is independent. There is no overall percentage.</span>
    </div>
  );
}

/** Modules × lifecycle dimensions. Deliberately a grid, never a single completion figure. */
export function LifecycleMatrix({ rows }: { rows: LifecycleRow[] }) {
  return (
    <div className="table-wrap">
      <table className="lc">
        <thead>
          <tr>
            <th className="name">Module</th>
            {LIFECYCLE_DIMENSIONS.map((d) => (
              <th key={d} title={LIFECYCLE_LABEL[d].question}>
                {LIFECYCLE_LABEL[d].short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.module_id} data-reliable={row.reliable ? undefined : "false"}>
              <td className="name">
                <Link href={recordHref("module", row.module_id)}>{row.name}</Link>
                {row.reliable ? null : (
                  <>
                    {" "}
                    <Chip tone="bad" glyph="!" title="This module's own record cannot be read in full: none of its lifecycle states is counted">
                      Not reliable
                    </Chip>
                  </>
                )}
              </td>
              {row.cells.map((cell) =>
                // ROUND5 K6: a module HQ cannot read shows no state in any cell, only that it is not counted.
                row.reliable ? (
                  <td key={cell.dimension}>
                    <LifecycleDot
                      state={cell.state}
                      title={`${LIFECYCLE_LABEL[cell.dimension].label}: ${glyphOf(cell.state).label}${typeof cell.note === "string" && cell.note ? ` — ${cell.note}` : ""}`}
                    />
                  </td>
                ) : (
                  <td key={cell.dimension}>
                    <span className="lc-dot lc-invalid" title={`${LIFECYCLE_LABEL[cell.dimension].label}: ${NOT_COUNTED}`} role="img" aria-label={`${LIFECYCLE_LABEL[cell.dimension].label}: ${NOT_COUNTED}`}>
                      !
                    </span>
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What other groups of sources report for each dimension (D15), read through the guards: a malformed entry is left out. */
function otherReports(module: ModuleRecord): Partial<Record<string, SafeLifecycleReport[]>> {
  const raw = (module as Record<string, unknown>).lifecycle_other_reports;
  if (!isObject(raw)) return {};
  return Object.fromEntries(Object.entries(raw).map(([dimension, list]) => [dimension, lifecycleReports(list)]));
}

/**
 * A dimension's entry: "unknown" when a stored record has no entry for it; when it has one whose state
 * is not a listed state, that state as stored, which the dot then shows as not valid.
 */
function entryOf(module: ModuleRecord, dimension: string): { state: unknown; basis: unknown; note: string; citations: unknown } {
  const lifecycle = (module as Record<string, unknown>).lifecycle;
  const entry = isObject(lifecycle) ? lifecycle[dimension] : undefined;
  if (entry === undefined) return { state: "unknown", basis: "no_evidence", note: "", citations: [] };
  if (!isObject(entry)) return { state: entry, basis: null, note: "", citations: [] };
  return { state: entry.state, basis: entry.basis, note: typeof entry.note === "string" ? entry.note : "", citations: entry.citations };
}

/**
 * One module's lifecycle, dimension by dimension, with the basis and sources for each. ROUND5 K6: for a
 * module whose own record fails validation (`reliable` false), no dimension shows a state, a basis or a
 * tick: each says it is not counted; the note and quotations it holds are still shown.
 */
export function LifecycleDetail({ ds, module, reliable = true }: { ds: DatasetView; module: ModuleRecord; reliable?: boolean }) {
  const others = otherReports(module);
  return (
    <div>
      {LIFECYCLE_DIMENSIONS.map((d) => {
        const entry = entryOf(module, d);
        const alt = others[d] ?? [];
        return (
          <div className="lc-row" key={d}>
            <div>
              <strong>{LIFECYCLE_LABEL[d].label}</strong>
              <div className="muted xsmall">{LIFECYCLE_LABEL[d].question}</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {reliable ? (
                <>
                  <LifecycleDot state={entry.state} />
                  <span className="small">{glyphOf(entry.state).label}</span>
                </>
              ) : (
                <NotCountedChip />
              )}
            </div>
            <div className="stack-sm" style={{ gap: 4 }}>
              {entry.note ? <div className="small">{entry.note}</div> : null}
              <div className="row" style={{ gap: 8 }}>
                {reliable ? <EpistemicChip value={entry.basis} /> : null}
                <Citations ds={ds} citations={entry.citations} by={reliable ? entry.basis : undefined} />
              </div>
              {(reliable ? alt : []).map((o, i) => (
                <div className="lc-other" key={i}>
                  <div className="small">
                    <strong>Another source reports:</strong> <LifecycleDot state={o.state} /> {glyphOf(o.state).label}
                    {o.note ? <> — {o.note}</> : null}
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    {o.basis ? <EpistemicChip value={o.basis} /> : null}
                    <Citations ds={ds} citations={o.citations} by={o.basis} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
