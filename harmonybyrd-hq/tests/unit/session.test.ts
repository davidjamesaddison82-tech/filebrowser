import { decodeJwt, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { DEVICE_DAYS, secureCookies, signDevice, verifyDevice } from "@/lib/auth/device";
import { signSession, verifySession } from "@/lib/auth/session";

/**
 * The device cookie and the session cookie are signed with the same secret, so each must refuse the
 * other: a device cookie is never a session, and a session is never a device cookie (F5).
 */
const SECRET = "unit-test-secret-0123456789abcdef0123456789abcdef";
const key = new TextEncoder().encode(SECRET);
const PRINCIPAL = "8d5b4a0e-7c2f-4e8a-9b1d-3f6a2c9e0b71";
const DID = "AbCdEfGhIjKlMnOpQrStUv";
const now = () => Math.floor(Date.now() / 1000);

/** A token signed with the right secret, with exactly the claims given. */
async function forge(claims: Record<string, unknown>, options: { iss?: string | null; iat?: number; exp?: number | null } = {}): Promise<string> {
  let jwt = new SignJWT(claims).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(PRINCIPAL).setIssuedAt(options.iat ?? now());
  if (options.iss !== null) jwt = jwt.setIssuer(options.iss ?? "harmonybyrd-hq");
  if (options.exp !== null) jwt = jwt.setExpirationTime(options.exp ?? now() + 3600);
  return jwt.sign(key);
}

describe("device cookie (F5)", () => {
  it("carries iss, typ device, sub and a 128-bit did, for 180 days", async () => {
    process.env.HQ_JWT_SECRET = SECRET;
    const token = await signDevice(PRINCIPAL);
    const payload = decodeJwt(token);
    expect(payload).toMatchObject({ iss: "harmonybyrd-hq", typ: "device", sub: PRINCIPAL });
    expect(payload.did).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(payload.did as string, "base64url")).toHaveLength(16);
    expect(payload.exp! - payload.iat!).toBe(DEVICE_DAYS * 86_400);
    expect(DEVICE_DAYS).toBe(180);
    expect(payload).not.toHaveProperty("amr");
    expect(payload).not.toHaveProperty("role");
    expect(await verifyDevice(token)).toEqual({ sub: PRINCIPAL, did: payload.did });
    // A new device id each time, unless the browser's own is kept.
    expect(decodeJwt(await signDevice(PRINCIPAL)).did).not.toBe(payload.did);
    expect(decodeJwt(await signDevice(PRINCIPAL, DID)).did).toBe(DID);
  });

  it("a device cookie is never accepted as a session", async () => {
    process.env.HQ_JWT_SECRET = SECRET;
    expect(await verifySession(await signDevice(PRINCIPAL))).toBeNull();
    // Even one that also carries every session claim: a token with typ "device" is refused.
    const both = await forge({ typ: "device", did: DID, role: "authenticated", amr: "session", sv: 0 });
    expect(await verifySession(both)).toBeNull();
    // The control: the same claims without typ are a session.
    expect(await verifySession(await forge({ role: "authenticated", amr: "session", sv: 0 }))).toEqual({ sub: PRINCIPAL, sv: 0 });
  });

  it("a session token is never accepted as a device cookie", async () => {
    process.env.HQ_JWT_SECRET = SECRET;
    expect(await verifyDevice(await signSession(PRINCIPAL, 0))).toBeNull();
    // Device claims plus any session claim are refused too.
    for (const extra of [{ amr: "session" }, { role: "authenticated" }, { sv: 0 }]) {
      expect(await verifyDevice(await forge({ typ: "device", did: DID, ...extra })), JSON.stringify(extra)).toBeNull();
    }
    expect(await verifyDevice(await forge({ typ: "device", did: DID }))).toEqual({ sub: PRINCIPAL, did: DID });
  });

  it("refuses a forged, expired, malformed or foreign device cookie", async () => {
    process.env.HQ_JWT_SECRET = SECRET;
    const token = await signDevice(PRINCIPAL, DID);
    expect(await verifyDevice(`${token.slice(0, -3)}abc`)).toBeNull();
    expect(await verifyDevice("not-a-token")).toBeNull();
    expect(await verifyDevice("")).toBeNull();
    expect(await verifyDevice(undefined)).toBeNull();
    expect(await verifyDevice(await forge({ typ: "device", did: DID }, { iat: now() - 181 * 86_400, exp: now() - 60 }))).toBeNull();
    expect(await verifyDevice(await forge({ typ: "device", did: DID }, { exp: null }))).toBeNull();
    expect(await verifyDevice(await forge({ typ: "device", did: DID }, { iss: "supabase" }))).toBeNull();
    expect(await verifyDevice(await forge({ typ: "device", did: DID }, { iss: null }))).toBeNull();
    expect(await verifyDevice(await forge({ typ: "device" }))).toBeNull();
    expect(await verifyDevice(await forge({ typ: "device", did: "short" }))).toBeNull();
    expect(await verifyDevice(await forge({ typ: "Device", did: DID }))).toBeNull();
    expect(await verifyDevice(await forge({ did: DID }))).toBeNull();
    process.env.HQ_JWT_SECRET = "a-different-secret-0123456789abcdef0123456789abcdef";
    expect(await verifyDevice(token)).toBeNull();
    process.env.HQ_JWT_SECRET = SECRET;
  });

  it("is Secure exactly when the session cookie is", () => {
    expect(secureCookies({ NODE_ENV: "production" })).toBe(true);
    expect(secureCookies({ NODE_ENV: "production", HQ_INSECURE_COOKIES: "1" })).toBe(false);
    expect(secureCookies({ NODE_ENV: "development" })).toBe(false);
  });
});
