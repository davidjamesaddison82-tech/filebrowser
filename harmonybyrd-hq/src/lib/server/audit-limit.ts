/**
 * A bound on the audit rows that callers WITHOUT a valid identity can cause (H7, Y13).
 *
 * Anyone who can reach HQ can be refused, and every refusal used to write one audit row: thousands a
 * minute from a single script. Now, per process and per minute, at most PER_MINUTE refusals of one
 * action and reason are written in full. Past that they are only counted, and when the minute is over
 * one summary row (same action, detail.summary = true) says how many were not written.
 *
 * Signed-in callers are never limited: their rows name a principal and are what the audit log is for.
 * Memory is bounded too: at most MAX_KEYS action/reason pairs are tracked in a minute; any further pair
 * shares one overflow counter, and a minute's counters are dropped once its summary is written.
 */

export const PER_MINUTE = 120;
export const MAX_KEYS = 100;
const MINUTE_MS = 60_000;
const REASON_MAX = 40;

/** The action the summary of the overflow counter is written under. */
export const OVERFLOW_ACTION = "audit.other_refusals";
export const OVERFLOW_REASON = "other";

export interface RefusalSummary {
  action: string;
  reason: string;
  /** Refusals of this action and reason in the minute that were counted but not written. */
  notWritten: number;
  /** Start of the minute, epoch milliseconds. */
  minuteStart: number;
}

interface Counter {
  action: string;
  reason: string;
  minute: number;
  written: number;
  dropped: number;
}

export interface RefusalLimiterOptions {
  perMinute?: number;
  maxKeys?: number;
  /** Injectable clock (epoch milliseconds). */
  now?: () => number;
  /** Injectable timer used to write a minute's summaries when it ends; it must not keep the process alive. */
  schedule?: (run: () => void, delayMs: number) => void;
  /** Writes one summary row. */
  onSummary: (summary: RefusalSummary) => void | Promise<void>;
}

const defaultSchedule = (run: () => void, delayMs: number) => {
  const timer = setTimeout(run, delayMs);
  timer.unref?.();
};

export class RefusalLimiter {
  readonly perMinute: number;
  readonly maxKeys: number;
  private readonly now: () => number;
  private readonly schedule: (run: () => void, delayMs: number) => void;
  private readonly onSummary: (summary: RefusalSummary) => void | Promise<void>;
  private readonly counters = new Map<string, Counter>();
  private scheduledFor: number | null = null;

  constructor(options: RefusalLimiterOptions) {
    this.perMinute = options.perMinute ?? PER_MINUTE;
    this.maxKeys = options.maxKeys ?? MAX_KEYS;
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? defaultSchedule;
    this.onSummary = options.onSummary;
  }

  /** How many action/reason pairs are tracked now (never more than maxKeys + 1). */
  get trackedKeys(): number {
    return this.counters.size;
  }

  /** Whether this refusal is written in full (true) or only counted (false). */
  admit(action: string, reason: string): boolean {
    const now = this.now();
    this.flush(now);
    const minute = Math.floor(now / MINUTE_MS);
    const cutReason = reason.slice(0, REASON_MAX);
    let key = `${action}\u0000${cutReason}`;
    let counter = this.counters.get(key);
    if (!counter && this.counters.size >= this.maxKeys) {
      key = `${OVERFLOW_ACTION}\u0000${OVERFLOW_REASON}`;
      counter = this.counters.get(key);
      if (!counter) {
        counter = { action: OVERFLOW_ACTION, reason: OVERFLOW_REASON, minute, written: 0, dropped: 0 };
        this.counters.set(key, counter);
      }
    }
    if (!counter) {
      counter = { action, reason: cutReason, minute, written: 0, dropped: 0 };
      this.counters.set(key, counter);
    }
    if (counter.written < this.perMinute) {
      counter.written += 1;
      return true;
    }
    counter.dropped += 1;
    this.scheduleFlush(minute);
    return false;
  }

  /** Write the summary of every minute that has ended and forget its counters. */
  flush(now = this.now()): void {
    const minute = Math.floor(now / MINUTE_MS);
    for (const [key, counter] of this.counters) {
      if (counter.minute >= minute) continue;
      this.counters.delete(key);
      if (counter.dropped > 0) {
        const summary = { action: counter.action, reason: counter.reason, notWritten: counter.dropped, minuteStart: counter.minute * MINUTE_MS };
        try {
          void Promise.resolve(this.onSummary(summary)).catch(() => undefined);
        } catch {
          /* a summary that cannot be written is lost, never an error for the request */
        }
      }
    }
  }

  private scheduleFlush(minute: number): void {
    if (this.scheduledFor !== null && this.scheduledFor >= minute) return;
    this.scheduledFor = minute;
    const delay = Math.max(0, (minute + 1) * MINUTE_MS - this.now()) + 50;
    this.schedule(() => {
      if (this.scheduledFor === minute) this.scheduledFor = null;
      this.flush();
    }, delay);
  }
}

/** The reason a refusal is counted under: detail.reason, else detail.code, else "unspecified". */
export function refusalReason(detail: unknown): string {
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const d = detail as Record<string, unknown>;
    if (typeof d.reason === "string" && d.reason) return d.reason;
    if (typeof d.code === "string" && d.code) return d.code;
  }
  return "unspecified";
}

/** The detail of a summary row. */
export function summaryDetail(summary: RefusalSummary): Record<string, unknown> {
  return {
    summary: true,
    reason: summary.reason,
    not_written: summary.notWritten,
    minute_start: new Date(summary.minuteStart).toISOString(),
    note: `${summary.notWritten} more refusal(s) of callers without a valid identity in this minute were counted but not written one by one.`,
  };
}

/**
 * Whether an audit event is written in full. Only refusals from callers without a valid identity
 * (no claims) go through the limiter; every row of a signed-in caller is written.
 */
export function admitAudit(
  limiter: RefusalLimiter,
  claims: object | null,
  event: { action: string; outcome: "allowed" | "denied" | "error"; detail?: unknown },
): boolean {
  if (claims !== null || event.outcome === "allowed") return true;
  return limiter.admit(event.action, refusalReason(event.detail));
}
