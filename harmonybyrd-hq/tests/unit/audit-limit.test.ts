import { describe, expect, it } from "vitest";
import {
  admitAudit,
  HELD_COUNTED,
  HELD_SHOWN,
  MAX_KEYS,
  OVERFLOW_ACTION,
  PER_MINUTE,
  RefusalLimiter,
  type RefusalSummary,
  refusalReason,
  summaryDetail,
} from "@/lib/server/audit-limit";

/**
 * H7 (Y13): refusal rows from callers without a valid identity are bounded per process — at most 120 a
 * minute per action and reason in full, then one summary row per minute with the count. The HTTP side
 * (500 unauthenticated MCP posts) is in tests/api/audit-volume.test.ts.
 */

/** A limiter on a fake clock; scheduled flushes are kept and run by hand. */
function limiterWithClock(start = Date.UTC(2026, 10, 19, 12, 0, 5)) {
  let clock = start;
  const summaries: RefusalSummary[] = [];
  const timers: { run: () => void; at: number }[] = [];
  const limiter = new RefusalLimiter({
    now: () => clock,
    schedule: (run, delayMs) => timers.push({ run, at: clock + delayMs }),
    onSummary: (s) => {
      summaries.push(s);
    },
  });
  const advance = (ms: number) => {
    clock += ms;
    for (const timer of timers.splice(0).sort((a, b) => a.at - b.at)) {
      if (timer.at <= clock) timer.run();
      else timers.push(timer);
    }
  };
  return { limiter, summaries, timers, advance, now: () => clock };
}

const ANON = null;
const SIGNED_IN = { sub: "00000000-0000-0000-0000-000000000001", role: "authenticated" };

describe("the bound on refusal rows of callers without a valid identity (H7)", () => {
  it("writes 120 in a minute in full, counts the rest, and writes one summary when the minute ends", () => {
    const { limiter, summaries, advance, now } = limiterWithClock();
    const minuteStart = Math.floor(now() / 60_000) * 60_000;
    const admitted = Array.from({ length: 500 }, () => limiter.admit("mcp.connect", "missing or invalid credential"));
    expect(PER_MINUTE).toBe(120);
    expect(admitted.filter(Boolean)).toHaveLength(120);
    expect(admitted.slice(0, 120).every(Boolean)).toBe(true);
    expect(admitted.slice(120).some(Boolean)).toBe(false);
    expect(summaries).toEqual([]);

    advance(60_000);
    // (ROUND5 K7 added what the held-back refusals named; these named nothing.)
    const none = { first: [], distinct: 0, atLeast: false };
    expect(summaries).toEqual([{ action: "mcp.connect", reason: "missing or invalid credential", notWritten: 380, minuteStart, objectIds: none, clientAddresses: none }]);
    expect(summaryDetail(summaries[0])).toMatchObject({ summary: true, reason: "missing or invalid credential", not_written: 380 });
    // The minute's counter is gone once its summary is written: the next minute starts afresh.
    expect(limiter.trackedKeys).toBe(0);
    expect(Array.from({ length: 121 }, () => limiter.admit("mcp.connect", "missing or invalid credential")).filter(Boolean)).toHaveLength(120);
  });

  it("writes one summary per minute, each with that minute's count", () => {
    const { limiter, summaries, advance } = limiterWithClock();
    for (let minute = 0; minute < 3; minute += 1) {
      for (let i = 0; i < 120 + 10 * (minute + 1); i += 1) limiter.admit("session.sign_in", "name_too_long");
      advance(60_000);
    }
    expect(summaries.map((s) => s.notWritten)).toEqual([10, 20, 30]);
    expect(new Set(summaries.map((s) => s.minuteStart)).size).toBe(3);
  });

  it("writes no summary for a minute in which nothing was held back", () => {
    const { limiter, summaries, advance, timers } = limiterWithClock();
    for (let i = 0; i < 120; i += 1) expect(limiter.admit("api.whoami", "unauthenticated")).toBe(true);
    expect(timers).toHaveLength(0);
    advance(120_000);
    limiter.flush();
    expect(summaries).toEqual([]);
  });

  it("counts each action and reason apart", () => {
    const { limiter, summaries, advance } = limiterWithClock();
    for (let i = 0; i < 130; i += 1) {
      limiter.admit("mcp.connect", "missing or invalid credential");
      limiter.admit("mcp.connect", "cross_origin");
      limiter.admit("tool.get_record", "unauthenticated");
    }
    advance(60_000);
    expect(summaries.map((s) => [s.action, s.reason, s.notWritten]).sort()).toEqual([
      ["mcp.connect", "cross_origin", 10],
      ["mcp.connect", "missing or invalid credential", 10],
      ["tool.get_record", "unauthenticated", 10],
    ]);
  });

  it("a summary is still written, at the latest on the next refusal, when the timer did not run", () => {
    const { limiter, summaries, timers, advance } = limiterWithClock();
    for (let i = 0; i < 125; i += 1) limiter.admit("mcp.connect", "x");
    timers.length = 0; // the timer is lost
    advance(60_000);
    expect(summaries).toEqual([]);
    expect(limiter.admit("mcp.connect", "x")).toBe(true);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].notWritten).toBe(5);
  });

  it("tracks at most a fixed number of action/reason pairs: further pairs share one overflow counter", () => {
    const { limiter, summaries, advance } = limiterWithClock();
    for (let i = 0; i < 5000; i += 1) limiter.admit(`tool.t${i}`, `reason ${i}`);
    expect(limiter.trackedKeys).toBeLessThanOrEqual(MAX_KEYS + 1);
    advance(60_000);
    expect(limiter.trackedKeys).toBe(0);
    // MAX_KEYS pairs had one refusal each; the other 4,900 shared the overflow counter: 120 written, the rest summed.
    expect(summaries).toEqual([expect.objectContaining({ action: OVERFLOW_ACTION, notWritten: 5000 - MAX_KEYS - 120 })]);
  });

  it("a long reason is counted under its first 40 characters", () => {
    const { limiter } = limiterWithClock();
    for (let i = 0; i < 200; i += 1) limiter.admit("mcp.connect", `${"r".repeat(40)}${"x".repeat(i)}`);
    expect(limiter.trackedKeys).toBe(1);
  });

  it("signed-in callers' rows, and allowed rows, are never limited", () => {
    const { limiter } = limiterWithClock();
    for (let i = 0; i < 1000; i += 1) {
      expect(admitAudit(limiter, SIGNED_IN, { action: "tool.get_record", outcome: "denied", detail: { code: "forbidden" } })).toBe(true);
      expect(admitAudit(limiter, SIGNED_IN, { action: "tool.get_record", outcome: "allowed" })).toBe(true);
    }
    expect(limiter.trackedKeys).toBe(0);
    const anonymous = Array.from({ length: 300 }, () => admitAudit(limiter, ANON, { action: "tool.get_record", outcome: "denied", detail: { code: "unauthenticated" } }));
    expect(anonymous.filter(Boolean)).toHaveLength(120);
    // The signed-in caller is still written in full after the anonymous budget is spent.
    expect(admitAudit(limiter, SIGNED_IN, { action: "tool.get_record", outcome: "denied", detail: { code: "unauthenticated" } })).toBe(true);
  });

  it("the reason is detail.reason, else detail.code, else unspecified", () => {
    expect(refusalReason({ reason: "cross_origin", code: "forbidden" })).toBe("cross_origin");
    expect(refusalReason({ code: "unauthenticated" })).toBe("unauthenticated");
    expect(refusalReason({ failures: 3 })).toBe("unspecified");
    expect(refusalReason(null)).toBe("unspecified");
    expect(refusalReason(["reason"])).toBe("unspecified");
  });
});

describe("ROUND5 K7 — the limiter hides nothing aimed at a real account, and a summary says what it held back", () => {
  it("a refusal marked unlimited (a sign-in naming an existing principal) is always written, also after a flood", () => {
    const { limiter } = limiterWithClock();
    for (let i = 0; i < 125; i += 1) admitAudit(limiter, ANON, { action: "session.sign_in", outcome: "denied", objectId: `nobody${i}`, detail: { reason: "no_match" } });
    // The quota for this action and reason is used up: a refusal for an unknown name is now only counted...
    expect(admitAudit(limiter, ANON, { action: "session.sign_in", outcome: "denied", objectId: "nobody-else", detail: { reason: "no_match" } })).toBe(false);
    // ...but every one for a real account is written.
    for (let i = 0; i < 4; i += 1) {
      expect(admitAudit(limiter, ANON, { action: "session.sign_in", outcome: "denied", objectId: "founder", detail: { reason: "no_match" }, unlimited: true })).toBe(true);
    }
  });

  it("a summary lists the first 10 distinct object ids and client addresses it held back, and how many there were", () => {
    const { limiter, summaries, advance } = limiterWithClock();
    for (let i = 0; i < 120; i += 1) limiter.admit("session.sign_in", "no_match", { objectId: `early${i}`, clientAddress: "10.0.0.1" });
    for (let i = 0; i < 30; i += 1) limiter.admit("session.sign_in", "no_match", { objectId: `held${i % 15}`, clientAddress: `10.0.1.${i % 3}` });
    advance(60_000);
    expect(HELD_SHOWN).toBe(10);
    expect(summaries[0]).toMatchObject({
      notWritten: 30,
      objectIds: { first: Array.from({ length: 10 }, (_, i) => `held${i}`), distinct: 15, atLeast: false },
      clientAddresses: { first: ["10.0.1.0", "10.0.1.1", "10.0.1.2"], distinct: 3, atLeast: false },
    });
    expect(summaryDetail(summaries[0])).toMatchObject({
      held_back_object_ids: { first: expect.arrayContaining(["held0", "held9"]), distinct: 15 },
      held_back_client_addresses: { first: ["10.0.1.0", "10.0.1.1", "10.0.1.2"], distinct: 3 },
    });
    expect(summaryDetail(summaries[0]).note).toMatch(/named 15 distinct object id\(s\) and came from 3 recorded client address\(es\)/);
  });

  it("each held-back value is cut to 80 characters on whole characters; past the counted number the count says at least", () => {
    const { limiter, summaries, advance } = limiterWithClock();
    for (let i = 0; i < 120; i += 1) limiter.admit("mcp.connect", "x");
    limiter.admit("mcp.connect", "x", { objectId: `${"a".repeat(79)}\u{1F600}tail` });
    for (let i = 0; i < HELD_COUNTED + 5; i += 1) limiter.admit("mcp.connect", "x", { objectId: `id${i}` });
    advance(60_000);
    const held = summaries[0].objectIds;
    expect(held.first[0]).toBe(`${"a".repeat(79)}\u{1F600}`);
    expect(held.distinct).toBe(HELD_COUNTED);
    expect(held.atLeast).toBe(true);
    expect(summaryDetail(summaries[0])).toMatchObject({ held_back_object_ids: { distinct_is_at_least: true } });
  });
});
