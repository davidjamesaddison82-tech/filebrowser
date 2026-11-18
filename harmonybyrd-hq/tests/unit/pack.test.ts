import { describe, expect, it } from "vitest";
import path from "node:path";
import { canonicalJson, normaliseForQuote, packContentHash, SourceTexts, validateRecords } from "@/lib/domain/pack";
import { safeParseRecord } from "@/lib/domain/schemas";
import { FIXTURE_DIR, fixturePack } from "../helpers/fixture";

const texts = () => new SourceTexts(path.join(FIXTURE_DIR, "source-text"));
const raw = (type: string, id: string) => {
  const record = fixturePack().records.find((r) => r.type === type && r.id === id)!;
  return { type, data: structuredClone(record.data) as Record<string, unknown> };
};
const errors = (records: { type: string; data: unknown }[]) =>
  validateRecords(records, texts(), { knownIds: new Set(fixturePack().records.map((r) => r.id)) }).problems.filter((p) => p.severity === "error");

describe("evidence packs cannot carry manufactured records", () => {
  it("the fixture pack validates with every quotation verified", () => {
    const pack = fixturePack();
    expect(pack.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(pack.stats.citations).toBeGreaterThan(40);
    expect(pack.stats.citations_verified).toBe(pack.stats.citations);
  });

  it("rejects a quotation that is not in the source", () => {
    const build = raw("build", "BLD-FX-01");
    (build.data.statement as { citations: { quote: string }[] }).citations[0].quote = "Alpha candidate 7 was accepted by the founder.";
    const problems = errors([build]);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toMatch(/quote not found verbatim/);
  });

  it("rejects a requirement whose wording was altered by a single word", () => {
    const requirement = raw("requirement", "FR-FX-002");
    requirement.data.exact_wording = "Always show a score out of ten.";
    expect(errors([requirement])[0].message).toMatch(/exact_wording not found verbatim/);
  });

  it("rejects a citation of a source that has no text snapshot", () => {
    const build = raw("build", "BLD-FX-01");
    (build.data.statement as { citations: { source_id: string }[] }).citations[0].source_id = "SRC-F03";
    expect(errors([build])[0].message).toMatch(/no text snapshot/);
  });

  it("rejects acceptance recorded 'in HQ' supplied by a pack", () => {
    const build = raw("build", "BLD-FX-01");
    build.data.hq_acceptance = { state: "accepted", decision_id: "FD-HQ-0001", decided_at: "2031-01-01", decided_by: "someone" };
    expect(errors([build])[0].message).toMatch(/hq_acceptance cannot be supplied/);
  });

  it("rejects a decision that claims to have been recorded in HQ", () => {
    const decision = raw("decision", "FD-FX-01");
    decision.data.recorded_in = "hq";
    expect(errors([decision])[0].message).toMatch(/cannot be supplied by a pack/);
  });

  it("rejects duplicate ids and unknown record types", () => {
    expect(errors([raw("build", "BLD-FX-01"), raw("build", "BLD-FX-01")])[0].message).toMatch(/duplicate/);
    expect(errors([{ type: "rumour", data: { id: "X-1" } }])[0].message).toMatch(/unknown record type/);
  });

  it("is insensitive to line wrapping but sensitive to wording", () => {
    expect(normaliseForQuote("Alpha   candidate\n7")).toBe("Alpha candidate 7");
    expect(texts().contains("SRC-F01", "Alpha candidate 7 is a candidate\nand has not been accepted.")).toBe(true);
    expect(texts().contains("SRC-F01", "Alpha candidate 7 has been accepted.")).toBe(false);
  });

  it("the pack content hash ignores key order and file formatting", () => {
    const records = fixturePack().records;
    const reordered = records.map((r) => ({ ...r, data: Object.fromEntries(Object.entries(r.data).reverse()) as typeof r.data })).reverse();
    expect(packContentHash(reordered)).toBe(packContentHash(records));
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });
});

describe("record schemas enforce epistemic discipline", () => {
  it("a reported claim must cite a source", () => {
    const build = raw("build", "BLD-FX-01");
    (build.data.statement as { citations: unknown[] }).citations = [];
    const result = safeParseRecord("build", build.data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toMatch(/must cite at least one source/);
  });

  it("a lifecycle 'yes' must cite the source that supports it", () => {
    const module = raw("module", "MOD-FX-GAMMA");
    (module.data.lifecycle as Record<string, unknown>).released = { state: "yes", basis: "reported", note: "", citations: [] };
    const result = safeParseRecord("module", module.data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toMatch(/must cite the source/);
  });

  it("every lifecycle dimension must be stated, even if only as unknown", () => {
    const module = raw("module", "MOD-FX-ALPHA");
    delete (module.data.lifecycle as Record<string, unknown>).released;
    expect(safeParseRecord("module", module.data).ok).toBe(false);
  });

  it("a recommendation can only ever be 'proposed'", () => {
    const rec = raw("recommendation", "REC-FX-01");
    rec.data.status = "approved";
    expect(safeParseRecord("recommendation", rec.data).ok).toBe(false);
  });

  it("ids must carry their type prefix", () => {
    const build = raw("build", "BLD-FX-01");
    build.data.id = "FR-FX-099";
    expect(safeParseRecord("build", build.data).ok).toBe(false);
  });
});
