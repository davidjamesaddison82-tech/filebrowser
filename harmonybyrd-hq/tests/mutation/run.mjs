#!/usr/bin/env node
/**
 * Mutation check of the database tests.
 *
 *   npm run test:mutation                 every mutation (about 25 s each)
 *   npm run test:mutation -- m01_founder_role mq3_quote_not_found
 *   npm run test:mutation -- --list
 *
 * For each mutation: reset the mutation database, apply ONE deliberate breakage of a database
 * protection, run the whole tests/db suite, and record which tests failed. A mutation that no test
 * fails for has SURVIVED: the protection it removes is not tested. The run exits non-zero if any
 * mutation survives, if a mutation could not be applied, or if the unmutated control run fails.
 *
 * Uses its own database (HQ_MUTATION_DATABASE, default hq_test_mutation). Never touches hq_dev.
 * A full run (no mutation named) writes tests/mutation/RESULTS.txt, whose first line names the commit
 * it ran against (and whether there were uncommitted changes), the date and the number of mutations.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { codeUnderTest, resultsText, shouldWriteResults } from "./results-file.mjs";

const here = import.meta.dirname;
const repo = path.resolve(here, "..", "..");
const mutDir = path.join(here, "mut");
const outDir = path.join(repo, "test-results", "mutation");
const database = process.env.HQ_MUTATION_DATABASE ?? "hq_test_mutation";
if (!/^hq_test(_[a-z0-9_]+)?$/.test(database)) {
  console.error(`Refusing to use database "${database}": the mutation database name must start with hq_test.`);
  process.exit(2);
}

const gen = spawnSync("python3", ["-I", path.join(here, "gen.py")], { cwd: here, encoding: "utf8" });
if (gen.status !== 0) {
  console.error(gen.stdout, gen.stderr);
  process.exit(2);
}
const all = readdirSync(mutDir).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, -4)).sort();
const args = process.argv.slice(2);
if (args.includes("--list")) {
  console.log(all.join("\n"));
  process.exit(0);
}
const wanted = args.filter((a) => !a.startsWith("--"));
const unknown = wanted.filter((w) => w !== "noop" && !all.includes(w));
if (unknown.length) {
  console.error(`Unknown mutation(s): ${unknown.join(", ")}. Use --list.`);
  process.exit(2);
}
const names = ["noop", ...(wanted.length ? wanted.filter((w) => w !== "noop") : all.filter((n) => n !== "noop"))];
mkdirSync(outDir, { recursive: true });

function run(name) {
  const report = path.join(outDir, `${name}.json`);
  rmSync(report, { force: true });
  const env = { ...process.env, HQ_TEST_DATABASE: database, NO_COLOR: "1", FORCE_COLOR: "0" };
  if (name !== "noop") env.MUTATION_FILE = path.join(mutDir, `${name}.sql`);
  else delete env.MUTATION_FILE;
  const r = spawnSync("npx", ["vitest", "run", "--config", path.join(here, "vitest.mut.config.mjs"), "--reporter=json", `--outputFile.json=${report}`], {
    cwd: repo,
    env,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (!existsSync(report)) return { name, error: `no report (exit ${r.status}): ${(r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" | ")}`, passed: 0, failed: [] };
  const data = JSON.parse(readFileSync(report, "utf8"));
  let passed = 0;
  const failed = [];
  let setupError = null;
  for (const file of data.testResults) {
    const short = path.basename(file.name).replace(/\.test\.ts$/, "");
    // A file-level failure with no assertions means the mutation itself (or the set-up) blew up.
    if (file.message && file.assertionResults.length === 0) setupError = `${short}: ${String(file.message).split("\n")[0].slice(0, 200)}`;
    for (const a of file.assertionResults) {
      if (a.status === "passed") passed += 1;
      else failed.push(`${short} › ${a.title}`);
    }
  }
  return { name, passed, failed, error: setupError };
}

const lines = [];
let survivors = 0;
let broken = 0;
for (const name of names) {
  const r = run(name);
  let line;
  if (name === "noop") {
    const ok = !r.error && r.failed.length === 0 && r.passed > 0;
    line = `noop (control, no mutation) → ${ok ? `none fail; ${r.passed} tests pass` : `CONTROL FAILED: ${r.error ?? r.failed.slice(0, 3).join("; ")}`}`;
    if (!ok) broken += 1;
  } else if (r.error && r.failed.length === 0) {
    line = `${name} → COULD NOT RUN: ${r.error}`;
    broken += 1;
  } else if (r.failed.length === 0) {
    line = `${name} → SURVIVED (no test failed)`;
    survivors += 1;
  } else {
    line = `${name} → ${r.failed.length}: ${r.failed[0]}${r.failed.length > 1 ? ` (+${r.failed.length - 1} more)` : ""}`;
  }
  console.log(line);
  lines.push(line);
  if (name === "noop" && broken) break;
}
const summary = `${names.length - 1} mutation(s) run against database ${database}: ${names.length - 1 - survivors - (broken && lines[0].includes("CONTROL") ? 0 : broken)} caught, ${survivors} survived, ${broken} could not run.`;
console.log(`\n${summary}`);
if (shouldWriteResults(wanted)) {
  writeFileSync(
    path.join(here, "RESULTS.txt"),
    resultsText({ lines, summary, code: codeUnderTest(repo), date: new Date(), count: names.length - 1 }),
  );
}
process.exit(survivors || broken ? 1 : 0);
