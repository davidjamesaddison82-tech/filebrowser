import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { freshWorld, type TestWorld } from "../helpers/db";
import { TEST_BASE_URL } from "../helpers/env";
import { api } from "../helpers/http";
import { fuzz, named, type Planted, plantOddRecords, screensCases } from "../helpers/odd-values";

/**
 * The REST API and the MCP endpoint never fail on a stored record of the wrong shape (round 3, G11a).
 *
 * The fuzz set (tests/helpers/odd-values.ts: one record of every type, every field holding a value of
 * every wrong kind, four ways) is stored as an owner-level import would store it, past the pack
 * validator. Then every tool the registry lists is called, over REST (GET and POST) and over MCP
 * tools/call, with the planted records' ids, at the latest revision and pinned to the revision that
 * planted them. Every answer must be 200, or a deliberate 4xx for an argument the tool refuses; none
 * may be 5xx; the server must print no error; and no answer may give a planted record a positive
 * status it does not validly hold (the stored form, which an answer offers under `stored`, aside).
 */

let w: TestWorld;
let fuzzed: Planted[];
let pinnedRev: number;
let headRev: number;
let logStart = 0;

const serverLog = () => {
  const file = inject("serverLog");
  return file && existsSync(file) ? readFileSync(file, "utf8") : "";
};

beforeAll(async () => {
  w = await freshWorld();
  fuzzed = fuzz();
  await plantOddRecords(fuzzed, "Records holding values of the wrong kind (HTTP test, fuzz)");
  pinnedRev = w.headRev + 1;
  // A second import after it, so that the pinned revision is not the latest.
  await plantOddRecords(named(), "Records holding values of the wrong kind (HTTP test, named)");
  headRev = w.headRev + 2;
  logStart = serverLog().length;
}, 120_000);

// ---------------------------------------------------------------------------
// What counts as a positive status
// ---------------------------------------------------------------------------

/** Values that say something is accepted, reported, tested, checked, implemented, decided or done. */
const POSITIVE_VALUES = new Set([
  "accepted_reported",
  "accepted",
  "accepted_in_hq",
  "acceptance_reported",
  "build_accepted_reported",
  "build_acceptance_claimed",
  "tested_not_accepted",
  "prototype_untested",
  "designed_only",
  "documented_only",
  "yes",
  "partial",
  "existing",
  "hq_verified",
  "source_reported",
  "implemented_tested",
  "implemented_untested",
  "satisfied",
  "resolved",
  "issued",
  "delivered",
  "verified",
  "reported",
  "founder_statement",
  "founder_acceptance",
  "hq_check",
]);

/**
 * The fields that say where something stands. A positive word elsewhere is text (an alias or a concept
 * may well be "accepted_reported" as text, and is shown as text).
 */
const STATUS_KEYS = new Set(["standing", "status", "state", "verification", "implementation_state", "disposition", "headline", "epistemic", "basis", "type"]);

/** Flags that are positive when true, and `outstanding`, which is positive when false (nothing left to do). */
const POSITIVE_WHEN_TRUE = new Set(["documented", "designed", "runnable", "test_evidence", "acceptance_reported", "acceptance_recorded_in_hq", "has_linked_evidence"]);

/** The record an object in an answer is about, if it is about one. */
function aboutId(obj: Record<string, unknown>): string | null {
  for (const key of ["id", "record_id", "module_id"]) if (typeof obj[key] === "string") return obj[key] as string;
  const ref = obj.ref as { id?: unknown } | undefined;
  if (ref && typeof ref.id === "string") return ref.id;
  return null;
}

/**
 * Every positive status an answer gives, per record id: "key=value" pairs found inside an object about
 * that record (not inside a nested object about another one). The stored form (`stored`) is left out:
 * it is offered as stored, and says so.
 */
function positivesByRecord(answer: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (id: string, pair: string) => {
    const set = out.get(id) ?? new Set<string>();
    set.add(pair);
    out.set(id, set);
  };
  const walk = (value: unknown, owner: string | null, key: string) => {
    if (key === "stored") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, owner, key);
      return;
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const own = aboutId(obj) ?? owner;
      for (const [k, v] of Object.entries(obj)) walk(v, own, k);
      return;
    }
    if (!owner) return;
    if (typeof value === "string" && STATUS_KEYS.has(key) && POSITIVE_VALUES.has(value)) add(owner, `${key}=${value}`);
    if (value === true && POSITIVE_WHEN_TRUE.has(key)) add(owner, `${key}=true`);
    if (value === false && key === "outstanding") add(owner, "outstanding=false");
  };
  walk(answer, null, "");
  return out;
}

/** "BLD-FX-01-ODD-D3" → { base: "BLD-FX-01", way: "D" }. */
function plantedParts(id: string): { base: string; way: string } {
  const m = /^(.*)-ODD-([A-D])\d+$/.exec(id)!;
  return { base: m[1], way: m[2] };
}

/**
 * Ways A, B and C replace every field (or every leaf) of the record with an odd value, so the record
 * validly holds no positive status at all: an answer may give it none, except that ways A and B keep
 * the references, so a requirement still validly links the fixture's evidence (has_linked_evidence).
 * Way D only adds an odd element to each list and keeps every value the fixture record had, so it may
 * show what its fixture record shows (`allowed`), and nothing more.
 */
function positiveProblems(answer: unknown, where: string, baseline: (base: string) => Set<string>): string[] {
  const problems: string[] = [];
  const found = positivesByRecord(answer);
  for (const record of fuzzed) {
    const pairs = found.get(record.id);
    if (!pairs) continue;
    const { base, way } = plantedParts(record.id);
    const allowed =
      way === "D" ? new Set([...(found.get(base) ?? []), ...baseline(base)]) : way === "C" ? new Set<string>() : new Set(["has_linked_evidence=true"]);
    const extra = [...pairs].filter((p) => !allowed.has(p));
    if (extra.length > 0) problems.push(`${where}: ${record.id} reads ${extra.join(", ")}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Calling every tool
// ---------------------------------------------------------------------------

interface Call {
  tool: string;
  args: Record<string, unknown>;
}

interface Answer {
  call: Call;
  transport: "GET" | "POST" | "MCP";
  status: number;
  body: unknown;
}

function query(args: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) {
    if (Array.isArray(v)) for (const item of v) params.append(k, String(item));
    else params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

let rpcId = 0;
async function mcpCall(call: Call, token: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${TEST_BASE_URL}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: call.tool, arguments: call.args } }),
  });
  const text = await res.text();
  const rpc = JSON.parse(text) as { result?: { isError: boolean; structuredContent: { error?: { status: number } } }; error?: { data?: { status?: number } } };
  if (res.status !== 200) return { status: res.status, body: rpc };
  if (rpc.error) return { status: rpc.error.data?.status ?? 400, body: rpc };
  const content = rpc.result!.structuredContent;
  return { status: rpc.result!.isError ? (content.error?.status ?? 500) : 200, body: content };
}

async function callAll(calls: Call[], readTools: Set<string>, token: string): Promise<Answer[]> {
  const jobs: (() => Promise<Answer>)[] = [];
  for (const call of calls) {
    if (readTools.has(call.tool)) {
      jobs.push(async () => {
        const res = await api(`/api/v1/tools/${call.tool}${query(call.args)}`, { token });
        return { call, transport: "GET", status: res.status, body: res.body };
      });
    }
    jobs.push(async () => {
      const res = await api(`/api/v1/tools/${call.tool}`, { token, body: call.args });
      return { call, transport: "POST", status: res.status, body: res.body };
    });
    jobs.push(async () => ({ call, transport: "MCP", ...(await mcpCall(call, token)) }));
  }
  const answers: Answer[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < jobs.length) answers.push(await jobs[next++]());
    }),
  );
  return answers;
}

const ofType = (type: string) => fuzzed.filter((r) => r.type === type).map((r) => r.id);

/** Arguments for every tool: the planted records' ids wherever a tool takes an id. `rev` is added for pinned calls. */
function readCalls(): Call[] {
  const calls: Call[] = [];
  const all = fuzzed.map((r) => ({ type: r.type, id: r.id }));
  const bases = [...new Set(fuzzed.map((r) => `${r.type}:${plantedParts(r.id).base}`))].map((k) => ({ type: k.split(":")[0], id: k.split(":")[1] }));
  calls.push({ tool: "get_ecosystem_overview", args: {} }, { tool: "list_learning_loops", args: {} }, { tool: "list_sources", args: {} }, { tool: "get_review_items", args: {} });
  for (const id of [...ofType("module"), "MOD-FX-ALPHA"]) calls.push({ tool: "get_module_brief", args: { module: id } });
  for (const id of [...ofType("loop"), "LOOP-FX-01"]) calls.push({ tool: "get_learning_loop", args: { loop_id: id } });
  calls.push(
    { tool: "search_founder_requirements", args: {} },
    { tool: "search_founder_requirements", args: { query: "FX" } },
    { tool: "search_founder_requirements", args: { module: "MOD-FX-ALPHA" } },
    { tool: "search_founder_requirements", args: { outstanding: true } },
    { tool: "search_founder_requirements", args: { disposition: "unreviewed" } },
    { tool: "search_founder_requirements", args: { source_id: "SRC-F01" } },
    { tool: "find_outstanding_requirements", args: {} },
    { tool: "find_outstanding_requirements", args: { module: "MOD-FX-ALPHA" } },
    { tool: "search_records", args: { query: "ODD" } },
    { tool: "search_records", args: { query: "FX" } },
    { tool: "search_records", args: { query: "accepted" } },
    { tool: "search_records", args: { query: "not_a_listed_value" } },
    { tool: "search_records", args: { query: "FX", types: ["build", "module", "evidence"] } },
  );
  for (const tool of ["get_record", "get_acceptance_status", "get_source_lineage", "get_development_dependencies"]) {
    for (const ref of [...all, ...bases]) calls.push({ tool, args: { type: ref.type, id: ref.id } });
  }
  return calls;
}

/** The tools that always answer at the latest revision, and the inbox tools, with the planted ids. */
function headOnlyCalls(rev: number): Call[] {
  const modules = ofType("module");
  const builds = ofType("build");
  const calls: Call[] = [
    { tool: "get_recent_changes", args: {} },
    { tool: "get_recent_changes", args: { limit: 5 } },
    { tool: "list_my_proposals", args: {} },
    { tool: "list_my_proposals", args: { status: "submitted" } },
  ];
  for (let i = 0; i < modules.length; i += 7) {
    calls.push({
      tool: "submit_defect_report",
      args: { title: `Defect on ${modules[i]}`, description: "Filed by the odd-values test.", module_ids: [modules[i]], build_id: builds[i % builds.length], base_rev: rev },
    });
    calls.push({
      tool: "record_test_evidence",
      args: { title: `Evidence on ${modules[i]}`, result_summary: "Filed by the odd-values test.", module_ids: [modules[i]], build_id: builds[i % builds.length], base_rev: rev },
    });
  }
  // A change to a planted record: the record as it would stand is not valid, so this is refused (4xx), never a 5xx.
  for (const record of fuzzed.filter((_, i) => i % 5 === 0)) {
    if (record.type === "decision") continue;
    calls.push({
      tool: "submit_change_proposal",
      args: { title: `Retitle ${record.id}`, rationale: "Filed by the odd-values test.", base_rev: rev, target: { type: record.type, id: record.id, base_version: 1 }, set: { title: "Retitled by the odd-values test" } },
    });
  }
  calls.push({
    tool: "submit_change_proposal",
    args: { title: "New open item on odd records", rationale: "Filed by the odd-values test.", base_rev: rev, create: { record_type: "open_item", record: { title: "Odd records", module_ids: [modules[0]], kind: "gap", statement: { text: "Filed by the odd-values test.", epistemic: "submitter_claim", citations: [] } } } },
  });
  return calls;
}

function summarise(answers: Answer[]): { failures: string[]; problems: string[] } {
  const failures: string[] = [];
  const baselines = new Map<string, Set<string>>();
  // What each single-record tool says about a fixture record, for the way-D comparison.
  for (const a of answers) {
    if (a.status !== 200) continue;
    const id = a.call.args.id ?? a.call.args.module ?? a.call.args.loop_id;
    if (typeof id !== "string" || id.includes("-ODD-")) continue;
    const pairs = positivesByRecord(a.body).get(id);
    if (pairs) baselines.set(`${a.call.tool}:${id}`, new Set([...(baselines.get(`${a.call.tool}:${id}`) ?? []), ...pairs]));
  }
  const problems: string[] = [];
  for (const a of answers) {
    const where = `${a.transport} ${a.call.tool} ${JSON.stringify(a.call.args)}`;
    if (a.status >= 500 || (a.status !== 200 && (a.status < 400 || a.status >= 500))) failures.push(`${where}: ${a.status} ${JSON.stringify(a.body).slice(0, 200)}`);
    // Way D keeps every value its fixture record had, so it may show anything a single-record tool shows
    // about that fixture record, whichever tool this answer comes from. (ROUND4 H6a: a requirement HQ
    // cannot read is listed as outstanding, so a way-D requirement now appears in the outstanding lists,
    // with the implementation state its fixture record validly holds, where its fixture record does not.)
    const anyTool = (base: string) => new Set([...baselines.entries()].filter(([k]) => k.endsWith(`:${base}`)).flatMap(([, v]) => [...v]));
    if (a.status === 200) problems.push(...positiveProblems(a.body, where, (base) => new Set([...(baselines.get(`${a.call.tool}:${base}`) ?? []), ...anyTool(base)])));
  }
  return { failures, problems };
}

describe("every tool answers on stored records of the wrong shape (G11a)", () => {
  let readTools: Set<string>;
  let allTools: string[];

  beforeAll(async () => {
    const listed = await api<{ tools: { name: string; mode: string }[] }>("/api/v1/tools", { token: w.tokens.claude });
    allTools = listed.body.tools.map((t) => t.name);
    readTools = new Set(listed.body.tools.filter((t) => t.mode === "read").map((t) => t.name));
  });

  it("calls every tool the registry lists", () => {
    const called = new Set([...readCalls(), ...headOnlyCalls(headRev)].map((c) => c.tool));
    expect([...allTools].sort()).toEqual([...called].sort());
  });

  it("at the latest revision: every answer is 200 or a deliberate 4xx, and no planted record reads as positive", { timeout: 900_000 }, async () => {
    const answers = await callAll([...readCalls(), ...headOnlyCalls(headRev)], readTools, w.tokens.claude);
    const { failures, problems } = summarise(answers);
    const byTool = [...new Set(failures.map((f) => f.split(" ").slice(0, 2).join(" ")))];
    expect(byTool, "tools that answered with a server error").toEqual([]);
    expect(failures).toEqual([]);
    expect([...new Set(problems.map((p) => p.replace(/^\S+ \S+ .*?: /, "")))].slice(0, 60)).toEqual([]);
    // Most calls name a planted record that exists: they must succeed, not be refused.
    const reads = answers.filter((a) => readTools.has(a.call.tool));
    expect(reads.filter((a) => a.status !== 200).map((a) => `${a.transport} ${a.call.tool} ${JSON.stringify(a.call.args)}: ${a.status}`)).toEqual([]);
  });

  it("pinned to the revision that stored them: the same", { timeout: 900_000 }, async () => {
    const calls = readCalls().map((c) => ({ ...c, args: { ...c.args, rev: pinnedRev } }));
    const answers = await callAll(calls, readTools, w.tokens.chatgpt);
    const { failures, problems } = summarise(answers);
    expect(failures).toEqual([]);
    expect([...new Set(problems.map((p) => p.replace(/^\S+ \S+ .*?: /, "")))].slice(0, 60)).toEqual([]);
    expect(answers.filter((a) => a.status !== 200).map((a) => `${a.transport} ${a.call.tool}: ${a.status}`)).toEqual([]);
    for (const a of answers.slice(0, 20)) expect((a.body as { revision: { rev: number; is_head: boolean } }).revision).toMatchObject({ rev: pinnedRev, is_head: false });
  });

  it("the server printed no error while answering", () => {
    const log = serverLog().slice(logStart);
    const errors = log.split("\n").filter((line) => /error|⨯|uncaught|unhandled/i.test(line));
    expect(errors).toEqual([]);
  });
});

describe("an answer says plainly that a stored record is not valid (G11a)", () => {
  type RecordAnswer = {
    data: { valid: boolean; validation_problems?: string[]; stored?: unknown; record: Record<string, unknown> };
    integrity?: { notice: string; records: { type: string; id: string; valid: boolean; problems: string[]; stored: unknown }[] };
  };

  it("get_record returns the conformed record, says it is not valid, with the problems, and gives the stored form", async () => {
    const planted = fuzzed.find((r) => r.id === "BLD-FX-01-ODD-A0")!;
    expect(planted.data.standing).toEqual(["accepted_reported"]);
    const rest = await api<RecordAnswer>(`/api/v1/tools/get_record?type=build&id=${planted.id}`, { token: w.tokens.claude });
    expect(rest.status).toBe(200);
    expect(rest.body.data.valid).toBe(false);
    expect(rest.body.data.validation_problems!.length).toBeGreaterThan(0);
    expect(rest.body.data.validation_problems!.join(" ")).toMatch(/standing/);
    expect(rest.body.data.stored).toEqual(planted.data);
    expect(rest.body.data.record.standing).toBe("Not a valid value");
    expect(rest.body.integrity?.notice).toMatch(/not valid/i);
    expect(rest.body.integrity?.records.find((r) => r.id === planted.id)).toMatchObject({ type: "build", valid: false, stored: planted.data });

    const mcp = await mcpCall({ tool: "get_record", args: { type: "build", id: planted.id } }, w.tokens.claude);
    expect(mcp.status).toBe(200);
    expect((mcp.body as RecordAnswer).data).toEqual(rest.body.data);
  });

  it("a valid record says it is valid and carries no stored copy", async () => {
    const rest = await api<RecordAnswer>("/api/v1/tools/get_record?type=build&id=BLD-FX-01", { token: w.tokens.claude });
    expect(rest.status).toBe(200);
    expect(rest.body.data.valid).toBe(true);
    expect(rest.body.data).not.toHaveProperty("stored");
    expect(rest.body.data).not.toHaveProperty("validation_problems");
    expect(rest.body).not.toHaveProperty("integrity");
  });

  it("search_records marks each hit that is not valid, and the answer lists them with their stored form", async () => {
    const res = await api<{ data: { hits: { id: string; valid: boolean }[] } } & RecordAnswer>("/api/v1/tools/search_records?query=ODD", { token: w.tokens.claude });
    expect(res.status).toBe(200);
    const odd = res.body.data.hits.filter((h) => h.id.includes("-ODD-"));
    expect(odd.length).toBeGreaterThan(0);
    expect(odd.every((h) => h.valid === false)).toBe(true);
    const listed = new Set(res.body.integrity!.records.map((r) => r.id));
    for (const hit of odd) expect(listed.has(hit.id), hit.id).toBe(true);
  });

  it("a tool that lists records lists the invalid ones among them, with their problems and stored form", async () => {
    const res = await api<{ data: { sources: { id: string }[] } } & RecordAnswer>("/api/v1/tools/list_sources", { token: w.tokens.claude });
    expect(res.status).toBe(200);
    const listed = new Map(res.body.integrity!.records.map((r) => [r.id, r]));
    // 28 odd sources; two of them (an extra text in a list of texts) still pass validation, and are not listed.
    const odd = res.body.data.sources.filter((s) => s.id.includes("-ODD-") && !["SRC-F01-ODD-D5", "SRC-F01-ODD-D6"].includes(s.id));
    expect(odd.length).toBe(26);
    expect(listed.has("SRC-F01-ODD-D5")).toBe(false);
    for (const source of odd) {
      const entry = listed.get(source.id);
      expect(entry, source.id).toBeDefined();
      expect(entry!.problems.length).toBeGreaterThan(0);
      expect(entry!.stored).toEqual(fuzzed.find((r) => r.id === source.id)!.data);
    }
  });
});

describe("ROUND4 H6: a record that fails validation never makes anything read better, and is listed on what it names", () => {
  type Ref = { type: string; id: string };
  type Brief = { data: { reliable: boolean; unreadable_records: Ref[]; unreadable_note: string | null; standing: { headline: string } }; integrity?: { records: { id: string }[] } };
  let cases: Planted[];

  beforeAll(async () => {
    cases = screensCases();
    await plantOddRecords(cases, "The screens verifier's records (HTTP test, ROUND4 H6)");
  }, 120_000);

  it("Y15/H6b: Gamma's brief lists the records that name it, says so in words, and the overview says the same words; over MCP too", async () => {
    const rest = await api<Brief>("/api/v1/tools/get_module_brief?module=MOD-FX-GAMMA", { token: w.tokens.claude });
    expect(rest.status).toBe(200);
    const ids = rest.body.data.unreadable_records.map((r) => r.id).sort();
    expect(ids).toEqual(expect.arrayContaining(["DEF-RV3-MODSTR", "OPEN-RV3-STR", "DEF-R4-COMMA", "EV-R4-HQV", "BLD-R4-ACC"]));
    expect(rest.body.data.reliable).toBe(true);
    expect(rest.body.data.unreadable_note).toBe(`${ids.length} records that name this module cannot be read in full; its figures may be incomplete.`);
    // Each is listed in the answer's integrity block, with its stored form.
    const listed = new Set(rest.body.integrity!.records.map((r) => r.id));
    for (const id of ids) expect(listed.has(id), id).toBe(true);
    const mcp = await mcpCall({ tool: "get_module_brief", args: { module: "MOD-FX-GAMMA" } }, w.tokens.claude);
    expect((mcp.body as Brief).data.unreadable_note).toBe(rest.body.data.unreadable_note);
    const overview = await api<{ data: { modules: { id: string; unreadable_note: string | null; unreadable_records: Ref[] }[]; health: Record<string, { count: number; items: { id: string }[] }> } }>(
      "/api/v1/tools/get_ecosystem_overview",
      { token: w.tokens.claude },
    );
    const gamma = overview.body.data.modules.find((m) => m.id === "MOD-FX-GAMMA")!;
    expect(gamma.unreadable_note).toBe(rest.body.data.unreadable_note);
    // Development health lists every record HQ cannot read: the planted ones among them.
    const unreadable = new Set(overview.body.data.health.unreadable_records.items.map((i) => i.id));
    for (const c of cases) expect(unreadable.has(c.id), c.id).toBe(true);
  });

  it("a module whose own record fails validation is not reliable, says so, and counts nothing towards a standing", async () => {
    const res = await api<Brief>("/api/v1/tools/get_module_brief?module=MOD-RV3-BLK", { token: w.tokens.claude });
    expect(res.status).toBe(200);
    expect(res.body.data.reliable).toBe(false);
    expect(res.body.data.standing.headline).toBe("not_reliable");
    expect(res.body.data.unreadable_note).toBe("This module's own record cannot be read in full: its figures are not reliable.");
    const health = await api<{ data: { health: Record<string, { items: { id: string }[] }> } }>("/api/v1/tools/get_ecosystem_overview", { token: w.tokens.claude });
    expect(health.body.data.health.tested_not_accepted.items.map((i) => i.id)).not.toContain("MOD-RV3-BLK");
  });

  it("Y14: an evidence record that fails validation is no acceptance instrument: Beta build 2 keeps its review item", async () => {
    const res = await api<{ data: { items: { key: string }[] } }>("/api/v1/tools/get_review_items", { token: w.tokens.claude });
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((i) => i.key)).toContain("acc:BLD-FX-02");
  });

  it("Y17: a recommendation with no made_by does not read as HQ's builder's", async () => {
    const res = await api<{ data: { record: { made_by: unknown }; stored: Record<string, unknown> } }>("/api/v1/tools/get_record?type=recommendation&id=REC-RV3-BLK", { token: w.tokens.claude });
    expect(res.status).toBe(200);
    expect(res.body.data.record.made_by).toBe("Not a valid value");
    expect(res.body.data.stored).not.toHaveProperty("made_by");
  });

  it("L8 (Y15): a list HQ cannot read is answered with the note beside it, never as nothing", async () => {
    const NOTE = "Not readable — see the stored record";
    type Deps = { data: { blockers: unknown[]; unreadable_fields?: Record<string, string> }; integrity?: { records: { id: string; unreadable_fields?: Record<string, string> }[] } };
    const deps = await api<Deps>("/api/v1/tools/get_development_dependencies?type=recommendation&id=REC-RV3-BLK", { token: w.tokens.claude });
    expect(deps.status).toBe(200);
    expect(deps.body.data.blockers).toEqual([]);
    expect(deps.body.data.unreadable_fields).toMatchObject({ blocked_by: NOTE });
    expect(deps.body.integrity!.records.find((r) => r.id === "REC-RV3-BLK")!.unreadable_fields).toMatchObject({ blocked_by: NOTE });
    const record = await api<{ data: { record: { blocked_by: unknown }; unreadable_fields?: Record<string, string> } }>("/api/v1/tools/get_record?type=recommendation&id=REC-RV3-BLK", { token: w.tokens.claude });
    expect(record.body.data.record.blocked_by).toEqual([]);
    expect(record.body.data.unreadable_fields).toMatchObject({ blocked_by: NOTE });
    // Control: a valid record's answer carries no such note.
    const valid = await api<{ data: { unreadable_fields?: unknown } }>("/api/v1/tools/get_development_dependencies?type=recommendation&id=REC-FX-01", { token: w.tokens.claude });
    expect(valid.body.data).not.toHaveProperty("unreadable_fields");
  });

  it("an invalid record's stored words are still found by search", async () => {
    const res = await api<{ data: { hits: { id: string }[] } }>(`/api/v1/tools/search_records?query=${encodeURIComponent("MIDI input is broken")}`, { token: w.tokens.claude });
    expect(res.status).toBe(200);
    expect(res.body.data.hits.map((h) => h.id)).toContain("MOD-RV3-BLK");
  });

  it("H6c: a proposal that writes the marker back is refused (422), and nothing is stored", async () => {
    const before = await api<{ data: { proposals: unknown[] } }>("/api/v1/tools/list_my_proposals", { token: w.tokens.claude });
    const res = await api<{ error: { code: string; detail?: { rule?: string } } }>("/api/v1/tools/submit_change_proposal", {
      token: w.tokens.claude,
      body: { title: "Write the marker back", rationale: "ROUND4 H6c test.", base_rev: headRev + 1, target: { type: "module", id: "MOD-RV3-CA", base_version: 1 }, set: { summary: "Not a valid value" } },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.detail?.rule).toBe("not_a_valid_value");
    const after = await api<{ data: { proposals: unknown[] } }>("/api/v1/tools/list_my_proposals", { token: w.tokens.claude });
    expect(after.body.data.proposals.length).toBe(before.body.data.proposals.length);
  });
});
