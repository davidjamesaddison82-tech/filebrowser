/**
 * Run by 07-odd-values.spec.ts (through tsx, as plant-claimed-build.ts is). Stores, as the owner and as
 * an import would, records whose fields hold values of the wrong kind (tests/helpers/odd-values.ts).
 *
 *   npx tsx tests/e2e/plant-odd-values.ts named   the four named cases and a few more, on new records
 *   npx tsx tests/e2e/plant-odd-values.ts fuzz    every field of one record of every type, seven values, four ways
 *
 * Prints the planted records as JSON ({ type, id }[]) on its last line. Uses the TEST database only
 * (tests/helpers/env.ts).
 */
import "../helpers/env";
import { fuzz, named, plantOddRecords } from "../helpers/odd-values";

async function main() {
  const which = process.argv[2];
  const records = which === "fuzz" ? fuzz() : which === "named" ? named() : null;
  if (!records) throw new Error("say which: named or fuzz");
  await plantOddRecords(records, `Records holding values of the wrong kind (browser test, ${which})`);
  console.log(JSON.stringify(records.map(({ type, id }) => ({ type, id }))));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
