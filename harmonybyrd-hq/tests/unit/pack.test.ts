import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  canonicalJson,
  normaliseForQuote,
  packContentHash,
  quoteProblem,
  RESERVED_ID,
  SourceTexts,
  validateRecords,
  wordingProblem,
} from "@/lib/domain/pack";
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

describe("a build reported as accepted must quote its source (F1)", () => {
  const accepted = (statement: Record<string, unknown>) => {
    const build = raw("build", "BLD-FX-01");
    build.data.standing = "accepted_reported";
    build.data.statement = statement;
    return build;
  };
  const all = (records: { type: string; data: unknown }[]) =>
    validateRecords(records, texts(), { knownIds: new Set(fixturePack().records.map((r) => r.id)) });

  it('refuses standing "accepted_reported" whose statement has no citation', () => {
    for (const epistemic of ["submitter_claim", "no_evidence", "verified"]) {
      const result = all([accepted({ text: "Accepted.", epistemic, citations: [] })]);
      const problems = result.problems.filter((p) => p.severity === "error");
      expect(problems, epistemic).toHaveLength(1);
      expect(problems[0]).toMatchObject({ type: "build", id: "BLD-FX-01" });
      expect(problems[0].message).toMatch(/standing "accepted_reported" needs a statement that quotes the source/);
      expect(result.valid.map((r) => r.id), epistemic).not.toContain("BLD-FX-01");
    }
  });

  it("warns when the quoting statement is not labelled as a report", () => {
    const quote = "Beta build 2 was accepted by the founder on 3 March 2031 for desktop browsers only.";
    const result = all([accepted({ text: "Accepted.", epistemic: "design_intention", citations: [{ source_id: "SRC-F01", locator: null, quote }] })]);
    expect(result.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(result.problems.filter((p) => p.severity === "warning").map((p) => p.message).join(" ")).toMatch(/labelled "design_intention"/);
  });

  it("control: the fixture's reported acceptance (reported, with a citation) is valid", () => {
    expect(all([raw("build", "BLD-FX-02")]).problems).toEqual([]);
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

describe("degenerate quotations are rejected (evidence-1, tests-2)", () => {
  const knownIds = () => new Set(fixturePack().records.map((r) => r.id));
  const check = (records: { type: string; data: unknown }[]) => validateRecords(records, texts(), { knownIds: knownIds() });
  const withStatementQuote = (quote: string) => {
    const item = raw("open_item", "OPEN-FX-02");
    (item.data.statement as { citations: { quote: string }[] }).citations[0].quote = quote;
    return item;
  };

  const padded: [string, string][] = [
    ["twelve spaces", " ".repeat(12)],
    ['"a" and eleven spaces', `a${" ".repeat(11)}`],
    ["tabs and newlines", "\t\n".repeat(6)],
    ["no-break spaces", " ".repeat(12)],
    ['a padded "the"', "     the    "],
  ];
  for (const [name, quote] of padded) {
    it(`refuses a citation whose quotation is ${name}`, () => {
      const result = check([withStatementQuote(quote)]);
      expect(result.valid.map((r) => r.id)).not.toContain("OPEN-FX-02");
      const messages = result.problems.filter((p) => p.severity === "error").map((p) => p.message);
      expect(messages.join(" ")).toMatch(/quotation is (empty|too short)/);
      expect(result.verified).toBe(0);
    });
  }

  for (const [name, wording] of [
    ["three spaces", "   "],
    ['"the"', "the"],
    ["three newlines", "\n\n\n"],
    ['a padded "a"', "  a  "],
  ] as const) {
    it(`refuses a requirement whose exact wording is ${name}`, () => {
      const requirement = raw("requirement", "FR-FX-002");
      requirement.data.exact_wording = wording;
      const result = check([requirement]);
      expect(result.valid).toEqual([]);
      expect(result.problems.filter((p) => p.severity === "error").map((p) => p.message).join(" ")).toMatch(/exact wording is (empty|too short)/);
    });
  }

  it("refuses a padded quotation in a field the schema does not declare", () => {
    // The schema never sees this object, but the pack gate still verifies it as a citation.
    const build = raw("build", "BLD-FX-01");
    build.data.notes = [{ source_id: "SRC-F01", quote: `a${" ".repeat(11)}` }];
    const result = check([build]);
    expect(result.valid).toEqual([]);
    expect(result.problems[0].message).toMatch(/citation of SRC-F01: the quotation is too short/);
    expect(result.verified).toBe(result.citations - 1);
  });

  it("an empty quotation is never contained in a source", () => {
    expect(texts().contains("SRC-F01", " ".repeat(12))).toBe(false);
    expect(texts().contains("SRC-F01", "")).toBe(false);
    expect(texts().contains("SRC-F01", " \t\n")).toBe(false);
    expect(texts().contains("SRC-F01", "Never show a score out of ten.")).toBe(true);
  });

  it("counts length after normalisation, at the documented minimums", () => {
    expect(quoteProblem("abcdefghijkl")).toBeNull();
    expect(quoteProblem("abcdefghijk")).toMatch(/too short/);
    expect(quoteProblem("abc    defgh")).toMatch(/too short/); // 9 characters once spaces collapse
    expect(wordingProblem("abcd efgh")).toBeNull();
    expect(wordingProblem("abc defg")).toMatch(/too short/);
    expect(wordingProblem("   ")).toMatch(/empty/);
    // normaliseForQuote itself is unchanged: the database mirrors it exactly.
    expect(normaliseForQuote("  a \t b  ")).toBe("a b");
  });

  it("the record schemas apply the same minimums, so proposals are refused too", () => {
    const build = raw("build", "BLD-FX-01");
    (build.data.statement as { citations: { quote: string }[] }).citations[0].quote = " ".repeat(12);
    const result = safeParseRecord("build", build.data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toMatch(/statement\.citations\.0\.quote: the quotation is empty/);
    const requirement = raw("requirement", "FR-FX-002");
    requirement.data.exact_wording = "the";
    const req = safeParseRecord("requirement", requirement.data);
    expect(req.ok).toBe(false);
    if (!req.ok) expect(req.issues.join(" ")).toMatch(/exact_wording: the exact wording is too short/);
  });
});

describe("ids issued by HQ cannot be imported (evidence-6)", () => {
  const knownIds = () => new Set(fixturePack().records.map((r) => r.id));
  const renamed = (type: string, id: string, newId: string) => {
    const record = raw(type, id);
    record.data.id = newId;
    return record;
  };

  for (const [type, id, reserved] of [
    ["evidence", "EV-FX-01", "EV-HQ-0001"],
    ["decision", "FD-FX-01", "FD-HQ-0001"],
    ["requirement", "FR-FX-002", "FR-HQ-0001"],
    ["open_item", "OPEN-FX-02", "OPEN-HQ-12"],
  ] as const) {
    it(`refuses ${reserved}`, () => {
      const result = validateRecords([renamed(type, id, reserved)], texts(), { knownIds: knownIds() });
      expect(result.valid).toEqual([]);
      expect(result.problems).toEqual([expect.objectContaining({ severity: "error", id: reserved, message: expect.stringMatching(/issued by HQ itself/) })]);
    });
  }

  it("accepts the build's own ids, which are not of that form", () => {
    for (const [type, id, own] of [
      ["evidence", "EV-FX-01", "EV-HQ-CHK-01"],
      ["build", "BLD-FX-01", "BLD-HQ-P02R1"],
      ["recommendation", "REC-FX-01", "REC-P02-01"],
    ] as const) {
      const result = validateRecords([renamed(type, id, own)], texts(), { knownIds: knownIds() });
      expect(result.valid.map((r) => r.id)).toEqual([own]);
      expect(RESERVED_ID.test(own)).toBe(false);
    }
  });
});
