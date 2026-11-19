import { describe, expect, it } from "vitest";
import path from "node:path";
import { collectCitations } from "@/lib/domain/dataset";
import { SourceTexts, validateRecords } from "@/lib/domain/pack";
import {
  BUILD_ONLY_FIELDS,
  Claim,
  EPISTEMIC,
  FIELD_ENUMS,
  fieldEnumProblem,
  LIFECYCLE_DIMENSIONS,
  LIFECYCLE_STATES,
  RECORD_SCHEMAS,
  RECORD_TYPES,
  type RecordType,
  safeParseRecord,
  STRUCTURED_FIELDS,
} from "@/lib/domain/schemas";
import { FIXTURE_DIR, fixturePack } from "../helpers/fixture";

const texts = () => new SourceTexts(path.join(FIXTURE_DIR, "source-text"));
const raw = (type: RecordType, id: string) => {
  const record = fixturePack().records.find((r) => r.type === type && r.id === id)!;
  return structuredClone(record.data) as Record<string, unknown>;
};
const knownIds = () => new Set(fixturePack().records.map((r) => r.id));
const importOne = (type: RecordType, data: unknown) => validateRecords([{ type, data }], texts(), { knownIds: knownIds() });

/** A quotation that is verbatim in SRC-F01, so a correctly typed nested citation passes the pack gate. */
const CITE = { source_id: "SRC-F01", locator: null, quote: "Beta build 2 was accepted by the founder on 3 March 2031 for desktop browsers only." };
const CLAIM = { text: "Reported elsewhere as accepted.", epistemic: "reported", citations: [CITE] };

/**
 * One row per build-only field (D15): where it lives, a correctly typed value, and wrongly typed
 * values that a pack (or an old store) could carry and that used to crash the record pages (ui-3).
 */
const BUILD_ONLY_CASES: { field: string; type: RecordType; id: string; good: unknown; bad: unknown[] }[] = [
  { field: "recorded_from_cluster", type: "defect", id: "DEF-FX-01", good: "cluster-07", bad: [7, ["c"]] },
  { field: "addenda_from_clusters", type: "module", id: "MOD-FX-ALPHA", good: ["c1", "c2"], bad: ["c1", [1]] },
  { field: "commission_entry", type: "module", id: "MOD-FX-ALPHA", good: "Alpha (listed in §6)", bad: [{ text: "x" }] },
  {
    field: "lifecycle_other_reports",
    type: "module",
    id: "MOD-FX-BETA",
    good: { founder_accepted: [{ state: "partial", basis: "reported", note: "", citations: [CITE], from_cluster: "c3" }] },
    bad: [
      { founder_accepted: [null] },
      { founder_accepted: [{ state: "yes", basis: "founder_approved" }] },
      { founder_accepted: [{ state: "yes", basis: "verified", citations: [CITE] }] },
      { browser_tested: [{ state: "yes", basis: "reported", citations: [] }] },
      { not_a_dimension: [] },
    ],
  },
  {
    field: "other_mentions",
    type: "build",
    id: "BLD-FX-02",
    good: [{ merged_id: "BLD-OTHER-2", status_in_that_source: "accepted", statement: CLAIM, citations: [CITE] }],
    bad: [[null], [{ status_in_that_source: 5 }], [{ merged_id: "X", statement: CLAIM, title: 3 }]],
  },
  {
    field: "possibly_same_as",
    type: "build",
    id: "BLD-FX-02",
    good: ["BLD-FX-01"],
    bad: [[123, null], ["MOD-FX-ALPHA"]],
  },
  {
    field: "code_ref",
    type: "build",
    id: "BLD-FX-01",
    good: { repository: "example/alpha", ref: "main", commit: null },
    bad: [{ repository: "example/alpha" }, "example/alpha@main", { repository: "r", ref: "main", commit: 7 }],
  },
  {
    field: "search_results",
    type: "evidence",
    id: "EV-FX-01",
    good: [{ term: "tempo", hits: [{ source_id: "SRC-F01", count: 3 }] }],
    bad: [[null], [{ term: "x", hits: "abc" }], [{ term: "x", hits: [{ source_id: 42, count: 1 }] }], [{ term: "x", hits: [{ source_id: "SRC-F01", count: -1 }] }]],
  },
  { field: "linked_tests", type: "requirement", id: "FR-FX-001", good: ["tests/alpha.spec.ts"], bad: ["tests/alpha.spec.ts", [{ path: "x" }]] },
  { field: "doc_kind", type: "source", id: "SRC-F01", good: "handover", bad: [3] },
  { field: "content_kind", type: "source", id: "SRC-F01", good: null, bad: [["markdown"]] },
  { field: "importance", type: "source", id: "SRC-F01", good: "high", bad: [true] },
  { field: "identifiers", type: "source", id: "SRC-F01", good: "FX-1", bad: [{ code: "FX-1" }] },
  { field: "other_names", type: "source", id: "SRC-F01", good: ["Document A"], bad: ["Document A", [1]] },
];

describe("fields written by HQ's build are typed (D15, ui-3)", () => {
  it("every field in BUILD_ONLY_FIELDS has a case here", () => {
    expect([...new Set(BUILD_ONLY_CASES.map((c) => c.field))].sort()).toEqual([...BUILD_ONLY_FIELDS].sort());
  });

  for (const c of BUILD_ONLY_CASES) {
    it(`${c.type}.${c.field}: a correctly typed value imports`, () => {
      const result = importOne(c.type, { ...raw(c.type, c.id), [c.field]: c.good });
      expect(result.problems.filter((p) => p.severity === "error")).toEqual([]);
      expect(result.valid.map((r) => r.id)).toEqual([c.id]);
    });

    c.bad.forEach((bad, index) => {
      it(`${c.type}.${c.field}: wrongly typed value ${index + 1} is refused with a message naming the field`, () => {
        const result = importOne(c.type, { ...raw(c.type, c.id), [c.field]: bad });
        expect(result.valid).toEqual([]);
        const errors = result.problems.filter((p) => p.severity === "error");
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].message.startsWith(`${c.field}`)).toBe(true);
      });
    });
  }

  it("the same check refuses a proposal's merged record (safeParseRecord)", () => {
    const merged = { ...raw("build", "BLD-FX-02"), other_mentions: [null] };
    const result = safeParseRecord("build", merged);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toMatch(/^other_mentions\.0: /);
  });

  it("hq_acceptance keeps accepted_version, typed as a positive whole number", () => {
    const acceptance = { state: "accepted", decision_id: "FD-HQ-0001", decided_at: "2031-05-01T00:00:00Z", decided_by: "founder" };
    const ok = safeParseRecord("module", { ...raw("module", "MOD-FX-GAMMA"), hq_acceptance: { ...acceptance, accepted_version: 2 } });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect((ok.data as { hq_acceptance?: { accepted_version?: number } }).hq_acceptance?.accepted_version).toBe(2);
    for (const bad of ["2", 0, 1.5]) {
      expect(safeParseRecord("module", { ...raw("module", "MOD-FX-GAMMA"), hq_acceptance: { ...acceptance, accepted_version: bad } }).ok).toBe(false);
    }
  });

  it("collectCitations ignores a citation-shaped object whose locator is not text", () => {
    const found = collectCitations({ notes: [{ source_id: "SRC-F01", quote: CITE.quote, locator: { evil: 1 } }, CITE] });
    expect(found).toEqual([{ source_id: "SRC-F01", quote: CITE.quote, locator: null }]);
  });

  it("STRUCTURED_FIELDS names the fields whose values are objects, arrays or claims", () => {
    expect(STRUCTURED_FIELDS.module).toEqual(expect.arrayContaining(["lifecycle", "objective", "capabilities", "lifecycle_other_reports"]));
    expect(STRUCTURED_FIELDS.build).toEqual(expect.arrayContaining(["statement", "code_ref", "other_mentions", "possibly_same_as"]));
    expect(STRUCTURED_FIELDS.requirement).toEqual(expect.arrayContaining(["implementation_note", "linked_evidence_ids", "conflicts_with"]));
    expect(STRUCTURED_FIELDS.build).not.toContain("label");
    expect(STRUCTURED_FIELDS.requirement).not.toContain("exact_wording");
    expect(STRUCTURED_FIELDS.requirement).not.toContain("implementation_state");
    expect(STRUCTURED_FIELDS.source).not.toContain("doc_date");
  });
});

describe("a reported founder acceptance must come from a source (evidence-7, honesty-2)", () => {
  const withFounderAccepted = (entry: unknown) => {
    const module = raw("module", "MOD-FX-GAMMA");
    (module.lifecycle as Record<string, unknown>).founder_accepted = entry;
    return module;
  };

  it('refuses founder_accepted "yes" with basis "verified" and no citation', () => {
    const result = safeParseRecord("module", withFounderAccepted({ state: "yes", basis: "verified", note: "Accepted", citations: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toMatch(/lifecycle\.founder_accepted: a founder acceptance of "yes" must have basis "reported" or "founder_statement"/);
  });

  it('refuses founder_accepted "partial" with basis "verified" even with a citation, and with a submitter\'s claim', () => {
    expect(safeParseRecord("module", withFounderAccepted({ state: "partial", basis: "verified", citations: [CITE] })).ok).toBe(false);
    expect(safeParseRecord("module", withFounderAccepted({ state: "yes", basis: "submitter_claim", citations: [CITE] })).ok).toBe(false);
  });

  it("the pack gate refuses it too", () => {
    const result = importOne("module", withFounderAccepted({ state: "yes", basis: "verified", citations: [] }));
    expect(result.valid).toEqual([]);
    expect(result.problems.map((p) => p.message).join(" ")).toMatch(/lifecycle\.founder_accepted/);
  });

  it("accepts a cited report or founder statement, and any non-positive state", () => {
    expect(safeParseRecord("module", withFounderAccepted({ state: "yes", basis: "reported", citations: [CITE] })).ok).toBe(true);
    expect(safeParseRecord("module", withFounderAccepted({ state: "partial", basis: "founder_statement", citations: [CITE] })).ok).toBe(true);
    expect(safeParseRecord("module", withFounderAccepted({ state: "no", basis: "verified", citations: [] })).ok).toBe(true);
  });
});

describe("dates are ISO dates or null (honesty-5)", () => {
  const cases: { type: RecordType; id: string; field: string }[] = [
    { type: "source", id: "SRC-F01", field: "doc_date" },
    { type: "source", id: "SRC-F01", field: "updated" },
    { type: "requirement", id: "FR-FX-001", field: "source_date" },
    { type: "decision", id: "FD-FX-01", field: "date" },
    { type: "commission", id: "COM-FX-01", field: "date" },
    { type: "evidence", id: "EV-FX-01", field: "date" },
  ];
  for (const c of cases) {
    it(`${c.type}.${c.field}`, () => {
      for (const bad of ["April 2031", "2031", "12/04/2031", ""]) {
        const result = safeParseRecord(c.type, { ...raw(c.type, c.id), [c.field]: bad });
        expect(result.ok, `${c.field} = ${JSON.stringify(bad)}`).toBe(false);
        if (!result.ok) expect(result.issues.join(" ")).toMatch(new RegExp(`${c.field}: must be a date written as YYYY-MM-DD`));
      }
      for (const good of ["2031-04-12", "2031-04-12T09:30:00Z", null]) {
        expect(safeParseRecord(c.type, { ...raw(c.type, c.id), [c.field]: good }).ok, `${c.field} = ${JSON.stringify(good)}`).toBe(true);
      }
    });
  }
});

/** The values a zod enum or literal allows, through optional / nullable / default wrappers; null for anything else. */
function choicesOf(schema: unknown): string[] | null {
  let current = schema as { _zod: { def: { type: string; innerType?: unknown; entries?: Record<string, string>; values?: unknown[] } } };
  while (["optional", "nullable", "default", "prefault", "readonly", "catch", "nonoptional"].includes(current._zod.def.type) && current._zod.def.innerType) {
    current = current._zod.def.innerType as typeof current;
  }
  const def = current._zod.def;
  if (def.type === "enum") return Object.values(def.entries!);
  if (def.type === "literal") return def.values!.map(String);
  return null;
}

describe("G1c — FIELD_ENUMS is the record schemas' own lists", () => {
  const shape = (type: RecordType) => (RECORD_SCHEMAS[type] as unknown as { shape: Record<string, unknown> }).shape;

  it("every top-level field the schemas restrict to a list is in FIELD_ENUMS, with exactly the schema's values", () => {
    for (const type of RECORD_TYPES) {
      for (const [field, schema] of Object.entries(shape(type))) {
        const choices = choicesOf(schema);
        if (!choices) continue;
        const row = FIELD_ENUMS.find((f) => f.type === type && f.path === field);
        expect(row, `${type}.${field}`).toBeDefined();
        expect([...row!.allowed], `${type}.${field}`).toEqual(choices);
      }
    }
  });

  it("every FIELD_ENUMS row names a real field, and the nested rows use the schema's lists", () => {
    for (const row of FIELD_ENUMS) {
      if (row.type === "*") {
        expect(row.path).toBe("**.epistemic");
        expect([...row.allowed]).toEqual(choicesOf((Claim as unknown as { shape: Record<string, unknown> }).shape.epistemic));
        continue;
      }
      const top = row.path.split(".")[0];
      expect(shape(row.type), `${row.type}.${row.path}`).toHaveProperty(top);
      if (row.path === top) expect([...row.allowed]).toEqual(choicesOf(shape(row.type)[top]));
    }
    const lifecycle = (path: string) => [...FIELD_ENUMS.find((f) => f.type === "module" && f.path === path)!.allowed];
    expect(lifecycle("lifecycle.*")).toEqual([...LIFECYCLE_DIMENSIONS]);
    expect(lifecycle("lifecycle.*.state")).toEqual([...LIFECYCLE_STATES]);
    expect(lifecycle("lifecycle.*.basis")).toEqual([...EPISTEMIC]);
  });

  it("fieldEnumProblem checks only what an update sets, plus always the fields that drive acceptance", () => {
    const build = raw("build", "BLD-FX-01");
    const oddSeverity = { ...raw("defect", "DEF-FX-01"), severity: "critical" };
    expect(fieldEnumProblem("defect", { title: "Renamed" }, oddSeverity)).toBeNull();
    expect(fieldEnumProblem("defect", { severity: "critical" }, raw("defect", "DEF-FX-01"))).toMatchObject({ field: "severity" });
    expect(fieldEnumProblem("build", { label: "x" }, { ...build, standing: "accepted" })).toMatchObject({ field: "standing" });
    expect(fieldEnumProblem("build", { label: "x" }, build)).toBeNull();
    expect(fieldEnumProblem("build", { standing: "accepted" }, null)).toMatchObject({ message: 'Field "standing" holds "accepted", which is not one of its allowed values.' });
    expect(fieldEnumProblem("open_item", { statement: { text: "x", epistemic: "constructor" } }, null)).toMatchObject({ field: "epistemic" });
    expect(fieldEnumProblem("module", { constructor: "x" }, raw("module", "MOD-FX-GAMMA"))).toBeNull();
  });
});
