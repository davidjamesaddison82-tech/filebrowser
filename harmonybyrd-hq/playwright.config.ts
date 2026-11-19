import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests. They run against a production build of HQ, served on its own port against the
 * TEST database, which tests/e2e/serve.ts resets and reseeds with the synthetic fixture pack
 * before every run. The development database is never touched.
 *
 * The spec files run in name order with one worker, because they share that database:
 * 00 and 03b test the browser guard and the layout detector on pages of their own (no database);
 * 01–04 change no record (04 adds one developer proposal to the inbox, which stays unreviewed);
 * 05 exercises the governance workflow and creates new dataset revisions; 06 adds proposals, one
 * planted build and one planted proposal to check what the review screens say about them; 07 runs last
 * and stores records holding values of the wrong kind, to check that every screen still works and shows
 * them as not valid.
 */
const PORT = Number(process.env.HQ_E2E_PORT ?? 3212);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results/e2e",
  reporter: [["list"], ["json", { outputFile: "test-results/e2e-results.json" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1366, height: 768 },
  },
  webServer: {
    command: "npx tsx tests/e2e/serve.ts",
    url: `http://127.0.0.1:${PORT}/sign-in`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
