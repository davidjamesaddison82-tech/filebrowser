import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshWorld, type TestWorld } from "../helpers/db";
import { TEST_BASE_URL } from "../helpers/env";
import { api, sessionCookie } from "../helpers/http";

/**
 * These tests drive HQ's MCP endpoint with the official MCP SDK client over Streamable HTTP —
 * an independent implementation of the protocol. They show protocol compatibility. They do NOT
 * show that the Claude or ChatGPT applications can connect: that needs a public HTTPS deployment.
 */
let w: TestWorld;
const clients: Client[] = [];

async function connect(name: string, token: string | null): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${TEST_BASE_URL}/api/mcp`), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(transport);
  clients.push(client);
  return client;
}

type ToolResult = { isError?: boolean; structuredContent?: Record<string, unknown>; content: { type: string; text: string }[] };
const call = (client: Client, name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as Promise<ToolResult>;

let claude: Client;
let chatgpt: Client;

beforeAll(async () => {
  w = await freshWorld();
  claude = await connect("test-client-claude", w.tokens.claude);
  chatgpt = await connect("test-client-chatgpt", w.tokens.chatgpt);
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => undefined)));
});

describe("MCP — connection and discovery", () => {
  it("completes the MCP handshake and identifies itself", () => {
    expect(claude.getServerVersion()).toMatchObject({ name: "harmonybyrd-hq" });
    expect(claude.getServerCapabilities()).toMatchObject({ tools: {} });
    expect(claude.getInstructions()).toMatch(/NON-AUTHORITATIVE PROTOTYPE/);
    expect(claude.getInstructions()).toMatch(/cannot review, accept or approve/);
  });

  it("lists every documented tool with an input schema", async () => {
    const { tools } = await claude.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      "get_ecosystem_overview", "get_module_brief", "get_learning_loop", "search_founder_requirements", "find_outstanding_requirements",
      "get_acceptance_status", "get_source_lineage", "get_development_dependencies", "submit_change_proposal", "submit_defect_report", "record_test_evidence",
    ]));
    expect(tools.every((t) => t.inputSchema.type === "object" && t.description && t.description.length > 20)).toBe(true);
    expect(tools.find((t) => t.name === "get_module_brief")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "submit_change_proposal")?.annotations?.readOnlyHint).toBe(false);
  });

  it("offers no tool that reviews, accepts, approves or decides", async () => {
    const { tools } = await claude.listTools();
    const founderActs = /^(review_proposal|accept_|approve_|record_founder_decision|record_decision|set_acceptance|issue_credential|revoke_credential)/;
    expect(tools.map((t) => t.name).filter((n) => founderActs.test(n))).toEqual([]);
    expect(tools.filter((t) => t.annotations?.readOnlyHint === false).map((t) => t.name).sort()).toEqual(["record_test_evidence", "submit_change_proposal", "submit_defect_report"]);
    await expect(call(claude, "review_proposal", { id: "PROP-000001", decision: "accept" })).rejects.toThrow(/Unknown tool/);
    await expect(call(claude, "record_founder_decision", { title: "x", exact_text: "y" })).rejects.toThrow(/Unknown tool/);
  });

  it("a read-only credential is not even shown the tools that write to the inbox", async () => {
    const readOnly = await connect("test-client-readonly", w.tokens.claudeReadOnly);
    const names = (await readOnly.listTools()).tools.map((t) => t.name);
    expect(names).toContain("get_module_brief");
    expect(names).not.toContain("submit_change_proposal");
    expect(names).not.toContain("submit_defect_report");
    expect(names).not.toContain("record_test_evidence");
    await expect(call(readOnly, "submit_defect_report", { title: "x", description: "x x x", module_ids: ["MOD-FX-ALPHA"], base_rev: 1 })).rejects.toThrow(/not available to this credential/);
  });

  it("refuses to connect without a credential, or with a bad one", async () => {
    await expect(connect("anonymous", null)).rejects.toThrow();
    await expect(connect("bad-token", "hbq_deadbeef_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).rejects.toThrow();
    const raw = await fetch(`${TEST_BASE_URL}/api/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(raw.status).toBe(401);
    expect(raw.headers.get("www-authenticate")).toMatch(/^Bearer/);
  });
});

describe("MCP — the same answers for every client", () => {
  it("returns a module brief with revision, requester and provenance", async () => {
    const res = await call(claude, "get_module_brief", { module: "MOD-FX-ALPHA" });
    expect(res.isError).toBe(false);
    const body = res.structuredContent as { data: { id: string; standing: { headline: string } }; revision: { rev: number; content_hash: string }; requested_by: { handle: string }; provenance: { sources: { id: string; sha256: string }[] } };
    expect(body.data.id).toBe("MOD-FX-ALPHA");
    expect(body.data.standing.headline).toBe("tested_not_accepted");
    expect(body.revision.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.requested_by.handle).toBe("claude");
    expect(body.provenance.sources.map((s) => s.id)).toEqual(["SRC-F01", "SRC-F02"]);
    expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent);
  });

  it("AC5 — Claude and ChatGPT pinning the same revision retrieve identical records", async () => {
    for (const [tool, args] of [
      ["get_ecosystem_overview", { rev: 1 }],
      ["get_module_brief", { module: "MOD-FX-BETA", rev: 1 }],
      ["search_founder_requirements", { query: "score", rev: 1 }],
      ["get_learning_loop", { loop_id: "LOOP-FX-01", rev: 1 }],
      ["get_source_lineage", { type: "build", id: "BLD-FX-02", rev: 1 }],
      ["find_outstanding_requirements", { rev: 1 }],
    ] as const) {
      const a = (await call(claude, tool, args)).structuredContent as { data: unknown; revision: unknown; provenance: unknown; requested_by: { handle: string } };
      const b = (await call(chatgpt, tool, args)).structuredContent as typeof a;
      expect(JSON.stringify(a.data), tool).toBe(JSON.stringify(b.data));
      expect(a.revision).toEqual(b.revision);
      expect(a.provenance).toEqual(b.provenance);
      expect([a.requested_by.handle, b.requested_by.handle]).toEqual(["claude", "chatgpt"]);
    }
  });

  it("reports tool failures as tool errors with a stable code", async () => {
    const missing = await call(claude, "get_module_brief", { module: "MOD-NOPE" });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toMatchObject({ error: { code: "not_found", status: 404 } });
    const invalid = await call(claude, "get_acceptance_status", { type: "rumour", id: "x" });
    expect(invalid.isError).toBe(true);
    expect(invalid.structuredContent).toMatchObject({ error: { code: "invalid_request" } });
  });
});

describe("MCP — proposals are isolated and revision-aware", () => {
  let proposalId: string;

  it("accepts a proposal into the inbox without changing any record", async () => {
    const res = await call(claude, "submit_change_proposal", {
      title: "Interpretation via MCP",
      rationale: "Recorded for founder review.",
      base_rev: 1,
      target: { type: "requirement", id: "FR-FX-002", base_version: 1 },
      set: { interpretation: "No numeric score is shown to the learner." },
      idempotency_key: "mcp-test-key-0001",
    });
    expect(res.isError).toBe(false);
    const body = res.structuredContent as { proposal: { id: string; status: string }; note: string };
    proposalId = body.proposal.id;
    expect(body.proposal.status).toBe("submitted");
    const record = (await call(chatgpt, "get_record", { type: "requirement", id: "FR-FX-002" })).structuredContent as { data: { record: { interpretation: unknown } }; revision: { rev: number } };
    expect(record.data.record.interpretation).toBeNull();
    expect(record.revision.rev).toBe(1);
  });

  it("ChatGPT cannot see Claude's proposal", async () => {
    const mine = (await call(claude, "list_my_proposals")).structuredContent as { proposals: { id: string }[] };
    const theirs = (await call(chatgpt, "list_my_proposals")).structuredContent as { proposals: unknown[] };
    expect(mine.proposals.map((p) => p.id)).toEqual([proposalId]);
    expect(theirs.proposals).toEqual([]);
  });

  it("refuses protected fields and stale versions, explicitly", async () => {
    const protectedField = await call(claude, "submit_change_proposal", {
      title: "Mark as satisfied", rationale: "I finished it.", base_rev: 1,
      target: { type: "requirement", id: "FR-FX-002", base_version: 1 }, set: { disposition: "satisfied" },
    });
    expect(protectedField.isError).toBe(true);
    expect(protectedField.structuredContent).toMatchObject({ error: { code: "forbidden", status: 403 } });

    const stale = await call(chatgpt, "submit_change_proposal", {
      title: "Stale edit", rationale: "x x x", base_rev: 1,
      target: { type: "requirement", id: "FR-FX-002", base_version: 5 }, set: { interpretation: "y" },
    });
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent).toMatchObject({ error: { code: "conflict", status: 409, detail: { current_version: 1, base_version: 5 } } });
  });

  it("test evidence submitted by an agent is labelled as a claim, and stays one after the founder files it", async () => {
    const res = await call(claude, "record_test_evidence", {
      title: "Full suite green", result_summary: "All tests pass; work complete.", module_ids: ["MOD-FX-ALPHA"], build_id: "BLD-FX-01",
      counts: { passed: 42, failed: 0, skipped: 0 }, base_rev: 1,
    });
    expect(res.isError).toBe(false);
    const body = res.structuredContent as { proposal: { id: string }; note: string };
    expect(body.note).toMatch(/claim, not evidence of completion/);

    const founder = await sessionCookie(w.founder.id);
    const filed = await api<{ result: { record_id: string; resulting_rev: number } }>(`/api/v1/proposals/${body.proposal.id}/review`, { cookie: founder, body: { decision: "accept" } });
    expect(filed.status).toBe(200);
    const evidence = (await call(chatgpt, "get_record", { type: "evidence", id: filed.body.result.record_id })).structuredContent as { data: { record: { verification: string; submitted_by: string } } };
    expect(evidence.data.record).toMatchObject({ verification: "agent_submitted_unverified", submitted_by: "claude" });
    const status = (await call(chatgpt, "get_acceptance_status", { type: "build", id: "BLD-FX-01" })).structuredContent as { data: { headline: string; recorded_in_hq: unknown } };
    expect(status.data).toMatchObject({ headline: "build_candidate", recorded_in_hq: null });
  });

  it("after the founder accepts, both clients see the new head and can still pin the old revision", async () => {
    const founder = await sessionCookie(w.founder.id);
    const accepted = await api<{ result: { resulting_rev: number } }>(`/api/v1/proposals/${proposalId}/review`, { cookie: founder, body: { decision: "accept" } });
    expect(accepted.status).toBe(200);
    const rev = accepted.body.result.resulting_rev;
    for (const client of [claude, chatgpt]) {
      const head = (await call(client, "get_record", { type: "requirement", id: "FR-FX-002" })).structuredContent as { data: { record: { interpretation: string } }; revision: { rev: number } };
      expect(head.revision.rev).toBe(rev);
      expect(head.data.record.interpretation).toBe("No numeric score is shown to the learner.");
      const old = (await call(client, "get_record", { type: "requirement", id: "FR-FX-002", rev: 1 })).structuredContent as { data: { record: { interpretation: unknown } }; revision: { rev: number; is_head: boolean } };
      expect(old.data.record.interpretation).toBeNull();
      expect(old.revision).toMatchObject({ rev: 1, is_head: false });
    }
  });
});

describe("MCP — AC5 once the head has moved (tests-4)", () => {
  it("both clients pinning revision 1 get revision 1, not the head, from every pinnable read tool", async () => {
    // Runs after the acceptance above, so the head is past revision 1 and an ignored rev would show.
    const head = ((await call(claude, "get_ecosystem_overview", {})).structuredContent as { revision: { rev: number } }).revision.rev;
    expect(head).toBeGreaterThan(1);
    for (const [tool, args] of [
      ["get_ecosystem_overview", { rev: 1 }],
      ["get_module_brief", { module: "MOD-FX-BETA", rev: 1 }],
      ["search_founder_requirements", { query: "score", rev: 1 }],
      ["get_learning_loop", { loop_id: "LOOP-FX-01", rev: 1 }],
      ["get_source_lineage", { type: "build", id: "BLD-FX-02", rev: 1 }],
      ["find_outstanding_requirements", { rev: 1 }],
      ["get_record", { type: "requirement", id: "FR-FX-002", rev: 1 }],
    ] as const) {
      const a = (await call(claude, tool, args)).structuredContent as { data: unknown; revision: { rev: number; is_head: boolean; head_rev: number } };
      const b = (await call(chatgpt, tool, args)).structuredContent as typeof a;
      expect(a.revision, tool).toMatchObject({ rev: 1, is_head: false, head_rev: head });
      expect(JSON.stringify(a.data), tool).toBe(JSON.stringify(b.data));
      expect(a.revision).toEqual(b.revision);
    }
    const record = (await call(chatgpt, "get_record", { type: "requirement", id: "FR-FX-002", rev: 1 })).structuredContent as { data: { record: { interpretation: unknown }; meta: { version: number } } };
    expect(record.data.record.interpretation).toBeNull();
    expect(record.data.meta.version).toBe(1);
  });
});

describe("MCP — protocol details (raw HTTP)", () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${TEST_BASE_URL}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${w.tokens.claude}`, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

  it("negotiates the protocol version", async () => {
    const supported = await (await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "raw", version: "0" } } })).json();
    expect(supported.result.protocolVersion).toBe("2025-03-26");
    const unknown = await (await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01", capabilities: {}, clientInfo: { name: "raw", version: "0" } } })).json();
    expect(unknown.result.protocolVersion).toBe("2025-11-25");
    expect((await post({ jsonrpc: "2.0", id: 2, method: "ping" }, { "mcp-protocol-version": "1999-01-01" })).status).toBe(400);
  });

  it("acknowledges notifications with 202 and answers ping", async () => {
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    expect(await (await post({ jsonrpc: "2.0", id: 7, method: "ping" })).json()).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
  });

  it("returns JSON-RPC errors for malformed and unsupported requests", async () => {
    expect((await (await post("{nope")).json()).error.code).toBe(-32700);
    expect((await (await post({ jsonrpc: "2.0", id: 3, method: "resources/list" })).json()).error.code).toBe(-32601);
    expect((await (await post({ id: 4, method: "ping" })).json()).error.code).toBe(-32600);
  });

  it("refuses a browser request from another origin, and offers no GET stream", async () => {
    const cross = await fetch(`${TEST_BASE_URL}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example", cookie: await sessionCookie(w.founder.id) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(cross.status).toBe(403);
    expect((await fetch(`${TEST_BASE_URL}/api/mcp`, { headers: { authorization: `Bearer ${w.tokens.claude}` } })).status).toBe(405);
  });
});
