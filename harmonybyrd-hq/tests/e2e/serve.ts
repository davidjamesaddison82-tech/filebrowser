/**
 * Started by Playwright (see playwright.config.ts → webServer).
 * Resets the TEST database, imports the synthetic fixture pack, creates the test identities,
 * builds the application if there is no build, and serves it until Playwright stops this process.
 */
import "../helpers/env";
import { freshWorld } from "../helpers/db";
import { ensureBuild, startServer } from "../helpers/server";

const port = Number(process.env.HQ_E2E_PORT ?? 3212);

async function main() {
  const world = await freshWorld();
  console.log(`[e2e] test database reset; fixture imported at dataset revision ${world.headRev}`);
  ensureBuild();
  const child = await startServer(port);
  console.log(`[e2e] serving on http://127.0.0.1:${port}`);
  const stop = () => {
    child.kill("SIGTERM");
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  child.once("exit", (code) => process.exit(code ?? 0));
  await new Promise(() => undefined);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
