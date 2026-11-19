/**
 * The conformed view (src/lib/domain/conform.ts, round 3 G1f and G11a): every reader computes on the
 * dataset with each stored record that fails validation conformed to its schema. These tests hold it to
 * what it promises: a valid record is untouched, a value of the wrong kind is made not valid, and
 * conforming never adds a meaning — no positive status, acceptance or link that the stored record does
 * not validly hold. The odd records are the browser and HTTP suites' fuzz set (tests/helpers/odd-values.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { conformDataset, conformRecord, type DatasetView, NOT_VALID, UNREADABLE_LIST, unreadableFieldNotes, unreadableFields } from "@/lib/domain/conform";
import * as derive from "@/lib/domain/derive";
import type { PackRecord } from "@/lib/domain/pack";
import { type RecordType, safeParseRecord } from "@/lib/domain/schemas";
import { NOT_VALID as SHOWN_NOT_VALID, recommendationMaker } from "@/lib/ui/format";
import { datasetFrom, fixtureRecords, storedDatasetFrom } from "../helpers/fixture";
import { fuzz, named, type Planted, screensCases } from "../helpers/odd-values";

type Data = Record<string, unknown>;

const asPack = (planted: Planted[]): PackRecord[] => planted.map((p) => ({ type: p.type as RecordType, id: p.id, data: p.data as never }));

/** Every leaf of a value, keyed by its path with list positions left out ("lifecycle.documented.citations.quote"). */
function leaves(value: unknown, path = "", out = new Map<string, unknown[]>()): Map<string, unknown[]> {
  if (Array.isArray(value)) {
    for (const item of value) leaves(item, path, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) leaves(v, path ? `${path}.${k}` : k, out);
  } else {
    out.set(path, [...(out.get(path) ?? []), value]);
  }
  return out;
}

describe("a valid record passes through untouched", () => {
  it("every fixture record comes back as the same object", () => {
    for (const record of fixtureRecords()) {
      const parsed = safeParseRecord(record.type, record.data);
      expect(parsed.ok, record.id).toBe(true);
      expect(conformRecord(record.type, record.data), record.id).toBe(record.data);
    }
  });

  it("a dataset whose every record is valid is its own view", () => {
    const stored = storedDatasetFrom(fixtureRecords());
    expect(conformDataset(stored)).toBe(stored);
    expect(conformDataset(stored, [])).toBe(stored);
  });

  it("in a dataset with invalid records, the valid ones keep their envelope, and the view is worked out once", () => {
    const records = [...fixtureRecords(), ...asPack(named())];
    const stored = storedDatasetFrom(records);
    const view = conformDataset(stored);
    expect(view).not.toBe(stored);
    expect(conformDataset(stored)).toBe(view);
    expect(view.get("module", "MOD-FX-ALPHA")).toBe(stored.get("module", "MOD-FX-ALPHA"));
    expect(view.get("build", "BLD-ODD-ARRAY")).not.toBe(stored.get("build", "BLD-ODD-ARRAY"));
    // The stored record is not changed by conforming it.
    expect(stored.get("build", "BLD-ODD-ARRAY")!.data.standing).toEqual(["accepted_reported"]);
  });

  it("the screens show the same words for a value that is not valid", () => {
    expect(SHOWN_NOT_VALID).toBe(NOT_VALID);
  });
});

describe("a value of the wrong kind is made not valid", () => {
  const build = () => structuredClone(fixtureRecords().find((r) => r.id === "BLD-FX-01")!.data) as unknown as Data;
  const module = () => structuredClone(fixtureRecords().find((r) => r.id === "MOD-FX-ALPHA")!.data) as unknown as Data;

  it("a listed value of the wrong kind, or outside its list, reads not valid", () => {
    for (const standing of [["accepted_reported"], { state: "yes" }, 7, true, null, "", "Accepted", "accepted"]) {
      const conformed = conformRecord("build", { ...build(), standing }) as unknown as Data;
      expect(conformed.standing, JSON.stringify(standing)).toBe(NOT_VALID);
    }
  });

  it("a reference of the wrong kind is null; a list of the wrong kind is empty; an element of the wrong kind is left out", () => {
    const conformed = conformRecord("build", { ...build(), module_id: ["MOD-FX-ALPHA"] }) as unknown as Data;
    expect(conformed.module_id).toBeNull();
    const m = conformRecord("module", { ...module(), loop_ids: "LOOP-FX-01", aliases: ["alpha", 7, null] }) as unknown as Data;
    expect(m.loop_ids).toEqual([]);
    expect(m.aliases).toEqual(["alpha"]);
  });

  it("a key a declared object does not have is dropped, as parsing drops it: a claim stored as { state: \"yes\" } does not carry the yes", () => {
    const conformed = conformRecord("build", { ...build(), statement: { state: "yes", x: 1 } }) as unknown as { statement: Data };
    expect(conformed.statement).toEqual({ text: NOT_VALID, epistemic: NOT_VALID, citations: [] });
    // A record's own top level keeps keys it does not declare (an older application reads a newer pack).
    expect((conformRecord("build", { ...build(), standing: 7, later_field: { state: "yes" } }) as unknown as Data).later_field).toEqual({ state: "yes" });
  });

  it("a lifecycle of the wrong kind has every dimension not valid, never unknown or yes", () => {
    for (const lifecycle of [7, ["yes"], null, { state: "yes", x: 1 }]) {
      const m = conformRecord("module", { ...module(), lifecycle }) as unknown as { lifecycle: Record<string, { state: unknown }> };
      const states = Object.values(m.lifecycle).map((e) => e.state);
      expect(states.every((s) => s === NOT_VALID), JSON.stringify(lifecycle)).toBe(true);
    }
  });

  it("a value of the right kind that breaks its field's rule: an id that is not an id, a quotation too short to be one", () => {
    const m = module();
    const lifecycle = m.lifecycle as Record<string, Data>;
    lifecycle.documented = { ...lifecycle.documented, citations: [{ source_id: "SRC-F01", locator: null, quote: "yes" }] };
    const conformed = conformRecord("module", { ...m, parent_id: "not an id", loop_ids: ["LOOP-FX-01", "nonsense"] }) as unknown as Data;
    expect(conformed.parent_id).toBeNull();
    expect(conformed.loop_ids).toEqual(["LOOP-FX-01"]);
    const documented = (conformed.lifecycle as Record<string, { state: string; citations: unknown[] }>).documented;
    expect(documented.citations).toEqual([]);
    // Left with no quotation, its "yes" is a claim the derivations do not count.
    const ds = datasetFrom([...fixtureRecords().filter((r) => r.id !== "MOD-FX-ALPHA"), { type: "module", id: "MOD-FX-ALPHA", data: conformed as never }]);
    expect(derive.moduleStanding(ds.module("MOD-FX-ALPHA")!.data).claimed_only).toContain("documented");
  });

  it("a defect whose status is not valid still counts as open: it does not drop out of the open work", () => {
    expect(derive.isOpenDefect("open")).toBe(true);
    expect(derive.isOpenDefect(NOT_VALID)).toBe(true);
    for (const odd of [undefined, null, 5, ["resolved"], { status: "resolved" }, "Resolved", "resolved "]) expect(derive.isOpenDefect(odd), JSON.stringify(odd)).toBe(true);
    for (const settled of ["resolved", "deferred", "unknown"]) expect(derive.isOpenDefect(settled), settled).toBe(false);

    // Through the whole path: a fixture defect given a status HQ cannot read is conformed, then counted.
    const records = fixtureRecords();
    const defects = records.filter((r) => r.type === "defect");
    expect(defects.length).toBeGreaterThan(0);
    const openIds = (rs: PackRecord[]) => derive.developmentHealth(datasetFrom(rs)).open_defects.map((d) => d.id);
    const before = openIds(records);
    const target = defects.find((d) => !before.includes(d.id)) ?? defects[0];
    (target.data as Data).status = ["resolved"];
    const after = openIds(records);
    expect(after).toContain(target.id);
    expect(after.length).toBe(before.includes(target.id) ? before.length : before.length + 1);
  });

  it("a requirement whose disposition is not valid stays live: it does not drop out of the outstanding work", () => {
    const records = fixtureRecords();
    const req = records.find((r) => r.id === "FR-FX-001")!;
    (req.data as unknown as Data).disposition = 3;
    (req.data as unknown as Data).implementation_state = "no_record";
    const ds = datasetFrom(records);
    expect(ds.get("requirement", "FR-FX-001")!.data.disposition).toBe(NOT_VALID);
    expect(derive.isOutstanding(ds.get("requirement", "FR-FX-001")!.data, ds)).toBe(true);
    expect(derive.filterRequirements(ds, { outstanding: true }).map((r) => r.meta.id)).toContain("FR-FX-001");
  });
});

describe("conforming never adds a meaning (property, over the fuzz set)", () => {
  const planted = fuzz();

  it("every value in a conformed record is one the stored record holds at that place, or not valid, or empty", () => {
    const problems: string[] = [];
    for (const record of planted) {
      const conformed = conformRecord(record.type as RecordType, record.data);
      const stored = leaves(record.data);
      for (const [path, values] of leaves(conformed)) {
        for (const value of values) {
          if (value === NOT_VALID || value === null || value === "" || value === false) continue;
          if ((stored.get(path) ?? []).some((v) => v === value)) continue;
          problems.push(`${record.id} ${path}: ${JSON.stringify(value)}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("no conformed record holds a positive status or label that its stored record does not hold, as text, at the same place", () => {
    const POSITIVE = ["accepted_reported", "accepted", "yes", "partial", "existing", "hq_verified", "source_reported", "implemented_tested", "satisfied", "resolved", "issued", "delivered", "verified", "reported", "founder_statement"];
    const problems: string[] = [];
    for (const record of planted) {
      const stored = leaves(record.data);
      for (const [path, values] of leaves(conformRecord(record.type as RecordType, record.data))) {
        for (const value of values) {
          if (typeof value === "string" && POSITIVE.includes(value) && !(stored.get(path) ?? []).includes(value)) problems.push(`${record.id} ${path}: ${value}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("an odd list holding the word of an acceptance, or an object holding a positive state, never reads as one", () => {
    const view = datasetFrom([...fixtureRecords(), ...asPack(planted)]);
    const odd = (id: string) => id.includes("-ODD-") && !/-ODD-D\d$/.test(id);
    const health = derive.developmentHealth(view);
    for (const key of ["acceptance_reported_only", "accepted_in_hq", "tested_not_accepted"] as const) {
      expect(health[key].map((i) => i.id).filter(odd), key).toEqual([]);
    }
    // ROUND4 H6a: a build that fails validation counts for no acceptance at all: its status says "not reliable".
    for (const b of view.builds.filter((e) => odd(e.meta.id))) {
      expect(["not_reliable"], b.meta.id).toContain(derive.acceptanceStatus(view, "build", b.meta.id)!.headline);
    }
    for (const m of view.modules.filter((e) => odd(e.meta.id))) {
      const standing = derive.moduleStanding(m.data);
      expect(standing.headline, m.meta.id).toBe("named_only");
      expect(Object.values(standing.flags).some(Boolean), m.meta.id).toBe(false);
    }
  });

  it("every derivation answers on the conformed fuzz set without throwing", () => {
    const view = datasetFrom([...fixtureRecords(), ...asPack(planted), ...asPack(named())]);
    expect(() => {
      derive.ecosystemOverview(view);
      derive.developmentHealth(view);
      derive.missingWork(view);
      derive.moduleLastSeen(view);
      derive.reviewItems(view);
      derive.loopStageMatrix(view);
      derive.stageCoverage(view);
      derive.lifecycleMatrix(view);
      derive.resolvedByHqDecisions(view);
      derive.filterRequirements(view, { outstanding: true });
      derive.search(view, "ODD");
      derive.search(view, "accepted");
      for (const e of view.all()) {
        derive.recordTitle(e.meta.type, e.data);
        derive.describeRef(view, e.meta.id);
        derive.incomingRefs(view, e.meta.id);
        derive.acceptanceStatus(view, e.meta.type, e.meta.id);
        derive.lineage(view, e.meta.type, e.meta.id);
        derive.dependencies(view, e.meta.type, e.meta.id);
        derive.sourceSummary(view, e.meta.id);
        derive.enteredThroughInbox(e);
        if (e.meta.type === "module") derive.moduleBrief(view, e.meta.id);
        if (e.meta.type === "build") derive.hasAcceptanceInstrument(view, e as never);
        if (e.meta.type === "requirement") {
          derive.isOutstanding(e.data as never, view);
          derive.requirementTestEvidence(view, e.data as never);
        }
      }
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------
// ROUND4 H6: a record that fails validation never makes anything read better, and never hides a module's
// negative content. "Better" is defined for each derivation below; each record is compared with the same
// dataset with that record removed entirely.
// ---------------------------------------------------------------------------------------------------

/** Higher is better: what a standing or an acceptance status claims. */
const RANK: Record<string, number> = {
  accepted_in_hq: 8,
  acceptance_reported: 7,
  build_accepted_reported: 7,
  tested_not_accepted: 6,
  prototype_untested: 5,
  designed_only: 4,
  documented_only: 3,
  build_candidate: 2,
  build_development: 2,
  build_acceptance_claimed: 2,
  not_applicable: 2,
  named_only: 2,
  not_reliable: 0,
  rejected_in_hq: 0,
};
const rank = (headline: string) => {
  if (!(headline in RANK)) throw new Error(`no rank for ${headline}`);
  return RANK[headline];
};

const idsOf = (items: { id: string }[]) => new Set(items.map((i) => i.id));
const missingFrom = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x));

/**
 * Everything by which `withX` reads better than `without`, as text; empty when it reads no better.
 * Better means, record by record (the record X itself is left out, it has no counterpart):
 *   - ecosystem overview: a higher standing; fewer open defects or blockers; more loops;
 *   - development health: more accepted in HQ, checked by HQ, reported as accepted, tested; fewer open
 *     defects, blocked, unverified claims, pending decisions, unresolved dependencies, rejections, unreadable records;
 *   - missing work: fewer entries under any heading (recent sources included);
 *   - review items: an item of the dataset without X that is not covered (same kind, at least its records) with X;
 *   - requirements: fewer outstanding; more verified test evidence;
 *   - acceptance status of every record: a higher headline; an acceptance instrument a build did not have;
 *   - resolved by HQ decisions: more resolved; stage coverage: more module/stage pairs;
 *   - module brief: a higher standing, a requirement no longer outstanding; dependencies: fewer blockers;
 *   - recency: a module referred to by a later source.
 */
function readsBetter(withX: DatasetView, without: DatasetView, x: string): string[] {
  const out: string[] = [];
  const say = (what: string) => out.push(`${x}: ${what}`);

  const ovW = new Map(derive.ecosystemOverview(withX).modules.map((m) => [m.id, m]));
  for (const m of derive.ecosystemOverview(without).modules) {
    const w = ovW.get(m.id);
    if (!w) continue;
    if (rank(w.standing) > rank(m.standing)) say(`overview ${m.id} standing ${m.standing} → ${w.standing}`);
    if (w.open_defects < m.open_defects) say(`overview ${m.id} open defects ${m.open_defects} → ${w.open_defects}`);
    if (w.blockers < m.blockers) say(`overview ${m.id} blockers ${m.blockers} → ${w.blockers}`);
    if (w.loops > m.loops) say(`overview ${m.id} loops ${m.loops} → ${w.loops}`);
  }

  const hW = derive.developmentHealth(withX);
  const hO = derive.developmentHealth(without);
  for (const key of ["accepted_in_hq", "hq_verified", "acceptance_reported_only", "tested_not_accepted"] as const) {
    for (const id of missingFrom(idsOf(hW[key]), idsOf(hO[key]))) if (id !== x) say(`health ${key} gains ${id}`);
  }
  for (const key of ["open_defects", "blocked", "unverified_claims", "pending_founder_decisions", "unresolved_dependencies", "rejected_in_hq", "unreadable_records"] as const) {
    for (const id of missingFrom(idsOf(hO[key] ?? []), idsOf(hW[key] ?? []))) say(`health ${key} loses ${id}`);
  }

  const mW = derive.missingWork(withX);
  const mO = derive.missingWork(without);
  for (const key of Object.keys(mO) as (keyof typeof mO)[]) {
    const a = key === "not_in_recent_sources" ? mO[key].items : (mO[key] as { id: string }[]);
    const b = key === "not_in_recent_sources" ? mW[key].items : (mW[key] as { id: string }[]);
    for (const id of missingFrom(idsOf(a), idsOf(b))) say(`missing ${key} loses ${id}`);
  }

  const rW = derive.reviewItems(withX);
  for (const item of derive.reviewItems(without)) {
    const refs = item.refs.map((r) => r.id);
    const covered = rW.some((w) => w.kind === item.kind && refs.every((id) => w.refs.some((r) => r.id === id)));
    if (!covered) say(`review loses ${item.key}`);
  }

  for (const r of without.requirements) {
    const w = withX.get("requirement", r.meta.id);
    if (!w || r.meta.id === x) continue;
    if (derive.isOutstanding(r.data, without) && !derive.isOutstanding(w.data, withX)) say(`requirement ${r.meta.id} no longer outstanding`);
    const vW = new Set(derive.requirementTestEvidence(withX, w.data).verified);
    for (const id of missingFrom(vW, new Set(derive.requirementTestEvidence(without, r.data).verified))) say(`requirement ${r.meta.id} gains verified ${id}`);
  }

  for (const e of without.all()) {
    if (e.meta.id === x) continue;
    const a = derive.acceptanceStatus(without, e.meta.type, e.meta.id)!;
    const b = derive.acceptanceStatus(withX, e.meta.type, e.meta.id)!;
    if (rank(b.headline) > rank(a.headline)) say(`acceptance ${e.meta.id} ${a.headline} → ${b.headline}`);
    if (e.meta.type === "build") {
      const bw = withX.get("build", e.meta.id)!;
      if (derive.hasAcceptanceInstrument(withX, bw) && !derive.hasAcceptanceInstrument(without, e as never)) say(`instrument gained for ${e.meta.id}`);
    }
    const dA = derive.dependencies(without, e.meta.type, e.meta.id)!;
    const dB = derive.dependencies(withX, e.meta.type, e.meta.id)!;
    if (dB.blockers.length < dA.blockers.length) say(`dependencies ${e.meta.id} blockers ${dA.blockers.length} → ${dB.blockers.length}`);
  }

  for (const id of missingFrom(derive.resolvedByHqDecisions(withX), derive.resolvedByHqDecisions(without))) say(`resolves ${id}`);

  const pairs = (ds: DatasetView) => new Set(Object.entries(derive.stageCoverage(ds)).flatMap(([stage, list]) => list.map((c) => `${stage}|${c.module_id}`)));
  for (const pair of missingFrom(pairs(withX), pairs(without))) say(`stage coverage gains ${pair}`);

  const seenW = derive.moduleLastSeen(withX);
  const seenO = derive.moduleLastSeen(without);
  for (const m of without.modules) {
    if (m.meta.id === x) continue;
    const a = seenO.get(m.meta.id) ?? "";
    const b = seenW.get(m.meta.id) ?? "";
    if (b > a) say(`module ${m.meta.id} last seen ${a || "never"} → ${b}`);
    const bA = derive.moduleBrief(without, m.meta.id)!;
    const bB = derive.moduleBrief(withX, m.meta.id)!;
    if (rank(bB.standing.headline) > rank(bA.standing.headline)) say(`brief ${m.meta.id} standing ${bA.standing.headline} → ${bB.standing.headline}`);
    for (const r of bA.requirements) {
      if (r.outstanding && bB.requirements.find((q) => q.ref.id === r.ref.id)?.outstanding === false) say(`brief ${m.meta.id} requirement ${r.ref.id} no longer outstanding`);
    }
  }
  return out;
}

/** The module ids a stored value names anywhere (a whole text, an object key, or standing on its own inside a text). */
function namedModules(value: unknown, moduleIds: string[]): Set<string> {
  const out = new Set<string>();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const visit = (v: unknown) => {
    if (typeof v === "string") {
      for (const id of moduleIds) if (new RegExp(`(^|[^A-Za-z0-9_-])${esc(id)}($|[^A-Za-z0-9_-])`).test(v)) out.add(id);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") for (const [k, child] of Object.entries(v)) (visit(k), visit(child));
  };
  visit(value);
  return out;
}

describe("ROUND4 H6: a record that fails validation never makes anything read better", () => {
  const cases = asPack(screensCases());
  // Only records that fail validation: a fuzz record that happens to be valid may rightly add something.
  const all = [...asPack(named()), ...cases, ...asPack(fuzz())].filter((r) => !safeParseRecord(r.type, r.data).ok);

  it("every planted case fails validation (or the property would test nothing)", () => {
    for (const r of [...cases, ...asPack(named())]) expect(safeParseRecord(r.type, r.data).ok, r.id).toBe(false);
  });

  it("each invalid record, added to the fixture alone, reads no better than the fixture without it (fuzz set, named and the verifier's cases)", () => {
    const without = datasetFrom(fixtureRecords());
    const problems: string[] = [];
    for (const record of all) {
      const withX = datasetFrom([...fixtureRecords(), structuredClone(record)]);
      problems.push(...readsBetter(withX, without, record.id));
    }
    expect(problems).toEqual([]);
  });

  it("with all the verifier's cases and named records present together, removing any one makes nothing read worse", () => {
    const together = [...fixtureRecords(), ...asPack(named()), ...cases];
    const withAll = datasetFrom(structuredClone(together));
    const problems: string[] = [];
    for (const record of [...asPack(named()), ...cases]) {
      const without = datasetFrom(structuredClone(together.filter((r) => r.id !== record.id)));
      problems.push(...readsBetter(withAll, without, record.id));
    }
    expect(problems).toEqual([]);
  });

  // Links from valid records to invalid ones: the base already points at the record, and the record fails validation.
  const linked: [string, (records: PackRecord[]) => void, PackRecord][] = [
    [
      "checked evidence that fails validation, linked from a tested requirement",
      (records) => {
        const r = records.find((x) => x.id === "FR-FX-002")!.data as unknown as Data;
        r.implementation_state = "implemented_tested";
        r.linked_evidence_ids = ["EV-R4-HQV"];
      },
      cases.find((c) => c.id === "EV-R4-HQV")!,
    ],
    [
      "a founder decision in HQ that fails validation, named by a build's acceptance and resolving an open item",
      (records) => {
        const b = records.find((x) => x.id === "BLD-FX-02")!.data as unknown as Data;
        b.hq_acceptance = { state: "accepted", decision_id: "FD-HQ-0009", decided_by: "founder", decided_at: "2031-04-01T00:00:00Z", scope_note: null, accepted_version: 1 };
      },
      {
        type: "decision",
        id: "FD-HQ-0009",
        data: {
          ...(structuredClone(fixtureRecords().find((x) => x.id === "FD-FX-01")!.data) as unknown as Data),
          id: "FD-HQ-0009",
          recorded_in: "hq",
          status: "issued",
          decided_by: "founder",
          decided_at: "2031-04-01T00:00:00Z",
          resolves: ["OPEN-FX-02"],
          effects: [{ type: "set_acceptance", record_type: "build", record_id: "BLD-FX-02", state: "accepted" }],
          title: 7,
        } as never,
      },
    ],
    [
      "a loop that fails validation, named by a module",
      (records) => {
        const m = records.find((x) => x.id === "MOD-FX-DELTA")!.data as unknown as Data;
        m.loop_ids = [];
      },
      cases.find((c) => c.id === "LOOP-R4-ODD")!,
    ],
  ];
  for (const [name, setup, record] of linked) {
    it(`${name}: counts for nothing`, () => {
      const base = fixtureRecords();
      setup(base);
      expect(safeParseRecord(record.type, record.data).ok).toBe(false);
      const without = datasetFrom(structuredClone(base));
      const withX = datasetFrom([...structuredClone(base), structuredClone(record)]);
      expect(readsBetter(withX, without, record.id)).toEqual([]);
    });
  }

  it("Y14: an evidence record that fails validation is no acceptance instrument: Beta build 2 keeps its review item", () => {
    const ds = datasetFrom([...fixtureRecords(), ...cases]);
    expect(derive.hasAcceptanceInstrument(ds, ds.get("build", "BLD-FX-02")!)).toBe(false);
    expect(derive.reviewItems(ds).map((i) => i.key)).toContain("acc:BLD-FX-02");
    // The same record made valid is an instrument (the rule still works).
    const fixed = structuredClone(cases.find((c) => c.id === "EV-RV3-FA")!);
    (fixed.data as unknown as Data).result = { text: "Accepted.", epistemic: "submitter_claim", citations: [] };
    expect(safeParseRecord("evidence", fixed.data).ok).toBe(true);
    const control = datasetFrom([...fixtureRecords(), fixed]);
    expect(derive.hasAcceptanceInstrument(control, control.get("build", "BLD-FX-02")!)).toBe(true);
  });

  it("an invalid module counts nothing towards its standing and reads 'not reliable'; its claims are listed", () => {
    const ds = datasetFrom([...fixtureRecords(), ...cases]);
    const node = derive.ecosystemOverview(ds).modules.find((m) => m.id === "MOD-RV3-BLK")!;
    expect(node.standing).toBe("not_reliable");
    expect(node.reliable).toBe(false);
    expect(derive.developmentHealth(ds).tested_not_accepted.map((i) => i.id)).not.toContain("MOD-RV3-BLK");
    expect(derive.developmentHealth(ds).unverified_claims.map((i) => i.id)).toContain("MOD-RV3-BLK");
    expect(derive.reviewItems(ds).map((i) => i.key)).not.toContain("tna:MOD-RV3-BLK");
  });
});

describe("ROUND4 H6b: negative content is never lost", () => {
  const cases = asPack(screensCases());
  // Only records that fail validation: a fuzz record that happens to be valid may rightly add something.
  const all = [...asPack(named()), ...cases, ...asPack(fuzz())].filter((r) => !safeParseRecord(r.type, r.data).ok);

  it("every invalid record that names a module id in its stored data is in that module's unreadable_records, in the overview, the brief and development health", () => {
    const ds = datasetFrom([...fixtureRecords(), ...structuredClone(all)]);
    const moduleIds = ds.modules.map((m) => m.meta.id);
    const overview = new Map(derive.ecosystemOverview(ds).modules.map((m) => [m.id, m]));
    const unreadable = new Set(derive.developmentHealth(ds).unreadable_records.map((i) => i.id));
    const problems: string[] = [];
    for (const record of all) {
      const names = namedModules(record.data, moduleIds);
      if (record.type === "module") names.add(record.id);
      if (!unreadable.has(record.id)) problems.push(`${record.id} not in health's unreadable records`);
      for (const moduleId of names) {
        const inOverview = overview.get(moduleId)!.unreadable_records.some((r) => r.id === record.id);
        const inBrief = derive.moduleBrief(ds, moduleId)!.unreadable_records.some((r) => r.id === record.id);
        if (!inOverview || !inBrief) problems.push(`${record.id} names ${moduleId} but is not in its unreadable_records`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("the verifier's records: Gamma, Delta and Beta carry them, with the words the screens and the API use", () => {
    const ds = datasetFrom([...fixtureRecords(), ...cases]);
    const gamma = derive.moduleBrief(ds, "MOD-FX-GAMMA")!;
    expect(gamma.unreadable_records.map((r) => r.id).sort()).toEqual(["BLD-R4-ACC", "DEF-R4-COMMA", "DEF-RV3-MODSTR", "EV-R4-HQV", "OPEN-RV3-STR"]);
    expect(gamma.unreadable_note).toBe("5 records that name this module cannot be read in full; its figures may be incomplete.");
    expect(gamma.reliable).toBe(true);
    const node = derive.ecosystemOverview(ds).modules.find((m) => m.id === "MOD-FX-GAMMA")!;
    expect(node.unreadable_note).toBe(gamma.unreadable_note);
    // A comma list, an object key, a sentence and a nested list each name the module.
    expect(derive.moduleBrief(ds, "MOD-FX-DELTA")!.unreadable_records.map((r) => r.id).sort()).toEqual(["DEF-R4-COMMA", "LOOP-R4-ODD", "OPEN-R4-KEY"]);
    // (Copies of Alpha name Beta in their connections, and a copy of a loop names it in a step: they are listed too.)
    expect(derive.moduleBrief(ds, "MOD-FX-BETA")!.unreadable_records.map((r) => r.id)).toEqual(expect.arrayContaining(["EV-R4-SENT", "EV-RV3-FA", "FR-R4-DEEP", "MOD-RV3-BLK", "LOOP-R4-ODD"]));
    // A module whose own record fails is listed on itself, and its figures are not reliable.
    const blk = derive.moduleBrief(ds, "MOD-RV3-BLK")!;
    expect(blk.unreadable_records).toEqual([{ type: "module", id: "MOD-RV3-BLK" }]);
    expect(blk.reliable).toBe(false);
    expect(blk.unreadable_note).toBe("This module's own record cannot be read in full: its figures are not reliable.");
    // A module id inside a longer id does not name it; standing on its own in a text, it does.
    const def = structuredClone(cases.find((c) => c.id === "DEF-RV3-MODSTR")!);
    const prefix = { ...def, id: "DEF-R4-PREFIX", data: { ...def.data, id: "DEF-R4-PREFIX", module_ids: "MOD-FX-ALPHA-2 MOD-FX-ALPHAX xMOD-FX-ALPHA" } as never };
    const plain = { ...def, id: "DEF-R4-PLAIN", data: { ...def.data, id: "DEF-R4-PLAIN", module_ids: "(MOD-FX-ALPHA)" } as never };
    const ds3 = datasetFrom([...fixtureRecords(), prefix, plain]);
    expect(derive.moduleBrief(ds3, "MOD-FX-ALPHA")!.unreadable_records.map((r) => r.id)).toEqual(["DEF-R4-PLAIN"]);
  });

  it("an invalid defect or blocker on a module is still found by its stored words, and an invalid defect counts as open", () => {
    const ds = datasetFrom([...fixtureRecords(), ...cases]);
    expect(derive.search(ds, "MIDI input is broken").map((h) => h.id)).toContain("MOD-RV3-BLK");
    const resolved = structuredClone(cases.find((c) => c.id === "DEF-RV3-MODSTR")!);
    (resolved.data as unknown as Data).status = "resolved";
    const ds2 = datasetFrom([...fixtureRecords(), resolved]);
    expect(derive.developmentHealth(ds2).open_defects.map((d) => d.id)).toContain("DEF-RV3-MODSTR");
  });
});

describe("ROUND4 H6d: a default never asserts", () => {
  it("Y17: a recommendation missing made_by does not read as HQ's builder's", () => {
    const rec = screensCases().find((c) => c.id === "REC-RV3-BLK")!;
    expect("made_by" in rec.data).toBe(false);
    const conformed = conformRecord("recommendation", rec.data) as unknown as Data;
    expect(conformed.made_by).toBe(NOT_VALID);
    expect(String(conformed.made_by)).not.toMatch(/HQ builder/);
  });

  it("L7: a VALID recommendation stored without made_by is never returned or shown as HQ's own", () => {
    const rec = structuredClone(fixtureRecords().find((r) => r.type === "recommendation")!);
    delete (rec.data as unknown as Data).made_by;
    // As the store and the pack read it: the schema's default fills the field.
    const parsed = safeParseRecord("recommendation", rec.data);
    expect(parsed.ok).toBe(true);
    const madeBy = (parsed as { data: Data }).data.made_by;
    expect(madeBy).toBe("Not stated");
    expect(String(madeBy)).not.toMatch(/HQ/);
    // As the screens say it.
    expect(recommendationMaker(madeBy)).toBe("This recommendation does not say who made it.");
    expect(recommendationMaker(madeBy)).not.toMatch(/HQ/);
    // And through the conformed view every reader uses (the record is valid, so it is kept as parsed).
    const ds = datasetFrom([...fixtureRecords().filter((r) => r.id !== rec.id), { ...rec, data: (parsed as unknown as { data: never }).data }]);
    const viewed = ds.get("recommendation", rec.id)!.data as unknown as Data;
    expect(viewed.made_by).toBe("Not stated");
    expect(recommendationMaker(viewed.made_by)).not.toMatch(/HQ/);
  });

  it("L7: a recommendation that names its maker says so, and one HQ cannot read names nobody", () => {
    expect(recommendationMaker("HQ test fixture")).toBe("This is a recommendation by HQ test fixture.");
    expect(recommendationMaker("Proposed through the inbox by claude")).toBe("This is a recommendation by Proposed through the inbox by claude.");
    for (const odd of [NOT_VALID, "", null, undefined, 7]) expect(recommendationMaker(odd), String(odd)).toBe("This recommendation names no maker HQ can read.");
  });

  it("a missing field takes its default only when the default says nothing", () => {
    const build = structuredClone(fixtureRecords().find((r) => r.id === "BLD-FX-01")!.data) as unknown as Data;
    delete build.hq_checks;
    delete build.citations;
    const conformed = conformRecord("build", { ...build, standing: 7 }) as unknown as Data;
    expect(conformed.hq_checks).toEqual([]);
    expect(conformed.citations).toEqual([]);
    const defect = structuredClone(fixtureRecords().find((r) => r.type === "defect")!.data) as unknown as Data;
    delete defect.severity;
    expect((conformRecord("defect", { ...defect, status: 9 }) as unknown as Data).severity).toBe("unknown");
    const source = structuredClone(fixtureRecords().find((r) => r.id === "SRC-F02")!.data) as unknown as Data;
    delete source.summary;
    expect((conformRecord("source", { ...source, bytes: "x" }) as unknown as Data).summary).toBe(NOT_VALID);
  });
});

describe("ROUND4 H6b: the view keeps what it knows on itself", () => {
  it("another copy of the conform module (as a production build loads one per bundle) reads the same unreadable records and marks", async () => {
    const view = datasetFrom([...fixtureRecords(), ...asPack(screensCases())]);
    vi.resetModules();
    const other = await import("@/lib/domain/conform");
    expect(other.conformDataset, "a second copy of the module").not.toBe(conformDataset);
    expect(other.unreadableNaming(view, "MOD-FX-GAMMA").map((r) => r.id)).toEqual(expect.arrayContaining(["DEF-RV3-MODSTR", "OPEN-RV3-STR"]));
    expect(other.unreadableRecords(view).length).toBe(screensCases().length);
    expect(other.isReadable(view.get("defect", "DEF-RV3-MODSTR")!)).toBe(false);
  });
});

describe("L8: on a record that fails validation, a list conforming emptied is never 'nothing'", () => {
  const planted = [...fuzz(), ...named(), ...screensCases()];
  const ds = datasetFrom([...fixtureRecords(), ...(planted as unknown as PackRecord[])]);
  const isEmptied = (stored: unknown, viewed: unknown) => Array.isArray(viewed) && viewed.length === 0 && stored !== undefined && !(Array.isArray(stored) && stored.length === 0);

  it("every top-level list conforming emptied is recorded on the view, for records of every type", () => {
    const typesSeen = new Set<string>();
    for (const p of planted) {
      const envelope = ds.get(p.type as RecordType, p.id)!;
      const viewed = envelope.data as unknown as Data;
      const expected = Object.keys(viewed).filter((k) => isEmptied((p.data as Data)[k], viewed[k]));
      const recorded = unreadableFields(ds, envelope);
      for (const field of expected) expect(recorded, `${p.type} ${p.id} ${field}`).toContain(field);
      // Nothing is recorded that the view does not show empty.
      for (const field of recorded) {
        const value = field.split(".").reduce<unknown>((v, k) => (v as Data | undefined)?.[k], viewed);
        expect(value, `${p.id} ${field}`).toEqual([]);
      }
      if (expected.length) typesSeen.add(p.type);
    }
    // The shared set empties a list on a record of every type.
    expect([...typesSeen].sort()).toEqual([...new Set(planted.map((p) => p.type))].sort());
  });

  it("a record that passes validation, and a list stored empty or not at all, is never marked", () => {
    for (const r of fixtureRecords()) expect(unreadableFields(ds, ds.get(r.type, r.id)!), r.id).toEqual([]);
    const rec = structuredClone(fixtureRecords().find((r) => r.id === "REC-FX-02")!);
    const data = rec.data as unknown as Data;
    delete data.blocked_by;
    data.prerequisite_ids = [];
    data.rank = "first";
    const view = datasetFrom([{ ...rec, id: "REC-L8-EMPTY", data: { ...data, id: "REC-L8-EMPTY" } as never }]);
    expect(unreadableFields(view, view.get("recommendation", "REC-L8-EMPTY")!)).toEqual([]);
  });

  it("Y15: a recommendation whose blocked_by is a string: the view says it cannot read it, and its dependencies carry the note beside the empty list", () => {
    const envelope = ds.get("recommendation", "REC-RV3-BLK")!;
    expect((envelope.data as unknown as Data).blocked_by).toEqual([]);
    expect(unreadableFields(ds, envelope)).toContain("blocked_by");
    expect(unreadableFieldNotes(ds, envelope)).toMatchObject({ blocked_by: UNREADABLE_LIST });
    expect(UNREADABLE_LIST).toBe("Not readable — see the stored record");
    const deps = derive.dependencies(ds, "recommendation", "REC-RV3-BLK")!;
    expect(deps.blockers).toEqual([]);
    expect(deps.unreadable_fields).toMatchObject({ blocked_by: UNREADABLE_LIST });
    // A valid record's dependencies carry no such note.
    expect(derive.dependencies(ds, "recommendation", "REC-FX-02")!.unreadable_fields).toBeUndefined();
  });

  it("every record of the set: the API's dependencies answer carries the note for each list conforming emptied", () => {
    for (const p of planted) {
      const envelope = ds.get(p.type as RecordType, p.id)!;
      const fields = unreadableFields(ds, envelope);
      const deps = derive.dependencies(ds, p.type as RecordType, p.id)!;
      if (fields.length === 0) expect(deps.unreadable_fields, p.id).toBeUndefined();
      else expect(Object.keys(deps.unreadable_fields ?? {}), p.id).toEqual([...fields]);
    }
  });
});
