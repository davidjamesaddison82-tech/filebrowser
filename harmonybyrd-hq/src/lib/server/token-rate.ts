/**
 * Per-token rate limit for the REST API and the MCP endpoint (HB-HQ-HOST-P1).
 *
 * Each API token has a bucket of BURST requests that refills at RATE per minute. A request that finds
 * the bucket empty is refused with 429 and a Retry-After of the seconds until one request is
 * available again. On MCP, every message in a batch costs one request, so a batch of 50 cannot slip
 * past a burst of 30 (a batch larger than the burst is refused outright: send smaller batches). Founder sessions (people at the screens) are not limited here; sign-in has its
 * own throttle.
 *
 * Settings: HQ_TOKEN_RATE_PER_MINUTE (default 120) and HQ_TOKEN_BURST (default 30); 0 for either turns
 * the limit off, which is meant only for tests. The bucket lives in the server's memory, per process:
 * a restart refills every bucket, and several server processes would each have their own. At most
 * MAX_TRACKED tokens are tracked; the least recently used is forgotten first (it then starts full,
 * which is the cautious-enough failure for a single-founder deployment with a handful of tokens).
 *
 * A refusal is written to the audit log at most once per token per minute (`rateLimitAuditDue`), so a
 * client hammering HQ cannot fill the log; the row says how many were refused since the last one.
 */

export const DEFAULT_RATE_PER_MINUTE = 120;
export const DEFAULT_BURST = 30;
export const MAX_TRACKED = 10_000;
const MINUTE_MS = 60_000;

export interface RateSettings {
  ratePerMinute: number;
  burst: number;
}

export function rateSettingsFromEnv(env: Record<string, string | undefined> = process.env): RateSettings {
  const read = (name: string, fallback: number) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : fallback;
  };
  return { ratePerMinute: read("HQ_TOKEN_RATE_PER_MINUTE", DEFAULT_RATE_PER_MINUTE), burst: read("HQ_TOKEN_BURST", DEFAULT_BURST) };
}

interface Bucket {
  tokens: number;
  at: number;
  refusedSinceAudit: number;
  lastAuditAt: number;
}

export type RateDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number; refusedSinceAudit: number; tooLarge?: boolean };

export class TokenRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly settings: RateSettings,
    private readonly now: () => number = Date.now,
    private readonly maxTracked = MAX_TRACKED,
  ) {}

  get enabled(): boolean {
    return this.settings.ratePerMinute > 0 && this.settings.burst > 0;
  }

  get size(): number {
    return this.buckets.size;
  }

  /** Take `cost` requests from the token's bucket, or refuse without taking any. */
  take(key: string, cost = 1): RateDecision {
    if (!this.enabled) return { allowed: true, remaining: Number.POSITIVE_INFINITY };
    const { ratePerMinute, burst } = this.settings;
    const now = this.now();
    let b = this.buckets.get(key);
    if (b) this.buckets.delete(key);
    else b = { tokens: burst, at: now, refusedSinceAudit: 0, lastAuditAt: 0 };
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) * ratePerMinute) / MINUTE_MS);
    b.at = now;
    this.buckets.set(key, b);
    while (this.buckets.size > this.maxTracked) this.buckets.delete(this.buckets.keys().next().value as string);

    const need = Math.max(1, cost);
    if (b.tokens >= need) {
      b.tokens -= need;
      return { allowed: true, remaining: Math.floor(b.tokens) };
    }
    b.refusedSinceAudit += 1;
    // A request costing more than the whole burst can never pass: say so through tooLarge.
    if (need > burst) return { allowed: false, retryAfterSeconds: Math.ceil(MINUTE_MS / 1000), refusedSinceAudit: b.refusedSinceAudit, tooLarge: true };
    const retryAfterSeconds = Math.max(1, Math.ceil(((need - b.tokens) * MINUTE_MS) / ratePerMinute / 1000));
    return { allowed: false, retryAfterSeconds, refusedSinceAudit: b.refusedSinceAudit };
  }

  /** True at most once per token per minute: whether this refusal should be written to the audit log. Resets the count. */
  rateLimitAuditDue(key: string): { due: boolean; refused: number } {
    const b = this.buckets.get(key);
    if (!b) return { due: true, refused: 1 };
    const now = this.now();
    if (now - b.lastAuditAt < MINUTE_MS) return { due: false, refused: b.refusedSinceAudit };
    const refused = b.refusedSinceAudit;
    b.lastAuditAt = now;
    b.refusedSinceAudit = 0;
    return { due: true, refused };
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __hqTokenRateLimiter: TokenRateLimiter | undefined;
}

/** The process-wide limiter. */
export function tokenRateLimiter(): TokenRateLimiter {
  return (globalThis.__hqTokenRateLimiter ??= new TokenRateLimiter(rateSettingsFromEnv()));
}
