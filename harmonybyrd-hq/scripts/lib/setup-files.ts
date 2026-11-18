/**
 * The secret-bearing files that `npm run setup` writes: .env.local and .hq-local-credentials.json.
 *
 * Kept apart from scripts/setup.ts (which runs on import) so the rules can be tested:
 *   - .env.local is created from .env.example with generated secrets, and placeholders left in an
 *     existing .env.local are filled in, so the published placeholder never becomes a password;
 *   - both files are made owner-only (0600) on every run, not only when they are created, and a
 *     file that was readable by others is reported, because its secrets may already have been read.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";

export const JWT_PLACEHOLDER = "__GENERATED_JWT_SECRET__";
export const APP_DB_PASSWORD_PLACEHOLDER = "__GENERATED_APP_DB_PASSWORD__";
const PLACEHOLDER = /__GENERATED_[A-Z_]*__/;

export interface PrivateFileResult {
  /** True when group or other users could read or write the file before this run tightened it. */
  wasExposed: boolean;
  /** False on a platform where the mode could not be set (e.g. some Windows file systems). */
  tightened: boolean;
}

/** Make a file owner-only (0600) and say whether it was open to others before. */
export function makePrivate(file: string): PrivateFileResult {
  let wasExposed = false;
  try {
    wasExposed = (statSync(file).mode & 0o077) !== 0;
  } catch {
    /* missing file: nothing to report */
  }
  try {
    chmodSync(file, 0o600);
    return { wasExposed, tightened: (statSync(file).mode & 0o777) === 0o600 };
  } catch {
    return { wasExposed, tightened: false };
  }
}

/** Write a file holding secrets: created owner-only, and tightened if it already existed. */
export function writePrivateFile(file: string, content: string): PrivateFileResult {
  const before = existsSync(file) ? makePrivate(file) : { wasExposed: false, tightened: true };
  writeFileSync(file, content, { mode: 0o600 });
  const after = makePrivate(file);
  return { wasExposed: before.wasExposed, tightened: after.tightened };
}

/** Replace the generated-value placeholders. One application password is used for every occurrence. */
export function fillPlaceholders(text: string): { text: string; filled: string[] } {
  const filled: string[] = [];
  let out = text;
  if (out.includes(JWT_PLACEHOLDER)) {
    out = out.replaceAll(JWT_PLACEHOLDER, randomBytes(48).toString("base64url"));
    filled.push("HQ_JWT_SECRET");
  }
  if (out.includes(APP_DB_PASSWORD_PLACEHOLDER)) {
    out = out.replaceAll(APP_DB_PASSWORD_PLACEHOLDER, randomBytes(18).toString("base64url"));
    filled.push("DATABASE_URL password");
  }
  return { text: out, filled };
}

export interface EnvFileResult extends PrivateFileResult {
  created: boolean;
  /** Which placeholders were replaced with generated values. */
  filled: string[];
}

/**
 * Create .env.local from the template if it is missing; otherwise fill any placeholders still in it.
 * Either way the file ends up owner-only.
 */
export function ensureEnvFile(envFile: string, templateFile: string): EnvFileResult {
  if (!existsSync(envFile)) {
    const { text, filled } = fillPlaceholders(readFileSync(templateFile, "utf8"));
    const result = writePrivateFile(envFile, text);
    return { ...result, created: true, filled };
  }
  const permissions = makePrivate(envFile);
  const { text, filled } = fillPlaceholders(readFileSync(envFile, "utf8"));
  if (filled.length > 0) writeFileSync(envFile, text, { mode: 0o600 });
  return { ...permissions, created: false, filled };
}

/**
 * Why the environment cannot be used, or null. A placeholder must never reach the database (it is
 * published in .env.example) or sign sessions (it is too short and public).
 */
export function environmentProblem(env: Record<string, string | undefined>): string | null {
  const secret = env.HQ_JWT_SECRET ?? "";
  if (PLACEHOLDER.test(secret) || secret.length < 32) {
    return "HQ_JWT_SECRET in .env.local is still a placeholder or shorter than 32 characters. Run `npm run setup` to generate one, or set a long random value yourself.";
  }
  if (PLACEHOLDER.test(env.DATABASE_URL ?? "")) {
    return "DATABASE_URL in .env.local still contains a placeholder password. Run `npm run setup` to generate one, or set a long random value yourself.";
  }
  return null;
}
