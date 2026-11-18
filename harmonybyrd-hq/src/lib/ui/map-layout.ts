/**
 * Deterministic arrangement for the ecosystem map. No physics, no randomness: the same dataset
 * always draws the same picture, so a founder can learn where things are.
 *
 * The map is drawn in HTML (family boxes that flow into columns), so names wrap instead of being
 * cut off and a phone gets one column. Connections are not drawn as lines: each module carries
 * the index numbers of the modules it is connected to, and the page lights those up on hover or
 * keyboard focus.
 */
import type { EcosystemOverview, ModuleNode, StandingHeadline } from "@/lib/domain/derive";

export interface MapNode {
  /** Position in `nodes`; used only to build CSS class names. */
  index: number;
  id: string;
  name: string;
  family: string;
  standing: StandingHeadline;
  /** Short standing wording for the node itself; the full wording is `standingLabel`. */
  standingShort: string;
  standingLabel: string;
  parentName: string | null;
  openDefects: number;
  blockers: number;
  /** Indexes of the modules this one has a recorded connection with (either direction). */
  neighbours: number[];
}

export interface MapFamily {
  label: string;
  nodes: MapNode[];
}

export interface MapLayout {
  families: MapFamily[];
  nodes: MapNode[];
  edgeCount: number;
}

/** Matches the legend wording, so the node and the legend say the same thing. */
export const STANDING_SHORT: Record<StandingHeadline, string> = {
  accepted_in_hq: "Acceptance recorded in HQ",
  acceptance_reported: "Acceptance reported in a source",
  tested_not_accepted: "Tested, not accepted",
  prototype_untested: "Prototype, untested",
  designed_only: "Designed only",
  documented_only: "Documented only",
  named_only: "Named only",
};

export function layoutMap(overview: EcosystemOverview): MapLayout {
  const byId = new Map(overview.modules.map((m) => [m.id, m]));

  // Parents first, each followed by its children, so a submodule sits next to what it belongs to.
  const ordered = (ids: string[]): ModuleNode[] => {
    const members = ids.map((id) => byId.get(id)!).filter(Boolean);
    const inFamily = new Set(ids);
    const roots = members.filter((m) => !m.parent_id || !inFamily.has(m.parent_id));
    const out: ModuleNode[] = [];
    for (const root of roots.sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(root);
      out.push(...members.filter((m) => m.parent_id === root.id).sort((a, b) => a.name.localeCompare(b.name)));
    }
    for (const m of members) if (!out.includes(m)) out.push(m);
    return out;
  };

  const families = [...overview.families].sort((a, b) => b.module_ids.length - a.module_ids.length || a.family.localeCompare(b.family));
  const nodes: MapNode[] = [];
  const boxes: MapFamily[] = [];
  for (const family of families) {
    const box: MapFamily = { label: family.family, nodes: [] };
    for (const m of ordered(family.module_ids)) {
      const parent = m.parent_id ? byId.get(m.parent_id) : undefined;
      const node: MapNode = {
        index: nodes.length,
        id: m.id,
        name: m.name,
        family: m.family,
        standing: m.standing,
        standingShort: STANDING_SHORT[m.standing] ?? m.standing_label,
        standingLabel: m.standing_label,
        parentName: parent?.name ?? null,
        openDefects: m.open_defects,
        blockers: m.blockers,
        neighbours: [],
      };
      nodes.push(node);
      box.nodes.push(node);
    }
    boxes.push(box);
  }

  const pos = new Map(nodes.map((n) => [n.id, n]));
  let edgeCount = 0;
  for (const e of overview.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b || a === b) continue;
    edgeCount += 1;
    if (!a.neighbours.includes(b.index)) a.neighbours.push(b.index);
    if (!b.neighbours.includes(a.index)) b.neighbours.push(a.index);
  }
  for (const n of nodes) n.neighbours.sort((x, y) => x - y);

  return { families: boxes, nodes, edgeCount };
}
