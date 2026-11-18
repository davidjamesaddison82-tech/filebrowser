import { describe, expect, it } from "vitest";
import { generatePassphrase, hashPassphrase, hashToken, issueToken, looksLikeToken, verifyPassphrase } from "@/lib/auth/secrets";
import { canPropose, claimsFor, isFounderSession, type Principal } from "@/lib/auth/principal";
import { signSession, verifySession } from "@/lib/auth/session";

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
    const token = await signSession(base.id);
    expect(await verifySession(token)).toBe(base.id);
    expect(await verifySession(`${token.slice(0, -3)}abc`)).toBeNull();
    expect(await verifySession("")).toBeNull();
    process.env.HQ_JWT_SECRET = "a-different-secret-0123456789abcdef0123456789abcdef";
    expect(await verifySession(token)).toBeNull();
  });
});
