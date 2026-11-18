/**
 * The application's own check of its environment, run before it serves anything.
 *
 * The rule is the one `npm run setup` applies (scripts/lib/setup-files.ts environmentProblem): a
 * secret that is still the published placeholder, or shorter than 32 characters, must never sign
 * sessions, and a placeholder password must never reach the database. Reusing that function keeps
 * the two checks from drifting apart.
 */
import { environmentProblem } from "../../../scripts/lib/setup-files";

export { environmentProblem };

/** Throw with a clear message when the environment cannot be used. */
export function assertUsableEnvironment(env: Record<string, string | undefined> = process.env): void {
  const problem = environmentProblem(env);
  if (problem) throw new Error(`HarmonyByrd HQ will not start: ${problem}`);
}
