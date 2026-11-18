/**
 * Acceptance check 13: repeatable results from the same commit.
 *
 *   npm run test:repeat              unit + database suites, twice
 *   npm run test:repeat -- --full    also the HTTP and browser suites, twice (slower)
 *
 * Each pass starts from a freshly reset and reseeded test database. The two passes must agree on
 *   - the outcome of every single test, by name;
 *   - the content hash of the fixture pack and of the dataset revision it produces.
 * Writes test-results/repeatability.json and exits non-zero on any difference.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadPack } from "../src/lib/domain/pack";
import { loadEnv, projectRoot } from "./lib/env";
import { gitInfo, RESULTS_DIR, runPlaywright, runVitest, type SuiteResult } from "./lib/suites";
import { migrate } from "./migrate";
import { seed } from "./seed";

loadEnv();
const root = projectRoot();
const full = process.argv.includes("--full");
mkdirSync(path.join(root, RESULTS_DIR, "logs"), { recursive: true });

function testUrls() {
  const withDb = (url: string) => {
    const u = new URL(url);
    u.pathname = `/${process.env.HQ_TEST_DATABASE ?? "hq_test"}`;
    return u.toString();
  };
  return {
    admin: process.env.HQ_TEST_ADMIN_DATABASE_URL ?? withDb(process.env.HQ_ADMIN_DATABASE_URL!),
    app: process.env.HQ_TEST_DATABASE_URL ?? withDb(process.env.DATABASE_URL!),
  };
}

async function seedHash(): Promise<{ pack: string; dataset: string; records: number }> {
  const { admin, app } = testUrls();
  await migrate({ reset: true, adminUrl: admin, appUrl: app, quiet: true });
  const result = await seed({ packDir: "data/packs/fixture", adminUrl: admin, quiet: true });
  const client = new pg.Client({ connectionString: admin });
  await client.connect();
  try {
    const row = await client.query<{ content_hash: string; record_count: number }>("select content_hash, record_count from hq.dataset_revisions where rev = $1", [result.rev]);
    return { pack: loadPack(path.join(root, "data/packs/fixture")).stats.content_sha256, dataset: row.rows[0].content_hash, records: row.rows[0].record_count };
  } finally {
    await client.end();
  }
}

function pass(tag: string): SuiteResult[] {
  const suites = [runVitest("unit", "Unit tests", "unit", tag), runVitest("db", "Database tests", "db", tag)];
  if (full) {
    suites.push(runVitest("api", "HTTP tests (REST and MCP)", "api", tag));
    suites.push(runPlaywright("e2e", "Browser tests", tag));
  }
  return suites;
}

async function main() {
  const hash1 = await seedHash();
  const first = pass("-pass1");
  const hash2 = await seedHash();
  const second = pass("-pass2");

  const differences: string[] = [];
  if (hash1.pack !== hash2.pack) differences.push(`fixture pack hash differs: ${hash1.pack} vs ${hash2.pack}`);
  if (hash1.dataset !== hash2.dataset) differences.push(`dataset revision hash differs: ${hash1.dataset} vs ${hash2.dataset}`);
  const comparison = first.map((a, i) => {
    const b = second[i];
    const mapB = new Map(b.outcomes.map((o) => [o.name, o.status]));
    const mapA = new Map(a.outcomes.map((o) => [o.name, o.status]));
    for (const [name, status] of mapA) {
      if (!mapB.has(name)) differences.push(`${a.key}: "${name}" ran in pass 1 only`);
      else if (mapB.get(name) !== status) differences.push(`${a.key}: "${name}" was ${status} in pass 1 and ${mapB.get(name)} in pass 2`);
    }
    for (const name of mapB.keys()) if (!mapA.has(name)) differences.push(`${a.key}: "${name}" ran in pass 2 only`);
    return {
      suite: a.key,
      pass1: { passed: a.passed, failed: a.failed, skipped: a.skipped, duration_s: a.duration_s },
      pass2: { passed: b.passed, failed: b.failed, skipped: b.skipped, duration_s: b.duration_s },
      tests_compared: mapA.size,
    };
  });
  const failed = [...first, ...second].reduce((n, s) => n + s.failed, 0);
  const report = {
    generated_at: new Date().toISOString(),
    git: gitInfo(),
    scope: full ? "unit, database, HTTP and browser suites" : "unit and database suites",
    fixture_pack_sha256: { pass1: hash1.pack, pass2: hash2.pack },
    dataset_revision_hash: { pass1: hash1.dataset, pass2: hash2.dataset, records: hash1.records },
    comparison,
    differences,
    identical: differences.length === 0,
    failed_tests_in_either_pass: failed,
  };
  writeFileSync(path.join(root, RESULTS_DIR, "repeatability.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const c of comparison) console.log(`${c.suite}: pass 1 ${c.pass1.passed}/${c.pass1.failed}/${c.pass1.skipped}, pass 2 ${c.pass2.passed}/${c.pass2.failed}/${c.pass2.skipped} (passed/failed/skipped), ${c.tests_compared} tests compared`);
  console.log(`fixture pack hash: ${hash1.pack === hash2.pack ? "identical" : "DIFFERENT"}; dataset revision hash: ${hash1.dataset === hash2.dataset ? "identical" : "DIFFERENT"} (${hash1.dataset})`);
  console.log(differences.length === 0 ? "Repeatable: both passes agree on every test and on both hashes." : `NOT repeatable:\n  ${differences.join("\n  ")}`);
  process.exit(differences.length === 0 && failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
