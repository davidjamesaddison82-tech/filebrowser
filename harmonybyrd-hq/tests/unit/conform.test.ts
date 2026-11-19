/**
 * The conformed view (src/lib/domain/conform.ts, round 3 G1f and G11a): every reader computes on the
 * dataset with each stored record that fails validation conformed to its schema. These tests hold it to
 * what it promises: a valid record is untouched, a value of the wrong kind is made not valid, and
 * conforming never adds a meaning — no positive status, acceptance or link that the stored record does
 * not validly hold. The odd records are the browser and HTTP suites' fuzz set (tests/helpers/odd-values.ts).
 */
import { describe, expect, it } from "vitest";
import { conformDataset, conformRecord, NOT_VALID } from "@/lib/domain/conform";
import * as derive from "@/lib/domain/derive";
import type { PackRecord } from "@/lib/domain/pack";
import { type RecordType, safeParseRecord } from "@/lib/domain/schemas";
import { NOT_VALID as SHOWN_NOT_VALID } from "@/lib/ui/format";
import { datasetFrom, fixtureRecords, storedDatasetFrom } from "../helpers/fixture";
import { fuzz, named, type Planted } from "../helpers/odd-values";

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
    for (const b of view.builds.filter((e) => odd(e.meta.id))) {
      expect(["build_development"], b.meta.id).toContain(derive.acceptanceStatus(view, "build", b.meta.id)!.headline);
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
