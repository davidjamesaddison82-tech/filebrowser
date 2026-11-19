/**
 * The HQ information service.
 *
 * One set of functions serves the web UI, the REST API and the MCP tools, so every client —
 * the founder in a browser, Claude, ChatGPT — reads the same records through the same code and
 * the same permission checks. Every answer is wrapped in an envelope that states which dataset
 * revision it came from, who asked, and which sources support it.
 */
import { z } from "zod";
import { canPropose, claimsFor, isFounderSession, type Principal, publicPrincipal } from "@/lib/auth/principal";
import type { DatasetView } from "@/lib/domain/conform";
import { citedSourceIds, type Dataset } from "@/lib/domain/dataset";
import { canonicalJson } from "@/lib/domain/pack";
import {
  acceptanceStatus,
  dependencies,
  describeRef,
  developmentHealth,
  ecosystemOverview,
  filterRequirements,
  isOutstanding,
  lifecycleMatrix,
  lineage,
  loopStageMatrix,
  missingWork,
  moduleBrief,
  recordTitle,
  type RequirementFilter,
  requirementTestEvidence,
  reviewItems,
  search,
  sourceSummary,
  stageCoverage,
} from "@/lib/domain/derive";
import {
  type AnyRecord,
  BUILD_STANDINGS,
  CREATABLE_TYPES,
  EVIDENCE_TYPES,
  fieldEnumProblem,
  isRecordType,
  PROTECTED_FIELDS,
  RECORD_TYPES,
  type RecordType,
  safeParseRecord,
} from "@/lib/domain/schemas";
import { audit, readAs, writeAs } from "./db";
import { conflict, forbidden, HqError, invalid, notFound } from "./errors";
import { type DatasetContext, getDataset, type IntegrityWarning, listChanges, recordHistory, recordVersion } from "./store";

export const HQ_NOTICE =
  "HarmonyByrd HQ is a NON-AUTHORITATIVE PROTOTYPE built under commission HB-HQ-P02-R1. " +
  "Acceptance of the HB-AI-P00 prerequisite could not be verified from accessible evidence, so nothing here is a governing record. " +
  "Records are labelled by what supports them: checked by HQ's build, reported in a source, design intention, or recommendation.";

export interface ServiceOptions {
  /** Pin a dataset revision. Omit for the current head. */
  rev?: number | null;
}

export interface ServiceEnvelope<T> {
  hq: { authority: "prototype_non_authoritative"; notice: string };
  revision: {
    rev: number;
    content_hash: string;
    created_at: string;
    kind: string;
    summary: string;
    pinned: boolean;
    head_rev: number;
    is_head: boolean;
  };
  requested_by: ReturnType<typeof publicPrincipal>;
  data: T;
  provenance: {
    sources: ReturnType<typeof sourceSummary>[];
    note?: string;
  };
  /** Present only when the answer names a stored record that fails validation (G11a). */
  integrity?: AnswerIntegrity;
}

export const INTEGRITY_NOTICE =
  "This answer names records that are stored in a form that does not pass validation. Everything in `data` is computed on them conformed to their schema: " +
  'a value of the wrong kind reads "Not a valid value", a reference of the wrong kind is null, and an element of the wrong kind is left out, so none of them reads as accepted, tested, checked or linked because of a value that is not valid. ' +
  "Each is listed here with its validation problems and exactly as stored (`stored`).";

export interface AnswerIntegrity {
  notice: string;
  records: { type: string; id: string; valid: false; problems: string[]; stored: unknown }[];
}

/**
 * G11a: the stored records that fail validation which an answer names anywhere in its data (as a record,
 * a reference or a hit), each with its problems and its stored form. Null when it names none.
 */
function integrityOf(ctx: DatasetContext, data: unknown): AnswerIntegrity | null {
  if (ctx.warnings.length === 0) return null;
  const invalid = new Map<string, IntegrityWarning>(ctx.warnings.map((w) => [w.id, w]));
  const named = new Map<string, IntegrityWarning>();
  const walk = (value: unknown, key: string) => {
    // A stored form is the record as stored: what it names is not what the answer says.
    if (key === "stored") return;
    if (typeof value === "string") {
      const warning = invalid.get(value);
      if (warning) named.set(value, warning);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, key);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, k);
    }
  };
  walk(data, "");
  if (named.size === 0) return null;
  const records = [...named.values()]
    .sort((a, b) => (a.type === b.type ? a.id.localeCompare(b.id) : a.type.localeCompare(b.type)))
    .map((w) => ({ type: w.type, id: w.id, valid: false as const, problems: w.issues, stored: storedData(ctx, w.type, w.id) }));
  return { notice: INTEGRITY_NOTICE, records };
}

/** A record's data exactly as stored at the answer's revision. */
function storedData(ctx: DatasetContext, type: string, id: string): unknown {
  return isRecordType(type) ? (ctx.stored.get(type, id)?.data ?? null) : null;
}

function envelope<T>(principal: Principal, ctx: DatasetContext, data: T, sourceIds: string[] | null, note?: string): ServiceEnvelope<T> {
  const r = ctx.ds.revision;
  const integrity = integrityOf(ctx, data);
  return {
    hq: { authority: "prototype_non_authoritative", notice: HQ_NOTICE },
    revision: {
      rev: r.rev,
      content_hash: r.content_hash,
      created_at: r.created_at,
      kind: r.kind,
      summary: r.summary,
      pinned: ctx.pinned,
      head_rev: ctx.head,
      is_head: r.rev === ctx.head,
    },
    requested_by: publicPrincipal(principal),
    data,
    provenance: {
      sources: (sourceIds ?? []).sort().map((id) => sourceSummary(ctx.ds, id)),
      ...(note ? { note } : {}),
    },
    ...(integrity ? { integrity } : {}),
  };
}

function requireType(type: string): RecordType {
  if (!isRecordType(type)) {
    throw invalid(`Unknown record type "${type}". Known types: ${RECORD_TYPES.join(", ")}.`);
  }
  return type;
}

// ---------------------------------------------------------------------------
// Read operations (each runs against one immutable Dataset; none can write)
//
// Every read computes on the conformed view, `ctx.ds` (G11a): a stored record of the wrong shape can
// make no answer fail, and reads as nothing it does not validly hold. An answer that names such a
// record says so (`integrity`, above), and get_record returns its stored form beside it.
// ---------------------------------------------------------------------------

export async function getEcosystemOverview(principal: Principal, options: ServiceOptions = {}) {
  const ctx = await getDataset(principal, options.rev);
  const overview = ecosystemOverview(ctx.ds);
  const health = developmentHealth(ctx.ds);
  const missing = missingWork(ctx.ds);
  const data = {
    counts: overview.counts,
    families: overview.families,
    modules: overview.modules,
    connections: overview.edges,
    health: Object.fromEntries(Object.entries(health).map(([key, list]) => [key, { count: list.length, items: list }])),
    missing_and_forgotten: {
      requirements_without_implementation_record: missing.requirements_without_implementation_record.length,
      requirements_without_test_evidence: missing.requirements_without_test_evidence.length,
      requirements_unreviewed: missing.requirements_unreviewed.length,
      modules_without_source_evidence: missing.modules_without_source_evidence,
      modules_without_learning_loop: missing.modules_without_learning_loop.length,
      sources_not_accessible: missing.sources_not_accessible,
      not_in_recent_sources: missing.not_in_recent_sources,
    },
    priorities: ctx.ds.recommendations
      .map((r) => r.data)
      .sort((a, b) => a.rank - b.rank)
      .map((r) => ({
        id: r.id,
        rank: r.rank,
        title: r.title,
        status: r.status,
        note: "Recommendation only. Not approved work.",
        module_ids: r.module_ids,
        prerequisite_ids: r.prerequisite_ids,
        blocked_by: r.blocked_by,
      })),
    integrity_warnings: ctx.warnings,
  };
  return envelope(principal, ctx, data, null, "Per-record sources are returned by get_module_brief and get_source_lineage.");
}

export async function listModules(principal: Principal, options: ServiceOptions = {}) {
  const ctx = await getDataset(principal, options.rev);
  return envelope(principal, ctx, { modules: ecosystemOverview(ctx.ds).modules, lifecycle: lifecycleMatrix(ctx.ds) }, null);
}

export async function getModuleBrief(principal: Principal, id: string, options: ServiceOptions = {}) {
  const ctx = await getDataset(principal, options.rev);
  const brief = resolveModule(ctx.ds, id);
  return envelope(
    principal,
    ctx,
    {
      id: brief.module.meta.id,
      version: brief.module.meta.version,
      content_hash: brief.module.meta.content_hash,
      introduced_in_rev: brief.module.meta.rev,
      record: brief.module.data,
      standing: brief.standing,
      parent: brief.parent,
      children: brief.children,
      learning_loops: brief.loops,
      pathways: brief.pathways,
      requirements: brief.requirements,
      decisions: brief.decisions,
      commissions: brief.commissions,
      builds: brief.builds,
      evidence: brief.evidence,
      defects: brief.defects,
      open_items: brief.open_items,
      recommendations: brief.recommendations,
      connections_out: brief.connections_out,
      connections_in: brief.connections_in,
      last_referred_to_by_a_source_dated: brief.last_seen,
    },
    brief.sources.map((s) => s.id),
  );
}

/** Accept a module id, or an exact name or alias (case-insensitive). */
function resolveModule(ds: DatasetView, idOrName: string) {
  let brief = moduleBrief(ds, idOrName);
  if (!brief) {
    const wanted = idOrName.trim().toLowerCase();
    const match = ds.modules.find(
      (m) => m.data.name.toLowerCase() === wanted || m.data.aliases.some((a) => a.toLowerCase() === wanted),
    );
    if (match) brief = moduleBrief(ds, match.meta.id);
  }
  if (!brief) throw notFound(`No module "${idOrName}" at dataset revision ${ds.revision.rev}.`);
  return brief;
}

export async function listLearningLoops(principal: Principal, options: ServiceOptions = {}) {
  const ctx = await getDataset(principal, options.rev);
  return envelope(
    principal,
    ctx,
    {
      shared_progression: ["encounter", "understand", "predict", "hear", "perform", "create", "capture_reflect", "retrieve", "transfer"],
      note: "The shared progression is a lens, not a template: each loop keeps its own steps and terms, and maps onto the progression only where the source supports it.",
      loops: loopStageMatrix(ctx.ds),
      stage_coverage: stageCoverage(ctx.ds),
      pathways: ctx.ds.pathways.map((p) => p.data),
    },
    null,
  );
}

export async function getLearningLoop(principal: Principal, id: string, options: ServiceOptions = {}) {
  const ctx = await getDataset(principal, options.rev);
  const loop = ctx.ds.get("loop", id);
  if (!loop) throw notFound(`No learning loop "${id}" at dataset revision ${ctx.ds.revision.rev}.`);
  const sameStages = new Set(loop.data.steps.map((s) => s.shared_stage).filter((s) => s !== "none"));
  const coverage = stageCoverage(ctx.ds);
  const contributing = new Map<string, Set<string>>();
  for (const stage of sameStages) {
    for (const entry of coverage[stage as keyof typeof coverage]) {
      if (loop.data.module_ids.includes(entry.module_id)) continue;
      const set = contributing.get(entry.module_id) ?? new Set<string>();
      set.add(stage);
      contributing.set(entry.module_id, set);
    }
  }
  return envelope(
    principal,
    ctx,
    {
      id: loop.meta.id,
      version: loop.meta.version,
      content_hash: loop.meta.content_hash,
      record: loop.data,
      modules: loop.data.module_ids.map((m) => describeRef(ctx.ds, m)),
      variant_of: loop.data.variant_of ? describeRef(ctx.ds, loop.data.variant_of) : null,
      variants: ctx.ds.loops.filter((l) => l.data.variant_of === id).map((l) => describeRef(ctx.ds, l.meta.id)),
      pathways: ctx.ds.pathways
        .filter((p) => p.data.steps.some((s) => loop.data.module_ids.includes(s.module_id)))
        .map((p) => describeRef(ctx.ds, p.meta.id)),
      modules_contributing_to_the_same_stages: [...contributing.entries()]
        .map(([moduleId, stages]) => ({ module: describeRef(ctx.ds, moduleId), stages: [...stages].sort() }))
        .sort((a, b) => a.module.id.localeCompare(b.module.id)),
      assessment_authority_note:
        "Musical correctness (notes, timing, chords, voicings, scoring) is decided by HarmonyByrd's deterministic engines and the founder. HQ and AI clients record and retrieve; they do not redefine what is correct.",
    },
    citedSourceIds(loop.data),
  );
}

export async function searchFounderRequirements(principal: Principal, filter: RequirementFilter, options: ServiceOptions = {}) {
  const ctx = await getDataset(principal, options.rev);
  const list = filterRequirements(ctx.ds, filter);
  return envelope(
    principal,
    ctx,
    {
      filter,
      total: list.length,
      requirements: list.map((r) => ({
        id: r.meta.id,
        version: r.meta.version,
        title: r.data.title,
        exact_wording: r.data.exact_wording,
        source_id: r.data.source_id,
        source_date: r.data.source_date,
        locator: r.data.locator,
        attribution: r.data.attribution,
        category: r.data.category,
        interpretation: r.data.interpretation,
        module_ids: r.data.module_ids,
        disposition: r.data.disposition,
        implementation_state: r.data.implementation_state,
        outstanding: isOutstanding(r.data, ctx.ds),
        linked_evidence_ids: r.data.linked_evidence_ids,
        test_evidence: requirementTestEvidence(ctx.ds, r.data),
      })),
    },
    [...new Set(list.map((r) => r.data.source_id))],
  );
}

export async function findOutstandingRequirements(principal: Principal, filter: { module_id?: string }, options: ServiceOptions = {}) {
  const ctx = await getDataset(principal, options.rev);
  const list = filterRequirements(ctx.ds, { ...filter, outstanding: true });
  const missing = missingWork(ctx.ds);
  return envelope(
    principal,
    ctx,
    {
      definition:
        "Outstanding: a live requirement (unreviewed, active, conflicted or deferred) that is not recorded as implemented and tested, or that has no linked evidence a source reports or HQ's build checked. Linked ids that do not resolve to an evidence record, and unverified submissions, do not count.",
      total: list.length,
      requirements: list.map((r) => {
        const evidence = requirementTestEvidence(ctx.ds, r.data);
        return {
          id: r.meta.id,
          title: r.data.title,
          exact_wording: r.data.exact_wording,
          module_ids: r.data.module_ids,
          disposition: r.data.disposition,
          implementation_state: r.data.implementation_state,
          has_linked_evidence: evidence.verified.length > 0,
          test_evidence: evidence,
          reasons: [
            ...(r.data.implementation_state === "no_record" ? ["no implementation record"] : []),
            ...(evidence.verified.length === 0
              ? [
                  evidence.unverified.length > 0
                    ? "linked evidence is only an unverified submission"
                    : "no linked test or acceptance evidence",
                ]
              : []),
            ...(evidence.missing.length > 0 ? [`linked evidence id(s) not found: ${evidence.missing.join(", ")}`] : []),
            ...(r.data.disposition === "unreviewed" ? ["standing not yet confirmed by the founder in HQ"] : []),
          ],
        };
      }),
      also_missing: {
        modules_without_source_evidence: missing.modules_without_source_evidence,
        sources_not_accessible: missing.sources_not_accessible,
      },
    },
    [...new Set(list.map((r) => r.data.source_id))],
  );
}

export async function getRecord(principal: Principal, type: string, id: string, options: ServiceOptions = {}) {
  const ctx = await getDataset(principal, options.rev);
  const t = requireType(type);
  const record = ctx.ds.get(t, id);
  if (!record) throw notFound(`No ${t} "${id}" at dataset revision ${ctx.ds.revision.rev}.`);
  const history = await recordHistory(principal, t, id, ctx.ds.revision.rev);
  // G11a: a record that fails validation is returned conformed, says so, and comes with its stored form.
  const warning = ctx.warnings.find((w) => w.type === t && w.id === id);
  return envelope(
    principal,
    ctx,
    {
      type: t,
      id,
      title: recordTitle(t, record.data),
      meta: record.meta,
      record: record.data,
      valid: !warning,
      ...(warning ? { validation_problems: warning.issues, stored: storedData(ctx, t, id) } : {}),
      history,
    },
    citedSourceIds(record.data),
  );
}

export async function getAcceptanceStatus(principal: Principal, type: string, id: string, options: ServiceOptions = {}) {
  const ctx = await getDataset(principal, options.rev);
  const t = requireType(type);
  const status = acceptanceStatus(ctx.ds, t, id);
  if (!status) throw notFound(`No ${t} "${id}" at dataset revision ${ctx.ds.revision.rev}.`);
  const record = ctx.ds.get(t, id)!;
  return envelope(
    principal,
    ctx,
    {
      ...status,
      how_to_read:
        "Four different things are kept apart: a PROPOSAL (in the inbox, not a record), a PROTOTYPE or candidate (exists, not accepted), TESTED (evidence on record, not accepted) and ACCEPTED (a founder decision). Acceptance 'reported in a source' is what a document says; acceptance 'recorded in HQ' exists only as the effect of a founder decision.",
    },
    citedSourceIds(record.data),
  );
}

export async function getSourceLineage(principal: Principal, type: string, id: string, options: ServiceOptions = {}) {
  const ctx = await getDataset(principal, options.rev);
  const t = requireType(type);
  const result = lineage(ctx.ds, t, id);
  if (!result) throw notFound(`No ${t} "${id}" at dataset revision ${ctx.ds.revision.rev}.`);
  const history = await recordHistory(principal, t, id, ctx.ds.revision.rev);
  return envelope(principal, ctx, { ...result, history }, result.sources.map((s) => s.id));
}

export async function getDevelopmentDependencies(principal: Principal, type: string, id: string, options: ServiceOptions = {}) {
  const ctx = await getDataset(principal, options.rev);
  const t = requireType(type);
  const result = dependencies(ctx.ds, t, id);
  if (!result) throw notFound(`No ${t} "${id}" at dataset revision ${ctx.ds.revision.rev}.`);
  return envelope(principal, ctx, result, citedSourceIds(ctx.ds.get(t, id)!.data));
}

export async function listSources(principal: Principal, options: ServiceOptions = {}) {
  const ctx = await getDataset(principal, options.rev);
  return envelope(principal, ctx, { sources: ctx.ds.sources.map((s) => s.data) }, null);
}

/** At most this many hits are returned; `total` always counts every match. */
export const SEARCH_LIMIT = 60;

export async function searchRecords(principal: Principal, query: string, types: string[] | undefined, options: ServiceOptions = {}) {
  const ctx = await getDataset(principal, options.rev);
  const all = search(ctx.ds, query, { types: types?.map(requireType), limit: Number.POSITIVE_INFINITY });
  const invalid = new Set(ctx.warnings.map((w) => `${w.type}:${w.id}`));
  // Each hit says whether its record passes validation (G11a); the answer's `integrity` lists those that do not.
  const hits = all.slice(0, SEARCH_LIMIT).map((hit) => ({ ...hit, valid: !invalid.has(`${hit.type}:${hit.id}`) }));
  return envelope(principal, ctx, { query, total: all.length, returned: hits.length, truncated: all.length > hits.length, hits }, null);
}

export async function getReviewItems(principal: Principal, options: ServiceOptions = {}) {
  const ctx = await getDataset(principal, options.rev);
  return envelope(principal, ctx, { items: reviewItems(ctx.ds), integrity_warnings: ctx.warnings }, null);
}

export async function getRecentChanges(principal: Principal, limit = 30) {
  const ctx = await getDataset(principal);
  const changes = await listChanges(principal, limit);
  return envelope(principal, ctx, { changes }, null);
}

// ---------------------------------------------------------------------------
// Proposal inbox (isolated: nothing here changes an authoritative record)
// ---------------------------------------------------------------------------

export const PROPOSAL_KINDS = ["change_proposal", "defect_report", "test_evidence", "classification", "reconciliation"] as const;

const ChangeProposalInput = z.object({
  kind: z.enum(["change_proposal", "classification", "reconciliation"]).default("change_proposal"),
  title: z.string().min(3).max(200),
  rationale: z.string().min(3).max(8000),
  /** The dataset revision you read before writing this proposal. */
  base_rev: z.number().int().positive(),
  target: z
    .strictObject({
      type: z.string(),
      id: z.string(),
      /** The version of the record you read. A proposal against an older version is refused as stale. */
      base_version: z.number().int().positive(),
    })
    .optional(),
  /** Top-level fields to replace on the target record. */
  set: z.record(z.string(), z.unknown()).optional(),
  /** Or: a new record to create. */
  create: z.object({ record_type: z.string(), record: z.record(z.string(), z.unknown()) }).optional(),
  evidence: z.array(z.object({ description: z.string().min(1), reference: z.string().optional(), sha256: z.string().optional() })).default([]),
  idempotency_key: z.string().min(8).max(120).optional(),
});
export type ChangeProposalInput = z.input<typeof ChangeProposalInput>;

const DefectReportInput = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(3).max(8000),
  module_ids: z.array(z.string()).min(1),
  build_id: z.string().optional(),
  severity: z.enum(["blocking", "major", "minor", "unknown"]).default("unknown"),
  base_rev: z.number().int().positive(),
  evidence: z.array(z.object({ description: z.string().min(1), reference: z.string().optional(), sha256: z.string().optional() })).default([]),
  idempotency_key: z.string().min(8).max(120).optional(),
});
export type DefectReportInput = z.input<typeof DefectReportInput>;

const TestEvidenceInput = z.object({
  title: z.string().min(3).max(200),
  type: z.enum(EVIDENCE_TYPES).default("automated_test"),
  result_summary: z.string().min(3).max(8000),
  module_ids: z.array(z.string()).default([]),
  build_id: z.string().optional(),
  /** Where the tested code lives. HQ stores the reference, never a copy of the code. */
  code_ref: z.object({ repository: z.string(), ref: z.string(), path: z.string().optional() }).optional(),
  counts: z.object({ passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() }).optional(),
  artifact_sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  date: z.string().optional(),
  base_rev: z.number().int().positive(),
  idempotency_key: z.string().min(8).max(120).optional(),
});
export type TestEvidenceInput = z.input<typeof TestEvidenceInput>;

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw invalid(
      "The request is not valid.",
      result.error.issues.map((issue) => `${issue.path.join(".") || "(body)"}: ${issue.message}`),
    );
  }
  return result.data;
}

async function requireProposer(principal: Principal, action: string) {
  if (!canPropose(principal)) {
    await audit(claimsFor(principal), { action, outcome: "denied", detail: { reason: "role or scope does not permit proposals" } });
    throw forbidden(
      principal.appRole === "reader"
        ? "The reader role cannot submit proposals."
        : 'This credential does not carry the "propose" scope.',
    );
  }
}

// ---------------------------------------------------------------------------
// What a proposal may assert. These mirror the database's rules (migration 0005: hq._validate_payload,
// hq._validate_against_target) so a refusal comes back early with a clear message; the database
// refuses the same proposals on its own, at submission and again at acceptance.
// ---------------------------------------------------------------------------

/** Labels only HQ itself assigns. A proposal can never use them (403). */
const HQ_ONLY_LABELS: readonly string[] = ["verified", "hq_recommendation"];
/** Labels that say a source supports the statement. Allowed in a proposal only with citations, which are then verified. */
const SOURCED_LABELS: readonly string[] = ["reported", "design_intention", "source_recommendation", "founder_statement"];

/** Fields no proposal may set on any record type (mirrors hq.protected_fields()). */
export const PROPOSAL_PROTECTED_FIELDS: readonly string[] = [
  ...new Set<string>([...PROTECTED_FIELDS, "hq_checks", "made_by", "recorded_from_cluster"]),
];
/** On create, a requirement's original wording and provenance are given by the proposer (and then verified). */
const CREATE_MAY_GIVE: readonly string[] = ["source_id", "locator", "source_date", "attribution", "exact_wording"];

/**
 * Fields only HQ's build writes, per record type (mirrors hq.build_only_fields(type); the union over
 * all types is BUILD_ONLY_FIELDS in schemas.ts). code_ref is build-only on builds only: inbox test
 * evidence legitimately carries one.
 */
export function buildOnlyFieldsFor(type: RecordType): readonly string[] {
  const perType: Partial<Record<RecordType, string[]>> = {
    module: ["addenda_from_clusters", "commission_entry", "lifecycle_other_reports"],
    decision: ["other_mentions"],
    build: ["other_mentions", "possibly_same_as", "code_ref"],
    evidence: ["search_results"],
    requirement: ["linked_tests"],
    source: ["doc_kind", "content_kind", "importance", "identifiers", "other_names"],
  };
  return ["recorded_from_cluster", ...(perType[type] ?? [])];
}

/** What an existing source says about the snapshot HQ read (mirrors hq.source_integrity_fields()). */
export const SOURCE_INTEGRITY_FIELDS: readonly string[] = ["sha256", "bytes", "text_snapshot", "access", "kind", "authority", "retrieved_at", "parts", "version", "location"];
/** Evidence types recorded only by the founder or by HQ's build. */
const HQ_EVIDENCE_TYPES: readonly string[] = ["founder_acceptance", "hq_check"];
/** Evidence fields that cannot be rewritten once a source reports the evidence or HQ's build checked it. */
const LOCKED_EVIDENCE_FIELDS: readonly string[] = ["type", "result", "sha256", "date", "build_id"];

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** Every object in a document, the document itself included (depth first). */
function objectsIn(value: unknown, out: Json[] = []): Json[] {
  if (Array.isArray(value)) for (const item of value) objectsIn(item, out);
  else if (isObject(value)) {
    out.push(value);
    for (const child of Object.values(value)) objectsIn(child, out);
  }
  return out;
}

const hasCitations = (obj: Json) => Array.isArray(obj.citations) && obj.citations.length > 0;

/**
 * D1b: HQ's own labels anywhere (keys "epistemic" / "basis", and a loop's top-level "standing") are a
 * permission refusal; a source-backed label without citations is invalid. The top level of an update
 * ("set") is checked against the merged record, so `merged` is given for updates.
 */
function labelProblem(type: RecordType, doc: Json, merged: Json | null): HqError | null {
  for (const obj of objectsIn(doc)) {
    const top = obj === doc;
    const keys = type === "loop" && top ? ["epistemic", "basis", "standing"] : ["epistemic", "basis"];
    for (const key of keys) {
      const value = obj[key];
      if (typeof value !== "string") continue;
      if (HQ_ONLY_LABELS.includes(value)) {
        return forbidden(`The label "${value}" is HQ's own and cannot be used in a proposal (field "${key}"). Use "submitter_claim".`, {
          field: key,
          label: value,
        });
      }
      const citedHere = top && merged ? hasCitations(merged) : hasCitations(obj);
      if (SOURCED_LABELS.includes(value) && !citedHere) {
        return invalid(`A "${value}" statement must cite at least one source (field "${key}"). Without a source, use "submitter_claim".`, {
          field: key,
          label: value,
        });
      }
    }
  }
  return null;
}

interface QuoteCheck {
  source_id: string;
  quote: string;
  kind: "quote" | "wording";
}

/** D1a: every citation-shaped object at any depth, and the shape of every citation list. */
function quotationsIn(doc: Json): { checks: QuoteCheck[]; malformed: boolean } {
  const checks: QuoteCheck[] = [];
  let malformed = false;
  for (const obj of objectsIn(doc)) {
    for (const key of ["citations", "named_in"]) {
      const list = obj[key];
      if (list === undefined || list === null) continue;
      if (!Array.isArray(list) || list.some((c) => !isObject(c) || typeof c.source_id !== "string" || typeof c.quote !== "string")) malformed = true;
    }
    if (typeof obj.source_id === "string" && typeof obj.quote === "string") checks.push({ source_id: obj.source_id, quote: obj.quote, kind: "quote" });
  }
  return { checks, malformed };
}

/**
 * Check quotations against the source texts stored at import, through hq.quotes_ok: the same data
 * and the same rule the database applies on submission. The application never reads the texts.
 */
async function unverifiedQuotations(principal: Principal, checks: QuoteCheck[]): Promise<{ index: number; source_id: string; reason: string; message: string }[]> {
  if (checks.length === 0) return [];
  const failures: { index: number; source_id: string; reason: string; message: string }[] = [];
  for (let start = 0; start < checks.length; start += 500) {
    const chunk = checks.slice(start, start + 500);
    const rows = await readAs(claimsFor(principal), (q) => q.query<{ r: typeof failures }>("select hq.quotes_ok($1::jsonb) as r", [JSON.stringify(chunk)]));
    for (const f of rows.rows[0].r) failures.push({ ...f, index: f.index + start });
  }
  return failures;
}

/** Refuse a proposal before it reaches the database, and record the refusal. */
async function refuse(principal: Principal, target: { type?: string | null; id?: string | null }, error: HqError): Promise<never> {
  await audit(claimsFor(principal), {
    action: "proposal.submit",
    objectType: target.type ?? null,
    objectId: target.id ?? null,
    outcome: "denied",
    detail: { code: error.code, status: error.status, message: error.message, detail: error.detail },
  });
  throw error;
}

/** D1a/D1b for a proposed document, then the verbatim check against the stored source texts. */
async function checkAssertions(principal: Principal, type: RecordType, doc: Json, merged: Json | null, target: { type?: string | null; id?: string | null }) {
  const label = labelProblem(type, doc, merged);
  if (label) await refuse(principal, target, label);
  const { checks, malformed } = quotationsIn(doc);
  if (malformed) await refuse(principal, target, invalid("Each citation needs a source_id and a verbatim quote."));
  if (!merged && type === "requirement" && typeof doc.source_id === "string" && typeof doc.exact_wording === "string") {
    checks.push({ source_id: doc.source_id, quote: doc.exact_wording, kind: "wording" });
  }
  const failures = await unverifiedQuotations(principal, checks);
  if (failures.length > 0) {
    await refuse(
      principal,
      target,
      invalid(`${failures[0].message.charAt(0).toUpperCase()}${failures[0].message.slice(1)}.${failures.length > 1 ? ` (${failures.length - 1} more quotation(s) also failed.)` : ""}`, {
        unverified_quotations: failures,
      }),
    );
  }
}

/** D2: a record carrying a founder acceptance (accepted or rejected) cannot be changed by proposal. */
export function acceptanceBlock(type: string, id: string, data: unknown): HqError | null {
  const acceptance = isObject(data) && isObject(data.hq_acceptance) ? data.hq_acceptance : null;
  if (!acceptance || (acceptance.state !== "accepted" && acceptance.state !== "rejected")) return null;
  return conflict(
    `${type}/${id} carries a founder ${acceptance.state === "rejected" ? "rejection" : "acceptance"} recorded in HQ (${String(acceptance.decision_id ?? "decision unknown")}). ` +
      "Record a founder decision that clears it first, or propose a new record.",
    { acceptance },
  );
}

/** F1: why a proposal may not claim acceptance. The same words as the database's HQ403. */
export const ACCEPTANCE_CLAIM_RULE = "acceptance is recorded only by a founder decision in HQ or by an import; a proposal cannot assert it";
/** G1a: why a build reported as accepted cannot be changed by proposal. The same words as the database's HQ403. */
export const REPORTED_BUILD_FROZEN_RULE =
  "a build reported as accepted is changed only by an import or a founder decision; a proposal may only withdraw the reported acceptance";
/** G1b: the founder_accepted states that do not claim an acceptance. Anything else counts as positive. */
const NOT_ACCEPTED_STATES: readonly string[] = ["no", "unknown", "not_applicable"];

const sentence = (rule: string) => `${rule.charAt(0).toUpperCase()}${rule.slice(1)}.`;

/**
 * F1, G1a, G1b: a proposal can never introduce or reshape a claim of acceptance (mirrors
 * hq._refuse_acceptance_claims, in the same order). `doc` is the update's "set" or the created record;
 * `current` is the target's data for an update and null for a create. Refused (403, rule acceptance_claim):
 *   - on any record type, a top-level founder_accepted field (also as a dotted path);
 *   - a build whose current standing is "accepted_reported": every change, unless the resulting
 *     standing is another valid standing (withdrawing the claim is not asserting one);
 *   - a build whose resulting standing is "accepted_reported", unless the target already had it;
 *   - a module whose resulting lifecycle.founder_accepted is anything but an object whose state is
 *     exactly no, unknown or not_applicable, unless the whole entry is identical to the current one
 *     (an added key such as scope is a change).
 * A citation does not make it acceptable: a quotation proves the words are in a source, not that they
 * report an acceptance.
 */
export function acceptanceClaimProblem(type: RecordType, doc: Json, current: Json | null): HqError | null {
  const refuse = (field: string, what: string, rule = ACCEPTANCE_CLAIM_RULE) => forbidden(`${what}: ${sentence(rule)}`, { field, rule: "acceptance_claim" });
  const named = Object.keys(doc).find((key) => key === "founder_accepted" || key.endsWith(".founder_accepted"));
  if (named) return refuse(named, `Field "${named}"`);
  const after: Json = current ? { ...current, ...doc } : doc;
  if (type === "build" && current?.standing === "accepted_reported") {
    const standing = after.standing;
    const withdraws = typeof standing === "string" && standing !== "accepted_reported" && (BUILD_STANDINGS as readonly string[]).includes(standing);
    if (!withdraws) return refuse("standing", `Build ${String(current.id)}`, REPORTED_BUILD_FROZEN_RULE);
  }
  if (type === "build" && after.standing === "accepted_reported" && current?.standing !== "accepted_reported") {
    return refuse("standing", 'Build standing "accepted_reported"');
  }
  if (type === "module") {
    const entry = isObject(after.lifecycle) ? after.lifecycle.founder_accepted : undefined;
    const negative = isObject(entry) && typeof entry.state === "string" && NOT_ACCEPTED_STATES.includes(entry.state);
    if (entry !== undefined && !negative) {
      const before = current && isObject(current.lifecycle) ? current.lifecycle.founder_accepted : undefined;
      if (before === undefined || canonicalJson(before) !== canonicalJson(entry)) {
        const state = isObject(entry) && typeof entry.state === "string" ? entry.state : "";
        return refuse("lifecycle.founder_accepted", `lifecycle.founder_accepted "${state}"`);
      }
    }
  }
  return null;
}

/** G1c: a value outside its field's list (mirrors hq._check_field_enums). 422, naming the field. */
function fieldEnumRefusal(type: RecordType, doc: Json, current: Json | null): HqError | null {
  const problem = fieldEnumProblem(type, doc, current);
  return problem ? invalid(problem.message, { field: problem.field, rule: "allowed_values" }) : null;
}

/** The standard answer envelope for an inbox tool, at the current head (proposals change no revision). */
async function inboxAnswer<T extends Json>(principal: Principal, data: T, ctx?: DatasetContext): Promise<ServiceEnvelope<T> & T> {
  const at = ctx ?? (await getDataset(principal));
  // The result's own fields stay at the top level as well, for callers written before the envelope.
  return { ...envelope(principal, at, data, null, "Inbox answers carry no authority: nothing here is a record until the founder accepts it."), ...data };
}

async function submit(
  principal: Principal,
  args: {
    kind: string;
    title: string;
    rationale: string;
    baseRev: number;
    target?: { type: string; id: string; baseVersion: number };
    payload: Record<string, unknown>;
    evidence: unknown[];
    idempotencyKey?: string;
  },
) {
  const claims = claimsFor(principal);
  try {
    const result = await writeAs(claims, async (q) => {
      const row = await q.query<{ p: Record<string, unknown> }>(
        "select hq.submit_proposal($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10) as p",
        [
          args.kind,
          args.target?.type ?? null,
          args.target?.id ?? null,
          args.target?.baseVersion ?? null,
          args.baseRev,
          args.title,
          args.rationale,
          JSON.stringify(args.payload),
          JSON.stringify(args.evidence),
          args.idempotencyKey ?? null,
        ],
      );
      return row.rows[0].p;
    });
    return {
      proposal: result,
      status: "submitted_for_founder_review",
      note: "This proposal is held in the isolated inbox. It has changed no record and carries no authority until the founder reviews it.",
    };
  } catch (error) {
    if (error instanceof HqError && (error.status === 403 || error.status === 409 || error.status === 422)) {
      await audit(claims, {
        action: "proposal.submit",
        objectType: args.target?.type,
        objectId: args.target?.id,
        outcome: "denied",
        detail: { code: error.code, message: error.message, detail: error.detail },
      });
    }
    throw error;
  }
}

export async function submitChangeProposal(principal: Principal, input: unknown) {
  await requireProposer(principal, "proposal.submit");
  const body = parseInput(ChangeProposalInput, input);
  if (!!body.set === !!body.create) {
    throw invalid('Provide exactly one of "set" (change an existing record) or "create" (propose a new record).');
  }
  const ctx = await getDataset(principal);

  if (body.set) {
    if (!body.target) throw invalid('A "set" proposal needs a target: { type, id, base_version }.');
    const type = requireType(body.target.type);
    const target = { type, id: body.target.id };
    if (type === "decision") {
      await refuse(principal, target, forbidden("Decision records are written only by a founder decision; they cannot be changed by proposal."));
    }
    const protectedHere = [...PROPOSAL_PROTECTED_FIELDS, ...buildOnlyFieldsFor(type), ...(type === "source" ? SOURCE_INTEGRITY_FIELDS : [])];
    const blocked = Object.keys(body.set).filter((key) => protectedHere.includes(key));
    if (blocked.length > 0) {
      await refuse(
        principal,
        target,
        forbidden(
          `Protected fields cannot be changed by a proposal: ${blocked.join(", ")}. ` +
            "Original wording and provenance never change; dispositions and acceptance change only by founder decision; HQ's own checks, attribution and source snapshots are written only by HQ.",
          { protected_fields: blocked },
        ),
      );
    }
    if (type === "evidence" && typeof body.set.type === "string" && HQ_EVIDENCE_TYPES.includes(body.set.type)) {
      await refuse(principal, target, forbidden(`Evidence of type "${body.set.type}" cannot be made by proposal: it is recorded by the founder or by HQ's build.`));
    }
    // Every check of a change is made against the record as stored (G11a): the acceptance rules, the
    // base version, the merged record that must validate. The database makes the same comparisons.
    const current = ctx.stored.get(type, body.target.id);
    if (!current) throw notFound(`No ${type} "${body.target.id}" to change.`);
    const currentData = current.data as Json;
    const accepted = acceptanceBlock(type, body.target.id, currentData);
    if (accepted) await refuse(principal, target, accepted);
    if (
      type === "evidence" &&
      ["hq_verified", "source_reported"].includes(String(currentData.verification)) &&
      Object.keys(body.set).some((key) => LOCKED_EVIDENCE_FIELDS.includes(key))
    ) {
      await refuse(
        principal,
        target,
        forbidden("Evidence that a source reports or that HQ's build checked cannot be rewritten by proposal; submit new evidence instead.", {
          locked_fields: Object.keys(body.set).filter((key) => LOCKED_EVIDENCE_FIELDS.includes(key)),
        }),
      );
    }
    if (current.meta.version !== body.target.base_version) {
      await audit(claimsFor(principal), {
        action: "proposal.submit",
        objectType: type,
        objectId: body.target.id,
        outcome: "denied",
        detail: { reason: "stale", base_version: body.target.base_version, current_version: current.meta.version },
      });
      throw conflict(
        `Stale revision: ${type} ${body.target.id} is at version ${current.meta.version}, but this proposal was written against version ${body.target.base_version}. Re-read the record and resubmit.`,
        { current_version: current.meta.version, base_version: body.target.base_version, head_rev: ctx.head },
      );
    }
    const merged = { ...currentData, ...body.set };
    const links = linkProblem(ctx.stored, body.set);
    if (links) await refuse(principal, target, links);
    await checkAssertions(principal, type, body.set, merged, target);
    // After the label and quotation checks, in the database's order: allowed values, then acceptance claims.
    const values = fieldEnumRefusal(type, body.set, currentData);
    if (values) await refuse(principal, target, values);
    const claim = acceptanceClaimProblem(type, body.set, currentData);
    if (claim) await refuse(principal, target, claim);
    const check = safeParseRecord(type, merged);
    if (!check.ok) throw invalid(`The proposed change would make ${body.target.id} invalid.`, check.issues);
    return inboxAnswer(
      principal,
      await submit(principal, {
        kind: body.kind,
        title: body.title,
        rationale: body.rationale,
        baseRev: body.base_rev,
        target: { type, id: body.target.id, baseVersion: body.target.base_version },
        payload: { op: "update", set: body.set },
        evidence: body.evidence,
        idempotencyKey: body.idempotency_key,
      }),
      ctx,
    );
  }

  const create = body.create!;
  const type = requireType(create.record_type);
  const target = { type, id: null };
  if (!(CREATABLE_TYPES as readonly string[]).includes(type)) {
    await refuse(principal, target, forbidden(`Records of type "${type}" cannot be created by proposal.`));
  }
  const blocked = Object.keys(create.record).filter(
    (key) => (PROPOSAL_PROTECTED_FIELDS.includes(key) && !CREATE_MAY_GIVE.includes(key)) || buildOnlyFieldsFor(type).includes(key),
  );
  if (blocked.length > 0) {
    await refuse(principal, target, forbidden(`Protected fields cannot be set by a proposal: ${blocked.join(", ")}.`, { protected_fields: blocked }));
  }
  if (type === "source") {
    const r = create.record;
    const snapshot = ["sha256", "bytes", "text_snapshot", "parts"].filter((key) => key in r);
    if (r.kind !== "named_not_accessible" || r.access !== "not_accessible" || r.authority !== "referenced_only" || snapshot.length > 0) {
      await refuse(
        principal,
        target,
        forbidden(
          'A proposal can only add a source that is named but not accessible (kind "named_not_accessible", access "not_accessible", authority "referenced_only", with no checksum or snapshot). Sources HQ has read come only from an import.',
          snapshot.length > 0 ? { protected_fields: snapshot } : undefined,
        ),
      );
    }
  }
  if (type === "evidence" && typeof create.record.type === "string" && HQ_EVIDENCE_TYPES.includes(create.record.type)) {
    await refuse(principal, target, forbidden(`Evidence of type "${create.record.type}" cannot be made by proposal: it is recorded by the founder or by HQ's build.`));
  }
  const links = linkProblem(ctx.stored, create.record);
  if (links) await refuse(principal, target, links);
  await checkAssertions(principal, type, create.record, null, target);
  const values = fieldEnumRefusal(type, create.record, null);
  if (values) await refuse(principal, target, values);
  const claim = acceptanceClaimProblem(type, create.record, null);
  if (claim) await refuse(principal, target, claim);
  const candidate = withPlaceholders(type, create.record);
  const check = safeParseRecord(type, candidate);
  if (!check.ok) throw invalid(`The proposed ${type} record is not valid.`, check.issues);
  return inboxAnswer(
    principal,
    await submit(principal, {
      kind: body.kind,
      title: body.title,
      rationale: body.rationale,
      baseRev: body.base_rev,
      payload: { op: "create", record_type: type, record: create.record },
      evidence: body.evidence,
      idempotencyKey: body.idempotency_key,
    }),
    ctx,
  );
}

/** Fill in the fields the database assigns at acceptance, so a proposed record can be validated now. */
function withPlaceholders(type: RecordType, record: Record<string, unknown>): Record<string, unknown> {
  const prefix: Record<string, string> = {
    defect: "DEF",
    evidence: "EV",
    open_item: "OPEN",
    recommendation: "REC",
    requirement: "FR",
    module: "MOD",
    loop: "LOOP",
    pathway: "PATH",
    commission: "COM",
    build: "BLD",
    source: "SRC",
  };
  return {
    ...record,
    id: `${prefix[type]}-HQ-0000`,
    ...(type === "requirement" ? { disposition: "unreviewed" } : {}),
    ...(type === "evidence" ? { verification: "agent_submitted_unverified" } : {}),
    ...(type === "recommendation" ? { made_by: "Proposed through the inbox" } : {}),
  };
}

/** Fields that link a record to other records, and the type each id must name. */
const LINK_FIELDS: Record<string, RecordType> = { linked_evidence_ids: "evidence", linked_build_ids: "build", decision_ids: "decision" };

/**
 * A proposal that sets a link field must name records that exist at head: a dangling id would read as
 * evidence, a build or a decision that is not there (honesty-6). 422, naming the ids.
 */
function linkProblem(ds: Dataset, doc: Record<string, unknown>): HqError | null {
  const problems: { field: string; ids: unknown[] }[] = [];
  for (const [field, type] of Object.entries(LINK_FIELDS)) {
    const value = doc[field];
    if (value === undefined || value === null) continue;
    const ids = Array.isArray(value) ? value : [value];
    const unknown = ids.filter((id) => typeof id !== "string" || !ds.get(type, id));
    if (unknown.length > 0) problems.push({ field, ids: unknown });
  }
  if (problems.length === 0) return null;
  return invalid(
    `Linked records do not exist: ${problems.map((p) => `${p.field} ${p.ids.map(String).join(", ")}`).join("; ")}.`,
    { unknown_links: problems },
  );
}

function assertModulesExist(ds: Dataset, moduleIds: string[]) {
  const unknown = moduleIds.filter((id) => !ds.module(id));
  if (unknown.length > 0) throw invalid(`Unknown module id(s): ${unknown.join(", ")}.`);
}

export async function submitDefectReport(principal: Principal, input: unknown) {
  await requireProposer(principal, "defect.report");
  const body = parseInput(DefectReportInput, input);
  const ctx = await getDataset(principal);
  // Existence checks on the write path, against the records as stored (the view holds the same ids).
  assertModulesExist(ctx.stored, body.module_ids);
  if (body.build_id && !ctx.stored.get("build", body.build_id)) throw invalid(`Unknown build id: ${body.build_id}.`);
  const record = {
    title: body.title,
    module_ids: body.module_ids,
    build_id: body.build_id ?? null,
    status: "open",
    severity: body.severity,
    statement: { text: body.description, epistemic: "submitter_claim", citations: [] },
    citations: [],
    reported_via: "hq_proposal_inbox",
    reported_by: principal.handle,
  };
  const check = safeParseRecord("defect", withPlaceholders("defect", record));
  if (!check.ok) throw invalid("The defect report is not valid.", check.issues);
  return inboxAnswer(
    principal,
    await submit(principal, {
      kind: "defect_report",
      title: body.title,
      rationale: body.description,
      baseRev: body.base_rev,
      payload: { op: "create", record_type: "defect", record },
      evidence: body.evidence,
      idempotencyKey: body.idempotency_key,
    }),
    ctx,
  );
}

export async function recordTestEvidence(principal: Principal, input: unknown) {
  await requireProposer(principal, "evidence.submit");
  const body = parseInput(TestEvidenceInput, input);
  if (HQ_EVIDENCE_TYPES.includes(body.type)) {
    await refuse(principal, { type: "evidence" }, forbidden(`Evidence of type "${body.type}" cannot be submitted: it is recorded by the founder or by HQ's build.`));
  }
  const ctx = await getDataset(principal);
  // Existence checks on the write path, against the records as stored (the view holds the same ids).
  assertModulesExist(ctx.stored, body.module_ids);
  if (body.build_id && !ctx.stored.get("build", body.build_id)) throw invalid(`Unknown build id: ${body.build_id}.`);
  const record = {
    type: body.type,
    title: body.title,
    module_ids: body.module_ids,
    build_id: body.build_id ?? null,
    result: { text: body.result_summary, epistemic: "submitter_claim", citations: [] },
    date: body.date ?? null,
    sha256: body.artifact_sha256 ?? null,
    code_ref: body.code_ref ?? null,
    counts: body.counts ?? null,
    citations: [],
  };
  const check = safeParseRecord("evidence", withPlaceholders("evidence", record));
  if (!check.ok) throw invalid("The evidence submission is not valid.", check.issues);
  const result = await submit(principal, {
    kind: "test_evidence",
    title: body.title,
    rationale: body.result_summary,
    baseRev: body.base_rev,
    payload: { op: "create", record_type: "evidence", record },
    evidence: [],
    idempotencyKey: body.idempotency_key,
  });
  return inboxAnswer(
    principal,
    {
      ...result,
      note:
        "Recorded as a SUBMISSION in the isolated inbox. Even after the founder files it, it stays labelled as an unverified submission: " +
        "a statement that tests passed is a claim, not evidence of completion, and never implies founder acceptance.",
    },
    ctx,
  );
}

// ---------------------------------------------------------------------------
// Proposal reading and founder review
// ---------------------------------------------------------------------------

export interface ProposalView {
  id: string;
  kind: string;
  target_type: string | null;
  target_id: string | null;
  base_version: number | null;
  base_rev: number;
  title: string;
  rationale: string;
  payload: Record<string, unknown>;
  evidence: unknown[];
  submitted_by: string;
  submitted_by_kind: string;
  submitted_by_role: string;
  client: string | null;
  submitted_at: string;
  status: string;
  events: { event: string; actor: string; note: string | null; resulting_rev: number | null; detail: unknown; at: string }[];
}

const PROPOSAL_SQL = `
  select p.id, p.kind, p.target_type, p.target_id, p.base_version, p.base_rev, p.title, p.rationale, p.payload,
         p.evidence, p.client, p.submitted_at, hq.proposal_status(p.id) as status,
         coalesce(d.handle, 'unknown') as submitted_by, coalesce(d.kind, 'unknown') as submitted_by_kind,
         coalesce(d.app_role, 'unknown') as submitted_by_role,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'event', e.event, 'actor', coalesce(a.handle, 'unknown'), 'note', e.note,
                     'resulting_rev', e.resulting_rev, 'detail', e.detail, 'at', e.at) order by e.id)
                     from hq.proposal_events e left join hq.principal_directory() a on a.id = e.actor
                    where e.proposal_id = p.id), '[]'::jsonb) as events
    from hq.proposals p
    left join hq.principal_directory() d on d.id = p.submitted_by`;

function toProposalView(row: Record<string, unknown>): ProposalView {
  return {
    ...(row as unknown as ProposalView),
    base_rev: Number(row.base_rev),
    submitted_at: (row.submitted_at as Date).toISOString(),
  };
}

/** Proposals visible to the caller: their own, or all of them for the founder (enforced by row-level security). */
export async function listProposals(principal: Principal, filter: { status?: string } = {}): Promise<ProposalView[]> {
  const rows = await readAs(claimsFor(principal), async (q) => {
    const result = await q.query(`${PROPOSAL_SQL} order by p.submitted_at desc, p.id desc`);
    return result.rows.map(toProposalView);
  });
  return filter.status ? rows.filter((p) => p.status === filter.status) : rows;
}

/**
 * The list_my_proposals tool: the caller's own proposals (all of them for the founder), in the standard
 * answer envelope at the current head. Proposals are not records, so this cannot be pinned to a revision.
 */
export async function listMyProposals(principal: Principal, filter: { status?: string } = {}) {
  const proposals = await listProposals(principal, filter);
  return inboxAnswer(principal, { proposals });
}

export async function getProposal(principal: Principal, id: string): Promise<ProposalView> {
  const row = await readAs(claimsFor(principal), async (q) => {
    const result = await q.query(`${PROPOSAL_SQL} where p.id = $1`, [id]);
    return result.rows[0] ? toProposalView(result.rows[0]) : null;
  });
  // Row-level security hides other principals' proposals; "not found" is the honest answer either way.
  if (!row) throw notFound(`Proposal ${id} was not found.`);
  return row;
}

export async function withdrawProposal(principal: Principal, id: string, note?: string) {
  return writeAs(claimsFor(principal), async (q) => {
    const row = await q.query<{ p: unknown }>("select hq.withdraw_proposal($1, $2) as p", [id, note ?? null]);
    return row.rows[0].p;
  });
}

async function requireFounder(principal: Principal, action: string, objectType: string, objectId: string | null) {
  if (!isFounderSession(principal)) {
    await audit(claimsFor(principal), {
      action,
      objectType,
      objectId,
      outcome: "denied",
      detail: {
        reason: "founder authority required",
        attempted_by: principal.handle,
        kind: principal.kind,
        role: principal.appRole,
        authenticated_by: principal.amr,
      },
    });
    throw forbidden(
      `Founder authority is required for this action. "${principal.handle}" (${principal.kind}, ${principal.appRole}) cannot perform it. ` +
        "Review and acceptance are reserved to the founder's interactive session; an AI client or developer cannot approve work, including its own.",
    );
  }
}

/**
 * G1d: accepting a proposal validates the record as it would then stand, with the schema a pack import
 * uses (the same check submitChangeProposal makes), so a proposal planted in the inbox with a value the
 * application would never have submitted cannot be accepted from the screens.
 */
function resultingRecordRefusal(id: string, type: string, data: unknown): HqError | null {
  if (!isRecordType(type)) return null;
  const check = safeParseRecord(type, data);
  return check.ok ? null : invalid(`Accepting ${id} would make the record invalid. It stays in the inbox; you can reject it or ask for changes.`, check.issues);
}

/**
 * G1d for an update whose target has moved on since it was written. The database would mark it stale;
 * a proposal that would leave an invalid record is refused instead, and is not marked stale. (Every
 * other proposal is checked inside the acceptance's own transaction, after the database's rules, so
 * their more specific refusals still answer first.)
 */
async function staleResultRefusal(principal: Principal, id: string): Promise<HqError | null> {
  let proposal: ProposalView;
  try {
    proposal = await getProposal(principal, id);
  } catch {
    return null;
  }
  const payload = proposal.payload as { op?: unknown; set?: unknown };
  if (proposal.status !== "submitted" || payload.op !== "update" || !isObject(payload.set)) return null;
  if (!proposal.target_type || !proposal.target_id || !isRecordType(proposal.target_type)) return null;
  // The record as it would stand is the stored record merged with the change: that is what the database writes.
  const current = (await getDataset(principal)).stored.get(proposal.target_type, proposal.target_id);
  if (!current || current.meta.version === proposal.base_version) return null;
  return resultingRecordRefusal(id, proposal.target_type, { ...(current.data as Json), ...payload.set });
}

export async function reviewProposal(principal: Principal, id: string, decision: "accept" | "reject" | "needs_changes", note?: string) {
  await requireFounder(principal, "proposal.review", "proposal", id);
  const claims = claimsFor(principal);
  let result: Record<string, unknown>;
  try {
    if (decision === "accept") {
      const stale = await staleResultRefusal(principal, id);
      if (stale) throw stale;
    }
    result = await writeAs(claims, async (q) => {
      const row = await q.query<{ r: Record<string, unknown> }>("select hq.review_proposal($1, $2, $3) as r", [id, decision, note ?? null]);
      const r = row.rows[0].r;
      if (decision === "accept" && !r.conflict && typeof r.record_type === "string") {
        // G1d: the record exactly as the database wrote it. Throwing here rolls the acceptance back.
        const written = await q.query<{ data: unknown }>("select data from hq.record_versions where record_type = $1 and record_id = $2 and version = $3", [
          r.record_type,
          r.record_id,
          r.version,
        ]);
        const refusal = resultingRecordRefusal(id, r.record_type, written.rows[0]?.data);
        if (refusal) throw refusal;
      }
      return r;
    });
  } catch (error) {
    if (error instanceof HqError && (error.status === 403 || error.status === 409 || error.status === 422)) {
      await audit(claims, {
        action: "proposal.review",
        objectType: "proposal",
        objectId: id,
        outcome: "denied",
        detail: { status: error.status, code: error.code, message: error.message, ...(error.status === 422 ? { detail: error.detail } : {}) },
      });
    }
    throw error;
  }
  if (result.conflict) {
    // The stale marker was committed; now report the conflict explicitly.
    throw conflict(
      `Proposal ${id} is stale: its target changed after the proposal was written (it was based on version ${result.base_version}; the record is now at version ${result.current_version}). ` +
        "It has been marked stale and was not applied. Ask the proposer to re-read the record and resubmit.",
      { proposal_id: id, base_version: result.base_version, current_version: result.current_version, marked: "stale" },
    );
  }
  return result;
}

const DecisionInput = z.object({
  title: z.string().min(3).max(200),
  /** The founder's own words. Stored exactly as typed. */
  exact_text: z.string().min(3).max(8000),
  rationale: z.string().max(8000).optional(),
  effects: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("set_requirement_disposition"),
          requirement_id: z.string(),
          disposition: z.enum(["unreviewed", "active", "superseded", "conflicted", "deferred", "withdrawn", "satisfied"]),
        }),
        z.object({
          type: z.literal("set_acceptance"),
          record_type: z.enum(["build", "module", "evidence", "requirement", "loop", "commission"]),
          record_id: z.string(),
          state: z.enum(["accepted", "rejected", "none"]),
          scope_note: z.string().max(2000).optional(),
        }),
      ]),
    )
    .default([]),
  resolves: z.array(z.string()).default([]),
  module_ids: z.array(z.string()).default([]),
  commission_ref: z.string().optional(),
});
export type DecisionInput = z.input<typeof DecisionInput>;

/**
 * D13: the ids a decision names must exist at head, with the right type (the database checks the same,
 * under the write lock; this gives the same refusal early, with every bad id listed).
 */
function decisionReferenceProblems(ds: Dataset, body: z.output<typeof DecisionInput>): string[] {
  const problems: string[] = [];
  for (const id of body.resolves) {
    if (!ds.get("decision", id) && !ds.get("open_item", id)) problems.push(`resolves: "${id}" is not a decision or open item in HQ`);
  }
  for (const id of body.module_ids) {
    if (!ds.module(id)) problems.push(`module_ids: "${id}" is not a module in HQ`);
  }
  for (const effect of body.effects) {
    if (effect.type === "set_requirement_disposition" && !ds.get("requirement", effect.requirement_id)) {
      problems.push(`effect target requirement "${effect.requirement_id}" does not exist`);
    }
    if (effect.type === "set_acceptance" && !ds.get(effect.record_type, effect.record_id)) {
      problems.push(`effect target ${effect.record_type}/${effect.record_id} does not exist`);
    }
  }
  return problems;
}

export async function recordFounderDecision(principal: Principal, input: unknown) {
  await requireFounder(principal, "decision.record", "decision", null);
  const body = parseInput(DecisionInput, input);
  const claims = claimsFor(principal);
  const problems = decisionReferenceProblems((await getDataset(principal)).stored, body);
  if (problems.length > 0) {
    throw invalid(`The decision names records that are not in HQ: ${problems.join("; ")}.`, { problems });
  }
  try {
    return await writeAs(claims, async (q) => {
      const row = await q.query<{ r: Record<string, unknown> }>(
        "select hq.record_founder_decision($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7) as r",
        [
          body.title,
          body.exact_text,
          body.rationale ?? null,
          JSON.stringify(body.effects),
          JSON.stringify(body.resolves),
          JSON.stringify(body.module_ids),
          body.commission_ref ?? null,
        ],
      );
      return row.rows[0].r;
    });
  } catch (error) {
    if (error instanceof HqError && error.status === 403) {
      await audit(claims, { action: "decision.record", objectType: "decision", outcome: "denied", detail: { message: error.message } });
    }
    throw error;
  }
}

const isLoose = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What accepting a proposal would do: current against proposed values, and what else refers to the
 * target. One function for the review screen and the tests (G11b); pass the page's loaded dataset to
 * save reading it again.
 *
 * Two forms of the dataset, deliberately: what the target refers to and what refers to it (affected,
 * depends_on, sources, the target's title) is worked out on the conformed view, because it follows
 * references through every record and one stored record of the wrong shape made it throw; the "before"
 * values and the target's founder acceptance are the record as stored, because that is what the
 * change replaces and what the acceptance rules compare. The page shows a stored value of any kind as JSON.
 */
export async function proposalImpact(principal: Principal, proposal: ProposalView, loaded?: DatasetContext) {
  const ctx = loaded ?? (await getDataset(principal));
  const payload = (isLoose(proposal.payload) ? proposal.payload : {}) as { op?: unknown; set?: unknown; record_type?: unknown; record?: unknown };
  if (payload.op === "update" && proposal.target_type && proposal.target_id && isRecordType(proposal.target_type)) {
    const current = ctx.stored.get(proposal.target_type, proposal.target_id);
    // While a proposal is open, "before" is the record as it stands now. Once it is closed, "before" is the
    // version the proposal was written against — otherwise an accepted proposal would show its own result as "before".
    const closed = proposal.status !== "submitted";
    const base = closed && proposal.base_version ? await recordVersion(principal, proposal.target_type, proposal.target_id, proposal.base_version) : null;
    const data = ((isLoose(base) ? base : null) ?? current?.data ?? {}) as Record<string, unknown>;
    const set = isLoose(payload.set) ? payload.set : {};
    const changes = Object.entries(set).map(([field, value]) => ({ field, before: data[field] ?? null, after: value }));
    const deps = current ? dependencies(ctx.ds, proposal.target_type, proposal.target_id) : null;
    const lin = current ? lineage(ctx.ds, proposal.target_type, proposal.target_id) : null;
    return {
      op: "update" as const,
      target: current ? { ...describeRef(ctx.ds, proposal.target_id), version: current.meta.version } : null,
      stale: !current || current.meta.version !== proposal.base_version,
      current_version: current?.meta.version ?? null,
      changes,
      affected: lin?.downstream ?? [],
      depends_on: deps?.depends_on ?? [],
      sources: lin?.sources ?? [],
      sensitive_fields: changes.map((c) => c.field).filter((f) => SENSITIVE_FIELDS.includes(f)),
      target_acceptance: targetAcceptance(current?.data),
    };
  }
  const record = isLoose(payload.record) ? payload.record : {};
  const moduleIds = Array.isArray(record.module_ids) ? record.module_ids.filter((id): id is string => typeof id === "string") : [];
  return {
    op: "create" as const,
    record_type: typeof payload.record_type === "string" ? payload.record_type : "unknown",
    record,
    affected: moduleIds.map((id) => describeRef(ctx.ds, id)),
    stale: false,
    current_version: null,
    changes: [],
    depends_on: [],
    sources: [],
    sensitive_fields: Object.keys(record).filter((f) => SENSITIVE_FIELDS.includes(f)),
    target: null,
    target_acceptance: null,
  };
}

/** Fields whose change alters what HQ shows as tested, accepted, verified or decided (D1d). Flagged for the founder. */
export const SENSITIVE_FIELDS: readonly string[] = [
  "status",
  "standing",
  "implementation_state",
  "lifecycle",
  "type",
  "result",
  "statement",
  "sha256",
  "severity",
  "exact_text",
  // F2: links that can make a record look decided or tested, and the module it is counted under.
  "decision_ids",
  "module_id",
  "module_ids",
  "linked_evidence_ids",
  "linked_build_ids",
  // F1: never accepted from a proposal, but called out if a stored proposal carries it.
  "founder_accepted",
];

/** The founder acceptance the target carries, if any: accepting a change to such a record is refused (D2). */
function targetAcceptance(data: unknown): Json | null {
  return isObject(data) && isObject(data.hq_acceptance) ? data.hq_acceptance : null;
}

export type { AnyRecord };

// ---------------------------------------------------------------------------
// Access administration (founder only)
// ---------------------------------------------------------------------------

export interface CredentialView {
  credential_id: string;
  handle: string;
  display_name: string;
  kind: string;
  app_role: string;
  label: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

export async function listCredentials(principal: Principal): Promise<CredentialView[]> {
  if (!isFounderSession(principal)) throw forbidden("Only the founder can list credentials.");
  return readAs(claimsFor(principal), async (q) => {
    const rows = await q.query("select * from hq.founder_list_credentials()");
    return rows.rows.map((r) => ({
      ...r,
      created_at: (r.created_at as Date).toISOString(),
      expires_at: r.expires_at ? (r.expires_at as Date).toISOString() : null,
      revoked_at: r.revoked_at ? (r.revoked_at as Date).toISOString() : null,
      last_used_at: r.last_used_at ? (r.last_used_at as Date).toISOString() : null,
    })) as CredentialView[];
  });
}

export interface AuditEntry {
  id: number;
  at: string;
  principal_handle: string | null;
  app_role: string | null;
  client: string | null;
  action: string;
  object_type: string | null;
  object_id: string | null;
  outcome: string;
  detail: unknown;
}

/** The audit log is visible to the founder only (row-level security returns nothing to anyone else). */
export async function listAudit(principal: Principal, options: { outcome?: string; limit?: number } = {}): Promise<AuditEntry[]> {
  return readAs(claimsFor(principal), async (q) => {
    const rows = await q.query(
      `select id, at, principal_handle, app_role, client, action, object_type, object_id, outcome, detail
         from hq.audit_log where ($1::text is null or outcome = $1) order by id desc limit $2`,
      [options.outcome ?? null, Math.min(options.limit ?? 50, 500)],
    );
    return rows.rows.map((r) => ({ ...r, id: Number(r.id), at: (r.at as Date).toISOString() })) as AuditEntry[];
  });
}
