import Link from "next/link";
import type { Dataset } from "@/lib/domain/dataset";
import type { LifecycleRow } from "@/lib/domain/derive";
import { type Citation, type Epistemic, LIFECYCLE_DIMENSIONS, LIFECYCLE_LABEL, type ModuleRecord } from "@/lib/domain/schemas";
import { Citations, EpistemicChip } from "./ui";

const GLYPH: Record<string, { glyph: string; label: string }> = {
  yes: { glyph: "●", label: "Yes" },
  partial: { glyph: "◐", label: "Partly" },
  no: { glyph: "✕", label: "No" },
  unknown: { glyph: "?", label: "Unknown" },
  not_applicable: { glyph: "–", label: "Not applicable" },
};

export function LifecycleDot({ state, title }: { state: string; title?: string }) {
  const g = GLYPH[state] ?? GLYPH.unknown;
  return (
    <span className={`lc-dot lc-${state}`} title={title ?? g.label} role="img" aria-label={title ?? g.label}>
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
            <tr key={row.module_id}>
              <td className="name">
                <Link href={`/modules/${row.module_id}`}>{row.name}</Link>
              </td>
              {row.cells.map((cell) => (
                <td key={cell.dimension}>
                  <LifecycleDot
                    state={cell.state}
                    title={`${LIFECYCLE_LABEL[cell.dimension].label}: ${GLYPH[cell.state]?.label ?? cell.state}${cell.note ? ` — ${cell.note}` : ""}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A different state for one lifecycle dimension, as reported by another group of sources. */
interface OtherReport {
  state: string;
  basis: Epistemic;
  note?: string;
  citations?: Citation[];
  from_cluster?: string;
}

function otherReports(module: ModuleRecord): Partial<Record<string, OtherReport[]>> {
  const raw = (module as Record<string, unknown>).lifecycle_other_reports;
  return raw && typeof raw === "object" ? (raw as Partial<Record<string, OtherReport[]>>) : {};
}

/** One module's lifecycle, dimension by dimension, with the basis and sources for each. */
export function LifecycleDetail({ ds, module }: { ds: Dataset; module: ModuleRecord }) {
  const others = otherReports(module);
  return (
    <div>
      {LIFECYCLE_DIMENSIONS.map((d) => {
        const entry = module.lifecycle[d];
        const alt = Array.isArray(others[d]) ? others[d]! : [];
        return (
          <div className="lc-row" key={d}>
            <div>
              <strong>{LIFECYCLE_LABEL[d].label}</strong>
              <div className="muted xsmall">{LIFECYCLE_LABEL[d].question}</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <LifecycleDot state={entry.state} />
              <span className="small">{GLYPH[entry.state]?.label ?? entry.state}</span>
            </div>
            <div className="stack-sm" style={{ gap: 4 }}>
              {entry.note ? <div className="small">{entry.note}</div> : null}
              <div className="row" style={{ gap: 8 }}>
                <EpistemicChip value={entry.basis} />
                <Citations ds={ds} citations={entry.citations} />
              </div>
              {alt.map((o, i) => (
                <div className="lc-other" key={i}>
                  <div className="small">
                    <strong>Another source reports:</strong> <LifecycleDot state={o.state} /> {GLYPH[o.state]?.label ?? o.state}
                    {o.note ? <> — {o.note}</> : null}
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    {o.basis ? <EpistemicChip value={o.basis} /> : null}
                    <Citations ds={ds} citations={o.citations ?? []} />
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
