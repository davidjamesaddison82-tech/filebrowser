/**
 * Records whose fields hold values of the wrong kind: an array where a status should be, a number as a
 * lifecycle state, an object as an evidence type, null as a defect status. The database refuses such
 * values from a proposal (migration 0008), but an owner-level import that skips the pack validator can
 * still store them, so every reader must cope with them (round 3, G1f and G11a).
 *
 * Shared by the browser suite (tests/e2e/plant-odd-values.ts, 07-odd-values.spec.ts), the HTTP suite
 * (tests/api/odd-values.test.ts) and the unit tests of the conformer (tests/unit/conform.test.ts).
 * Planting uses the TEST database only (tests/helpers/env.ts).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Rec = { [key: string]: Json };
export interface Planted {
  type: string;
  id: string;
  data: Rec;
}

const FIXTURE = path.resolve(import.meta.dirname, "..", "..", "data", "packs", "fixture", "records");
const fixture = (type: string): Rec[] => JSON.parse(readFileSync(path.join(FIXTURE, `${type}.json`), "utf8")) as Rec[];
const first = (type: string, id?: string): Rec => structuredClone(fixture(type).find((r) => !id || r.id === id) ?? fixture(type)[0]);

/** Values of every kind a JSON field can hold that is not the kind the schema asks for, or not one of its listed values. */
export const ODD_VALUES: Json[] = [["accepted_reported"], 7, { state: "yes", x: 1 }, null, true, "", "not_a_listed_value"];

/** Fields that point at other records. Kept valid in two of the three ways, so the odd record is shown on the screens of what it points at. */
const isReference = (key: string) => key === "id" || /(^|_)ids?$/.test(key) || key === "variant_of" || key === "commission_code" || key === "commission_codes";

/** Every leaf of a value replaced by `odd`, its arrays and objects kept. */
function deepOdd(value: Json, odd: Json, key = ""): Json {
  if (isReference(key)) return value;
  if (Array.isArray(value)) return value.length ? value.map((v) => deepOdd(v, odd)) : [structuredClone(odd)];
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepOdd(v, odd, k)]));
  return structuredClone(odd);
}

export const TYPES = ["build", "commission", "decision", "defect", "evidence", "loop", "module", "open_item", "pathway", "recommendation", "requirement", "source"];

/** Every list in a value, at any depth, given one more element: `odd`. The elements already there are kept. */
function oddElement(value: Json, odd: Json): Json {
  if (Array.isArray(value)) return [...value.map((v) => oddElement(v, odd)), structuredClone(odd)];
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, oddElement(v, odd)]));
  return value;
}

/**
 * One record of each type, seven odd values, four ways: every field but the references (A); every
 * leaf but the references, at any depth (B); every field but the id (C); every list, at any depth,
 * with one odd element added to what it holds (D).
 */
export function fuzz(): Planted[] {
  const out: Planted[] = [];
  for (const type of TYPES) {
    const base = first(type);
    ODD_VALUES.forEach((odd, n) => {
      const ways: [string, (k: string, v: Json) => Json][] = [
        ["A", (k, v) => (isReference(k) ? v : structuredClone(odd))],
        ["B", (k, v) => deepOdd(v, odd, k)],
        ["C", (k, v) => (k === "id" ? v : structuredClone(odd))],
        ["D", (k, v) => (k === "id" ? v : oddElement(v, odd))],
      ];
      for (const [way, change] of ways) {
        const id = `${String(base.id)}-ODD-${way}${n}`;
        const data: Rec = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, change(k, v)]));
        data.id = id;
        // A decision recorded "in HQ" is founder authority and cannot be imported; any other odd value can.
        if (type === "decision" && data.recorded_in === "hq") data.recorded_in = "source";
        out.push({ type, id, data });
      }
    });
  }
  return out;
}

/** The cases the browser test looks at one by one: what each screen must show as not valid. */
export function named(): Planted[] {
  const build = first("build", "BLD-FX-01");
  const mod = first("module", "MOD-FX-ALPHA");
  const ev = first("evidence");
  const defect = first("defect");
  const req = first("requirement");
  const lifecycle = structuredClone(mod.lifecycle) as Rec;
  const tested = lifecycle && typeof lifecycle === "object" ? Object.keys(lifecycle)[0] : "tested";
  lifecycle[tested] = { ...(lifecycle[tested] as Rec), state: 7 };
  return [
    { type: "build", id: "BLD-ODD-ARRAY", data: { ...build, id: "BLD-ODD-ARRAY", label: "odd-standing-build", standing: ["accepted_reported"] } },
    { type: "module", id: "MOD-ODD-NUMBER", data: { ...mod, id: "MOD-ODD-NUMBER", name: "Odd lifecycle module", aliases: [], lifecycle } },
    { type: "evidence", id: "EV-ODD-OBJECT", data: { ...ev, id: "EV-ODD-OBJECT", title: "Odd type evidence", type: { founder_acceptance: true } } },
    { type: "defect", id: "DEF-ODD-NULL", data: { ...defect, id: "DEF-ODD-NULL", title: "Odd status defect", status: null } },
    { type: "requirement", id: "FR-ODD-NUMBER", data: { ...req, id: "FR-ODD-NUMBER", title: "Odd disposition requirement", disposition: 3, implementation_state: ["implemented_tested"] } },
    { type: "build", id: "BLD-ODD-STRING", data: { ...build, id: "BLD-ODD-STRING", label: "odd-word-build", standing: "Accepted" } },
  ];
}

/**
 * ROUND4 H6: the screens verifier's planted records (rv3 new defects Y14–Y18 and G11a), and variations of
 * them: invalid records whose stored data says something negative, names a module in a way conforming
 * cannot keep, or would be made to say something by a default. None of them may make anything read
 * better than it reads without them, and each that names a module must be listed in its figures.
 * BLD-FX-02 is reported as accepted with no instrument in the fixture; MOD-FX-GAMMA has no defect.
 */
export function screensCases(): Planted[] {
  const alpha = first("module", "MOD-FX-ALPHA");
  const b1 = first("build", "BLD-FX-01");
  const ev = first("evidence", "EV-FX-01");
  const def = first("defect", "DEF-FX-01");
  const rec2 = first("recommendation", "REC-FX-02");
  const open2 = first("open_item", "OPEN-FX-02");
  const req = first("requirement", "FR-FX-001");
  const loop = first("loop", "LOOP-FX-01");
  const src = first("source", "SRC-F01");
  const withoutMadeBy = Object.fromEntries(Object.entries(rec2).filter(([k]) => k !== "made_by")) as Rec;
  return [
    // Y14: an evidence record that fails validation is no acceptance instrument; its stored result says the opposite.
    { type: "evidence", id: "EV-RV3-FA", data: { ...ev, id: "EV-RV3-FA", type: "founder_acceptance", title: "rv3 odd founder acceptance of Beta build 2", module_ids: ["MOD-FX-BETA"], build_id: "BLD-FX-02", verification: "source_reported", result: "The founder did NOT accept this build." } },
    // Y15: negative content a conformed view drops.
    { type: "module", id: "MOD-RV3-BLK", data: { ...alpha, id: "MOD-RV3-BLK", name: "rv3 blocker module", aliases: [], blockers: [{ text: "RV3 BLOCKER: MIDI input is broken, do not ship", epistemic: "Reported", citations: [] }] } },
    { type: "defect", id: "DEF-RV3-MODSTR", data: { ...def, id: "DEF-RV3-MODSTR", title: "rv3 open blocking defect on Gamma", status: "open", severity: "blocking", module_ids: "MOD-FX-GAMMA", build_id: null } },
    { type: "open_item", id: "OPEN-RV3-STR", data: { ...open2, id: "OPEN-RV3-STR", title: "rv3 blocker on Gamma", kind: "blocker", module_ids: "MOD-FX-GAMMA" } },
    // Y15 and Y17: a recommendation blocked by a string, with no made_by.
    { type: "recommendation", id: "REC-RV3-BLK", data: { ...withoutMadeBy, id: "REC-RV3-BLK", title: "rv3 blocked recommendation", blocked_by: "OPEN-FX-02", rank: "first" } },
    // Y18: an HQ check whose stored result is a failure object.
    { type: "build", id: "BLD-RV3-CHK", data: { ...b1, id: "BLD-RV3-CHK", label: "rv3-checks", hq_checks: [{ check: "sha256 matches", result: "pass" }, { check: "opens in a browser", result: { failed: true, detail: "RV3 FAILED CHECK" } }] } },
    // G11a: a tested requirement whose evidence links are a string; a module stored with a number as summary.
    { type: "requirement", id: "FR-RV3-LINK", data: { ...req, id: "FR-RV3-LINK", title: "rv3 tested requirement with odd links", implementation_state: "implemented_tested", linked_evidence_ids: "EV-FX-01" } },
    { type: "module", id: "MOD-RV3-CA", data: { ...alpha, id: "MOD-RV3-CA", name: "rv3 cycle A", aliases: [], parent_id: "MOD-RV3-CB", summary: 7 } },
    { type: "module", id: "MOD-RV3-CB", data: { ...alpha, id: "MOD-RV3-CB", name: "rv3 cycle B", aliases: [], parent_id: "MOD-RV3-CA", summary: 7 } },
    // Variations (ROUND4 view lane): a module named in a comma list, as an object key, at the end of a
    // sentence and deep in a nested list; a valid-looking positive record that fails on one other field.
    { type: "defect", id: "DEF-R4-COMMA", data: { ...def, id: "DEF-R4-COMMA", title: "r4 defect on two modules", status: "open", module_ids: "MOD-FX-GAMMA, MOD-FX-DELTA", build_id: null } },
    { type: "open_item", id: "OPEN-R4-KEY", data: { ...open2, id: "OPEN-R4-KEY", title: "r4 blocker keyed by module", kind: 7, module_ids: [], by_module: { "MOD-FX-DELTA": "blocked" } } },
    { type: "evidence", id: "EV-R4-SENT", data: { ...ev, id: "EV-R4-SENT", title: "r4 evidence", type: ["test_run"], module_ids: [], build_id: null, result: { text: "Fails on MOD-FX-BETA.", epistemic: "reported", citations: [] } } },
    { type: "requirement", id: "FR-R4-DEEP", data: { ...req, id: "FR-R4-DEEP", title: "r4 requirement", module_ids: [], acceptance_criteria: [[{ text: "see MOD-FX-BETA" }]] } },
    { type: "build", id: "BLD-R4-ACC", data: { ...b1, id: "BLD-R4-ACC", label: "r4-accepted", module_id: "MOD-FX-GAMMA", standing: "accepted_reported", statement: { text: "Accepted.", epistemic: "reported", citations: [{ source_id: "SRC-F01", locator: null, quote: "Beta build 2 was accepted by the founder on 3 March 2031 for desktop browsers only." }] }, bytes: 12 } },
    { type: "evidence", id: "EV-R4-HQV", data: { ...ev, id: "EV-R4-HQV", title: "r4 checked evidence", verification: "hq_verified", type: "test_run", module_ids: ["MOD-FX-GAMMA"], build_id: null, date: 20310101 } },
    { type: "loop", id: "LOOP-R4-ODD", data: { ...loop, id: "LOOP-R4-ODD", name: "r4 loop", module_ids: ["MOD-FX-DELTA"], standing: 5 } },
    { type: "source", id: "SRC-R4-ODD", data: { ...src, id: "SRC-R4-ODD", title: "r4 source", doc_date: "2099-01-01", access: "read_full", bytes: "many" } },
  ];
}

/**
 * ROUND4 H1: a VALID build whose statement is a submitter's claim quoting a source verbatim, as an update
 * may now leave one. Its page must show the statement as the submitter's, never under "What the source says".
 */
export function submitterClaimBuild(): Planted {
  const b1 = first("build", "BLD-FX-01");
  return {
    type: "build",
    id: "BLD-R4-SUBQ",
    data: {
      ...b1,
      id: "BLD-R4-SUBQ",
      label: "r4-submitter-claim-build",
      standing: "development",
      statement: { text: "The submitter says this build was accepted.", epistemic: "submitter_claim", citations: [{ source_id: "SRC-F01", locator: null, quote: "Beta build 2 was accepted by the founder on 3 March 2031 for desktop browsers only." }] },
    },
  };
}

/** Store the records as the owner, as an import would (hq.admin_put_records), in one new revision. */
export async function plantOddRecords(records: Planted[], summary: string): Promise<void> {
  // Imported here, not at the top, so the unit tests can use the records without a database.
  const { admin } = await import("./db");
  const client = await admin();
  try {
    await client.query("select hq.admin_put_records($1::jsonb, $2, null, 'hq-import', false)", [JSON.stringify(records), summary]);
  } finally {
    await client.end();
  }
}
