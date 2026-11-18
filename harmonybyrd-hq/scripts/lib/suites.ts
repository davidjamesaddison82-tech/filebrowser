/**
 * Runs the test suites as child processes and reads their machine-written reports.
 * Counts are taken from the reporters' JSON, never from parsing console text.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./env";

export interface TestOutcome {
  name: string;
  status: "passed" | "failed" | "skipped";
}

export interface SuiteResult {
  key: string;
  title: string;
  command: string;
  ran: boolean;
  exit_code: number | null;
  passed: number;
  failed: number;
  skipped: number;
  duration_s: number;
  failures: string[];
  skipped_tests: string[];
  outcomes: TestOutcome[];
  log_file: string;
  log_sha256: string | null;
  note?: string;
}

export const RESULTS_DIR = "test-results";

function sha256(file: string): string | null {
  return existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null;
}

function run(command: string, args: string[], logFile: string, env: Record<string, string> = {}): { code: number | null; seconds: number } {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: projectRoot(),
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", CI: "1", NEXT_TELEMETRY_DISABLED: "1", ...env },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  mkdirSync(path.dirname(logFile), { recursive: true });
  writeFileSync(logFile, `$ ${command} ${args.join(" ")}\n\n${result.stdout ?? ""}\n${result.stderr ?? ""}\n[exit ${result.status}]\n`);
  return { code: result.status, seconds: Math.round((Date.now() - started) / 100) / 10 };
}

function base(key: string, title: string, command: string, logFile: string): SuiteResult {
  return { key, title, command, ran: false, exit_code: null, passed: 0, failed: 0, skipped: 0, duration_s: 0, failures: [], skipped_tests: [], outcomes: [], log_file: logFile, log_sha256: null };
}

export function runCommandSuite(key: string, title: string, command: string, args: string[], tag = ""): SuiteResult {
  const root = projectRoot();
  const logFile = path.join(RESULTS_DIR, "logs", `${key}${tag}.log`);
  const suite = base(key, title, `${command} ${args.join(" ")}`, logFile);
  const { code, seconds } = run(command, args, path.join(root, logFile));
  suite.ran = true;
  suite.exit_code = code;
  suite.duration_s = seconds;
  suite.passed = code === 0 ? 1 : 0;
  suite.failed = code === 0 ? 0 : 1;
  suite.outcomes = [{ name: title, status: code === 0 ? "passed" : "failed" }];
  if (code !== 0) suite.failures = [`${title}: exit code ${code} (see ${logFile})`];
  suite.log_sha256 = sha256(path.join(root, logFile));
  return suite;
}

interface VitestReport {
  testResults: { name: string; assertionResults: { fullName: string; status: string }[] }[];
}

export function runVitest(key: string, title: string, project: string, tag = ""): SuiteResult {
  const root = projectRoot();
  const report = path.join(RESULTS_DIR, `${key}${tag}.json`);
  const logFile = path.join(RESULTS_DIR, "logs", `${key}${tag}.log`);
  const args = ["vitest", "run", "--project", project, "--reporter=default", "--reporter=json", `--outputFile.json=${report}`];
  const suite = base(key, title, `npx ${args.slice(0, 4).join(" ")}`, logFile);
  rmSync(path.join(root, report), { force: true });
  const { code, seconds } = run("npx", args, path.join(root, logFile));
  suite.ran = true;
  suite.exit_code = code;
  suite.duration_s = seconds;
  suite.log_sha256 = sha256(path.join(root, logFile));
  if (!existsSync(path.join(root, report))) {
    suite.failed = 1;
    suite.failures = [`${title}: the run produced no report (exit code ${code}; see ${logFile})`];
    return suite;
  }
  const data = JSON.parse(readFileSync(path.join(root, report), "utf8")) as VitestReport;
  for (const file of data.testResults) {
    const fileName = path.relative(root, file.name);
    for (const a of file.assertionResults) {
      const name = `${fileName} › ${a.fullName}`;
      const status = a.status === "passed" ? "passed" : a.status === "failed" ? "failed" : "skipped";
      suite.outcomes.push({ name, status });
    }
  }
  tally(suite);
  if (code !== 0 && suite.failed === 0) {
    suite.failed = 1;
    suite.failures.push(`${title}: exit code ${code} with no failing test reported (see ${logFile})`);
  }
  return suite;
}

interface PwSuite {
  title: string;
  file?: string;
  suites?: PwSuite[];
  specs?: { title: string; tests: { status: string; results: { status: string }[] }[] }[];
}

export function runPlaywright(key: string, title: string, tag = ""): SuiteResult {
  const root = projectRoot();
  const report = path.join(RESULTS_DIR, "e2e-results.json");
  const logFile = path.join(RESULTS_DIR, "logs", `${key}${tag}.log`);
  const suite = base(key, title, "npx playwright test --trace off", logFile);
  rmSync(path.join(root, report), { force: true });
  const { code, seconds } = run("npx", ["playwright", "test", "--trace", "off"], path.join(root, logFile));
  suite.ran = true;
  suite.exit_code = code;
  suite.duration_s = seconds;
  suite.log_sha256 = sha256(path.join(root, logFile));
  if (!existsSync(path.join(root, report))) {
    suite.failed = 1;
    suite.failures = [`${title}: the run produced no report (exit code ${code}; see ${logFile})`];
    return suite;
  }
  const data = JSON.parse(readFileSync(path.join(root, report), "utf8")) as { suites: PwSuite[] };
  const walk = (s: PwSuite, trail: string[]) => {
    const here = s.title ? [...trail, s.title] : trail;
    for (const spec of s.specs ?? []) {
      for (const t of spec.tests) {
        const name = [...here, spec.title].join(" › ");
        const status = t.status === "expected" ? "passed" : t.status === "skipped" ? "skipped" : "failed";
        suite.outcomes.push({ name, status });
      }
    }
    for (const child of s.suites ?? []) walk(child, here);
  };
  for (const s of data.suites) walk(s, []);
  if (tag) {
    const kept = path.join(RESULTS_DIR, `e2e-results${tag}.json`);
    writeFileSync(path.join(root, kept), readFileSync(path.join(root, report)));
  }
  tally(suite);
  if (code !== 0 && suite.failed === 0) {
    suite.failed = 1;
    suite.failures.push(`${title}: exit code ${code} with no failing test reported (see ${logFile})`);
  }
  return suite;
}

function tally(suite: SuiteResult): void {
  suite.outcomes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  suite.passed = suite.outcomes.filter((o) => o.status === "passed").length;
  suite.failed = suite.outcomes.filter((o) => o.status === "failed").length;
  suite.skipped = suite.outcomes.filter((o) => o.status === "skipped").length;
  suite.failures = suite.outcomes.filter((o) => o.status === "failed").map((o) => o.name);
  suite.skipped_tests = suite.outcomes.filter((o) => o.status === "skipped").map((o) => o.name);
}

export function gitInfo(): { commit: string | null; branch: string | null; dirty: boolean | null } {
  const git = (args: string[]) => {
    const r = spawnSync("git", args, { cwd: projectRoot(), encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const status = git(["status", "--porcelain", "--", "."]);
  return { commit: git(["rev-parse", "HEAD"]), branch: git(["rev-parse", "--abbrev-ref", "HEAD"]), dirty: status === null ? null : status.length > 0 };
}
