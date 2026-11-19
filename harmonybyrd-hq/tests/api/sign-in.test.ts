import { decodeJwt, SignJWT } from "jose";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, inject, it } from "vitest";
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

describe("the name and the passphrase have a maximum length (G7, round 3)", () => {
  /** The highest audit row id so far, to read only the rows a test writes. */
  async function lastAuditId(): Promise<number> {
    const client = await admin();
    try {
      return Number((await client.query<{ id: string }>("select coalesce(max(id), 0) as id from hq.audit_log")).rows[0].id);
    } finally {
      await client.end();
    }
  }
  async function signInRowsAfter(id: number) {
    const client = await admin();
    try {
      return (
        await client.query<{ object_id: string | null; outcome: string; detail: Record<string, unknown> | null; size: number }>(
          "select object_id, outcome, detail, length(coalesce(object_id, '') || coalesce(detail::text, '')) as size from hq.audit_log where action = 'session.sign_in' and id > $1 order by id",
          [id],
        )
      ).rows;
    } finally {
      await client.end();
    }
  }
  /** Milliseconds until a few seconds into the next minute (the audit limiter counts by minute). */
  const untilNextMinute = () => 60_000 - (Date.now() % 60_000) + 3_000;
  /** The test server's resident memory in MB, or null when it cannot be read (not Linux, no pid). */
  function serverRssMb(): number | null {
    try {
      const status = readFileSync(`/proc/${inject("serverPid")}/status`, "utf8");
      return Number(/VmRSS:\s+(\d+)/.exec(status)![1]) / 1024;
    } catch {
      return null;
    }
  }

  /** Post `count` sign-ins, 8 at a time, with names of `size` characters; the answers' messages. */
  async function longNames(count: number, size: number, tag: string): Promise<string[]> {
    let next = 0;
    const answers: string[] = [];
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (next < count) {
          const i = next++;
          answers.push((await postSignIn(`${"M".repeat(size)}${tag}${i}`, "anything")).message ?? "none");
        }
      }),
    );
    return answers;
  }

  it("500 sign-ins with 900 KB names are refused at once, create no lane, and are audited with the length only", async () => {
    // Warm the server up first, so that the measurement below is not its first use of the sign-in page.
    await longNames(50, 900_000, "warm");
    // H7: refusals of callers without a valid identity are written in full up to 120 a minute per action
    // and reason, then summed up in one row for the minute. Start in a fresh minute, so that every row
    // and every count below belongs to these 500.
    await new Promise((r) => setTimeout(r, untilNextMinute()));
    const from = await lastAuditId();
    const before = serverRssMb();
    const answers = await longNames(500, 900_000, "n");
    const after = serverRssMb();
    expect(new Set(answers)).toEqual(new Set([WRONG]));
    // A summary row can already be among them if the 500 ran into a second minute.
    const during = (await signInRowsAfter(from)).filter((row) => row.detail?.summary !== true);
    expect(during.length).toBeGreaterThanOrEqual(120);
    expect(during.length).toBeLessThanOrEqual(240); // 120 a minute; the 500 take a few seconds, at most two minutes
    for (const row of during) {
      expect(row.outcome).toBe("denied");
      expect(row.object_id).toBeNull();
      // No lane: the throttle's rows carry "failures" and "lane"; these carry the reason and the length.
      expect(row.detail).toEqual({ reason: "name_too_long", name_length: expect.any(Number) });
      expect(row.detail!.name_length).toBeGreaterThan(900_000);
      expect(row.size).toBeLessThan(100);
    }
    // When the minute is over, a summary row says how many were not written one by one: none is lost.
    await new Promise((r) => setTimeout(r, untilNextMinute()));
    const all = await signInRowsAfter(from);
    const summaries = all.filter((row) => row.detail?.summary === true);
    expect(all.length - summaries.length).toBe(during.length);
    expect(summaries.length).toBeGreaterThanOrEqual(1);
    for (const row of summaries) expect(row.detail).toMatchObject({ reason: "name_too_long", not_written: expect.any(Number) });
    expect(during.length + summaries.reduce((n, row) => n + Number(row.detail!.not_written), 0)).toBe(500);
    // Kept as lanes, the names alone would be 450 MB (the re-check measured +536 MB for 500 of them
    // before the fix). The resident size of a Node server also moves with garbage it has not yet
    // returned (up to about 65 MB in a full api run), so the bound is wide; what it rules out is
    // keeping the names.
    if (before !== null && after !== null) expect(after - before).toBeLessThan(200);
    // The right passphrase still works at once afterwards.
    expect((await postSignIn("reader", w.passphrases.reader)).status).toBe(303);
  }, 240_000);

  it("a 2,000-character passphrase is refused without a passphrase check: the name's failure count does not move", async () => {
    const from = await lastAuditId();
    const name = "g7-no-such-name";
    for (let i = 0; i < 10; i += 1) {
      const reply = await postSignIn(name, `${"p".repeat(2000)}${i}`);
      expect(reply.message).toBe(WRONG);
      // No delay either: in a lane, the sixth wrong attempt would wait 200 ms and the tenth 3.2 s.
      expect(reply.ms).toBeLessThan(1500);
    }
    // One ordinary wrong attempt: it is the first failure the lane has seen.
    expect((await postSignIn(name, "wrong")).message).toBe(WRONG);
    const rows = await signInRowsAfter(from);
    expect(rows.slice(0, 10).map((r) => [r.object_id, r.detail])).toEqual(Array.from({ length: 10 }, () => [name, { reason: "passphrase_too_long", passphrase_length: 2001 }]));
    expect(rows[10]).toMatchObject({ object_id: name, detail: { failures: 1, lane: "anonymous" } });
    expect(rows).toHaveLength(11);
  }, 60_000);

  it("a name typed with capitals and spaces round it still signs in", async () => {
    expect((await postSignIn("  READER  ", w.passphrases.reader)).status).toBe(303);
  });
});
