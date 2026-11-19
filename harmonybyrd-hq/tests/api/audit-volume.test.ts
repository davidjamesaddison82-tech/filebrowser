/**
 * H7 (Y13, G-unbounded): refusal rows written for callers without a valid identity are bounded. Per
 * server process, at most 120 a minute per action and reason are written in full; past that, one
 * summary row per minute says how many more were refused. Signed-in callers' rows are not limited.
 * The limiter itself, with a fake clock, is tested in tests/unit/audit-limit.test.ts.
 *
 * This test waits for the end of the minute it floods (up to a minute), when the summary is written,
 * so the flood does not use up another test's budget either.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { admin, freshWorld, type TestWorld } from "../helpers/db";
import { TEST_BASE_URL } from "../helpers/env";

let w: TestWorld;
beforeAll(async () => {
  w = await freshWorld();
});

interface Row {
  id: string;
  request_id: string | null;
  principal_id: string | null;
  detail: { reason?: string; summary?: boolean; not_written?: number } | null;
  minute: string;
}

async function rowsAfter(id: string, action: string): Promise<Row[]> {
  const client = await admin();
  try {
    return (
      await client.query<Row>(
        "select id::text, request_id, principal_id::text, detail, to_char(date_trunc('minute', at), 'HH24:MI') as minute from hq.audit_log where id > $1::bigint and action = $2 order by hq.audit_log.id",
        [id, action],
      )
    ).rows;
  } finally {
    await client.end();
  }
}

async function lastId(): Promise<string> {
  const client = await admin();
  try {
    return (await client.query<{ id: string }>("select coalesce(max(id), 0)::text as id from hq.audit_log")).rows[0].id;
  } finally {
    await client.end();
  }
}

async function flood(n: number, request: () => Promise<Response>): Promise<Record<number, number>> {
  let next = 0;
  const statuses: Record<number, number> = {};
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      while (next < n) {
        next += 1;
        const res = await request();
        await res.text();
        statuses[res.status] = (statuses[res.status] ?? 0) + 1;
      }
    }),
  );
  return statuses;
}

const untilNextMinute = () => 60_000 - (Date.now() % 60_000) + 3_000;

describe("refusal rows of callers without a valid identity are bounded (H7)", () => {
  it("500 unauthenticated MCP posts leave at most 120 rows a minute in full, then one summary row with the count", async () => {
    // Start early in a minute so that the flood (a few seconds) falls in one minute.
    if (Date.now() % 60_000 > 40_000) await new Promise((r) => setTimeout(r, untilNextMinute()));
    const from = await lastId();
    const statuses = await flood(500, () =>
      fetch(`${TEST_BASE_URL}/api/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' }),
    );
    expect(statuses).toEqual({ 401: 500 });
    const during = await rowsAfter(from, "mcp.connect");
    const minutes = new Set(during.map((r) => r.minute)).size;
    expect(minutes).toBeGreaterThanOrEqual(1);
    expect(during.length).toBeLessThanOrEqual(120 * minutes);
    expect(during.every((r) => r.detail?.reason === "missing or invalid credential" && !r.detail?.summary)).toBe(true);

    // When the minute is over, one summary row per minute says how many were not written.
    await new Promise((r) => setTimeout(r, untilNextMinute()));
    const after = await rowsAfter(from, "mcp.connect");
    const full = after.filter((r) => !r.detail?.summary);
    const summaries = after.filter((r) => r.detail?.summary === true);
    expect(full.length).toBe(during.length);
    expect(summaries.length).toBeGreaterThanOrEqual(1);
    expect(summaries.length).toBeLessThanOrEqual(minutes);
    expect(after.at(-1)!.detail?.summary).toBe(true);
    for (const s of summaries) {
      expect(s.detail).toMatchObject({ summary: true, reason: "missing or invalid credential", not_written: expect.any(Number) });
      expect(s.principal_id).toBeNull();
      expect(s.request_id).toBeNull();
    }
    expect(full.length + summaries.reduce((n, s) => n + (s.detail!.not_written ?? 0), 0)).toBe(500);
    expect(after.length).toBeLessThanOrEqual(121 * minutes);
  }, 180_000);

  it("a signed-in caller's refusals are all written", async () => {
    const from = await lastId();
    // A read-only token may not propose: each call is refused (403) and audited under its principal.
    const statuses = await flood(200, () =>
      fetch(`${TEST_BASE_URL}/api/v1/tools/submit_defect_report`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${w.tokens.claudeReadOnly}` },
        body: "{}",
      }),
    );
    expect(statuses).toEqual({ 403: 200 });
    const rows = await rowsAfter(from, "tool.submit_defect_report");
    expect(rows).toHaveLength(200);
    expect(rows.every((r) => r.principal_id === w.claudeReadOnly.id && !r.detail?.summary)).toBe(true);
  }, 60_000);
});
