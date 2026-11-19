/**
 * Run by 07-odd-values.spec.ts (through tsx, as plant-claimed-build.ts is). Stores, as the owner and as
 * an import would, records whose fields hold values of the wrong kind (tests/helpers/odd-values.ts).
 *
 *   npx tsx tests/e2e/plant-odd-values.ts named   the four named cases and a few more, on new records
 *   npx tsx tests/e2e/plant-odd-values.ts fuzz    every field of one record of every type, seven values, four ways
 *   npx tsx tests/e2e/plant-odd-values.ts screens the screens verifier's records (ROUND4 H6) and a build whose statement is a submitter's claim
 *
 * Prints the planted records as JSON ({ type, id }[]) on its last line. Uses the TEST database only
 * (tests/helpers/env.ts).
 */
import "../helpers/env";
import { fuzz, named, plantOddRecords, screensCases, submitterClaimBuild } from "../helpers/odd-values";

async function main() {
  const which = process.argv[2];
  const records = which === "fuzz" ? fuzz() : which === "named" ? named() : which === "screens" ? [...screensCases(), submitterClaimBuild()] : null;
  if (!records) throw new Error("say which: named, fuzz or screens");
  await plantOddRecords(records, `Records holding values of the wrong kind (browser test, ${which})`);
  console.log(JSON.stringify(records.map(({ type, id }) => ({ type, id }))));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
