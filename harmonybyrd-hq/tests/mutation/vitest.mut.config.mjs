// Runs the real database suite (tests/db) with one deliberate breakage applied after each file's setup.
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..", "..");
const alias = { "@": path.join(repo, "src") };

export default {
  root: repo,
  resolve: { alias },
  test: {
    name: "db-mutation",
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    setupFiles: [path.join(repo, "tests/helpers/env.ts"), path.join(repo, "tests/mutation/mutate-setup.ts")],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
};
