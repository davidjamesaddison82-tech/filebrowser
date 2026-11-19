/**
 * Sign-in throttle: a growing delay per lane, a bound on the work in progress, never a lock-out.
 *
 * Lanes. Every attempt belongs to one lane, and the delay and the failure count are the lane's:
 *   - the anonymous lane of a name (lower-cased), for a browser that has not signed in as that name before;
 *   - a device lane, name + device id, for a browser carrying a valid device cookie (device.ts) for the
 *     principal of that name. Wrong attempts from elsewhere never touch it, so a flood against a known
 *     name does not slow down a browser that person has signed in from before.
 * The client's address is not part of any key: without a proxy HQ trusts, X-Forwarded-For is whatever
 * the client chose to send, so keying on it would let a guesser rotate it for unlimited attempts.
 *
 * Attempts do not queue behind one another (a queue let N open wrong attempts hold the right passphrase
 * for N × 8 s). Each attempt waits on its own, min(MAX_DELAY, base × 2^(failures − FREE_FAILURES)) ms
 * from its lane's failure count when it starts, then is checked. Failures are counted when they are
 * known; a success clears the lane; a count expires after WINDOW_MS without attempts.
 *
 * Bounded work. At most ANONYMOUS_PER_LANE attempts are in progress per name (ANONYMOUS_TOTAL in all),
 * and DEVICE_PER_LANE per device (DEVICE_PER_NAME over all the devices of one name). An attempt past a
 * cap is refused at once, without a passphrase check. Unknown names take the anonymous lane exactly like
 * known ones, so neither the delay nor a refusal says which names exist.
 *
 * Bounded memory. A lane's key never holds more than MAX_LANE_NAME_LENGTH characters of name (and of
 * device id): a longer one is refused as busy without creating anything, so no client can make the
 * table hold data of its choosing (the sign-in action refuses long names before this, G7). At most
 * MAX_LANES lanes are tracked. When a new lane needs room, the one forgotten is (G8), in this order:
 * the least recently used lane with nothing in progress and either fewer than FREE_FAILURES failures
 * or an expired count; otherwise the least recently used lane with nothing in progress. A lane with an
 * attempt in progress is never forgotten; if every lane has one, the new attempt is refused as busy.
 * So flushing the table with fresh names does not reset the count of a name under attack: to push such
 * a lane out, every other lane must be holding FREE_FAILURES failures too.
 *
 * The device lanes have no cap shared between names, on purpose. A device lane exists only for a valid
 * device cookie of that name's principal, so the work is bounded by principals × DEVICE_PER_NAME. A cap
 * shared by everyone would let any account holder, with device cookies of their own, fill it and have
 * every other person's returning browser refused.
 */

export const FREE_FAILURES = 5;
export const MAX_DELAY_MS = 8000;
export const DEFAULT_BASE_DELAY_MS = 500;
export const WINDOW_MS = 15 * 60_000;
export const MAX_LANES = 10_000;
/** The longest name (and device id) a lane is kept for; longer ones are refused as busy (G7). */
export const MAX_LANE_NAME_LENGTH = 64;

export const ANONYMOUS_PER_LANE = 4;
export const ANONYMOUS_TOTAL = 12;
export const DEVICE_PER_LANE = 2;
export const DEVICE_PER_NAME = 4;

export type AttemptOutcome = "success" | "failure" | "error";

/** Which lane an attempt runs in: the name's anonymous lane, or the lane of one device for that name. */
export interface Lane {
  name: string;
  /** The device id from a valid device cookie for the principal of `name`; absent for the anonymous lane. */
  device?: string | null;
}

export interface ThrottleOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  windowMs?: number;
  /** How many lanes are tracked at most. */
  maxNames?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface Entry {
  failures: number;
  last: number;
  /** Attempts of this lane that have started and not yet finished. */
  inProgress: number;
}

export type ThrottleResult<T> = { busy: false; value: T; waitedMs: number } | { busy: true };

/** The wait before an attempt, given the consecutive failures already recorded. */
export function delayFor(failures: number, baseDelayMs = DEFAULT_BASE_DELAY_MS, maxDelayMs = MAX_DELAY_MS): number {
  if (failures < FREE_FAILURES) return 0;
  return Math.min(maxDelayMs, baseDelayMs * 2 ** (failures - FREE_FAILURES));
}

/** The map key of a lane. The separator cannot occur in a device id (base64url), so keys cannot collide. */
function laneKey(lane: Lane): string {
  const name = lane.name.toLowerCase();
  return lane.device ? `d:${lane.device}:${name}` : `a:${name}`;
}

function asLane(lane: Lane | string): Lane {
  return typeof lane === "string" ? { name: lane } : lane;
}

export class SignInThrottle {
  private readonly entries = new Map<string, Entry>();
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly windowMs: number;
  private readonly maxLanes: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private anonymousInProgress = 0;
  private deviceInProgress = 0;
  /** Device attempts in progress per lower-cased name, over all of that name's devices. */
  private readonly deviceByName = new Map<string, number>();

  constructor(options: ThrottleOptions = {}) {
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? MAX_DELAY_MS;
    this.windowMs = options.windowMs ?? WINDOW_MS;
    this.maxLanes = options.maxNames ?? MAX_LANES;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Lanes currently tracked (for tests and diagnostics). */
  get size(): number {
    return this.entries.size;
  }

  /** Attempts in progress, anonymous and device (for tests and diagnostics). */
  get inProgress(): { anonymous: number; device: number } {
    return { anonymous: this.anonymousInProgress, device: this.deviceInProgress };
  }

  /** Consecutive failures recorded for a lane (0 once expired). A string is the name's anonymous lane. */
  failures(lane: Lane | string): number {
    const entry = this.entries.get(laneKey(asLane(lane)));
    if (!entry || this.now() - entry.last > this.windowMs) return 0;
    return entry.failures;
  }

  /**
   * Run one sign-in attempt in `lane`: refused at once ({ busy: true }) when that lane already has its
   * maximum in progress, or (anonymous) all anonymous lanes together do, or (device) all the devices of
   * that name together do; otherwise after the delay the lane's failure count calls for. An "error"
   * outcome (e.g. the database is down) is not a failure.
   */
  async run<T>(laneOrName: Lane | string, attempt: () => Promise<{ outcome: AttemptOutcome; value: T }>): Promise<ThrottleResult<T>> {
    const lane = asLane(laneOrName);
    const device = !!lane.device;
    // Measured after lower-casing, which can lengthen a string ("İ" becomes two code units).
    const name = lane.name.toLowerCase();
    if (name.length > MAX_LANE_NAME_LENGTH || (lane.device?.length ?? 0) > MAX_LANE_NAME_LENGTH) return { busy: true };
    const perLane = device ? DEVICE_PER_LANE : ANONYMOUS_PER_LANE;
    const key = laneKey(lane);
    const current = this.entries.get(key);
    if ((current?.inProgress ?? 0) >= perLane) return { busy: true };
    if (device ? (this.deviceByName.get(name) ?? 0) >= DEVICE_PER_NAME : this.anonymousInProgress >= ANONYMOUS_TOTAL) return { busy: true };
    if (!current && !this.makeRoom()) return { busy: true };

    const entry = this.touch(key);
    entry.inProgress += 1;
    this.adjust(device, name, 1);
    try {
      if (this.now() - entry.last > this.windowMs) entry.failures = 0;
      entry.last = this.now();
      const wait = delayFor(entry.failures, this.baseDelayMs, this.maxDelayMs);
      if (wait > 0) await this.sleep(wait);
      const result = await attempt();
      entry.last = this.now();
      if (result.outcome === "success") entry.failures = 0;
      else if (result.outcome === "failure") entry.failures += 1;
      return { busy: false, value: result.value, waitedMs: wait };
    } finally {
      entry.inProgress -= 1;
      this.adjust(device, name, -1);
    }
  }

  private adjust(device: boolean, name: string, by: number): void {
    if (!device) {
      this.anonymousInProgress += by;
      return;
    }
    this.deviceInProgress += by;
    const next = (this.deviceByName.get(name) ?? 0) + by;
    if (next > 0) this.deviceByName.set(name, next);
    else this.deviceByName.delete(name);
  }

  /**
   * Make room for one new lane, if the table is full, by forgetting one (see the order at the top of
   * this file). False when every lane has an attempt in progress: nothing may be forgotten then.
   */
  private makeRoom(): boolean {
    if (this.entries.size < this.maxLanes) return true;
    const now = this.now();
    let fallback: string | undefined;
    // Map order is least recently used first (touch() re-inserts), so the first match is the oldest.
    for (const [key, entry] of this.entries) {
      if (entry.inProgress > 0) continue;
      if (entry.failures < FREE_FAILURES || now - entry.last > this.windowMs) {
        this.entries.delete(key);
        return true;
      }
      fallback ??= key;
    }
    if (fallback === undefined) return false;
    this.entries.delete(fallback);
    return true;
  }

  /** The entry for a lane, created if needed and moved to the most-recent end (room was made by run()). */
  private touch(key: string): Entry {
    let entry = this.entries.get(key);
    if (entry) this.entries.delete(key);
    else entry = { failures: 0, last: this.now(), inProgress: 0 };
    this.entries.set(key, entry);
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
