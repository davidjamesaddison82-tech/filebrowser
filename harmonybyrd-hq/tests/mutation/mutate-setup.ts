/**
 * Mutation harness set-up. After the suite's own freshWorld() has reset, migrated and seeded the
 * test database, apply the SQL in $MUTATION_FILE with the owner connection. Each mutation file
 * re-creates one database function or drops one trigger with a single guard removed, and aborts
 * loudly if the text it means to replace is not there — a mutation can never silently do nothing.
 *
 * APP_MUT=readAs-writable additionally makes the application's read path use a writable transaction.
 */
import { readFileSync } from "node:fs";
import { vi } from "vitest";

type DbHelpers = typeof import("../helpers/db");
type ServerDb = typeof import("../../src/lib/server/db");

vi.mock("../helpers/db", async (importOriginal) => {
  const mod = await importOriginal<DbHelpers>();
  return {
    ...mod,
    freshWorld: async () => {
      const world = await mod.freshWorld();
      const file = process.env.MUTATION_FILE;
      if (file) {
        const client = await mod.admin();
        try {
          await client.query(readFileSync(file, "utf8"));
        } finally {
          await client.end();
        }
      }
      return world;
    },
  };
});

vi.mock("../../src/lib/server/db", async (importOriginal) => {
  const mod = await importOriginal<ServerDb>();
  if (process.env.APP_MUT !== "readAs-writable") return mod;
  return { ...mod, readAs: mod.writeAs };
});
