/**
 * Global setup for the api project: build once if needed, then run the production server
 * against the TEST database on its own port. Tests talk to it over real HTTP.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";
import { TEST_ADMIN_URL, TEST_APP_URL, TEST_BASE_URL, TEST_JWT_SECRET, TEST_PORT } from "./env";

const root = path.resolve(import.meta.dirname, "..", "..");

export function serverEnv(baseUrl: string = TEST_BASE_URL, overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HQ_ADMIN_DATABASE_URL: TEST_ADMIN_URL,
    DATABASE_URL: TEST_APP_URL,
    HQ_JWT_SECRET: TEST_JWT_SECRET,
    HQ_BASE_URL: baseUrl,
    HQ_INSECURE_COOKIES: "1",
    HQ_GITHUB_TOKEN: "",
    HQ_GITHUB_REPOSITORIES: "",
    HQ_GOOGLE_DRIVE_ACCESS_TOKEN: "",
    HQ_GOOGLE_DRIVE_FILE_IDS: "",
    // Sign-in delays are short on the test server (the production default is 500 ms; see throttle.ts).
    HQ_SIGNIN_BASE_DELAY_MS: "200",
    HQ_TRUST_PROXY: "",
    HQ_MAX_BODY_BYTES: "",
    NEXT_TELEMETRY_DISABLED: "1",
    ...overrides,
  };
}

export function ensureBuild(): void {
  if (existsSync(path.join(root, ".next", "BUILD_ID")) && process.env.HQ_TEST_REBUILD !== "1") return;
  const result = spawnSync("npx", ["next", "build"], { cwd: root, env: serverEnv(), stdio: "inherit" });
  if (result.status !== 0) throw new Error("next build failed");
}

/**
 * Start the built server. With `logFile`, everything it prints is also appended to that file, so a
 * test can check that what it did left no error in the server's output (tests/api/odd-values.test.ts).
 */
export async function startServer(port: number, overrides: Record<string, string> = {}, logFile?: string): Promise<ChildProcess> {
  // Run Next directly (not through npx) so that stopping the child stops the server itself.
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: root,
    env: serverEnv(`http://127.0.0.1:${port}`, overrides),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  const keep = (d: Buffer) => {
    log += d;
    if (logFile) appendFileSync(logFile, d);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/sign-in`);
      if (res.ok) return child;
    } catch {
      /* not up yet */
    }
    if (child.exitCode !== null) throw new Error(`server exited early:\n${log}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill();
  throw new Error(`server did not start within 60s:\n${log}`);
}

declare module "vitest" {
  export interface ProvidedContext {
    /** The process id of the test server, so a test can read its memory use (tests/api/sign-in.test.ts). */
    serverPid: number;
    /** A file that holds everything the test server has printed (outside the repository). */
    serverLog: string;
  }
}

export default async function setup(project: TestProject) {
  ensureBuild();
  const logFile = path.join(mkdtempSync(path.join(os.tmpdir(), "hq-api-server-")), "server.log");
  const child = await startServer(TEST_PORT, {}, logFile);
  if (child.pid !== undefined) project.provide("serverPid", child.pid);
  project.provide("serverLog", logFile);
  return async () => {
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("exit", resolve);
      setTimeout(resolve, 3000);
    });
  };
}
