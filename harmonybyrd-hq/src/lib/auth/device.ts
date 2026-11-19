/**
 * The device cookie `hq_device`: "this browser has signed in as this person before".
 *
 * Set after a successful sign-in, and read by the sign-in action only, to choose the throttle lane
 * (throttle.ts): a browser holding one for the principal of the name being signed in gets a lane of its
 * own, which wrong attempts from elsewhere cannot slow down. It is not a session and grants nothing:
 * authentication reads only the session cookie, and verifySession refuses any token with a `typ`
 * claim. In the other direction, verifyDevice refuses a session token (it carries no typ "device", and
 * it carries `amr`/`role`). Signing out, or ending every session, leaves it in place: it identifies the
 * browser, not a session.
 *
 * HS256 with HQ_JWT_SECRET; claims { iss: "harmonybyrd-hq", typ: "device", sub: <principal id>,
 * did: <random 128-bit id, base64url>, iat, exp }; 180 days.
 */
import { randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { secret, SESSION_ISSUER } from "./session";

export const DEVICE_COOKIE = "hq_device";
export const DEVICE_DAYS = 180;
const DEVICE_TYP = "device";
/** 128 random bits in base64url: 22 characters. */
const DEVICE_ID = /^[A-Za-z0-9_-]{22}$/;

export interface DeviceClaims {
  /** The principal who signed in from this browser. */
  sub: string;
  /** The device id. */
  did: string;
}

export function newDeviceId(): string {
  return randomBytes(16).toString("base64url");
}

/** Sign a device cookie for a principal; `did` keeps the id of a cookie the browser already holds. */
export async function signDevice(principalId: string, did: string = newDeviceId()): Promise<string> {
  if (!DEVICE_ID.test(did)) throw new Error("A device id is 128 random bits in base64url.");
  return new SignJWT({ typ: DEVICE_TYP, did })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(principalId)
    .setIssuer(SESSION_ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${DEVICE_DAYS}d`)
    .sign(secret());
}

/** The principal and device id of a valid device cookie, or null (forged, expired, malformed, or a session). */
export async function verifyDevice(token: string | undefined | null): Promise<DeviceClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
      issuer: SESSION_ISSUER,
      requiredClaims: ["sub", "iat", "exp", "typ", "did"],
    });
    if (payload.typ !== DEVICE_TYP) return null;
    // Purpose separation: anything that looks like a session is not a device cookie.
    if (payload.amr !== undefined || payload.role !== undefined || payload.sv !== undefined) return null;
    if (typeof payload.sub !== "string" || typeof payload.did !== "string" || !DEVICE_ID.test(payload.did)) return null;
    return { sub: payload.sub, did: payload.did };
  } catch {
    return null;
  }
}

/** Secure exactly when the session cookie is (both cookies use this). */
export function secureCookies(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "production" && env.HQ_INSECURE_COOKIES !== "1";
}
