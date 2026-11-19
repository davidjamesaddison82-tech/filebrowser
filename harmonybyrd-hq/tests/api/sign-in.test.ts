import { decodeJwt, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { signSession } from "@/lib/auth/session";
import { MAX_DELAY_MS } from "@/lib/auth/throttle";
import { admin, freshWorld, type TestWorld } from "../helpers/db";
import { TEST_BASE_URL, TEST_JWT_SECRET } from "../helpers/env";
import { api, cookiePair, postSignIn } from "../helpers/http";

/**
 * F5: sign-in attempts do not queue; each waits on its own, the work in progress is bounded, and a
 * browser that has signed in before (it holds a device cookie) has a lane of its own. The test server
 * uses a 200 ms base delay; the maximum delay is 8 s as in production.
 */
let w: TestWorld;
const BUSY = "Too many sign-in attempts are in progress. Try again in a moment.";
const WRONG = "That name and passphrase do not match.";
/** F5's bound on any answer: one maximum delay plus 3 s. */
const BOUND_MS = MAX_DELAY_MS + 3000;

beforeAll(async () => {
  w = await freshWorld();
});

/** The detail of the latest sign-in audit row for a name. */
async function lastSignInDetail(handle: string): Promise<{ outcome: string; detail: Record<string, unknown> | null }> {
  const client = await admin();
  try {
    const row = await client.query<{ outcome: string; detail: Record<string, unknown> | null }>(
      "select outcome, detail from hq.audit_log where action = 'session.sign_in' and object_id = $1 order by id desc limit 1",
      [handle],
    );
    return row.rows[0];
  } finally {
    await client.end();
  }
}

/** Sign in with the right passphrase and return the device cookie the answer sets ("hq_device=…"). */
async function deviceCookieFor(handle: keyof TestWorld["passphrases"]): Promise<string> {
  const reply = await postSignIn(handle, w.passphrases[handle]);
  expect(reply.status).toBe(303);
  return cookiePair(reply.setCookies.hq_device);
}

describe("the device cookie (F5)", () => {
  it("is set after a successful sign-in only: HttpOnly, SameSite=Lax, 180 days, and not Secure on this test server, like the session", async () => {
    const wrong = await postSignIn("developer", "not-the-passphrase");
    expect(wrong.message).toBe(WRONG);
    expect(Object.keys(wrong.setCookies)).toEqual([]);
    const unknown = await postSignIn("nobody-at-all", "not-the-passphrase");
    expect(unknown.message).toBe(WRONG);
    expect(Object.keys(unknown.setCookies)).toEqual([]);

    const ok = await postSignIn("developer", w.passphrases.developer);
    expect(ok.status).toBe(303);
    const device = ok.setCookies.hq_device;
    const session = ok.setCookies.hq_session;
    expect(device).toMatch(/; HttpOnly/i);
    expect(device).toMatch(/; SameSite=lax/i);
    expect(device).toMatch(/; Max-Age=15552000/);
    expect(device).toMatch(/; Path=\//);
    // Secure exactly as the session cookie (the test server runs with HQ_INSECURE_COOKIES=1).
    expect(/; Secure/i.test(device)).toBe(/; Secure/i.test(session));
    const claims = decodeJwt(cookiePair(device).slice("hq_device=".length));
    expect(claims).toMatchObject({ iss: "harmonybyrd-hq", typ: "device", sub: w.developer.id });
    expect(claims.did).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(claims).not.toHaveProperty("amr");

    // The same browser signing in again keeps its device id.
    const again = await postSignIn("developer", w.passphrases.developer, { cookie: cookiePair(device) });
    expect(decodeJwt(cookiePair(again.setCookies.hq_device).slice("hq_device=".length)).did).toBe(claims.did);
  });

  it("alone authenticates nothing: not a page, not a REST call, not the MCP endpoint", async () => {
    const device = await deviceCookieFor("founder");
    const page = await fetch(`${TEST_BASE_URL}/decisions`, { headers: { cookie: device }, redirect: "manual" });
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toMatch(/\/sign-in/);
    const rest = await api<{ error: { code: string } }>("/api/v1/whoami", { cookie: device });
    expect(rest.status).toBe(401);
    expect(rest.body.error.code).toBe("unauthenticated");
    const review = await api<{ error: { code: string } }>("/api/v1/decisions", { cookie: device, body: { title: "x", exact_text: "x", effects: [] } });
    expect(review.status).toBe(401);
    const mcp = await fetch(`${TEST_BASE_URL}/api/mcp`, {
      method: "POST",
      headers: { cookie: device, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(mcp.status).toBe(401);
    // Nor does its value presented as the session cookie.
    const asSession = `hq_session=${device.slice("hq_device=".length)}`;
    expect((await api("/api/v1/whoami", { cookie: asSession })).status).toBe(401);
    const asSessionPage = await fetch(`${TEST_BASE_URL}/decisions`, { headers: { cookie: asSession }, redirect: "manual" });
    expect(asSessionPage.status).toBe(307);
  });

  it("chooses the device lane only for a valid cookie of the principal of that name", async () => {
    const reader = await deviceCookieFor("reader");
    const developer = await deviceCookieFor("developer");
    const key = new TextEncoder().encode(TEST_JWT_SECRET);
    const did = decodeJwt(reader.slice("hq_device=".length)).did as string;
    const expired = await new SignJWT({ typ: "device", did })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(w.reader.id)
      .setIssuer("harmonybyrd-hq")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 200 * 86_400)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    const cases: [string, string | undefined, string][] = [
      ["the reader's own cookie", reader, "device"],
      ["no cookie", undefined, "anonymous"],
      ["another principal's cookie", developer, "anonymous"],
      ["a forged cookie", `${reader.slice(0, -4)}AAAA`, "anonymous"],
      ["an expired cookie", `hq_device=${expired}`, "anonymous"],
      ["a malformed cookie", "hq_device=not-a-token", "anonymous"],
      ["a session token in the device cookie", `hq_device=${await signSession(w.reader.id, 0)}`, "anonymous"],
    ];
    for (const [label, cookie, lane] of cases) {
      const reply = await postSignIn("reader", "not-the-passphrase", { cookie });
      expect(reply.message, label).toBe(WRONG);
      expect(await lastSignInDetail("reader"), label).toMatchObject({ outcome: "denied", detail: { lane } });
    }
    // A name that does not exist takes the anonymous lane whatever cookie is sent.
    await postSignIn("nobody-with-a-cookie", "not-the-passphrase", { cookie: reader });
    expect(await lastSignInDetail("nobody-with-a-cookie")).toMatchObject({ outcome: "denied", detail: { lane: "anonymous" } });
  });

  it("an unknown name waits exactly as a known one does", async () => {
    const seventh: Record<string, number> = {};
    for (const name of ["auditor-who-does-not-exist", "developer"]) {
      // The developer's anonymous lane was cleared by its last successful sign-in above.
      for (let i = 0; i < 6; i += 1) await postSignIn(name, `wrong-${i}`);
      seventh[name] = (await postSignIn(name, "wrong-7")).ms;
    }
    // Six failures: the seventh waits 200 x 2^1 = 400 ms first, for both.
    for (const ms of Object.values(seventh)) {
      expect(ms).toBeGreaterThanOrEqual(400);
      expect(ms).toBeLessThan(2000);
    }
  });
});

describe("a flood of wrong attempts cannot hold the right passphrase (F5, api-2, docs-1)", () => {
  it("with 20 wrong attempts held open for the founder, the founder's browser signs in at once, and no answer waits past one maximum delay + 3 s", async () => {
    const device = await deviceCookieFor("founder");
    // Eleven failures in the founder's anonymous lane: every further attempt there waits the full 8 s.
    for (let i = 0; i < 11; i += 1) expect((await postSignIn("founder", `wrong-${i}`)).message).toBe(WRONG);

    const floodStarted = Date.now();
    const flood = Array.from({ length: 20 }, (_, i) => postSignIn("founder", `flood-${i}`));
    await new Promise((r) => setTimeout(r, 1000));

    const [withDevice, without] = await Promise.all([
      postSignIn("founder", w.passphrases.founder, { cookie: device }),
      postSignIn("founder", w.passphrases.founder),
    ]);
    expect(withDevice.status).toBe(303);
    expect(withDevice.setCookies.hq_session).toBeDefined();
    expect(withDevice.ms).toBeLessThan(BOUND_MS);
    // Without the device cookie: refused, or delayed, but never kept waiting past the bound.
    expect(without.ms).toBeLessThan(BOUND_MS);
    expect(without.status === 303 || without.message === BUSY).toBe(true);

    const answers = await Promise.all(flood);
    for (const answer of answers) {
      expect([WRONG, BUSY]).toContain(answer.message);
      expect(answer.ms).toBeLessThan(BOUND_MS);
    }
    // At most four ran at once for the name; the rest were refused at once, without a passphrase check.
    expect(answers.filter((a) => a.message === WRONG).length).toBeLessThanOrEqual(4);
    expect(answers.filter((a) => a.message === BUSY).length).toBeGreaterThanOrEqual(16);
    expect(Date.now() - floodStarted).toBeLessThan(BOUND_MS + 2000);

    // The session the founder's browser got is a real one.
    expect((await api<{ role: string }>("/api/v1/whoami", { cookie: cookiePair(withDevice.setCookies.hq_session) })).body.role).toBe("founder");
  }, 90_000);
});
