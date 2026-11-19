import { describe, expect, it } from "vitest";
import { generatePassphrase, hashPassphrase, hashToken, issueToken, looksLikeToken, verifyPassphrase } from "@/lib/auth/secrets";
import { canPropose, claimsFor, isFounderSession, type Principal } from "@/lib/auth/principal";
import { SignJWT, decodeJwt } from "jose";
import { environmentProblem } from "@/lib/auth/environment";
import { SESSION_HOURS, signSession, verifySession } from "@/lib/auth/session";

const base: Principal = { id: "00000000-0000-4000-8000-000000000001", handle: "x", displayName: "X", kind: "human", appRole: "founder", amr: "session", scopes: ["read"] };

describe("credentials", () => {
  it("verifies a passphrase against its hash and nothing else", () => {
    const hash = hashPassphrase("correct horse battery");
    expect(hash.startsWith("scrypt-v1$")).toBe(true);
    expect(verifyPassphrase("correct horse battery", hash)).toBe(true);
    expect(verifyPassphrase("correct horse batterx", hash)).toBe(false);
    expect(verifyPassphrase("correct horse battery", "not-a-hash")).toBe(false);
    expect(hashPassphrase("correct horse battery")).not.toBe(hash);
  });

  it("issues tokens that are stored only as a SHA-256", () => {
    const issued = issueToken();
    expect(looksLikeToken(issued.token)).toBe(true);
    expect(issued.hash).toBe(hashToken(issued.token));
    expect(issued.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.token.startsWith(issued.prefix)).toBe(true);
    expect(issueToken().token).not.toBe(issued.token);
    expect(looksLikeToken("Bearer nonsense")).toBe(false);
  });

  it("generates readable passphrases", () => {
    expect(generatePassphrase()).toMatch(/^[a-z2-9]{5}(-[a-z2-9]{5}){3}$/);
  });
});

describe("who may do what", () => {
  it("only a human founder in an interactive session holds founder authority", () => {
    expect(isFounderSession(base)).toBe(true);
    expect(isFounderSession({ ...base, amr: "api_token" })).toBe(false);
    expect(isFounderSession({ ...base, kind: "ai_client" })).toBe(false);
    expect(isFounderSession({ ...base, appRole: "developer" })).toBe(false);
    expect(isFounderSession(null)).toBe(false);
  });

  it("readers cannot propose; tokens need the propose scope", () => {
    expect(canPropose({ ...base, appRole: "reader" })).toBe(false);
    expect(canPropose({ ...base, appRole: "ai_agent", kind: "ai_client", amr: "api_token", scopes: ["read"] })).toBe(false);
    expect(canPropose({ ...base, appRole: "ai_agent", kind: "ai_client", amr: "api_token", scopes: ["read", "propose"] })).toBe(true);
    expect(canPropose({ ...base, appRole: "developer" })).toBe(true);
  });

  it("database claims carry the authentication method, and scopes only for tokens", () => {
    expect(claimsFor(base)).toEqual({ sub: base.id, role: "authenticated", amr: "session", client: null });
    const ai = claimsFor({ ...base, kind: "ai_client", appRole: "ai_agent", amr: "api_token", handle: "claude", scopes: ["read"] });
    expect(ai).toMatchObject({ amr: "api_token", client: "claude", scopes: ["read"] });
  });
});

describe("session tokens", () => {
  it("round-trips a principal id and rejects tampering", async () => {
    process.env.HQ_JWT_SECRET = "unit-test-secret-0123456789abcdef0123456789abcdef";
    const token = await signSession(base.id, 3);
    expect(await verifySession(token)).toEqual({ sub: base.id, sv: 3 });
    expect(await verifySession(`${token.slice(0, -3)}abc`)).toBeNull();
    expect(await verifySession("")).toBeNull();
    process.env.HQ_JWT_SECRET = "a-different-secret-0123456789abcdef0123456789abcdef";
    expect(await verifySession(token)).toBeNull();
  });
});

describe("session tokens carry only what HQ itself issues (tests-10, api-5)", () => {
  const SECRET = "unit-test-secret-0123456789abcdef0123456789abcdef";
  const key = new TextEncoder().encode(SECRET);
  const now = () => Math.floor(Date.now() / 1000);

  /** A token signed with the right secret, with exactly the claims given. */
  async function forge(claims: Record<string, unknown>, options: { iss?: string; iat?: number; exp?: number | null } = {}): Promise<string> {
    let jwt = new SignJWT(claims).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(base.id).setIssuedAt(options.iat ?? now());
    if (options.iss !== undefined) jwt = jwt.setIssuer(options.iss);
    if (options.exp !== null) jwt = jwt.setExpirationTime(options.exp ?? now() + 3600);
    return jwt.sign(key);
  }
  const good = { role: "authenticated", amr: "session", sv: 0 };

  it("accepts a well-formed HQ session token (control)", async () => {
    process.env.HQ_JWT_SECRET = SECRET;
    expect(await verifySession(await forge(good, { iss: "harmonybyrd-hq" }))).toEqual({ sub: base.id, sv: 0 });
  });

  it("refuses an expired token", async () => {
    process.env.HQ_JWT_SECRET = SECRET;
    const expired = await forge(good, { iss: "harmonybyrd-hq", iat: now() - 13 * 3600, exp: now() - 3600 });
    expect(await verifySession(expired)).toBeNull();
  });

  it("refuses a token with no expiry", async () => {
    process.env.HQ_JWT_SECRET = SECRET;
    expect(await verifySession(await forge(good, { iss: "harmonybyrd-hq", exp: null }))).toBeNull();
  });

  it("refuses a token from another issuer, or with none", async () => {
    process.env.HQ_JWT_SECRET = SECRET;
    expect(await verifySession(await forge(good, { iss: "supabase" }))).toBeNull();
    expect(await verifySession(await forge(good))).toBeNull();
  });

  it("refuses a token that is not an interactive session, or carries no session epoch", async () => {
    process.env.HQ_JWT_SECRET = SECRET;
    expect(await verifySession(await forge({ role: "authenticated", sv: 0 }, { iss: "harmonybyrd-hq" }))).toBeNull();
    expect(await verifySession(await forge({ ...good, amr: "api_token" }, { iss: "harmonybyrd-hq" }))).toBeNull();
    expect(await verifySession(await forge({ role: "authenticated", amr: "session" }, { iss: "harmonybyrd-hq" }))).toBeNull();
    expect(await verifySession(await forge({ ...good, sv: "0" }, { iss: "harmonybyrd-hq" }))).toBeNull();
    expect(await verifySession(await forge({ ...good, role: "service_role" }, { iss: "harmonybyrd-hq" }))).toBeNull();
  });

  it("signs sessions for exactly SESSION_HOURS, with issuer, amr and the epoch", async () => {
    process.env.HQ_JWT_SECRET = SECRET;
    const payload = decodeJwt(await signSession(base.id, 7));
    expect(payload.exp! - payload.iat!).toBe(SESSION_HOURS * 3600);
    // Pinned to the documented lifetime, twelve hours, not just to the constant (F12, tests-10).
    expect(payload.exp! - payload.iat!).toBe(43_200);
    expect(payload).toMatchObject({ iss: "harmonybyrd-hq", amr: "session", role: "authenticated", sv: 7, sub: base.id });
  });

  it("refuses to sign or verify with a placeholder or short secret (docs-7)", async () => {
    process.env.HQ_JWT_SECRET = SECRET;
    const token = await signSession(base.id);
    for (const bad of ["__GENERATED_JWT_SECRET__", "__GENERATED_JWT_SECRET__-padded-to-be-long-enough-0123456789", "short-secret"]) {
      process.env.HQ_JWT_SECRET = bad;
      await expect(signSession(base.id)).rejects.toThrow(/HQ_JWT_SECRET/);
      expect(await verifySession(token)).toBeNull();
    }
    process.env.HQ_JWT_SECRET = SECRET;
  });

  it("the start-up check refuses the same environments setup refuses (docs-7)", () => {
    expect(environmentProblem({ HQ_JWT_SECRET: "__GENERATED_JWT_SECRET__" })).toMatch(/HQ_JWT_SECRET/);
    expect(environmentProblem({ HQ_JWT_SECRET: "x".repeat(31) })).toMatch(/HQ_JWT_SECRET/);
    expect(environmentProblem({ HQ_JWT_SECRET: SECRET, DATABASE_URL: "postgres://hq_app:__GENERATED_APP_DB_PASSWORD__@h/db" })).toMatch(/DATABASE_URL/);
    expect(environmentProblem({ HQ_JWT_SECRET: SECRET, DATABASE_URL: "postgres://hq_app:pw@h/db" })).toBeNull();
  });
});
