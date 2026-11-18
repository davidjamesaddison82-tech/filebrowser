import Link from "@/components/pin-link";
import type { MapLayout, MapNode } from "@/lib/ui/map-layout";
import { STANDING_SHORT } from "@/lib/ui/map-layout";
import { withRev } from "@/lib/ui/links";

function nodeTitle(n: MapNode): string {
  const parts = [n.name, n.standingLabel];
  if (n.parentName) parts.push(`part of ${n.parentName}`);
  parts.push(
    n.neighbours.length ? `connected to ${n.neighbours.length} other module${n.neighbours.length === 1 ? "" : "s"}` : "no connection recorded",
  );
  if (n.openDefects) parts.push(`${n.openDefects} open defect${n.openDefects === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/**
 * Module map, drawn without JavaScript. Every module is a link to its page. No connection lines are
 * drawn: hovering or tabbing to a module keeps the modules it is connected to lit and fades the rest.
 * The per-module rules below are built only from index numbers, never from record text.
 */
export function EcosystemMap({ layout, rev }: { layout: MapLayout; rev?: number | null }) {
  if (layout.nodes.length === 0) {
    return <div className="empty">No module is on record yet.</div>;
  }
  const rules = layout.nodes
    .filter((n) => n.neighbours.length > 0)
    .map((n) => `.map:has(.mn-${n.index}:hover,.mn-${n.index}:focus-visible) .mk-${n.index}{--lit:1}`)
    .join("\n");

  return (
    <div>
      {rules ? <style>{rules}</style> : null}
      <div className="map" role="group" aria-label="Modules grouped by family. Each module links to its page.">
        {layout.families.map((f) => (
          <section key={f.label} className="map-family">
            <h3 className="map-family-label">
              {f.label} <span className="map-family-n">{f.nodes.length}</span>
            </h3>
            <div className="map-nodes">
              {f.nodes.map((n) => (
                <Link
                  key={n.id}
                  href={withRev(`/modules/${n.id}`, rev)}
                  className={["mn", `mn-${n.index}`, `st-${n.standing}`, ...n.neighbours.map((j) => `mk-${j}`), n.parentName ? "child" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  title={nodeTitle(n)}
                  data-module={n.id}
                >
                  <span className="mn-name">{n.name}</span>
                  <span className="mn-sub">
                    <span>{n.parentName ? `Part of ${n.parentName}` : n.standingShort}</span>
                    {n.openDefects > 0 ? (
                      <span className="mn-def" aria-label={`${n.openDefects} open defect${n.openDefects === 1 ? "" : "s"}`}>
                        {n.openDefects}
                      </span>
                    ) : null}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="map-legend">
        {(Object.keys(STANDING_SHORT) as (keyof typeof STANDING_SHORT)[]).map((k) => (
          <span key={k}>
            <span className={`sw st-${k}`} />
            {STANDING_SHORT[k]}
          </span>
        ))}
        <span>
          <span className="mn-def" aria-hidden="true">
            n
          </span>{" "}
          open defects
        </span>
        <span>
          Hover over or tab to a module to see what it connects to: connected modules stay lit, the rest fade. {layout.edgeCount} connections are on
          record; no lines are drawn. A submodule names its parent; its colour gives its standing.
        </span>
      </div>
    </div>
  );
}
