/**
 * Validate a synthesis fragment (a partial evidence pack for one cluster of sources).
 *
 *   npx tsx scripts/validate-fragment.ts <fragment.json> --texts <source-text dir> --registry <module-registry.json>
 *
 * Checks every record against the HQ schemas, verifies every quotation verbatim against the
 * cited source's text snapshot, and checks that module references use canonical module ids.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { SourceTexts, validateRecords } from "../src/lib/domain/pack";
import { Capability, Citation, Claim, EPISTEMIC, LIFECYCLE_DIMENSIONS, LIFECYCLE_STATES } from "../src/lib/domain/schemas";
import { collectCitations } from "../src/lib/domain/dataset";

const args = process.argv.slice(2);
const file = args[0];
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const textsDir = flag("--texts");
const registryFile = flag("--registry");
if (!file || !textsDir || !registryFile) {
  console.error("usage: validate-fragment.ts <fragment.json> --texts <dir> --registry <module-registry.json>");
  process.exit(2);
}

const KEYS: Record<string, string> = {
  modules: "module",
  loops: "loop",
  pathways: "pathway",
  requirements: "requirement",
  decisions: "decision",
  commissions: "commission",
  builds: "build",
  evidence: "evidence",
  defects: "defect",
  open_items: "open_item",
};

const Addendum = z.object({
  module_id: z.string(),
  aliases: z.array(z.string()).default([]),
  capabilities: z.array(Capability).default([]),
  ui_requirements: z.array(Claim).default([]),
  blockers: z.array(Claim).default([]),
  next_actions: z.array(Claim).default([]),
  connections: z
    .array(z.object({ to: z.string(), nature: z.string().min(1), epistemic: z.enum(EPISTEMIC), citations: z.array(Citation).default([]) }))
    .default([]),
  lifecycle: z
    .partialRecord(
      z.enum(LIFECYCLE_DIMENSIONS),
      z.object({ state: z.enum(LIFECYCLE_STATES), basis: z.enum(EPISTEMIC), note: z.string().default(""), citations: z.array(Citation).default([]) }),
    )
    .default({}),
  citations: z.array(Citation).default([]),
});

let fragment: Record<string, unknown>;
try {
  fragment = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  console.error(`JSON PARSE ERROR: ${(error as Error).message}`);
  process.exit(2);
}

const registry = JSON.parse(readFileSync(registryFile, "utf8")) as { id: string; owner_cluster: string }[];
const moduleIds = new Set(registry.map((m) => m.id));
const cluster = String(fragment.cluster ?? "");
const texts = new SourceTexts(textsDir);
const errors: string[] = [];
const warnings: string[] = [];

const records: { type: string; data: unknown }[] = [];
for (const [key, type] of Object.entries(KEYS)) {
  const list = fragment[key];
  if (list === undefined) continue;
  if (!Array.isArray(list)) {
    errors.push(`${key}: must be an array`);
    continue;
  }
  for (const data of list) records.push({ type, data });
}
for (const key of Object.keys(fragment)) {
  if (!(key in KEYS) && !["cluster", "module_addenda", "notes"].includes(key)) errors.push(`unknown top-level key "${key}"`);
}

const sourceIds = new Set<string>();
for (const r of records) for (const c of collectCitations(r.data)) sourceIds.add(c.source_id);
const result = validateRecords(records, texts, { knownIds: new Set([...moduleIds, ...sourceIds]) });
for (const p of result.problems) (p.severity === "error" ? errors : warnings).push(`${p.type} ${p.id}: ${p.message}`);

// Ownership, id prefixes and canonical module references.
const owned = new Set(registry.filter((m) => m.owner_cluster === cluster).map((m) => m.id));
for (const r of result.valid) {
  const data = r.data as Record<string, unknown>;
  if (r.type === "module") {
    if (!owned.has(r.id)) errors.push(`module ${r.id}: this cluster (${cluster}) does not own that module; use module_addenda instead`);
  } else if (r.type !== "loop" && r.type !== "pathway") {
    const infix = r.id.split("-")[1];
    if (infix !== cluster) errors.push(`${r.type} ${r.id}: id must be <PREFIX>-${cluster}-<n>`);
  } else if (!r.id.includes(`-${cluster}-`)) {
    errors.push(`${r.type} ${r.id}: id must contain -${cluster}-`);
  }
  const refs = [
    ...(Array.isArray(data.module_ids) ? (data.module_ids as string[]) : []),
    ...(typeof data.module_id === "string" ? [data.module_id] : []),
    ...(typeof data.parent_id === "string" ? [data.parent_id] : []),
    ...(Array.isArray(data.connections) ? (data.connections as { to: string }[]).map((c) => c.to) : []),
    ...(Array.isArray(data.steps) ? (data.steps as { module_id?: string | null }[]).map((s) => s.module_id).filter(Boolean) : []),
  ] as string[];
  for (const ref of refs) if (!moduleIds.has(ref)) errors.push(`${r.type} ${r.id}: "${ref}" is not a canonical module id`);
}
for (const id of owned) {
  if (!result.valid.some((r) => r.type === "module" && r.id === id)) errors.push(`missing module record for owned module ${id}`);
}

// Addenda.
const addenda = Array.isArray(fragment.module_addenda) ? (fragment.module_addenda as unknown[]) : [];
let addendaQuotes = 0;
for (const [index, raw] of addenda.entries()) {
  const parsed = Addendum.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`module_addenda[${index}].${issue.path.join(".")}: ${issue.message}`);
    continue;
  }
  const a = parsed.data;
  if (!moduleIds.has(a.module_id)) errors.push(`module_addenda[${index}]: "${a.module_id}" is not a canonical module id`);
  if (owned.has(a.module_id)) errors.push(`module_addenda[${index}]: ${a.module_id} is owned by this cluster; put the facts in its module record`);
  for (const c of a.connections) if (!moduleIds.has(c.to)) errors.push(`module_addenda[${index}]: connection to non-canonical "${c.to}"`);
  for (const c of collectCitations(a)) {
    addendaQuotes += 1;
    if (!texts.contains(c.source_id, c.quote)) {
      errors.push(`module_addenda[${index}] (${a.module_id}): quote not found verbatim in ${c.source_id}: "${c.quote.replace(/\s+/g, " ").slice(0, 110)}"`);
    }
  }
}

for (const w of warnings.slice(0, 40)) console.log(`warning: ${w}`);
for (const e of errors) console.log(`ERROR: ${e}`);
const counts: Record<string, number> = {};
for (const r of result.valid) counts[r.type] = (counts[r.type] ?? 0) + 1;
console.log(
  `${result.valid.length} valid records ${JSON.stringify(counts)}, ${addenda.length} addenda, ` +
    `${result.citations + addendaQuotes} quotes checked, ${errors.length} errors, ${warnings.length} warnings`,
);
process.exit(errors.length ? 1 : 0);
