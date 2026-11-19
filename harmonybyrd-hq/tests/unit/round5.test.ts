/**
 * Fifth round (ROUND5), the parts that need no database: what a record HQ cannot read may still make a
 * screen or an answer say (K6), the wording of the propose form and of a recommendation made through the
 * inbox (K5), and well-formed, bounded echoes (K8). The verifiers' counter-examples (rv4 view lane) are
 * cases here, each with the dataset without the record, or with the record's valid form, beside it.
 */
import { describe, expect, it } from "vitest";
import { unreadableNaming } from "@/lib/domain/conform";
import * as derive from "@/lib/domain/derive";
import type { PackRecord } from "@/lib/domain/pack";
import { RESERVED_ID } from "@/lib/domain/pack";
import { safeParseRecord } from "@/lib/domain/schemas";
import { auditDetailJson } from "@/lib/server/db";
import { TESTED_CLAIM_RULE } from "@/lib/server/services";
import { cutText, wellFormed, wellFormedJson } from "@/lib/text";
import { SUBMITTER_CLAIM_SENTENCE } from "@/lib/ui/proposal-review";
import { datasetFrom, fixtureRecords } from "../helpers/fixture";
import { screensCases } from "../helpers/odd-values";

type Data = Record<string, unknown>;
const cases = screensCases();
const pick = (id: string): PackRecord => {
  const c = cases.find((x) => x.id === id)!;
  return { type: c.type, id: c.id, data: structuredClone(c.data) } as PackRecord;
};
const base = () => fixtureRecords();
const brief = (ds: ReturnType<typeof datasetFrom>, id: string) => derive.moduleBrief(ds, id)!;

describe("ROUND5 K6 (Z2): the module brief marks each entry HQ cannot read, and the module page counts only readable ones", () => {
  it("an invalid loop naming Delta is in Delta's list as not readable, and Delta has no readable loop", () => {
    const x = pick("LOOP-R4-ODD");
    expect(safeParseRecord(x.type, x.data).ok).toBe(false);
    const ds = datasetFrom([...base(), x]);
    const loops = brief(ds, "MOD-FX-DELTA").loops;
    expect(loops.find((l) => l.id === "LOOP-R4-ODD")).toMatchObject({ readable: false });
    expect(loops.filter((l) => l.readable)).toHaveLength(0);
  });

  it("an invalid build reported as accepted on Gamma is listed as not readable; Gamma still has no build on record", () => {
    const ds = datasetFrom([...base(), pick("BLD-R4-ACC")]);
    const builds = brief(ds, "MOD-FX-GAMMA").builds;
    expect(builds.map((b) => [b.ref.id, b.ref.readable])).toEqual([["BLD-R4-ACC", false]]);
    expect(derive.missingWork(ds).modules_without_build.map((i) => i.id)).toContain("MOD-FX-GAMMA");
  });

  it("invalid hq_verified evidence naming Gamma is not readable and is no HQ check", () => {
    const ds = datasetFrom([...base(), pick("EV-R4-HQV")]);
    expect(brief(ds, "MOD-FX-GAMMA").evidence.find((e) => e.ref.id === "EV-R4-HQV")).toMatchObject({ ref: { readable: false } });
    expect(derive.developmentHealth(ds).hq_verified.map((i) => i.id)).not.toContain("EV-R4-HQV");
  });
});

describe("ROUND5 K6 (Z3): one definition of an open defect", () => {
  it("the brief marks a defect HQ cannot read as open, whatever its status says, as the register does", () => {
    const def = structuredClone(base().find((r) => r.id === "DEF-FX-02")!.data) as unknown as Data;
    const odd: PackRecord = { type: "defect", id: "DEF-R5-RES", data: { ...def, id: "DEF-R5-RES", status: "resolved", title: 7, module_ids: ["MOD-FX-ALPHA"] } as never };
    expect(safeParseRecord("defect", odd.data).ok).toBe(false);
    const ds = datasetFrom([...base(), odd]);
    const entry = brief(ds, "MOD-FX-ALPHA").defects.find((d) => d.ref.id === "DEF-R5-RES")!;
    expect(entry.open).toBe(true);
    const register = derive.ecosystemOverview(ds).modules.find((m) => m.id === "MOD-FX-ALPHA")!.open_defects;
    expect(brief(ds, "MOD-FX-ALPHA").defects.filter((d) => d.open)).toHaveLength(register);
    expect(ds.defects.filter(derive.defectIsOpen).length).toBe(derive.developmentHealth(ds).open_defects.length);
  });
});

describe("ROUND5 K6 (Z4): a recommendation HQ cannot read never tops the priorities", () => {
  const rec = () => structuredClone(base().find((r) => r.id === "REC-FX-02")!.data) as unknown as Data;
  it("rank 'first' sorts after every readable ranked one, and after its own valid form would", () => {
    const invalid: PackRecord = { type: "recommendation", id: "REC-R5-RANK", data: { ...rec(), id: "REC-R5-RANK", rank: "first" } as never };
    const valid: PackRecord = { type: "recommendation", id: "REC-R5-RANK", data: { ...rec(), id: "REC-R5-RANK", rank: 99 } as never };
    expect(safeParseRecord("recommendation", invalid.data).ok).toBe(false);
    const order = (r: PackRecord) => derive.developmentPriorities(datasetFrom([...base(), r])).map((p) => p.envelope.meta.id);
    expect(order(invalid).at(-1)).toBe("REC-R5-RANK");
    expect(order(valid).at(-1)).toBe("REC-R5-RANK");
    const p = derive.developmentPriorities(datasetFrom([...base(), invalid])).find((x) => x.envelope.meta.id === "REC-R5-RANK")!;
    expect(p).toMatchObject({ readable: false, rank: null });
  });

  it("a blocker HQ cannot read is said to be unreadable, not dropped", () => {
    const p = derive.developmentPriorities(datasetFrom([...base(), pick("REC-RV3-BLK")])).find((x) => x.envelope.meta.id === "REC-RV3-BLK")!;
    expect(p.readable).toBe(false);
    expect(p.unreadable_fields).toMatchObject({ blocked_by: expect.any(String) });
  });
});

describe("ROUND5 K6 (Z5): a link to a record HQ cannot read resolves nothing", () => {
  it("a valid Delta whose loop_ids name an invalid loop has no loop, in the overview and in missing work", () => {
    const recs = base();
    (recs.find((r) => r.id === "MOD-FX-DELTA")!.data as unknown as Data).loop_ids = ["LOOP-R4-ODD"];
    const ds = datasetFrom([...recs, pick("LOOP-R4-ODD")]);
    expect(derive.ecosystemOverview(ds).modules.find((m) => m.id === "MOD-FX-DELTA")!.loops).toBe(0);
    expect(derive.missingWork(ds).modules_without_learning_loop.map((i) => i.id)).toContain("MOD-FX-DELTA");
  });

  it("a loop id that names no record at all counts the same: for nothing", () => {
    const recs = base();
    (recs.find((r) => r.id === "MOD-FX-DELTA")!.data as unknown as Data).loop_ids = ["LOOP-NOWHERE"];
    const ds = datasetFrom(recs);
    expect(derive.ecosystemOverview(ds).modules.find((m) => m.id === "MOD-FX-DELTA")!.loops).toBe(0);
    expect(derive.missingWork(ds).modules_without_learning_loop.map((i) => i.id)).toContain("MOD-FX-DELTA");
  });

  it("when the source behind every quotation fails validation, no standing or reported acceptance rests on it; the claims are listed as unverified", () => {
    const control = datasetFrom(base());
    const before = Object.fromEntries(derive.ecosystemOverview(control).modules.map((m) => [m.id, m.standing]));
    expect(before["MOD-FX-ALPHA"]).toBe("tested_not_accepted");
    expect(before["MOD-FX-BETA"]).toBe("acceptance_reported");
    expect(derive.acceptanceStatus(control, "build", "BLD-FX-02")!.headline).toBe("build_accepted_reported");

    const recs = base();
    (recs.find((r) => r.id === "SRC-F01")!.data as unknown as Data).bytes = "many";
    expect(safeParseRecord("source", recs.find((r) => r.id === "SRC-F01")!.data).ok).toBe(false);
    const ds = datasetFrom(recs);
    const after = Object.fromEntries(derive.ecosystemOverview(ds).modules.map((m) => [m.id, m.standing]));
    // Alpha stays tested only by its browser test, which quotes SRC-F02 (readable); what rests on SRC-F01 no longer counts.
    expect(after["MOD-FX-ALPHA"]).toBe("tested_not_accepted");
    expect(derive.standingOf(ds.module("MOD-FX-ALPHA")!, ds).claimed_only).toEqual(expect.arrayContaining(["documented", "prototyped", "automated_tests"]));
    expect(derive.standingOf(control.module("MOD-FX-ALPHA")!, control).claimed_only).not.toContain("automated_tests");
    expect(after["MOD-FX-BETA"]).not.toBe("acceptance_reported");
    expect(derive.acceptanceStatus(ds, "build", "BLD-FX-02")!.headline).toBe("build_acceptance_claimed");
    const health = derive.developmentHealth(ds);
    expect(health.acceptance_reported_only.map((i) => i.id)).not.toContain("BLD-FX-02");
    expect(health.unverified_claims.map((i) => i.id)).toEqual(expect.arrayContaining(["BLD-FX-02", "MOD-FX-ALPHA", "MOD-FX-BETA"]));
  });
});

describe("ROUND5 K6 (Z1): the lifecycle of a module whose own record fails validation", () => {
  it("its matrix row says it is not reliable; every other row is reliable", () => {
    const alpha = structuredClone(base().find((r) => r.id === "MOD-FX-ALPHA")!.data) as unknown as Data;
    const odd: PackRecord = { type: "module", id: "MOD-R5-LC", data: { ...alpha, id: "MOD-R5-LC", name: "r5 all-yes invalid module", summary: 7 } as never };
    expect(safeParseRecord("module", odd.data).ok).toBe(false);
    const rows = derive.lifecycleMatrix(datasetFrom([...base(), odd]));
    expect(rows.find((r) => r.module_id === "MOD-R5-LC")!.reliable).toBe(false);
    expect(rows.filter((r) => r.module_id !== "MOD-R5-LC").every((r) => r.reliable)).toBe(true);
  });
});

describe("ROUND5 K6 (Z8): module ids are matched without regard to case", () => {
  it("an invalid defect naming 'mod-fx-gamma' is flagged on Gamma; one naming 'MOD-FX-GAMA' is flagged on no module", () => {
    const def = structuredClone(base().find((r) => r.id === "DEF-FX-02")!.data) as unknown as Data;
    const lower: PackRecord = { type: "defect", id: "DEF-R5-CASE", data: { ...def, id: "DEF-R5-CASE", module_ids: ["mod-fx-gamma"], title: 7 } as never };
    const typo: PackRecord = { type: "defect", id: "DEF-R5-TYPO", data: { ...def, id: "DEF-R5-TYPO", module_ids: ["MOD-FX-GAMA"], title: 7 } as never };
    const ds = datasetFrom([...base(), lower, typo]);
    const gamma = unreadableNaming(ds, "MOD-FX-GAMMA").map((r) => r.id);
    expect(gamma).toContain("DEF-R5-CASE");
    expect(gamma).not.toContain("DEF-R5-TYPO");
    // Not part of a longer id, in any case.
    const longer: PackRecord = { type: "defect", id: "DEF-R5-LONG", data: { ...def, id: "DEF-R5-LONG", module_ids: ["mod-fx-gamma-2"], title: 7 } as never };
    expect(unreadableNaming(datasetFrom([...base(), longer]), "MOD-FX-GAMMA").map((r) => r.id)).not.toContain("DEF-R5-LONG");
  });
});

describe("ROUND5 K5 (Z20): the propose form's sentence on implemented and tested", () => {
  it("says only an import marks a requirement implemented and tested, as the refusal does", () => {
    expect(SUBMITTER_CLAIM_SENTENCE).not.toMatch(/import or a founder decision can say/);
    expect(SUBMITTER_CLAIM_SENTENCE).toContain("only an import marks a requirement as implemented and tested (the founder can record it as satisfied by a decision)");
    expect(TESTED_CLAIM_RULE).toContain("only an import marks a requirement as implemented and tested (the founder can record it as satisfied by a decision)");
  });
});

describe("ROUND5 K8 (Z10): what HQ echoes or writes to the audit log is well formed", () => {
  it("a lone surrogate becomes U+FFFD; a pair is kept", () => {
    expect(wellFormed("a\ud83db")).toBe("a�b");
    expect(wellFormed("\udc00x")).toBe("�x");
    expect(wellFormed("\u{1F600}")).toBe("\u{1F600}");
  });

  it("a cut is made on whole characters", () => {
    const text = `a${"\u{1F600}".repeat(200)}`;
    const cut = cutText(text, 60);
    expect(Array.from(cut)).toHaveLength(60);
    expect(cut).toBe(wellFormed(cut));
    expect(cutText("\ud83d", 80)).toBe("�");
  });

  it("the audit detail's JSON has no lone surrogate, in keys or values, and a literal backslash-u stays as it was", () => {
    const json = auditDetailJson({ "\ud83d": 1, v: "x\udc00", literal: "\\ud83d" })!;
    expect(json).not.toMatch(/(?<!\\)\\u[dD][89a-fA-F][0-9a-fA-F]{2}/);
    expect(JSON.parse(json)).toEqual({ "�": 1, v: "x�", literal: "\\ud83d" });
    expect(wellFormedJson("\u{1F600}")).toBe(JSON.stringify("\u{1F600}"));
  });

  it("a detail too large to store whole is previewed on whole characters", () => {
    const json = auditDetailJson({ big: "\u{1F600}".repeat(10_000) })!;
    expect(Buffer.byteLength(json)).toBeLessThan(8192);
    expect(JSON.parse(json)).toMatchObject({ truncated: true });
    expect(json).not.toMatch(/(?<!\\)\\u[dD][89a-fA-F][0-9a-fA-F]{2}/);
  });
});

describe("ROUND5 K4: a module created through the inbox is told by its id", () => {
  it("the pattern is the pack gate's reserved-id pattern", () => {
    expect(derive.ISSUED_BY_HQ.source).toBe(RESERVED_ID.source);
    expect(derive.createdInHq("MOD-HQ-0001")).toBe(true);
    expect(derive.createdInHq("MOD-FX-DELTA")).toBe(false);
  });

  it("missing work does not say the commission names a module created through the inbox", () => {
    const delta = structuredClone(base().find((r) => r.id === "MOD-FX-DELTA")!.data) as unknown as Data;
    const created: PackRecord = { type: "module", id: "MOD-HQ-0001", data: { ...delta, id: "MOD-HQ-0001", evidence_level: "commission_list_only", commission_listed: false } as never };
    const item = derive.missingWork(datasetFrom([...base(), created])).modules_without_source_evidence.find((i) => i.id === "MOD-HQ-0001")!;
    expect(item.note).toBe("It was created through the proposal inbox; no accessible source describes it.");
  });
});
