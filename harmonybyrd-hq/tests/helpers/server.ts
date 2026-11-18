/**
 * Global setup for the api project: build once if needed, then run the production server
 * against the TEST database on its own port. Tests talk to it over real HTTP.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { TEST_ADMIN_URL, TEST_APP_URL, TEST_BASE_URL, TEST_JWT_SECRET, TEST_PORT } from "./env";

const root = path.resolve(import.meta.dirname, "..", "..");

export function serverEnv(baseUrl: string = TEST_BASE_URL): NodeJS.ProcessEnv {
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
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

export function ensureBuild(): void {
  if (existsSync(path.join(root, ".next", "BUILD_ID")) && process.env.HQ_TEST_REBUILD !== "1") return;
  const result = spawnSync("npx", ["next", "build"], { cwd: root, env: serverEnv(), stdio: "inherit" });
  if (result.status !== 0) throw new Error("next build failed");
}

export async function startServer(port: number): Promise<ChildProcess> {
  // Run Next directly (not through npx) so that stopping the child stops the server itself.
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: root,
    env: serverEnv(`http://127.0.0.1:${port}`),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.on("data", (d) => (log += d));
  child.stderr?.on("data", (d) => (log += d));
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

export default async function setup() {
  ensureBuild();
  const child = await startServer(TEST_PORT);
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
