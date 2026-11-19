import { beforeAll, describe, expect, it } from "vitest";
import { admin, freshWorld, type TestWorld, worldState } from "../helpers/db";
import { TEST_BASE_URL } from "../helpers/env";
import { api, sessionCookie } from "../helpers/http";

/** Review findings in the HTTP layer: body size, MCP batches, query coercion, strict tool arguments, request ids, look-ups. */
let w: TestWorld;
let founderCookie: string;
let developerCookie: string;
type ErrorBody = { error: { code: string; message: string; detail?: unknown; request_id: string } };
type Rpc = { jsonrpc: string; id: unknown; result?: { isError?: boolean; structuredContent?: Record<string, unknown> }; error?: { code: number; message: string; data?: Record<string, unknown> } };

beforeAll(async () => {
  w = await freshWorld();
  founderCookie = await sessionCookie(w.founder.id);
  developerCookie = await sessionCookie(w.developer.id);
});

const mcp = (body: unknown, token = w.tokens.claude) =>
  fetch(`${TEST_BASE_URL}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const defectCall = (id: number, title: string) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name: "submit_defect_report", arguments: { title, description: "Found while testing batches.", module_ids: ["MOD-FX-ALPHA"], base_rev: 1 } },
});

async function myProposalTitles(token: string): Promise<string[]> {
  const res = await api<{ proposals: { title: string }[] }>("/api/v1/tools/list_my_proposals", { token });
  return res.body.proposals.map((p) => p.title);
}

async function auditRequestIds(): Promise<(string | null)[]> {
  const client = await admin();
  try {
    return (await client.query<{ request_id: string | null }>("select request_id from hq.audit_log")).rows.map((r) => r.request_id);
  } finally {
    await client.end();
  }
}

describe("request bodies are capped at HQ_MAX_BODY_BYTES (api-4)", () => {
  const big = JSON.stringify({ x: "a".repeat(2 * 1024 * 1024) });

  it("a 2 MB body to a read tool is refused with 413, even for a read-only token", async () => {
    const res = await api<ErrorBody>("/api/v1/tools/list_sources", { token: w.tokens.claudeReadOnly, body: big });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("payload_too_large");
  });

  it("the same body sent chunked, with no Content-Length, is refused too", async () => {
    const bytes = new TextEncoder().encode(big);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 65_536) controller.enqueue(bytes.subarray(i, i + 65_536));
        controller.close();
      },
    });
    const res = await fetch(`${TEST_BASE_URL}/api/v1/tools/list_sources`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${w.tokens.claudeReadOnly}` },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
    expect(((await res.json()) as ErrorBody).error.code).toBe("payload_too_large");
  });

  it("an MCP request over the limit is refused with 413 and a JSON-RPC error", async () => {
    const res = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_sources", arguments: { pad: "a".repeat(2 * 1024 * 1024) } } });
    expect(res.status).toBe(413);
    const body = (await res.json()) as Rpc;
    expect(body.error).toMatchObject({ code: -32600, data: { code: "payload_too_large", status: 413 } });
  });

  it("a proposal just over the limit is refused and nothing is written", async () => {
    const before = await worldState();
    const res = await api<ErrorBody>("/api/v1/tools/submit_change_proposal", {
      token: w.tokens.claude,
      body: { title: "Huge", rationale: "r".repeat(1_048_577), base_rev: 1, target: { type: "requirement", id: "FR-FX-004", base_version: 1 }, set: { interpretation: "x" } },
    });
    expect(res.status).toBe(413);
    expect(await worldState()).toEqual(before);
  });

  it("a normal 10 KB request still works", async () => {
    const res = await api("/api/v1/tools/search_records", { token: w.tokens.claude, body: { query: "alpha", types: ["module"] } });
    expect(res.status).toBe(200);
    const padded = await mcp({ jsonrpc: "2.0", id: 1, method: "ping", params: { _meta: { pad: "p".repeat(10_000) } } });
    expect(padded.status).toBe(200);
  });
});

describe("MCP batches: each message stands alone (api-3, D9)", () => {
  it("a null in a batch gets its own -32600 answer; the call before it still reports its proposal id", async () => {
    const res = await mcp([defectCall(1, "Batch defect before a null"), null]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Rpc[];
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe(1);
    expect(body[0].result?.isError).toBe(false);
    expect((body[0].result?.structuredContent as { proposal: { id: string } }).proposal.id).toMatch(/^PROP-/);
    expect(body[1]).toMatchObject({ id: null, error: { code: -32600 } });
    expect((await myProposalTitles(w.tokens.claude)).filter((t) => t === "Batch defect before a null")).toHaveLength(1);
  });

  it("a malformed message in the middle does not stop the ones after it", async () => {
    const res = await mcp([{ jsonrpc: "2.0", id: "a", method: "ping" }, 7, "x", [], { jsonrpc: "1.0", id: "b", method: "ping" }, { jsonrpc: "2.0", id: "c", method: "ping" }]);
    const body = (await res.json()) as Rpc[];
    expect(body.map((m) => [m.id, m.error?.code ?? "ok"])).toEqual([
      ["a", "ok"],
      [null, -32600],
      [null, -32600],
      [null, -32600],
      ["b", -32600],
      ["c", "ok"],
    ]);
  });

  it.each([
    ["null", "null"],
    ["a number", "1"],
    ["a batch of one number", "[1]"],
    ["a string", '"ping"'],
  ])("a body that is %s gets -32600, never an empty 500 or 202", async (_label, body) => {
    const res = await mcp(body);
    expect(res.status).not.toBe(500);
    expect(res.status).not.toBe(202);
    const parsed = (await res.json()) as Rpc | Rpc[];
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    expect(first.error?.code).toBe(-32600);
  });

  it("an empty batch, and one of more than 50 messages, are refused with -32600 and run nothing", async () => {
    const empty = await mcp([]);
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as Rpc).error?.code).toBe(-32600);
    const before = await worldState();
    const tooMany = await mcp(Array.from({ length: 51 }, (_, i) => defectCall(i, `Too many ${i}`)));
    expect(((await tooMany.json()) as Rpc).error?.code).toBe(-32600);
    expect(await worldState()).toEqual(before);
  });

  it("params and arguments that are not objects are refused with -32602", async () => {
    const res = await mcp([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: ["list_sources"] },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_sources", arguments: "rev=1" } },
    ]);
    expect(((await res.json()) as Rpc[]).map((m) => m.error?.code)).toEqual([-32602, -32602]);
  });
});

describe("MCP: a tool the credential may not call is a clear JSON-RPC error (docs-10)", () => {
  it("a read-only token calling an inbox tool gets -32602 naming the missing scope, with REST's code in data", async () => {
    const before = await worldState();
    const res = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "submit_defect_report", arguments: { title: "x x x", description: "x x x", module_ids: ["MOD-FX-ALPHA"], base_rev: 1 } } }, w.tokens.claudeReadOnly);
    const body = (await res.json()) as Rpc;
    expect(body.error?.code).toBe(-32602);
    expect(body.error?.message).toMatch(/not available to this credential: it needs the "propose" scope/);
    expect(body.error?.data).toEqual({ code: "forbidden", status: 403, required_scope: "propose" });
    const rest = await api<ErrorBody>("/api/v1/tools/submit_defect_report", { token: w.tokens.claudeReadOnly, body: { title: "x x x", description: "x x x", module_ids: ["MOD-FX-ALPHA"], base_rev: 1 } });
    expect([rest.status, rest.body.error.code]).toEqual([403, "forbidden"]);
    expect(await worldState()).toEqual(before);
  });

  it("an unknown tool gets -32602 with not_found", async () => {
    const body = (await (await mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "review_proposal", arguments: {} } })).json()) as Rpc;
    expect(body.error).toMatchObject({ code: -32602, data: { code: "not_found", status: 404 } });
    expect(body.error?.message).toMatch(/Unknown tool "review_proposal"/);
  });
});

describe("GET arguments are coerced by the tool's schema, not by their text (api-7)", () => {
  it("searching for the words false and true works", async () => {
    for (const word of ["false", "true"]) {
      const res = await api<ErrorBody>(`/api/v1/tools/search_records?query=${word}`, { token: w.tokens.claude });
      expect(res.status, word).toBe(200);
    }
  });

  it("a string filter called true is a string, and a boolean filter still works", async () => {
    const module = await api<ErrorBody & { data: { total: number } }>("/api/v1/tools/search_founder_requirements?module=true", { token: w.tokens.claude });
    expect(module.status).toBe(200);
    expect(module.body.data.total).toBe(0);
    const outstanding = await api<{ data: { filter: { outstanding: boolean } } }>("/api/v1/tools/search_founder_requirements?outstanding=true", { token: w.tokens.claude });
    expect(outstanding.status).toBe(200);
    expect(outstanding.body.data.filter.outstanding).toBe(true);
  });
});

describe("tools refuse arguments they do not take; inbox answers are envelopes (docs-3, D17)", () => {
  it.each(["get_recent_changes", "list_my_proposals"])("%s refuses rev with 422 instead of answering at head", async (name) => {
    for (const res of [
      await api<ErrorBody>(`/api/v1/tools/${name}?rev=1`, { token: w.tokens.claude }),
      await api<ErrorBody>(`/api/v1/tools/${name}`, { token: w.tokens.claude, body: { rev: 1 } }),
    ]) {
      expect(res.status).toBe(422);
      expect(res.body.error.message).toBe(`${name} does not take the argument "rev".`);
    }
    const viaMcp = (await (await mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { rev: 1 } } })).json()) as Rpc;
    expect(viaMcp.result?.isError).toBe(true);
    expect(viaMcp.result?.structuredContent).toMatchObject({ error: { code: "invalid_request", status: 422 } });
  });

  it("every read tool that takes rev refuses a revision that does not exist", async () => {
    const tools = (await api<{ tools: { name: string; mode: string; input_schema: { properties?: Record<string, unknown> } }[] }>("/api/v1/tools", { token: w.tokens.claude })).body.tools;
    const args: Record<string, Record<string, unknown>> = {
      get_module_brief: { module: "MOD-FX-ALPHA" },
      get_learning_loop: { loop_id: "LOOP-FX-01" },
      get_acceptance_status: { type: "build", id: "BLD-FX-01" },
      get_source_lineage: { type: "build", id: "BLD-FX-01" },
      get_development_dependencies: { type: "build", id: "BLD-FX-01" },
      get_record: { type: "build", id: "BLD-FX-01" },
      search_records: { query: "alpha" },
    };
    const reads = tools.filter((t) => t.mode === "read");
    expect(reads.filter((t) => !t.input_schema.properties?.rev).map((t) => t.name).sort()).toEqual(["get_recent_changes", "list_my_proposals"]);
    for (const tool of reads.filter((t) => t.input_schema.properties?.rev)) {
      const res = await api<ErrorBody>(`/api/v1/tools/${tool.name}`, { token: w.tokens.claude, body: { ...(args[tool.name] ?? {}), rev: 999 } });
      expect(res.status, tool.name).toBe(404);
    }
  });

  it("an unknown argument is refused rather than silently dropped", async () => {
    const res = await api<ErrorBody>("/api/v1/tools/get_module_brief", { token: w.tokens.claude, body: { module: "MOD-FX-ALPHA", modul: "typo" } });
    expect(res.status).toBe(422);
    expect(res.body.error.detail).toEqual(["modul: not an argument of get_module_brief"]);
  });

  it("list_my_proposals answers in the standard envelope", async () => {
    const res = await api<{ hq: { authority: string }; revision: { rev: number; is_head: boolean }; requested_by: { handle: string }; data: { proposals: unknown[] } }>(
      "/api/v1/tools/list_my_proposals",
      { token: w.tokens.chatgpt },
    );
    expect(res.status).toBe(200);
    expect(res.body.hq.authority).toBe("prototype_non_authoritative");
    expect(res.body.revision.is_head).toBe(true);
    expect(res.body.requested_by.handle).toBe("chatgpt");
    expect(res.body.data.proposals).toEqual([]);
  });
});

describe("request ids (api-8, D5, F6)", () => {
  it("a malformed X-Request-Id is replaced by a server id, in the answer and in the audit log", async () => {
    for (const forged of ["forged id with spaces", "x".repeat(80)]) {
      for (const token of [w.tokens.claude, undefined]) {
        const res = await api("/api/v1/whoami", { token, headers: { "x-request-id": forged } });
        const id = res.headers.get("x-request-id")!;
        expect(id).not.toBe(forged);
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect(await auditRequestIds()).toContain(id);
      }
      expect(await auditRequestIds()).not.toContain(forged);
      expect((await auditRequestIds()).some((r) => r !== null && forged.startsWith(r))).toBe(false);
    }
  });

  // Changed in the second round (F6): the client's well-formed id used to become the request id, so one
  // client could give its request another request's id in the audit log (the api-8 reproduction).
  it("a well-formed client id is never the request id: it is echoed apart and kept as the client's id", async () => {
    const first = await api("/api/v1/whoami", { token: w.tokens.claude, headers: { "x-request-id": "client-run-42.a" } });
    expect(first.status).toBe(200);
    const serverId = first.headers.get("x-request-id")!;
    expect(serverId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.headers.get("x-client-request-id")).toBe("client-run-42.a");
    expect(await auditRequestIds()).toContain(serverId);
    expect(await auditRequestIds()).not.toContain("client-run-42.a");

    // Another client, and an anonymous caller, send the first request's server id: neither gets it.
    for (const token of [w.tokens.chatgpt, undefined]) {
      const replay = await api<ErrorBody>("/api/v1/whoami", { token, headers: { "x-request-id": serverId } });
      const id = replay.headers.get("x-request-id")!;
      expect(id).not.toBe(serverId);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(replay.headers.get("x-client-request-id")).toBe(serverId);
      if (token === undefined) {
        expect(replay.status).toBe(401);
        expect(replay.body.error.request_id).toBe(id);
      }
    }
    const client = await admin();
    try {
      const rows = await client.query<{ principal_handle: string | null; outcome: string; detail: Record<string, unknown> | null }>(
        "select principal_handle, outcome, detail from hq.audit_log where request_id = $1 order by id",
        [serverId],
      );
      expect(rows.rows.map((r) => [r.principal_handle, r.outcome])).toEqual([["claude", "allowed"]]);
      // The allowed row keeps the id the client sent too, apart from the request id.
      expect(rows.rows[0].detail).toEqual({ client_request_id: "client-run-42.a" });
      // The refusal keeps the id the client sent, apart from the request id.
      const denied = await client.query<{ request_id: string; detail: Record<string, unknown> }>(
        "select request_id, detail from hq.audit_log where principal_id is null and detail ->> 'client_request_id' = $1",
        [serverId],
      );
      expect(denied.rows).toHaveLength(1);
      expect(denied.rows[0].request_id).not.toBe(serverId);
    } finally {
      await client.end();
    }
  });
});

describe("live look-ups need a signed-in person (D17, docs-5)", () => {
  it("an API token gets the configuration status, and its look-up is refused without asking anyone", async () => {
    for (const token of [w.tokens.claude, w.tokens.claudeReadOnly, w.tokens.developer]) {
      for (const query of ["github=example-org/example-repo&ref=main", "drive_file=1AbCdEfGhIjKlMnOp"]) {
        const res = await api<{ github: { configured: boolean }; lookup: { ok: boolean; reason: string } }>(`/api/v1/integrations?${query}`, { token });
        expect(res.status).toBe(200);
        expect(res.body.github.configured).toBe(false);
        expect(res.body.lookup).toMatchObject({ ok: false, reason: "forbidden" });
      }
    }
  });

  it("a reader's session cannot trigger a look-up either", async () => {
    const res = await api<{ lookup: { reason: string } }>("/api/v1/integrations?drive_file=1AbCdEfGhIjKlMnOp", { cookie: await sessionCookie(w.reader.id) });
    expect(res.body.lookup.reason).toBe("forbidden");
  });

  it("a founder's or developer's session reaches the adapter, which reports itself not configured", async () => {
    for (const cookie of [founderCookie, developerCookie]) {
      const res = await api<{ lookup: { ok: boolean; reason: string } }>("/api/v1/integrations?drive_file=1AbCdEfGhIjKlMnOp", { cookie });
      expect(res.body.lookup).toMatchObject({ ok: false, reason: "not_configured" });
    }
  });
});

describe("linked ids in a proposal must exist; outstanding counts only verified evidence (honesty-6)", () => {
  it.each([
    ["linked_evidence_ids", ["EV-NOPE-01"]],
    ["linked_evidence_ids", ["BLD-FX-01"]],
    ["linked_build_ids", ["BLD-NOPE-01"]],
    ["decision_ids", ["FD-NOPE-01"]],
  ])("a proposal setting %s to %j is refused with 422 and nothing is written", async (field, ids) => {
    const before = await worldState();
    const update = await api<ErrorBody>("/api/v1/tools/submit_change_proposal", {
      token: w.tokens.claude,
      body: { title: "Dangling link", rationale: "x x x", base_rev: 1, target: { type: "requirement", id: "FR-FX-003", base_version: 1 }, set: { [field]: ids } },
    });
    expect(update.status).toBe(422);
    expect(update.body.error.message).toContain(`${field} ${ids[0]}`);
    expect(await worldState()).toEqual(before);
  });

  it("a requirement linked only to an unverified submission stays outstanding", async () => {
    const submitted = await api<{ proposal: { id: string } }>("/api/v1/tools/record_test_evidence", {
      token: w.tokens.claude,
      body: { title: "My tests pass", result_summary: "All green on my machine.", module_ids: ["MOD-FX-ALPHA"], base_rev: 1 },
    });
    const filed = await api<{ result: { record_id: string; resulting_rev: number } }>(`/api/v1/proposals/${submitted.body.proposal.id}/review`, { cookie: founderCookie, body: { decision: "accept" } });
    expect(filed.status).toBe(200);
    const evidenceId = filed.body.result.record_id;
    const rev = filed.body.result.resulting_rev;

    const link = await api<{ proposal: { id: string } }>("/api/v1/tools/submit_change_proposal", {
      token: w.tokens.claude,
      body: {
        title: "Mark FR-FX-003 tested",
        rationale: "The submitted run covers it.",
        base_rev: rev,
        target: { type: "requirement", id: "FR-FX-003", base_version: 1 },
        set: { implementation_state: "implemented_tested", linked_evidence_ids: [evidenceId] },
      },
    });
    expect(link.status).toBe(200);
    expect((await api(`/api/v1/proposals/${link.body.proposal.id}/review`, { cookie: founderCookie, body: { decision: "accept" } })).status).toBe(200);

    type Outstanding = { data: { requirements: { id: string; has_linked_evidence: boolean; reasons: string[]; test_evidence: { unverified: string[] } }[] } };
    const res = await api<Outstanding>("/api/v1/tools/find_outstanding_requirements", { token: w.tokens.chatgpt });
    const row = res.body.data.requirements.find((r) => r.id === "FR-FX-003");
    expect(row).toBeDefined();
    expect(row!.has_linked_evidence).toBe(false);
    expect(row!.test_evidence.unverified).toEqual([evidenceId]);
    expect(row!.reasons).toContain("linked evidence is only an unverified submission");
    const search = await api<{ data: { requirements: { id: string; outstanding: boolean }[] } }>("/api/v1/tools/search_founder_requirements?module=MOD-FX-ALPHA", { token: w.tokens.chatgpt });
    const flags = Object.fromEntries(search.body.data.requirements.map((r) => [r.id, r.outstanding]));
    expect(flags["FR-FX-003"]).toBe(true);
    expect(flags["FR-FX-001"]).toBe(false);
    // Control: FR-FX-001 is implemented and tested with source-reported evidence, so it is not outstanding.
    expect(res.body.data.requirements.map((r) => r.id)).not.toContain("FR-FX-001");
  });
});
