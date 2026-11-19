import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_NEXT_LENGTH, safeNext } from "@/lib/auth/safe-next";
import { MAX_HANDLE_LENGTH, MAX_PASSPHRASE_LENGTH, tooLongSignInInput } from "@/lib/auth/sign-in-input";
import { baseDelayFromEnv, delayFor, SignInThrottle, signInThrottle } from "@/lib/auth/throttle";

// The sign-in action is run here with its outside world replaced, so the test can see what it touches.
const touched = vi.hoisted(() => ({ cookies: 0, headers: 0, lookups: 0, passphraseChecks: 0, audits: [] as Record<string, unknown>[] }));
vi.mock("next/headers", () => ({
  cookies: async () => {
    touched.cookies += 1;
    return { get: () => undefined, set: () => undefined, delete: () => undefined };
  },
  headers: async () => {
    touched.headers += 1;
    return new Headers();
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("@/lib/auth/authenticate", () => ({
  authenticatePassphrase: async () => {
    touched.passphraseChecks += 1;
    return null;
  },
  authenticateSessionToken: async () => null,
  loginPrincipalId: async () => {
    touched.lookups += 1;
    return null;
  },
}));
vi.mock("@/lib/server/db", () => ({
  audit: async (_claims: unknown, event: Record<string, unknown>) => {
    touched.audits.push(event);
  },
  writeAs: async () => undefined,
}));

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

describe("the sign-in form has a maximum name and passphrase length (G7, round 3)", () => {
  const form = (handle: string, passphrase: string) => {
    const fd = new FormData();
    fd.append("handle", handle);
    fd.append("passphrase", passphrase);
    fd.append("next", "/");
    return fd;
  };
  beforeEach(() => {
    Object.assign(touched, { cookies: 0, headers: 0, lookups: 0, passphraseChecks: 0, audits: [] });
    globalThis.__hqSignInThrottle = new SignInThrottle({ sleep: async () => undefined });
  });

  it("the limits: 41 characters of name (the database's handle check), 1,024 of passphrase", () => {
    expect(MAX_HANDLE_LENGTH).toBe(41);
    expect(MAX_PASSPHRASE_LENGTH).toBe(1024);
    expect(tooLongSignInInput("a".repeat(41), "p".repeat(1024))).toBeNull();
    expect(tooLongSignInInput("a".repeat(42), "p")).toEqual({ field: "name", length: 42 });
    expect(tooLongSignInInput("a", "p".repeat(1025))).toEqual({ field: "passphrase", length: 1025 });
    // Lower-casing can lengthen a name: 30 x "İ" is 30 characters typed, 60 once lower-cased.
    expect(tooLongSignInInput("İ".repeat(30), "p")).toEqual({ field: "name", length: 30 });
  });

  it.each([
    ["a 900 KB name", "M".repeat(900_000), "x"],
    ["a 42-character name", "a".repeat(42), "x"],
    ["a 65-character name with spaces round it", `  ${"n".repeat(65)}  `, "x"],
    ["a 2,000-character passphrase", "founder", "p".repeat(2000)],
  ])("%s is answered 'do not match' at once: no lane, no look-up, no passphrase check, no cookie read", async (_label, handle, passphrase) => {
    const { signIn } = await import("@/app/sign-in/actions");
    const before = signInThrottle().size;
    expect(await signIn(undefined, form(handle, passphrase))).toEqual({ error: "That name and passphrase do not match." });
    expect(signInThrottle().size).toBe(before);
    expect(signInThrottle().inProgress).toEqual({ anonymous: 0, device: 0 });
    expect(touched).toMatchObject({ cookies: 0, headers: 0, lookups: 0, passphraseChecks: 0 });
    // Audited with the length, never the value.
    expect(touched.audits).toHaveLength(1);
    const row = JSON.stringify(touched.audits[0]);
    expect(row.length).toBeLessThan(300);
    expect(touched.audits[0]).toMatchObject({ action: "session.sign_in", outcome: "denied" });
    const field = passphrase.length > 1024 ? "passphrase" : "name";
    expect(touched.audits[0].detail).toEqual({ reason: `${field}_too_long`, [`${field}_length`]: (field === "name" ? handle.trim() : passphrase).length });
    expect(row).not.toContain(field === "name" ? handle.trim() : passphrase);
  });

  it("a name and passphrase within the limits still go through the throttle and the passphrase check", async () => {
    const { signIn } = await import("@/app/sign-in/actions");
    expect(await signIn(undefined, form("a".repeat(41), "p".repeat(1024)))).toEqual({ error: "That name and passphrase do not match." });
    expect(touched.passphraseChecks).toBe(1);
    expect(signInThrottle().size).toBe(1);
    expect(signInThrottle().failures("a".repeat(41))).toBe(1);
  });
});

describe("the next parameter has a maximum length (G7 class, round 3)", () => {
  it("a path longer than 2,048 characters falls back to /", () => {
    expect(MAX_NEXT_LENGTH).toBe(2048);
    const ok = `/${"a".repeat(2047)}`;
    expect(safeNext(ok)).toBe(ok);
    expect(safeNext(`/${"a".repeat(2048)}`)).toBe("/");
    expect(safeNext(`/${"a".repeat(1_000_000)}`)).toBe("/");
  });
});
