import type { ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, freshWorld, type TestWorld } from "../helpers/db";
import { TEST_PORT } from "../helpers/env";
import { startServer } from "../helpers/server";

/**
 * HB-HQ-HOST-P1: the per-token rate limit, over real HTTP, on a server of its own with a small limit
 * (burst 5, 60 a minute). The shared test server runs with the limit off.
 */
const PORT = TEST_PORT + 5;
const BASE = `http://127.0.0.1:${PORT}`;
let w: TestWorld;
let hq: ChildProcess | null = null;

beforeAll(async () => {
  w = await freshWorld();
  hq = await startServer(PORT, { HQ_TOKEN_RATE_PER_MINUTE: "60", HQ_TOKEN_BURST: "5" });
}, 120_000);

afterAll(() => {
  hq?.kill("SIGTERM");
});

const rest = (token: string) => fetch(`${BASE}/api/v1/whoami`, { headers: { authorization: `Bearer ${token}` } });
const mcp = (token: string, body: unknown) =>
  fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });
const ping = (id: number) => ({ jsonrpc: "2.0", id, method: "ping" });

async function rateRows(handle: string) {
  const c = await admin();
  try {
    return (
      await c.query<{ action: string; detail: { code?: string; refused_since_last_row?: number } }>(
        "select action, detail from hq.audit_log where principal_handle = $1 and detail->>'code' = 'rate_limited' order by id",
        [handle],
      )
    ).rows;
  } finally {
    await c.end();
  }
}

describe("per-token rate limit (REST and MCP)", () => {
  it("REST: the burst passes, the next call is 429 with Retry-After and a clear error; another token is unaffected", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await rest(w.tokens.claudeReadOnly)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200]);
    const refused = await rest(w.tokens.claudeReadOnly);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(refused.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const body = (await refused.json()) as { error: { code: string; detail: { retry_after_seconds: number } } };
    expect(body.error.code).toBe("rate_limited");
    // Another token has its own bucket.
    expect((await rest(w.tokens.chatgpt)).status).toBe(200);
  });

  it("REST: the bucket refills (one call a second at 60 a minute)", async () => {
    await new Promise((r) => setTimeout(r, 1_200));
    expect((await rest(w.tokens.claudeReadOnly)).status).toBe(200);
    expect((await rest(w.tokens.claudeReadOnly)).status).toBe(429);
  });

  it("MCP: each message of a batch counts; a batch beyond what is left is refused with 429 and nothing runs", async () => {
    const ok = await mcp(w.tokens.claude, [ping(1), ping(2), ping(3)]);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as unknown[]).length).toBe(3);
    const refused = await mcp(w.tokens.claude, [ping(4), ping(5), ping(6)]); // 2 left, 3 asked
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).not.toBeNull();
    const body = (await refused.json()) as { error: { code: number; data: { code: string } } };
    expect(body.error).toMatchObject({ code: -32000, data: { code: "rate_limited" } });
  });

  it("MCP: a batch larger than the whole burst is refused outright, saying to send smaller batches", async () => {
    const refused = await mcp(w.tokens.developer, [ping(1), ping(2), ping(3), ping(4), ping(5), ping(6)]);
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toMatch(/smaller batches/);
    expect((await mcp(w.tokens.developer, ping(7))).status).toBe(200); // the refused batch took nothing
  });

  it("refusals reach the audit log at most once a minute per token, with a count", async () => {
    for (let i = 0; i < 10; i += 1) await rest(w.tokens.claudeReadOnly);
    const rows = await rateRows("claude");
    // claude's read-only token and claude's propose token are two tokens of one principal: at most one row each per minute.
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeLessThanOrEqual(2);
    expect(rows.every((r) => typeof r.detail.refused_since_last_row === "number")).toBe(true);
  });

  it("a founder session in the browser is not rate-limited by this mechanism", async () => {
    // Sessions are people at the screens; sign-in has its own throttle. Asserted on the code path:
    // enforceTokenRate returns at once for any principal that did not authenticate with an API token.
    const { enforceTokenRate } = await import("@/lib/server/http");
    const session = { ...w.founder, amr: "session" as const };
    for (let i = 0; i < 50; i += 1) await expect(enforceTokenRate(session, 1, "api.whoami", "r")).resolves.toBeUndefined();
  });
});
