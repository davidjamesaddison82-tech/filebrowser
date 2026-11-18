/**
 * Import an evidence pack into the database as a new dataset revision.
 *
 *   npm run db:seed                       import the pack at HQ_PACK_DIR
 *   npm run db:seed -- data/packs/fixture import a specific pack
 *   npm run db:seed -- <dir> --retire     also retire imported records that the pack no longer contains
 *
 * The pack is validated first. If any record fails its schema or any quotation is not found
 * verbatim in the cited source snapshot, nothing is imported.
 *
 * The normalised text of every source snapshot is stored in hq.source_texts in the same
 * transaction, so the database can check quotations in proposals against the same text the pack
 * gate used. The revision summary names the pack's kind, id, version and content hash.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type LoadedPack, loadPack, normaliseForQuote } from "../src/lib/domain/pack";
import { adminClient } from "./lib/admin";
import { loadEnv, projectRoot } from "./lib/env";
import { ensurePrincipal } from "./lib/principals";

export interface SourceTextRow {
  source_id: string;
  text_norm: string;
  sha256: string;
  chars: number;
}

/**
 * Every snapshot in <pack>/source-text, normalised exactly as the pack gate normalises it.
 * sha256 and chars describe the file's bytes, as a source record's text_snapshot does.
 */
export function sourceTextRows(packDir: string): SourceTextRow[] {
  const dir = path.join(packDir, "source-text");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /^SRC-[A-Z0-9][A-Z0-9.-]{0,60}\.md$/.test(file))
    .sort()
    .map((file) => {
      const bytes = readFileSync(path.join(dir, file));
      return {
        source_id: file.slice(0, -".md".length),
        text_norm: normaliseForQuote(bytes.toString("utf8")),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        chars: bytes.length,
      };
    });
}

/** The revision summary of an import: which kind of pack, which pack, which version, which content. */
export function importSummary(manifest: LoadedPack["manifest"], contentSha256: string): string {
  return `Import of ${manifest.kind} pack "${manifest.pack_id}" ${manifest.version} (content sha256 ${contentSha256})`;
}

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
    const texts = sourceTextRows(dir);
    // Texts and records go in together: a proposal must never be checked against texts from a
    // different import than the records it cites.
    await client.query("begin");
    let r: { rev: number; changed: number; retired: number; unchanged: number; diverged: unknown[] };
    let textsChanged: number;
    try {
      textsChanged = (await client.query<{ n: number }>("select hq.admin_put_source_texts($1::jsonb) as n", [JSON.stringify(texts)])).rows[0].n;
      const result = await client.query<{ r: typeof r }>("select hq.admin_put_records($1::jsonb, $2, $3, $4, $5) as r", [
        JSON.stringify(payload),
        importSummary(pack.manifest, pack.stats.content_sha256),
        pack.manifest.commission_ref ?? null,
        "hq-import",
        options.retire ?? false,
      ]);
      r = result.rows[0].r;
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
    log(`  dataset revision ${r.rev}: ${r.changed} written, ${r.retired} retired, ${r.unchanged} unchanged, ${r.diverged.length} diverged`);
    log(`  source texts for quotation checks: ${texts.length} stored, ${textsChanged} new or changed`);
    if (r.diverged.length > 0) {
      log("  Diverged records were changed through HQ governance after import and were NOT overwritten:");
      for (const d of r.diverged as { type: string; id: string }[]) log(`    ${d.type} ${d.id}`);
    }
    return { ...r, pack, source_texts: { stored: texts.length, changed: textsChanged } };
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
