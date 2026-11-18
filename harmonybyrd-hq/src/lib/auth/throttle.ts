/**
 * Sign-in throttle: a growing delay per name, never a lock-out.
 *
 * Keyed on the name alone (lower-cased). The client's address is not part of the key: without a
 * proxy HQ trusts, X-Forwarded-For is whatever the client chose to send, so keying on it would let a
 * guesser rotate it for unlimited attempts, and let anyone share (and lock) the founder's bucket.
 *
 * Attempts for one name are processed one at a time. After FREE_FAILURES consecutive failures, each
 * further attempt first waits min(MAX_DELAY, base * 2^(failures - FREE_FAILURES)) ms, then is checked
 * normally: the right passphrase still signs in, so someone guessing can slow the founder down but
 * cannot keep them out. A success clears the count; a count expires after WINDOW_MS without
 * attempts. Unknown names are throttled the same way, so the delay says nothing about which names
 * exist. At most MAX_NAMES names are tracked; the least recently used is forgotten first.
 */

export const FREE_FAILURES = 5;
export const MAX_DELAY_MS = 8000;
export const DEFAULT_BASE_DELAY_MS = 500;
export const WINDOW_MS = 15 * 60_000;
export const MAX_NAMES = 10_000;

export type AttemptOutcome = "success" | "failure" | "error";

export interface ThrottleOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  windowMs?: number;
  maxNames?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface Entry {
  failures: number;
  last: number;
  /** The tail of this name's queue: the next attempt starts when it settles. */
  tail: Promise<unknown>;
}

/** The wait before an attempt, given the consecutive failures already recorded. */
export function delayFor(failures: number, baseDelayMs = DEFAULT_BASE_DELAY_MS, maxDelayMs = MAX_DELAY_MS): number {
  if (failures < FREE_FAILURES) return 0;
  return Math.min(maxDelayMs, baseDelayMs * 2 ** (failures - FREE_FAILURES));
}

export class SignInThrottle {
  private readonly entries = new Map<string, Entry>();
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly windowMs: number;
  private readonly maxNames: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ThrottleOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? MAX_DELAY_MS;
    this.windowMs = options.windowMs ?? WINDOW_MS;
    this.maxNames = options.maxNames ?? MAX_NAMES;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Names currently tracked (for tests and diagnostics). */
  get size(): number {
    return this.entries.size;
  }

  /** Consecutive failures recorded for a name (0 once expired). */
  failures(name: string): number {
    const entry = this.entries.get(name.toLowerCase());
    if (!entry || this.now() - entry.last > this.windowMs) return 0;
    return entry.failures;
  }

  /**
   * Run one sign-in attempt for `name`, after the attempts already queued for it and after the
   * delay its failure count calls for. An "error" outcome (e.g. the database is down) is not a failure.
   */
  async run<T>(name: string, attempt: () => Promise<{ outcome: AttemptOutcome; value: T }>): Promise<{ value: T; waitedMs: number }> {
    const key = name.toLowerCase();
    const entry = this.touch(key);
    const turn = entry.tail.then(async () => {
      if (this.now() - entry.last > this.windowMs) entry.failures = 0;
      const wait = delayFor(entry.failures, this.baseDelayMs, this.maxDelayMs);
      if (wait > 0) await this.sleep(wait);
      const result = await attempt();
      entry.last = this.now();
      if (result.outcome === "success") entry.failures = 0;
      else if (result.outcome === "failure") entry.failures += 1;
      return { value: result.value, waitedMs: wait };
    });
    // The queue continues whether this attempt succeeded or threw.
    entry.tail = turn.catch(() => undefined);
    return turn;
  }

  /** The entry for a name, created if needed and moved to the most-recent end; evicts the oldest. */
  private touch(key: string): Entry {
    const now = this.now();
    let entry = this.entries.get(key);
    if (entry) this.entries.delete(key);
    else entry = { failures: 0, last: now, tail: Promise.resolve() };
    this.entries.set(key, entry);
    while (this.entries.size > this.maxNames) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    return entry;
  }
}

/**
 * The base delay. HQ_SIGNIN_BASE_DELAY_MS lets tests use a shorter one, but it is read only outside
 * production or when HQ_INSECURE_COOKIES=1 marks a test server: a production install always uses the default.
 */
export function baseDelayFromEnv(env: Record<string, string | undefined> = process.env): number {
  const testServer = env.NODE_ENV !== "production" || env.HQ_INSECURE_COOKIES === "1";
  const configured = Number(env.HQ_SIGNIN_BASE_DELAY_MS);
  return testServer && Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_BASE_DELAY_MS;
}

declare global {
  // eslint-disable-next-line no-var
  var __hqSignInThrottle: SignInThrottle | undefined;
}

/** The process-wide throttle used by the sign-in action. */
export function signInThrottle(): SignInThrottle {
  return (globalThis.__hqSignInThrottle ??= new SignInThrottle({ baseDelayMs: baseDelayFromEnv() }));
}
