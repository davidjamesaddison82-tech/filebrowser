import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/auth/safe-next";
import { baseDelayFromEnv, delayFor, SignInThrottle } from "@/lib/auth/throttle";

describe("after sign-in, HQ only ever redirects to a page on HQ (api-1, ui-4)", () => {
  it.each(["/", "/requirements?x=1#h", "/a/b", "/proposals/PROP-000012#a", "/records/build/BLD-FX-01?rev=1"])("keeps %j", (path) => {
    expect(safeNext(path)).toBe(path);
  });

  it.each([
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/\t/evil.example/",
    "/\n/evil.example",
    "/\r/evil.example",
    "/./\t/evil.example",
    "/.//evil.example",
    "/x/..//evil.example",
    "/ /evil.example",
    "/ /evil.example",
    "/ /evil.example",
    "https://evil.example",
    "http:/evil.example",
    "javascript:alert(1)",
    " /x",
    "",
  ])("refuses %j", (value) => {
    expect(safeNext(value)).toBe("/");
  });

  it("refuses anything that is not a string", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext(["/x"])).toBe("/");
  });

  it("whatever it returns stays on the site, in any browser's reading", () => {
    const tricky = ["/%09/evil.example", "/%2F%2Fevil.example", "/.%2F%2Fevil.example", "/..", "/a/../../b", "/?next=//evil.example", "/#//evil.example"];
    for (const value of tricky) {
      const out = safeNext(value);
      expect(out.startsWith("/") && !out.startsWith("//"), value).toBe(true);
      expect(new URL(out, "http://127.0.0.1:3000/sign-in").origin, value).toBe("http://127.0.0.1:3000");
    }
  });
});

/** A throttle on a fake clock: sleeping advances the clock and is recorded. */
function fakeThrottle(options: { maxNames?: number } = {}) {
  let clock = 1_000_000;
  const sleeps: number[] = [];
  const throttle = new SignInThrottle({
    baseDelayMs: 500,
    maxNames: options.maxNames,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  const attempt = async (name: string, ok: boolean) => {
    const result = await throttle.run(name, async () => ({ outcome: ok ? "success" : "failure", value: ok }));
    if (result.busy) throw new Error("refused as busy");
    return result;
  };
  return { throttle, sleeps, attempt, advance: (ms: number) => (clock += ms) };
}

describe("sign-in throttle: a growing delay per name, never a lock-out (api-2, docs-1)", () => {
  it("delays follow min(8000, 500 * 2^(failures - 5)) after five failures", () => {
    expect([0, 4, 5, 6, 7, 8, 9, 10, 20].map((f) => delayFor(f))).toEqual([0, 0, 500, 1000, 2000, 4000, 8000, 8000, 8000]);
  });

  it("the right passphrase still signs in after many wrong ones, after the delay, and clears the count", async () => {
    const { throttle, sleeps, attempt } = fakeThrottle();
    for (let i = 0; i < 12; i += 1) expect((await attempt("Founder", false)).value).toBe(false);
    expect(throttle.failures("founder")).toBe(12);
    const ok = await attempt("founder", true);
    expect(ok.value).toBe(true);
    expect(ok.waitedMs).toBe(8000);
    expect(throttle.failures("founder")).toBe(0);
    expect(sleeps).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000, 8000]);
    expect((await attempt("founder", false)).waitedMs).toBe(0);
  });

  it("is keyed on the name only, so it does not spread to other names", async () => {
    const { attempt } = fakeThrottle();
    for (let i = 0; i < 7; i += 1) await attempt("nobody-at-all", false);
    expect((await attempt("reader", true)).waitedMs).toBe(0);
    expect((await attempt("NOBODY-AT-ALL", false)).waitedMs).toBe(2000);
  });

  // Changed in the second round (F5): attempts no longer queue one behind another, because the queue let
  // N open wrong attempts hold the right passphrase for N x 8 s. Each waits on its own, and at most
  // four run at once for a name (tests/unit/throttle.test.ts covers the lanes and caps).
  it("does not queue one name's attempts: parallel guesses each wait on their own, at most four at once", async () => {
    const { throttle, sleeps } = fakeThrottle();
    for (let i = 0; i < 5; i += 1) await throttle.run("developer", async () => ({ outcome: "failure" as const, value: false }));
    let running = 0;
    let most = 0;
    const slow = () =>
      throttle.run("developer", async () => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 5));
        running -= 1;
        return { outcome: "failure" as const, value: false };
      });
    const results = await Promise.all(Array.from({ length: 8 }, slow));
    expect(most).toBe(4);
    expect(results.filter((r) => r.busy)).toHaveLength(4);
    // Each of the four started from the same count (5) and waited 500 ms, not 500, 1000, 2000, 4000.
    expect(sleeps).toEqual([500, 500, 500, 500]);
    expect(throttle.failures("developer")).toBe(9);
  });

  it("counts expire after 15 minutes without attempts", async () => {
    const { throttle, attempt, advance } = fakeThrottle();
    for (let i = 0; i < 6; i += 1) await attempt("developer", false);
    advance(15 * 60_000 + 1);
    expect(throttle.failures("developer")).toBe(0);
    expect((await attempt("developer", false)).waitedMs).toBe(0);
  });

  it("a database error is not counted as a failure", async () => {
    const { throttle } = fakeThrottle();
    for (let i = 0; i < 9; i += 1) await throttle.run("founder", async () => ({ outcome: "error" as const, value: null }));
    expect(throttle.failures("founder")).toBe(0);
  });

  it("tracks a bounded number of names, forgetting the least recently used", async () => {
    const { throttle, attempt } = fakeThrottle({ maxNames: 3 });
    for (const name of ["a", "b", "c"]) await attempt(name, false);
    await attempt("a", false);
    await attempt("d", false);
    expect(throttle.size).toBe(3);
    expect(throttle.failures("b")).toBe(0);
    expect(throttle.failures("a")).toBe(2);
  });

  it("a shorter base delay can be configured only on a test server", () => {
    expect(baseDelayFromEnv({ NODE_ENV: "production", HQ_SIGNIN_BASE_DELAY_MS: "10" })).toBe(500);
    expect(baseDelayFromEnv({ NODE_ENV: "production", HQ_INSECURE_COOKIES: "1", HQ_SIGNIN_BASE_DELAY_MS: "10" })).toBe(10);
    expect(baseDelayFromEnv({ NODE_ENV: "development", HQ_SIGNIN_BASE_DELAY_MS: "10" })).toBe(10);
    expect(baseDelayFromEnv({ NODE_ENV: "development", HQ_SIGNIN_BASE_DELAY_MS: "0" })).toBe(500);
    expect(baseDelayFromEnv({ NODE_ENV: "development" })).toBe(500);
  });
});
