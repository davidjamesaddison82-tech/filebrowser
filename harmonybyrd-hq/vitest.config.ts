import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Test projects
 *   unit  pure logic over the fixture pack — no database, no network
 *   db    governance, security and provenance against a real PostgreSQL database (hq_test)
 *   api   REST and MCP over HTTP against a running production build
 *
 * The db and api projects reset and reseed their database themselves, so every run starts
 * from the same state and can be repeated.
 */
const alias = { "@": path.resolve(import.meta.dirname, "src") };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        resolve: { alias },
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/helpers/env.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "api",
          include: ["tests/api/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/helpers/env.ts"],
          globalSetup: ["tests/helpers/server.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
