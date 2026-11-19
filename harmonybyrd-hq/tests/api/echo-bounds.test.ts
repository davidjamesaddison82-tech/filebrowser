/**
 * H7 (Y11, G-unbounded): what a client sent is echoed in an error only in part. Every echoed string is
 * cut to 80 characters, and a list of unknown arguments (or of problems) shows at most 10 with a count
 * of the rest. A 1 MB argument name or id gives an answer under 4 KB, over REST and over MCP.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { freshWorld, type TestWorld } from "../helpers/db";
import { TEST_BASE_URL } from "../helpers/env";

let w: TestWorld;
beforeAll(async () => {
  w = await freshWorld();
});

const LIMIT = 4096;

async function rest(path: string, body?: string) {
  const res = await fetch(`${TEST_BASE_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${w.tokens.claude}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body,
  });
  const text = await res.text();
  return { status: res.status, size: Buffer.byteLength(text), body: JSON.parse(text) as { error: { code: string; message: string; detail?: unknown } } };
}

async function mcpCall(name: string, args: unknown) {
  const res = await fetch(`${TEST_BASE_URL}/api/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${w.tokens.claude}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  const parsed = JSON.parse(text) as { result: { isError: boolean; structuredContent: { error: { code: string; status: number; message: string; detail?: unknown } } } };
  return { status: res.status, size: Buffer.byteLength(text), error: parsed.result.structuredContent.error, isError: parsed.result.isError };
}

describe("errors echo client text only in part (H7)", () => {
  it("a 1 MB unknown argument name: 422 under 4 KB, the name cut to 80 characters", async () => {
    const key = "k".repeat(1_000_000);
    const res = await rest("/api/v1/tools/get_record", JSON.stringify({ [key]: 1 }));
    expect(res.status).toBe(422);
    expect(res.size).toBeLessThan(LIMIT);
    expect(res.body.error.message).toBe(`get_record does not take the argument "${"k".repeat(80)}…".`);
    expect(res.body.error.detail).toContain(`${"k".repeat(80)}…: not an argument of get_record`);
  });

  it("80,000 unknown arguments: at most 10 listed, with a count of the rest", async () => {
    const body = JSON.stringify(Object.fromEntries(Array.from({ length: 80_000 }, (_, i) => [`k${i}`, 1])));
    const res = await rest("/api/v1/tools/get_record", body);
    expect(res.status).toBe(422);
    expect(res.size).toBeLessThan(LIMIT);
    expect(res.body.error.message).toMatch(/^get_record does not take the arguments "k0", "k1", .*"k9" and 79990 more\.$/);
    const detail = res.body.error.detail as string[];
    expect(detail).toHaveLength(11);
    // 80,000 unknown arguments and the two required ones that are missing (type, id): 80,002 problems.
    expect(detail[10]).toBe("(79992 more problem(s) not listed)");
  });

  it("an 8 KB query-string argument name: under 4 KB", async () => {
    const res = await rest(`/api/v1/tools/list_sources?${"q".repeat(8000)}=1`);
    expect(res.status).toBe(422);
    expect(res.size).toBeLessThan(LIMIT);
    const unknownTool = await rest(`/api/v1/tools/${"z".repeat(8000)}`);
    expect(unknownTool.status).toBe(404);
    expect(unknownTool.size).toBeLessThan(LIMIT);
  });

  it("50,000 wrong values in one list argument: at most 10 problems listed", async () => {
    const res = await rest(
      "/api/v1/tools/submit_defect_report",
      JSON.stringify({ title: "Many wrong ids", description: "Each id is a number.", module_ids: Array.from({ length: 50_000 }, (_, i) => i), base_rev: 1 }),
    );
    expect(res.status).toBe(422);
    expect(res.size).toBeLessThan(LIMIT);
    expect(res.body.error.detail as string[]).toHaveLength(11);
  });

  it("over MCP, a 500 KB unknown argument name: a tool error under 4 KB", async () => {
    const res = await mcpCall("get_record", { ["k".repeat(500_000)]: 1 });
    expect(res.status).toBe(200);
    expect(res.isError).toBe(true);
    expect(res.error.status).toBe(422);
    expect(res.size).toBeLessThan(LIMIT);
  });

  it("a 900 KB record id: not found, under 4 KB, over REST and MCP", async () => {
    const id = "Q".repeat(900_000);
    const viaRest = await rest("/api/v1/tools/get_record", JSON.stringify({ type: "module", id }));
    expect(viaRest.status).toBe(404);
    expect(viaRest.size).toBeLessThan(LIMIT);
    const viaMcp = await mcpCall("get_record", { type: "module", id });
    expect(viaMcp.error.status).toBe(404);
    expect(viaMcp.size).toBeLessThan(LIMIT);
    const brief = await rest("/api/v1/tools/get_module_brief", JSON.stringify({ module: id }));
    expect(brief.status).toBe(404);
    expect(brief.size).toBeLessThan(LIMIT);
  });

  it("a 1,000-character proposal id: not found, under 4 KB", async () => {
    const res = await rest(`/api/v1/proposals/${"a".repeat(1000)}`);
    expect(res.status).toBe(404);
    expect(res.size).toBeLessThan(1500);
  });
});
