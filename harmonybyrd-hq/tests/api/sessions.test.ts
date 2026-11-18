import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { claimsFor } from "@/lib/auth/principal";
import { setPassphrase } from "../../scripts/lib/principals";
import { admin, asAppRole, freshWorld, type TestWorld, worldState } from "../helpers/db";
import { TEST_JWT_SECRET } from "../helpers/env";
import { api, sessionCookie, sessionEpoch } from "../helpers/http";

/**
 * Sessions end when the person signs out (hq.end_sessions) or gets a new passphrase, and only tokens
 * HQ itself issued count as sessions (api-5, docs-13, tests-10, D7). The sign-out button itself is
 * exercised in the browser (tests/e2e/01-auth.spec.ts).
 */
let w: TestWorld;
let proposalId: string;
type ErrorBody = { error: { code: string; message: string } };

const now = () => Math.floor(Date.now() / 1000);
async function token(claims: Record<string, unknown>, options: { sub: string; iss?: string; iat?: number; exp?: number }): Promise<string> {
  let jwt = new SignJWT(claims).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(options.sub).setIssuedAt(options.iat ?? now());
  if (options.iss) jwt = jwt.setIssuer(options.iss);
  if (options.exp !== undefined) jwt = jwt.setExpirationTime(options.exp);
  return `hq_session=${await jwt.sign(new TextEncoder().encode(TEST_JWT_SECRET))}`;
}

async function proposalStatus(id: string): Promise<string> {
  const res = await api<{ proposal: { status: string } }>(`/api/v1/proposals/${id}`, { token: w.tokens.claude });
  return res.body.proposal.status;
}

beforeAll(async () => {
  w = await freshWorld();
  const res = await api<{ proposal: { id: string } }>("/api/v1/tools/submit_change_proposal", {
    token: w.tokens.claude,
    body: { title: "Session test", rationale: "For the session tests.", base_rev: 1, target: { type: "requirement", id: "FR-FX-004", base_version: 1 }, set: { interpretation: "x y z" } },
  });
  proposalId = res.body.proposal.id;
});

describe("ending sessions (api-5, docs-13)", () => {
  it("after the founder ends their sessions, an old cookie is refused everywhere and a new sign-in works", async () => {
    const old = await sessionCookie(w.founder.id);
    expect((await api<{ role: string }>("/api/v1/whoami", { cookie: old })).body.role).toBe("founder");

    await asAppRole("authenticated", claimsFor(w.founder), (c) => c.query("select hq.end_sessions()"));
    const before = await worldState();

    const whoami = await api<ErrorBody>("/api/v1/whoami", { cookie: old });
    expect(whoami.status).toBe(401);
    expect(whoami.body.error.code).toBe("unauthenticated");
    const review = await api<ErrorBody>(`/api/v1/proposals/${proposalId}/review`, { cookie: old, body: { decision: "accept" } });
    expect(review.status).toBe(401);
    const decision = await api<ErrorBody>("/api/v1/decisions", {
      cookie: old,
      body: { title: "Accept", exact_text: "Accepted.", effects: [{ type: "set_acceptance", record_type: "build", record_id: "BLD-FX-01", state: "accepted" }] },
    });
    expect(decision.status).toBe(401);
    expect(await worldState()).toEqual(before);
    expect(await proposalStatus(proposalId)).toBe("submitted");

    const fresh = await sessionCookie(w.founder.id);
    expect(fresh).not.toBe(old);
    expect((await api<{ role: string }>("/api/v1/whoami", { cookie: fresh })).status).toBe(200);
  });

  it("ending one person's sessions leaves everyone else signed in", async () => {
    const developer = await sessionCookie(w.developer.id);
    await asAppRole("authenticated", claimsFor(w.founder), (c) => c.query("select hq.end_sessions()"));
    expect((await api("/api/v1/whoami", { cookie: developer })).status).toBe(200);
  });

  it("a new passphrase ends the sessions signed in with the old one", async () => {
    const old = await sessionCookie(w.reader.id);
    expect((await api("/api/v1/whoami", { cookie: old })).status).toBe(200);
    const client = await admin();
    try {
      await setPassphrase(client, w.reader.id, "a-new-reader-passphrase-for-this-test");
    } finally {
      await client.end();
    }
    expect((await api("/api/v1/whoami", { cookie: old })).status).toBe(401);
    expect((await api("/api/v1/whoami", { cookie: await sessionCookie(w.reader.id) })).status).toBe(200);
  });
});

describe("only sessions HQ issued, unexpired and current, are sessions (tests-10)", () => {
  it("a correctly signed but expired founder cookie cannot review, and the proposal stays submitted", async () => {
    const sv = await sessionEpoch(w.founder.id);
    const expired = await token({ role: "authenticated", amr: "session", sv }, { sub: w.founder.id, iss: "harmonybyrd-hq", iat: now() - 13 * 3600, exp: now() - 3600 });
    const before = await worldState();
    const res = await api<ErrorBody>(`/api/v1/proposals/${proposalId}/review`, { cookie: expired, body: { decision: "accept" } });
    expect(res.status).toBe(401);
    expect(await worldState()).toEqual(before);
    expect(await proposalStatus(proposalId)).toBe("submitted");
  });

  it("a correctly signed founder token is refused without HQ's issuer, an expiry, the session amr or the current epoch", async () => {
    const sv = await sessionEpoch(w.founder.id);
    const good = { role: "authenticated", amr: "session", sv };
    const valid = await token(good, { sub: w.founder.id, iss: "harmonybyrd-hq", exp: now() + 3600 });
    expect((await api("/api/v1/whoami", { cookie: valid })).status).toBe(200);
    for (const [label, cookie] of [
      ["no issuer", await token(good, { sub: w.founder.id, exp: now() + 3600 })],
      ["foreign issuer", await token(good, { sub: w.founder.id, iss: "supabase", exp: now() + 3600 })],
      ["no expiry", await token(good, { sub: w.founder.id, iss: "harmonybyrd-hq" })],
      ["no amr", await token({ role: "authenticated", sv }, { sub: w.founder.id, iss: "harmonybyrd-hq", exp: now() + 3600 })],
      ["no epoch", await token({ role: "authenticated", amr: "session" }, { sub: w.founder.id, iss: "harmonybyrd-hq", exp: now() + 3600 })],
      ["old epoch", await token({ ...good, sv: sv - 1 }, { sub: w.founder.id, iss: "harmonybyrd-hq", exp: now() + 3600 })],
      ["future epoch", await token({ ...good, sv: sv + 1 }, { sub: w.founder.id, iss: "harmonybyrd-hq", exp: now() + 3600 })],
    ] as const) {
      const res = await api<ErrorBody>(`/api/v1/proposals/${proposalId}/review`, { cookie, body: { decision: "accept" } });
      expect(res.status, label).toBe(401);
    }
    expect(await proposalStatus(proposalId)).toBe("submitted");
  });
});
