/**
 * Import an evidence pack into the database as a new dataset revision.
 *
 *   npm run db:seed                       import the pack at HQ_PACK_DIR
 *   npm run db:seed -- data/packs/fixture import a specific pack
 *   npm run db:seed -- <dir> --retire     also retire imported records that the pack no longer contains
 *
 * The pack is validated first. If any record fails its schema or any quotation is not found
 * verbatim in the cited source snapshot, nothing is imported.
 */
import path from "node:path";
import { loadPack } from "../src/lib/domain/pack";
import { adminClient } from "./lib/admin";
import { loadEnv, projectRoot } from "./lib/env";
import { ensurePrincipal } from "./lib/principals";

export async function seed(options: { packDir?: string; adminUrl?: string; retire?: boolean; quiet?: boolean } = {}) {
  loadEnv();
  const log = (line: string) => {
    if (!options.quiet) console.log(line);
  };
  const dir = path.resolve(projectRoot(), options.packDir ?? process.env.HQ_PACK_DIR ?? "data/packs/fixture");
  const pack = loadPack(dir);
  const errors = pack.problems.filter((p) => p.severity === "error");
  const warnings = pack.problems.filter((p) => p.severity === "warning");
  log(`Pack "${pack.manifest.title}" (${pack.manifest.kind}, ${pack.manifest.version})`);
  log(`  ${pack.records.length} valid records, ${pack.stats.citations_verified}/${pack.stats.citations} quotations verified, ${warnings.length} warnings`);
  if (errors.length > 0) {
    for (const problem of errors.slice(0, 40)) console.error(`  ERROR ${problem.type} ${problem.id}: ${problem.message}`);
    throw new Error(`Pack has ${errors.length} error(s); nothing was imported.`);
  }

  const client = await adminClient(options.adminUrl);
  try {
    await ensurePrincipal(client, { handle: "hq-import", displayName: "HQ evidence import", kind: "service", appRole: "reader" });
    const payload = pack.records.map((r) => ({ type: r.type, id: r.id, data: r.data }));
    const result = await client.query<{ r: { rev: number; changed: number; retired: number; unchanged: number; diverged: unknown[] } }>(
      "select hq.admin_put_records($1::jsonb, $2, $3, $4, $5) as r",
      [
        JSON.stringify(payload),
        `Import of evidence pack "${pack.manifest.pack_id}" ${pack.manifest.version} (pack hash ${pack.stats.content_sha256.slice(0, 16)}…)`,
        pack.manifest.commission_ref ?? null,
        "hq-import",
        options.retire ?? false,
      ],
    );
    const r = result.rows[0].r;
    log(`  dataset revision ${r.rev}: ${r.changed} written, ${r.retired} retired, ${r.unchanged} unchanged, ${r.diverged.length} diverged`);
    if (r.diverged.length > 0) {
      log("  Diverged records were changed through HQ governance after import and were NOT overwritten:");
      for (const d of r.diverged as { type: string; id: string }[]) log(`    ${d.type} ${d.id}`);
    }
    return { ...r, pack };
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const packDir = args.find((a) => !a.startsWith("--"));
  seed({ packDir, retire: args.includes("--retire") }).catch((error) => {
    console.error(String(error.message ?? error));
    process.exit(1);
  });
}
