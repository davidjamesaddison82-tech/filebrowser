/**
 * A bound on the audit rows that callers WITHOUT a valid identity can cause (H7, Y13).
 *
 * Anyone who can reach HQ can be refused, and every refusal used to write one audit row: thousands a
 * minute from a single script. Now, per process and per minute, at most PER_MINUTE refusals of one
 * action and reason are written in full. Past that they are only counted, and when the minute is over
 * one summary row (same action, detail.summary = true) says how many were not written.
 *
 * Signed-in callers are never limited: their rows name a principal and are what the audit log is for.
 * Neither is a refused sign-in whose name is an existing principal's (ROUND5 K7): the caller says so
 * (admitAudit's `unlimited`), so a flood of harmless refusals cannot hide guesses at a real account.
 *
 * A summary names what it held back (ROUND5 K7): the first HELD_SHOWN distinct object ids and client
 * addresses of the refusals it did not write, each cut to 80 characters, and how many distinct ones
 * there were (counted exactly up to HELD_COUNTED; past that the count says "at least").
 *
 * Memory is bounded too: at most MAX_KEYS action/reason pairs are tracked in a minute; any further pair
 * shares one overflow counter, each counter keeps at most HELD_COUNTED distinct values of each kind, and
 * a minute's counters are dropped once its summary is written.
 */

import { cutText } from "@/lib/text";

export const PER_MINUTE = 120;
export const MAX_KEYS = 100;
/** How many distinct held-back object ids and client addresses a summary lists. */
export const HELD_SHOWN = 10;
/** How many distinct held-back values of each kind a counter remembers, to count them. */
export const HELD_COUNTED = 1000;
const HELD_MAX_CHARS = 80;
const MINUTE_MS = 60_000;
const REASON_MAX = 40;

/** The action the summary of the overflow counter is written under. */
export const OVERFLOW_ACTION = "audit.other_refusals";
export const OVERFLOW_REASON = "other";

/** What a summary says of one kind of value its held-back refusals carried. */
export interface HeldValues {
  /** The first HELD_SHOWN distinct values, in the order they came. */
  first: string[];
  /** How many distinct values there were (exact up to HELD_COUNTED). */
  distinct: number;
  /** True when there were more than HELD_COUNTED: `distinct` is then a lower bound. */
  atLeast: boolean;
}

export interface RefusalSummary {
  action: string;
  reason: string;
  /** Refusals of this action and reason in the minute that were counted but not written. */
  notWritten: number;
  /** Start of the minute, epoch milliseconds. */
  minuteStart: number;
  /** The object ids (a sign-in's name, say) of the refusals not written. */
  objectIds: HeldValues;
  /** The client addresses of the refusals not written (recorded only under HQ_TRUST_PROXY=1). */
  clientAddresses: HeldValues;
}

/** What a held-back refusal named, for its summary. */
export interface HeldBack {
  objectId?: string | null;
  clientAddress?: string | null;
}

interface Counter {
  action: string;
  reason: string;
  minute: number;
  written: number;
  dropped: number;
  objectIds: Set<string>;
  objectIdsOverflow: boolean;
  clientAddresses: Set<string>;
  clientAddressesOverflow: boolean;
}

/** A value cut to HELD_MAX_CHARS characters on code points, as well-formed text. */
const cutHeld = (value: string) => cutText(value, HELD_MAX_CHARS);

const heldValues = (set: Set<string>, overflow: boolean): HeldValues => ({ first: [...set].slice(0, HELD_SHOWN), distinct: set.size, atLeast: overflow });

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

function newCounter(action: string, reason: string, minute: number): Counter {
  return { action, reason, minute, written: 0, dropped: 0, objectIds: new Set(), objectIdsOverflow: false, clientAddresses: new Set(), clientAddressesOverflow: false };
}

function remember(counter: Counter, set: "objectIds" | "clientAddresses", overflow: "objectIdsOverflow" | "clientAddressesOverflow", value: unknown): void {
  if (typeof value !== "string" || value === "") return;
  const cut = cutHeld(value);
  if (counter[set].has(cut)) return;
  if (counter[set].size >= HELD_COUNTED) counter[overflow] = true;
  else counter[set].add(cut);
}

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

  /** Whether this refusal is written in full (true) or only counted (false); `held` is what it names, for the summary. */
  admit(action: string, reason: string, held: HeldBack = {}): boolean {
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
        counter = newCounter(OVERFLOW_ACTION, OVERFLOW_REASON, minute);
        this.counters.set(key, counter);
      }
    }
    if (!counter) {
      counter = newCounter(action, cutReason, minute);
      this.counters.set(key, counter);
    }
    if (counter.written < this.perMinute) {
      counter.written += 1;
      return true;
    }
    counter.dropped += 1;
    remember(counter, "objectIds", "objectIdsOverflow", held.objectId);
    remember(counter, "clientAddresses", "clientAddressesOverflow", held.clientAddress);
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
        const summary: RefusalSummary = {
          action: counter.action,
          reason: counter.reason,
          notWritten: counter.dropped,
          minuteStart: counter.minute * MINUTE_MS,
          objectIds: heldValues(counter.objectIds, counter.objectIdsOverflow),
          clientAddresses: heldValues(counter.clientAddresses, counter.clientAddressesOverflow),
        };
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
  const held = (v: HeldValues) => ({ first: v.first, distinct: v.distinct, ...(v.atLeast ? { distinct_is_at_least: true } : {}) });
  return {
    summary: true,
    reason: summary.reason,
    not_written: summary.notWritten,
    minute_start: new Date(summary.minuteStart).toISOString(),
    // ROUND5 K7: what the refusals not written named.
    held_back_object_ids: held(summary.objectIds),
    held_back_client_addresses: held(summary.clientAddresses),
    note:
      `${summary.notWritten} more refusal(s) of callers without a valid identity in this minute were counted but not written one by one. ` +
      `They named ${summary.objectIds.distinct}${summary.objectIds.atLeast ? " or more" : ""} distinct object id(s) and came from ` +
      `${summary.clientAddresses.distinct}${summary.clientAddresses.atLeast ? " or more" : ""} recorded client address(es); the first ${HELD_SHOWN} of each are listed. Their times and request ids are not kept.`,
  };
}

/**
 * Whether an audit event is written in full. Only refusals from callers without a valid identity
 * (no claims) go through the limiter; every row of a signed-in caller is written, and so is a refusal
 * the caller marks `unlimited` (ROUND5 K7: a refused sign-in whose name is an existing principal's).
 */
export function admitAudit(
  limiter: RefusalLimiter,
  claims: object | null,
  event: { action: string; outcome: "allowed" | "denied" | "error"; detail?: unknown; objectId?: string | null; unlimited?: boolean },
): boolean {
  if (claims !== null || event.outcome === "allowed" || event.unlimited === true) return true;
  const detail = event.detail && typeof event.detail === "object" && !Array.isArray(event.detail) ? (event.detail as Record<string, unknown>) : {};
  return limiter.admit(event.action, refusalReason(event.detail), {
    objectId: event.objectId ?? null,
    clientAddress: typeof detail.client_address === "string" ? detail.client_address : null,
  });
}
