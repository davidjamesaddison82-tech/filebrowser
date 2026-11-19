/**
 * The files `npm run setup` writes hold the session-signing secret, the owner database URL and API
 * tokens (api-6, docs-8, docs-7). They must end up owner-only on every run, and the published
 * placeholders must never stay in use. No database needed; it lives here with the setup scripts' other checks.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_DB_PASSWORD_PLACEHOLDER, closingMessage, ensureEnvFile, environmentProblem, JWT_PLACEHOLDER, writePrivateFile } from "../../scripts/lib/setup-files";

const mode = (file: string) => statSync(file).mode & 0o777;
let dir: string;
let template: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hq-setup-"));
  template = path.join(dir, ".env.example");
  writeFileSync(
    template,
    `DATABASE_URL=postgres://hq_app:${APP_DB_PASSWORD_PLACEHOLDER}@127.0.0.1:54329/hq_dev\nHQ_JWT_SECRET=${JWT_PLACEHOLDER}\nHQ_PACK_DIR=data/packs/fixture\n`,
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(process.platform === "win32")("secret files are owner-only on every setup run", () => {
  it("a new .env.local is created 0600 with the placeholders filled in", () => {
    const env = path.join(dir, ".env.local");
    const result = ensureEnvFile(env, template);
    expect(result).toMatchObject({ created: true, wasExposed: false, tightened: true });
    expect(result.filled).toEqual(["HQ_JWT_SECRET", "DATABASE_URL password"]);
    expect(mode(env)).toBe(0o600);
    expect(readFileSync(env, "utf8")).not.toMatch(/__GENERATED_/);
  });

  it("an existing world-readable .env.local (e.g. copied by hand) is tightened to 0600 and reported", () => {
    const env = path.join(dir, ".env.local");
    writeFileSync(env, "HQ_JWT_SECRET=already-a-long-random-secret-0123456789abcdef\nDATABASE_URL=postgres://hq_app:real@127.0.0.1/hq_dev\n");
    chmodSync(env, 0o644);
    const result = ensureEnvFile(env, template);
    expect(result).toMatchObject({ created: false, wasExposed: true, tightened: true, filled: [] });
    expect(mode(env)).toBe(0o600);
    // Nothing else in the file is touched.
    expect(readFileSync(env, "utf8")).toContain("already-a-long-random-secret-0123456789abcdef");
  });

  it("placeholders left in an existing .env.local are filled in, one password for every occurrence", () => {
    const env = path.join(dir, ".env.local");
    writeFileSync(
      env,
      `DATABASE_URL=postgres://hq_app:${APP_DB_PASSWORD_PLACEHOLDER}@127.0.0.1/hq_dev\nOTHER=postgres://hq_app:${APP_DB_PASSWORD_PLACEHOLDER}@x/y\nHQ_JWT_SECRET=${JWT_PLACEHOLDER}\n`,
    );
    chmodSync(env, 0o600);
    const result = ensureEnvFile(env, template);
    expect(result.filled).toEqual(["HQ_JWT_SECRET", "DATABASE_URL password"]);
    const text = readFileSync(env, "utf8");
    expect(text).not.toMatch(/__GENERATED_/);
    const passwords = [...text.matchAll(/hq_app:([^@]+)@/g)].map((m) => m[1]);
    expect(new Set(passwords).size).toBe(1);
    expect(/HQ_JWT_SECRET=(.+)/.exec(text)![1].length).toBeGreaterThanOrEqual(32);
    expect(mode(env)).toBe(0o600);
  });

  it("an existing world-readable credentials file is tightened to 0600 when rewritten", () => {
    const file = path.join(dir, ".hq-local-credentials.json");
    writeFileSync(file, "{}\n");
    chmodSync(file, 0o644);
    const result = writePrivateFile(file, '{"claude_api_token":"hbq_x"}\n');
    expect(result).toMatchObject({ wasExposed: true, tightened: true });
    expect(mode(file)).toBe(0o600);
    expect(readFileSync(file, "utf8")).toContain("hbq_x");
  });
});

describe("the environment is refused while a placeholder is still in use", () => {
  const good = { HQ_JWT_SECRET: "x".repeat(32), DATABASE_URL: "postgres://hq_app:secret@127.0.0.1/hq_dev" };
  it("refuses the published placeholders and a short secret", () => {
    expect(environmentProblem({ ...good, HQ_JWT_SECRET: JWT_PLACEHOLDER })).toMatch(/HQ_JWT_SECRET/);
    expect(environmentProblem({ ...good, HQ_JWT_SECRET: `${JWT_PLACEHOLDER}-padded-to-be-long-enough` })).toMatch(/placeholder/);
    expect(environmentProblem({ ...good, HQ_JWT_SECRET: "short" })).toMatch(/32 characters/);
    expect(environmentProblem({ ...good, DATABASE_URL: `postgres://hq_app:${APP_DB_PASSWORD_PLACEHOLDER}@127.0.0.1/hq_dev` })).toMatch(/DATABASE_URL/);
  });
  it("accepts real values", () => {
    expect(environmentProblem(good)).toBeNull();
  });
});

describe("setup's closing message names the address the application will have (L5)", () => {
  it("without HQ_BASE_URL it gives the default address and no port advice", () => {
    const text = closingMessage({}).join("\n");
    expect(text).toContain("npm run dev");
    expect(text).toContain("http://localhost:3210");
    expect(text).not.toMatch(/-p \d/);
  });

  it("with HQ_BASE_URL on the default port it gives that address", () => {
    const text = closingMessage({ HQ_BASE_URL: "http://127.0.0.1:3210/" }).join("\n");
    expect(text).toContain("http://127.0.0.1:3210");
    expect(text).not.toContain("localhost");
    expect(text).not.toMatch(/-p \d/);
  });

  it("with HQ_BASE_URL on another port it gives that address and says which port to start on", () => {
    const text = closingMessage({ HQ_BASE_URL: "http://localhost:3300" }).join("\n");
    expect(text).toContain("http://localhost:3300");
    expect(text).not.toContain("3210)");
    expect(text).toContain("npm run dev -- -p 3300");
  });

  it("an HQ_BASE_URL without a port uses its scheme's port", () => {
    expect(closingMessage({ HQ_BASE_URL: "https://hq.example.test" }).join("\n")).toContain("npm run dev -- -p 443");
  });
});
