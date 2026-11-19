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
