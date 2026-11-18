/**
 * Test environment. Tests never touch the development database: they use a sibling database
 * named hq_test on the same server (override with HQ_TEST_ADMIN_DATABASE_URL / HQ_TEST_DATABASE_URL).
 */
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
for (const name of [".env.local", ".env"]) {
  const file = path.join(root, name);
  if (existsSync(file)) {
    try {
      process.loadEnvFile(file);
    } catch {
      /* ignore */
    }
  }
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export const TEST_DATABASE = process.env.HQ_TEST_DATABASE ?? "hq_test";
const devAdmin = process.env.HQ_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54329/hq_dev";
const devApp = process.env.DATABASE_URL ?? "postgres://hq_app:hq_app@127.0.0.1:54329/hq_dev";

export const DEV_ADMIN_URL = devAdmin;
export const TEST_ADMIN_URL = process.env.HQ_TEST_ADMIN_DATABASE_URL ?? withDatabase(devAdmin, TEST_DATABASE);
export const TEST_APP_URL = process.env.HQ_TEST_DATABASE_URL ?? withDatabase(devApp, TEST_DATABASE);
export const TEST_JWT_SECRET = "test-only-secret-0123456789abcdef0123456789abcdef";
export const TEST_PORT = Number(process.env.HQ_TEST_PORT ?? 3211);
export const TEST_BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

// Everything imported after this file sees the test database only.
process.env.HQ_ADMIN_DATABASE_URL = TEST_ADMIN_URL;
process.env.DATABASE_URL = TEST_APP_URL;
process.env.HQ_JWT_SECRET = TEST_JWT_SECRET;
process.env.HQ_PACK_DIR = "data/packs/fixture";
