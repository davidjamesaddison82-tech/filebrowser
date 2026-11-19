import { describe, expect, it } from "vitest";
import { ANONYMOUS_PER_LANE, ANONYMOUS_TOTAL, DEVICE_PER_LANE, DEVICE_PER_NAME, MAX_DELAY_MS, SignInThrottle } from "@/lib/auth/throttle";

/**
 * F5: no queue, bounded work, and a lane for browsers that have signed in before. The sign-in action
 * and the device cookie are exercised over HTTP in tests/api/sign-in.test.ts.
 */

/** A deferred attempt: it runs (counts as in progress) until settled by hand. */
function held() {
  let settle!: (outcome: "success" | "failure") => void;
  const outcome = new Promise<"success" | "failure">((resolve) => (settle = resolve));
  return { attempt: async () => ({ outcome: await outcome, value: null }), settle: (o: "success" | "failure") => settle(o) };
}

/** A throttle whose sleeps are recorded and advance a fake clock without waiting. */
function throttleWithClock() {
  let clock = 5_000_000;
  const sleeps: number[] = [];
  const throttle = new SignInThrottle({
    baseDelayMs: 500,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  const fail = (lane: Parameters<SignInThrottle["run"]>[0]) => throttle.run(lane, async () => ({ outcome: "failure" as const, value: false }));
  const succeed = (lane: Parameters<SignInThrottle["run"]>[0]) => throttle.run(lane, async () => ({ outcome: "success" as const, value: true }));
  return { throttle, sleeps, fail, succeed };
}

describe("sign-in lanes (F5)", () => {
  it("wrong attempts in the anonymous lane do not slow down a device lane for the same name", async () => {
    const { throttle, fail, succeed } = throttleWithClock();
    for (let i = 0; i < 12; i += 1) await fail("founder");
    expect(throttle.failures("founder")).toBe(12);
    const device = { name: "founder", device: "AAAAAAAAAAAAAAAAAAAAAA" };
    expect(throttle.failures(device)).toBe(0);
    const ok = await succeed(device);
    expect(ok).toEqual({ busy: false, value: true, waitedMs: 0 });
    // The device lane's success does not clear the anonymous lane, which an attacker is filling.
    expect(throttle.failures("founder")).toBe(12);
  });

  it("each device has its own lane, and a device lane is per name", async () => {
    const { throttle, fail } = throttleWithClock();
    const a = { name: "founder", device: "aaaaaaaaaaaaaaaaaaaaaa" };
    for (let i = 0; i < 6; i += 1) await fail(a);
    expect(throttle.failures(a)).toBe(6);
    expect(throttle.failures({ name: "founder", device: "bbbbbbbbbbbbbbbbbbbbbb" })).toBe(0);
    expect(throttle.failures({ name: "developer", device: a.device })).toBe(0);
    expect(throttle.failures("founder")).toBe(0);
  });

  it("the anonymous lane is keyed on the lower-cased name", async () => {
    const { throttle, fail } = throttleWithClock();
    for (let i = 0; i < 3; i += 1) await fail("FOUNDER");
    await fail({ name: "Founder" });
    expect(throttle.failures("founder")).toBe(4);
  });
});

describe("each attempt waits on its own (F5)", () => {
  it("the delay is min(8000, base x 2^(failures - 5)) from the lane's count when the attempt starts", async () => {
    const { sleeps, fail } = throttleWithClock();
    for (let i = 0; i < 11; i += 1) await fail("reader");
    expect(sleeps).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
  });

  it("with wrong attempts held open, the right passphrase is answered after one delay, not after theirs", async () => {
    // Ten failures already counted: every attempt now waits the full 8 s (scaled down 400 times here).
    const realSleeps: number[] = [];
    const sleepy = new SignInThrottle({
      baseDelayMs: 500,
      sleep: async (ms) => {
        realSleeps.push(ms);
        await new Promise((r) => setTimeout(r, ms / 400)); // 8000 ms -> 20 ms
      },
    });
    for (let i = 0; i < 10; i += 1) await sleepy.run("founder", async () => ({ outcome: "failure" as const, value: false }));
    const holds = Array.from({ length: 20 }, () => held());
    const flood = holds.map((h) => sleepy.run("founder", h.attempt));
    const started = Date.now();
    const right = await sleepy.run({ name: "founder", device: "cccccccccccccccccccccc" }, async () => ({ outcome: "success" as const, value: "ok" }));
    expect(right).toEqual({ busy: false, value: "ok", waitedMs: 0 });
    // Without a device cookie: refused at once (the name's four places are taken), never queued.
    const anonymous = await sleepy.run("founder", async () => ({ outcome: "success" as const, value: "ok" }));
    expect(anonymous).toEqual({ busy: true });
    expect(Date.now() - started).toBeLessThan(1000);
    for (const h of holds) h.settle("failure");
    const settled = await Promise.all(flood);
    expect(settled.filter((r) => !r.busy)).toHaveLength(ANONYMOUS_PER_LANE);
    expect(settled.filter((r) => r.busy)).toHaveLength(20 - ANONYMOUS_PER_LANE);
    // The four that ran each waited one maximum delay, from the same starting count.
    expect(settled.filter((r) => !r.busy).map((r) => (r.busy ? 0 : r.waitedMs))).toEqual([MAX_DELAY_MS, MAX_DELAY_MS, MAX_DELAY_MS, MAX_DELAY_MS]);
    expect(realSleeps.slice(5)).toEqual([MAX_DELAY_MS, MAX_DELAY_MS, MAX_DELAY_MS, MAX_DELAY_MS]);
  });

  it("a success clears the lane; failures are counted when they are known", async () => {
    const { throttle, fail } = throttleWithClock();
    for (let i = 0; i < 5; i += 1) await fail("developer");
    const one = held();
    const two = held();
    const first = throttle.run("developer", one.attempt);
    const second = throttle.run("developer", two.attempt);
    // Both started at five failures; neither outcome is known yet.
    expect(throttle.failures("developer")).toBe(5);
    one.settle("failure");
    await first;
    expect(throttle.failures("developer")).toBe(6);
    two.settle("success");
    await second;
    expect(throttle.failures("developer")).toBe(0);
  });
});

describe("bounded work (F5)", () => {
  it("at most four attempts in progress per name, refused at once without running the check", async () => {
    const { throttle } = throttleWithClock();
    const holds = Array.from({ length: ANONYMOUS_PER_LANE }, () => held());
    const running = holds.map((h) => throttle.run("founder", h.attempt));
    let checked = false;
    const extra = await throttle.run("founder", async () => {
      checked = true;
      return { outcome: "success" as const, value: null };
    });
    expect(extra).toEqual({ busy: true });
    expect(checked).toBe(false);
    // A refusal is not a failure.
    expect(throttle.failures("founder")).toBe(0);
    // Another name is not affected by this one's cap.
    expect((await throttle.run("reader", async () => ({ outcome: "success" as const, value: null }))).busy).toBe(false);
    for (const h of holds) h.settle("failure");
    await Promise.all(running);
    // Once they finish, the name takes attempts again.
    expect((await throttle.run("founder", async () => ({ outcome: "failure" as const, value: null }))).busy).toBe(false);
    expect(throttle.inProgress).toEqual({ anonymous: 0, device: 0 });
  });

  it("at most twelve anonymous attempts in progress in all", async () => {
    const { throttle } = throttleWithClock();
    const holds = Array.from({ length: ANONYMOUS_TOTAL }, () => held());
    const running = holds.map((h, i) => throttle.run(`name-${i % 4}-${i}`, h.attempt));
    expect(throttle.inProgress.anonymous).toBe(ANONYMOUS_TOTAL);
    expect(await throttle.run("someone-else", async () => ({ outcome: "success" as const, value: null }))).toEqual({ busy: true });
    // The device lanes have their own budget, so a flood of anonymous attempts does not refuse them.
    expect((await throttle.run({ name: "founder", device: "dddddddddddddddddddddd" }, async () => ({ outcome: "success" as const, value: null }))).busy).toBe(false);
    for (const h of holds) h.settle("failure");
    await Promise.all(running);
  });

  it("at most two attempts in progress per device, and four over all the devices of one name", async () => {
    const { throttle } = throttleWithClock();
    const lane = (i: number, name = "founder") => ({ name, device: `${String(i).padStart(2, "0")}${"e".repeat(20)}` });
    const ok = async () => ({ outcome: "success" as const, value: null });
    expect([DEVICE_PER_LANE, DEVICE_PER_NAME]).toEqual([2, 4]);
    const own = Array.from({ length: DEVICE_PER_LANE }, () => held());
    const ownRunning = own.map((h) => throttle.run(lane(0), h.attempt));
    expect(await throttle.run(lane(0), ok)).toEqual({ busy: true });
    // A second device of the same name has room, up to four for the name in all.
    const others = Array.from({ length: DEVICE_PER_NAME - DEVICE_PER_LANE }, () => held());
    const othersRunning = others.map((h, i) => throttle.run(lane(i + 1), h.attempt));
    expect(throttle.inProgress.device).toBe(DEVICE_PER_NAME);
    expect(await throttle.run(lane(50), ok)).toEqual({ busy: true });
    // The name is compared without regard to case, like the lanes themselves.
    expect(await throttle.run(lane(51, "FOUNDER"), ok)).toEqual({ busy: true });
    // The anonymous lanes keep their own budget.
    expect((await throttle.run("founder", ok)).busy).toBe(false);
    for (const h of [...own, ...others]) h.settle("failure");
    await Promise.all([...ownRunning, ...othersRunning]);
    expect(throttle.inProgress).toEqual({ anonymous: 0, device: 0 });
    // Once they finish, the name has room again.
    expect((await throttle.run(lane(50), ok)).busy).toBe(false);
  });

  it("device attempts of other names never refuse a name: there is no cap shared between people", async () => {
    // An account holder who has collected device cookies of their own holds as many attempts open as
    // the caps allow, for many accounts at once. The founder's returning browser is still served.
    const { throttle } = throttleWithClock();
    const ok = async () => ({ outcome: "success" as const, value: null });
    const holds: ReturnType<typeof held>[] = [];
    const running: Promise<unknown>[] = [];
    for (let person = 0; person < 30; person += 1) {
      for (let device = 0; device < 2; device += 1) {
        for (let n = 0; n < DEVICE_PER_LANE; n += 1) {
          const h = held();
          holds.push(h);
          running.push(throttle.run({ name: `reader-${person}`, device: `${String(device)}${"r".repeat(21)}` }, h.attempt));
        }
      }
    }
    expect(throttle.inProgress.device).toBe(30 * DEVICE_PER_NAME);
    // Each of those names is full …
    expect(await throttle.run({ name: "reader-0", device: `9${"r".repeat(21)}` }, ok)).toEqual({ busy: true });
    // … and the founder, on a device of their own, is not refused and does not wait.
    expect(await throttle.run({ name: "founder", device: "f".repeat(22) }, ok)).toEqual({ busy: false, value: null, waitedMs: 0 });
    for (const h of holds) h.settle("failure");
    await Promise.all(running);
    expect(throttle.inProgress).toEqual({ anonymous: 0, device: 0 });
  });

  it("an attempt that throws still frees its place", async () => {
    const { throttle } = throttleWithClock();
    await expect(throttle.run("founder", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(throttle.inProgress).toEqual({ anonymous: 0, device: 0 });
  });

  it("tracks at most 10,000 lanes", async () => {
    const { throttle, fail } = throttleWithClock();
    for (let i = 0; i < 10_050; i += 1) await fail(`n${i}`);
    expect(throttle.size).toBe(10_000);
  });
});

describe("a lane never holds what the client chose to send (G7, round 3)", () => {
  it("a name longer than 64 characters is refused as busy: no lane, no attempt, no failure counted", async () => {
    const { throttle } = throttleWithClock();
    let ran = 0;
    const attempt = async () => {
      ran += 1;
      return { outcome: "failure" as const, value: false };
    };
    for (const name of ["m".repeat(65), "M".repeat(900_000), `${"x".repeat(64)}y`]) {
      expect(await throttle.run(name, attempt)).toEqual({ busy: true });
      expect(await throttle.run({ name, device: "AAAAAAAAAAAAAAAAAAAAAA" }, attempt)).toEqual({ busy: true });
    }
    expect(ran).toBe(0);
    expect(throttle.size).toBe(0);
    expect(throttle.inProgress).toEqual({ anonymous: 0, device: 0 });
  });

  it("a name that becomes longer than 64 characters when lower-cased is refused too", async () => {
    const { throttle } = throttleWithClock();
    // "İ" (U+0130) lower-cases to two code units, so 40 of them make an 80-character key.
    expect(await throttle.run("İ".repeat(40), async () => ({ outcome: "failure" as const, value: false }))).toEqual({ busy: true });
    expect(throttle.size).toBe(0);
  });

  it("a device id longer than 64 characters is refused, whatever the caller passes", async () => {
    const { throttle } = throttleWithClock();
    expect(await throttle.run({ name: "founder", device: "d".repeat(65) }, async () => ({ outcome: "success" as const, value: true }))).toEqual({ busy: true });
    expect(throttle.size).toBe(0);
  });

  it("names of exactly 64 characters still get a lane", async () => {
    const { throttle, fail } = throttleWithClock();
    const result = await fail("n".repeat(64));
    expect(result.busy).toBe(false);
    expect(throttle.size).toBe(1);
    expect(throttle.failures("n".repeat(64))).toBe(1);
  });
});

describe("eviction keeps the lanes that matter (G8, round 3)", () => {
  function smallThrottle(maxNames: number) {
    let clock = 9_000_000;
    const throttle = new SignInThrottle({
      baseDelayMs: 500,
      maxNames,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    const fail = (lane: Parameters<SignInThrottle["run"]>[0]) => throttle.run(lane, async () => ({ outcome: "failure" as const, value: false }));
    return { throttle, fail, advance: (ms: number) => (clock += ms) };
  }

  it("first evicts the oldest lane with nothing in progress and fewer than five failures", async () => {
    const { throttle, fail } = smallThrottle(3);
    for (let i = 0; i < 11; i += 1) await fail("founder");
    await fail("a");
    await fail("b");
    await fail("c"); // founder is the oldest, but it is delaying a guesser: "a" goes
    expect(throttle.size).toBe(3);
    expect(throttle.failures("founder")).toBe(11);
    expect(throttle.failures("a")).toBe(0);
    expect(throttle.failures("b")).toBe(1);
    expect(throttle.failures("c")).toBe(1);
  });

  it("an expired count is evictable even at five failures or more, before a recent lane with fewer", async () => {
    const { throttle, fail, advance } = smallThrottle(2);
    for (let i = 0; i < 6; i += 1) await fail("old");
    advance(15 * 60_000 + 1);
    await fail("low");
    await fail("new");
    expect(throttle.size).toBe(2);
    expect(throttle.failures("low")).toBe(1);
    expect(throttle.failures("new")).toBe(1);
  });

  it("when every lane is at five failures or more, the oldest one with nothing in progress goes", async () => {
    const { throttle, fail } = smallThrottle(3);
    for (const name of ["a", "b", "c"]) for (let i = 0; i < 5; i += 1) await fail(name);
    await fail("d");
    expect(throttle.size).toBe(3);
    expect(throttle.failures("a")).toBe(0);
    expect(throttle.failures("b")).toBe(5);
    expect(throttle.failures("c")).toBe(5);
    expect(throttle.failures("d")).toBe(1);
  });

  it("a lane with an attempt in progress is never evicted; with no other lane to evict, a new name is refused as busy", async () => {
    const { throttle, fail } = smallThrottle(2);
    const one = held();
    const two = held();
    const p1 = throttle.run("a", one.attempt);
    const p2 = throttle.run("b", two.attempt);
    await new Promise((r) => setTimeout(r, 1));
    expect(await fail("c")).toEqual({ busy: true });
    expect(throttle.size).toBe(2);
    one.settle("failure");
    await p1;
    expect((await fail("c")).busy).toBe(false); // "a" has nothing in progress now
    expect(throttle.failures("a")).toBe(0);
    two.settle("failure");
    await p2;
    expect(throttle.failures("b")).toBe(1);
    expect(throttle.inProgress).toEqual({ anonymous: 0, device: 0 });
  });

  it("the per-lane cap and the failure count hold for a name under attack while 10,000 other names come and go", async () => {
    const { throttle, fail } = throttleWithClock();
    for (let i = 0; i < 11; i += 1) await fail("founder");
    const open = Array.from({ length: ANONYMOUS_PER_LANE }, () => held());
    const runs = open.map((h) => throttle.run("founder", h.attempt));
    await new Promise((r) => setTimeout(r, 1));
    for (let i = 0; i < 10_100; i += 1) await fail(`flush-${i}`);
    expect(throttle.size).toBe(10_000);
    expect(throttle.failures("founder")).toBe(11);
    expect(await throttle.run("founder", async () => ({ outcome: "success" as const, value: true }))).toEqual({ busy: true });
    expect(throttle.inProgress).toEqual({ anonymous: ANONYMOUS_PER_LANE, device: 0 });
    for (const h of open) h.settle("failure");
    await Promise.all(runs);
    expect(throttle.failures("founder")).toBe(11 + ANONYMOUS_PER_LANE);
    // And with nothing in progress, the founder's count still survives another flush of fresh names.
    for (let i = 0; i < 10_100; i += 1) await fail(`again-${i}`);
    expect(throttle.failures("founder")).toBe(11 + ANONYMOUS_PER_LANE);
    expect(throttle.inProgress).toEqual({ anonymous: 0, device: 0 });
  });

  it("counters return to zero when evictions and completions interleave", async () => {
    let clock = 1;
    const throttle = new SignInThrottle({ maxNames: 4, now: () => clock, sleep: async (ms) => void (clock += ms) });
    const opened: { settle: (o: "success" | "failure") => void; run: Promise<unknown> }[] = [];
    const open = (lane: Parameters<SignInThrottle["run"]>[0]) => {
      const h = held();
      opened.push({ settle: h.settle, run: throttle.run(lane, h.attempt) });
    };
    open("a");
    open({ name: "b", device: "BBBBBBBBBBBBBBBBBBBBBB" });
    await throttle.run("x1", async () => ({ outcome: "failure" as const, value: null }));
    await throttle.run("x2", async () => ({ outcome: "failure" as const, value: null }));
    open("c"); // evicts x1
    opened[0].settle("failure");
    await opened[0].run;
    open({ name: "d", device: "DDDDDDDDDDDDDDDDDDDDDD" }); // evicts x2 or a
    open("e"); // evicts whatever has nothing in progress
    expect(throttle.size).toBeLessThanOrEqual(4);
    expect(throttle.inProgress).toEqual({ anonymous: 2, device: 2 });
    for (const o of opened.slice(1)) o.settle("success");
    await Promise.all(opened.map((o) => o.run));
    expect(throttle.inProgress).toEqual({ anonymous: 0, device: 0 });
    // The per-name device count is back to zero too: four device attempts for "b" are admitted again.
    const four = [held(), held(), held(), held()];
    const devices = ["B1".padEnd(22, "x"), "B2".padEnd(22, "x")];
    const runs = four.map((h, i) => throttle.run({ name: "b", device: devices[i % 2] }, h.attempt));
    await new Promise((r) => setTimeout(r, 1));
    expect(throttle.inProgress.device).toBe(4);
    for (const h of four) h.settle("failure");
    await Promise.all(runs);
    expect(throttle.inProgress).toEqual({ anonymous: 0, device: 0 });
  });
});
