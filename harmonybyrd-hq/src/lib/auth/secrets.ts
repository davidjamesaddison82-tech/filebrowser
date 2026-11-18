/**
 * Credential primitives. Pure functions over node:crypto so they can be used by the web
 * application, the setup scripts and the tests alike.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;

export function hashPassphrase(passphrase: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(passphrase.normalize("NFKC"), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt-v1$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassphrase(passphrase: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt-v1") return false;
  const [, n, r, p, salt, expected] = parts;
  const expectedBytes = Buffer.from(expected, "base64");
  const actual = scryptSync(passphrase.normalize("NFKC"), Buffer.from(salt, "base64"), expectedBytes.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
}

export interface IssuedToken {
  /** Shown once, to the person issuing it. Never stored. */
  token: string;
  prefix: string;
  hash: string;
}

/** API tokens look like `hbq_<8 hex>_<43 url-safe chars>`. Only the SHA-256 is stored. */
export function issueToken(): IssuedToken {
  const prefix = `hbq_${randomBytes(4).toString("hex")}`;
  const token = `${prefix}_${randomBytes(32).toString("base64url")}`;
  return { token, prefix, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function looksLikeToken(value: string): boolean {
  return /^hbq_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/.test(value);
}

export function generatePassphrase(): string {
  // Four groups of five characters from an unambiguous alphabet (~100 bits).
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(20);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join("")).join("-");
}
