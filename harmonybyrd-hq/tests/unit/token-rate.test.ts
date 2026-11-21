import { describe, expect, it } from "vitest";
import { DEFAULT_BURST, DEFAULT_RATE_PER_MINUTE, rateSettingsFromEnv, TokenRateLimiter } from "@/lib/server/token-rate";

/** HB-HQ-HOST-P1: the per-token rate limit for API tokens (REST and MCP). */
function limiter(ratePerMinute: number, burst: number, maxTracked?: number) {
  let clock = 1_000_000;
  const l = new TokenRateLimiter({ ratePerMinute, burst }, () => clock, maxTracked);
  return { l, advance: (ms: number) => (clock += ms) };
}

describe("per-token rate limit", () => {
  it("allows the burst, then refuses with the seconds until one request is available", () => {
    const { l } = limiter(60, 5);
    for (let i = 0; i < 5; i += 1) expect(l.take("t1").allowed).toBe(true);
    const refused = l.take("t1");
    expect(refused).toMatchObject({ allowed: false, retryAfterSeconds: 1 });
  });

  it("refills at the configured rate per minute", () => {
    const { l, advance } = limiter(60, 3);
    for (let i = 0; i < 3; i += 1) l.take("t1");
    expect(l.take("t1").allowed).toBe(false);
    advance(1_000); // one request per second at 60 a minute
    expect(l.take("t1").allowed).toBe(true);
    expect(l.take("t1").allowed).toBe(false);
    advance(10 * 60_000); // never more than the burst, however long the pause
    for (let i = 0; i < 3; i += 1) expect(l.take("t1").allowed).toBe(true);
    expect(l.take("t1").allowed).toBe(false);
  });

  it("keeps each token's bucket separate", () => {
    const { l } = limiter(60, 2);
    l.take("a");
    l.take("a");
    expect(l.take("a").allowed).toBe(false);
    expect(l.take("b").allowed).toBe(true);
  });

  it("charges a batch its full cost, and refuses a batch larger than the burst outright", () => {
    const { l } = limiter(60, 10);
    expect(l.take("t", 8)).toMatchObject({ allowed: true, remaining: 2 });
    expect(l.take("t", 3).allowed).toBe(false); // 2 left, 3 asked: nothing taken
    expect(l.take("t", 2)).toMatchObject({ allowed: true, remaining: 0 });
    const { l: l2 } = limiter(60, 10);
    expect(l2.take("t", 11)).toMatchObject({ allowed: false, tooLarge: true });
    expect(l2.take("t", 10).allowed).toBe(true); // the refused batch took nothing
  });

  it("audits a refusal at most once a minute per token, with the count since the last row", () => {
    const { l, advance } = limiter(60, 1);
    l.take("t");
    for (let i = 0; i < 4; i += 1) l.take("t");
    expect(l.rateLimitAuditDue("t")).toEqual({ due: true, refused: 4 });
    l.take("t");
    expect(l.rateLimitAuditDue("t").due).toBe(false);
    advance(60_000);
    for (let i = 0; i < 3; i += 1) l.take("t");
    expect(l.rateLimitAuditDue("t")).toMatchObject({ due: true });
  });

  it("tracks a bounded number of tokens", () => {
    const { l } = limiter(60, 1, 100);
    for (let i = 0; i < 1_000; i += 1) l.take(`t${i}`);
    expect(l.size).toBe(100);
  });

  it("reads its settings from the environment; 0 turns it off; nonsense falls back to the defaults", () => {
    expect(rateSettingsFromEnv({})).toEqual({ ratePerMinute: DEFAULT_RATE_PER_MINUTE, burst: DEFAULT_BURST });
    expect(rateSettingsFromEnv({ HQ_TOKEN_RATE_PER_MINUTE: "30", HQ_TOKEN_BURST: "5" })).toEqual({ ratePerMinute: 30, burst: 5 });
    expect(rateSettingsFromEnv({ HQ_TOKEN_RATE_PER_MINUTE: "-1", HQ_TOKEN_BURST: "lots" })).toEqual({ ratePerMinute: DEFAULT_RATE_PER_MINUTE, burst: DEFAULT_BURST });
    const off = new TokenRateLimiter(rateSettingsFromEnv({ HQ_TOKEN_RATE_PER_MINUTE: "0" }));
    expect(off.enabled).toBe(false);
    for (let i = 0; i < 1_000; i += 1) expect(off.take("t").allowed).toBe(true);
  });
});
