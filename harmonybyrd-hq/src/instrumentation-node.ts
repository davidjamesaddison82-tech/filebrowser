/**
 * Start-up check (Node.js runtime only; imported by instrumentation.ts).
 *
 * HQ refuses to start with a session secret that is still the published placeholder or shorter
 * than 32 characters, or with a placeholder database password: either would let anyone who has
 * read .env.example forge a founder session or log in to the database.
 */
import { environmentProblem } from "./lib/auth/environment";

const problem = environmentProblem(process.env);
if (problem) {
  console.error(`HarmonyByrd HQ will not start: ${problem}`);
  // Exit rather than throw: a thrown error here is logged, but the server would go on serving.
  process.exit(1);
}
