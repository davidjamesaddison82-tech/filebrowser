/**
 * Session tokens for interactive (human) sign-in.
 *
 * The token is an HS256 JWT signed with HQ_JWT_SECRET, carrying `sub` (the principal id),
 * `role: "authenticated"`, `amr: "session"`, `iss: "harmonybyrd-hq"`, `iat`, `exp` and `sv`, the
 * principal's session epoch at sign-in. A session is valid only while `sv` equals the principal's
 * current hq.principals.session_epoch (checked in authenticate.ts): signing out, or a new
 * passphrase, increments the epoch and so ends every session that person has open.
 *
 * Only tokens HQ itself issued are accepted: a token without HQ's issuer, the session `amr`, an
 * expiry or an epoch is refused even if it is signed with the right secret.
 */
import { jwtVerify, SignJWT } from "jose";
import { environmentProblem } from "./environment";

export const SESSION_COOKIE = "hq_session";
export const SESSION_HOURS = 12;
export const SESSION_ISSUER = "harmonybyrd-hq";

function secret(): Uint8Array {
  const value = process.env.HQ_JWT_SECRET;
  // Only the secret is checked here; the database URL is checked at start-up (src/instrumentation.ts).
  const problem = environmentProblem({ HQ_JWT_SECRET: value });
  if (!value || problem) throw new Error(problem ?? "HQ_JWT_SECRET is not set.");
  return new TextEncoder().encode(value);
}

/**
 * Sign a session for a principal. `sessionEpoch` must be the principal's current session_epoch
 * (auth_find_login returns it); 0 is the epoch of someone whose sessions were never ended.
 */
export async function signSession(principalId: string, sessionEpoch = 0): Promise<string> {
  return new SignJWT({ role: "authenticated", amr: "session", sv: sessionEpoch })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(principalId)
    .setIssuer(SESSION_ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
}

export interface SessionClaims {
  /** Principal id. */
  sub: string;
  /** Session epoch the token was signed with. */
  sv: number;
}

/** The principal id and epoch carried by a valid session token, or null. */
export async function verifySession(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
      issuer: SESSION_ISSUER,
      requiredClaims: ["sub", "iat", "exp", "sv"],
    });
    if (payload.role !== "authenticated" || payload.amr !== "session") return null;
    if (typeof payload.sub !== "string" || !Number.isInteger(payload.sv)) return null;
    return { sub: payload.sub, sv: payload.sv as number };
  } catch {
    return null;
  }
}
