/**
 * Session tokens for interactive (human) sign-in.
 *
 * The token is an HS256 JWT with the same shape Supabase Auth issues (`sub`, `role:
 * "authenticated"`, `exp`), signed with HQ_JWT_SECRET. On Supabase, set HQ_JWT_SECRET to the
 * project's JWT secret and Supabase-issued access tokens verify here unchanged.
 */
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "hq_session";
export const SESSION_HOURS = 12;

function secret(): Uint8Array {
  const value = process.env.HQ_JWT_SECRET;
  if (!value || value.length < 32) {
    throw new Error("HQ_JWT_SECRET must be set to a random string of at least 32 characters.");
  }
  return new TextEncoder().encode(value);
}

export async function signSession(principalId: string): Promise<string> {
  return new SignJWT({ role: "authenticated", amr: "session" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(principalId)
    .setIssuer("harmonybyrd-hq")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
}

/** Returns the principal id carried by a valid session token, or null. */
export async function verifySession(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (payload.role !== "authenticated" || typeof payload.sub !== "string") return null;
    return payload.sub;
  } catch {
    return null;
  }
}
