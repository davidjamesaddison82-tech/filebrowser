/**
 * Resolve the caller of a request to a Principal.
 *
 *   Authorization: Bearer hbq_…   → API token (AI clients, scripts). Never a founder.
 *   hq_session cookie             → interactive human session.
 *
 * In both cases role and kind are read from hq.principals at request time.
 */
import { asAuthRole } from "@/lib/server/db";
import { unauthenticated } from "@/lib/server/errors";
import type { AppRole, Principal, PrincipalKind } from "./principal";
import { hashToken, looksLikeToken, verifyPassphraseAsync } from "./secrets";
import { SESSION_COOKIE, verifySession } from "./session";

interface PrincipalRow {
  principal_id: string;
  handle: string;
  display_name: string;
  kind: PrincipalKind;
  app_role: AppRole;
  /** Present on the session look-ups (migration 0006): a session is valid only while its sv equals this. */
  session_epoch?: number;
}

/** A successful passphrase sign-in: the principal, and the session epoch to sign into its session. */
export type SignedIn = Principal & { sessionEpoch: number };

const SESSION_SCOPES: Record<AppRole, string[]> = {
  founder: ["read", "propose", "decide"],
  developer: ["read", "propose"],
  ai_agent: ["read", "propose"],
  reader: ["read"],
};

function fromRow(row: PrincipalRow, amr: Principal["amr"], scopes: string[], credentialId?: string): Principal {
  return {
    id: row.principal_id,
    handle: row.handle,
    displayName: row.display_name,
    kind: row.kind,
    appRole: row.app_role,
    amr,
    scopes,
    credentialId,
  };
}

export async function authenticateToken(token: string): Promise<Principal | null> {
  if (!looksLikeToken(token)) return null;
  const row = await asAuthRole(async (q) => {
    const result = await q.query<{ c: (PrincipalRow & { credential_id: string; scopes: string[] }) | null }>(
      "select hq.auth_find_credential($1) as c",
      [hashToken(token)],
    );
    return result.rows[0]?.c ?? null;
  });
  if (!row) return null;
  // Defence in depth: the database refuses to issue founder tokens; refuse to honour one anyway.
  if (row.app_role === "founder") return null;
  return fromRow(row, "api_token", row.scopes, row.credential_id);
}

export async function authenticateSessionToken(sessionToken: string | undefined | null): Promise<Principal | null> {
  const claims = await verifySession(sessionToken);
  if (!claims) return null;
  const row = await asAuthRole(async (q) => {
    const result = await q.query<{ p: PrincipalRow | null }>("select hq.auth_get_principal($1::uuid) as p", [claims.sub]);
    return result.rows[0]?.p ?? null;
  });
  if (!row || row.kind !== "human") return null;
  // Signed out (or passphrase changed) since this session was signed: it has ended.
  if (row.session_epoch !== claims.sv) return null;
  return fromRow(row, "session", SESSION_SCOPES[row.app_role]);
}

/** Verify a passphrase sign-in. Returns the principal on success, null otherwise (no detail leaked). */
export async function authenticatePassphrase(handle: string, passphrase: string): Promise<SignedIn | null> {
  const row = await asAuthRole(async (q) => {
    const result = await q.query<{ l: (PrincipalRow & { scheme: string; secret_hash: string }) | null }>(
      "select hq.auth_find_login($1) as l",
      [handle.trim().toLowerCase()],
    );
    return result.rows[0]?.l ?? null;
  });
  if (!row) {
    // Spend comparable time whether or not the handle exists.
    await verifyPassphraseAsync(passphrase, "scrypt-v1$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    return null;
  }
  if (!(await verifyPassphraseAsync(passphrase, row.secret_hash))) return null;
  return { ...fromRow(row, "session", SESSION_SCOPES[row.app_role]), sessionEpoch: row.session_epoch ?? 0 };
}

/** Authenticate an API request (bearer token first, then session cookie). */
export async function principalFromRequest(request: Request): Promise<Principal | null> {
  const header = request.headers.get("authorization");
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) return null;
    return authenticateToken(match[1].trim());
  }
  const cookieHeader = request.headers.get("cookie") ?? "";
  const session = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return authenticateSessionToken(session ? decodeURIComponent(session) : null);
}

export async function requirePrincipalFromRequest(request: Request): Promise<Principal> {
  const principal = await principalFromRequest(request);
  if (!principal) throw unauthenticated("A valid session or API token is required.");
  return principal;
}
