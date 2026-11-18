/**
 * Verify an evidence pack without importing it: schemas, verbatim quotations, references.
 *   npm run pack:verify -- data/packs/fixture
 */
import path from "node:path";
import { loadPack } from "../src/lib/domain/pack";
import { loadEnv, projectRoot } from "./lib/env";

loadEnv();
const dir = path.resolve(projectRoot(), process.argv[2] ?? process.env.HQ_PACK_DIR ?? "data/packs/fixture");
const pack = loadPack(dir);
const errors = pack.problems.filter((p) => p.severity === "error");
const warnings = pack.problems.filter((p) => p.severity === "warning");
console.log(`Pack: ${pack.manifest.title} — ${pack.manifest.kind} — ${pack.manifest.version}`);
console.log(`Records: ${JSON.stringify(pack.stats.records)}`);
console.log(`Quotations: ${pack.stats.citations_verified} of ${pack.stats.citations} verified verbatim against ${pack.stats.sources_with_text} source snapshots`);
console.log(`Content SHA-256: ${pack.stats.content_sha256}`);
for (const w of warnings.slice(0, process.argv.includes("--all") ? 10_000 : 25)) console.log(`warning  ${w.type} ${w.id}: ${w.message}`);
if (warnings.length > 25 && !process.argv.includes("--all")) console.log(`… ${warnings.length - 25} more warnings (use --all)`);
for (const e of errors) console.log(`ERROR    ${e.type} ${e.id}: ${e.message}`);
console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
