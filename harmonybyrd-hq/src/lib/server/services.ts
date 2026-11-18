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
import { citedSourceIds, type Dataset } from "@/lib/domain/dataset";
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
  reviewItems,
  search,
  sourceSummary,
  stageCoverage,
} from "@/lib/domain/derive";
import {
  type AnyRecord,
  CREATABLE_TYPES,
  EVIDENCE_TYPES,
  isRecordType,
  PROTECTED_FIELDS,
  RECORD_TYPES,
  type RecordType,
  safeParseRecord,
} from "@/lib/domain/schemas";
import { audit, readAs, writeAs } from "./db";
import { conflict, forbidden, HqError, invalid, notFound } from "./errors";
import { type DatasetContext, getDataset, listChanges, recordHistory, recordVersion } from "./store";

export const HQ_NOTICE =
  "HarmonyByrd HQ is a NON-AUTHORITATIVE PROTOTYPE built under commission HB-HQ-P02-R1. " +
  "Acceptance of the HB-AI-P00 prerequisite could not be verified from accessible evidence, so nothing here is a governing record. " +
  "Records are labelled by what supports them: verified by HQ, reported in a source, design intention, or recommendation.";

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
}

function envelope<T>(principal: Principal, ctx: DatasetContext, data: T, sourceIds: string[] | null, note?: string): ServiceEnvelope<T> {
  const r = ctx.ds.revision;
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
function resolveModule(ds: Dataset, idOrName: string) {
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
        outstanding: isOutstanding(r.data),
        linked_evidence_ids: r.data.linked_evidence_ids,
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
        "Outstanding: a live requirement (unreviewed, active, conflicted or deferred) that has no linked test evidence or is not recorded as implemented and tested.",
      total: list.length,
      requirements: list.map((r) => ({
        id: r.meta.id,
        title: r.data.title,
        exact_wording: r.data.exact_wording,
        module_ids: r.data.module_ids,
        disposition: r.data.disposition,
        implementation_state: r.data.implementation_state,
        has_linked_evidence: r.data.linked_evidence_ids.length > 0,
        reasons: [
          ...(r.data.implementation_state === "no_record" ? ["no implementation record"] : []),
          ...(r.data.linked_evidence_ids.length === 0 ? ["no linked test or acceptance evidence"] : []),
          ...(r.data.disposition === "unreviewed" ? ["standing not yet confirmed by the founder in HQ"] : []),
        ],
      })),
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
  return envelope(
    principal,
    ctx,
    { type: t, id, title: recordTitle(t, record.data), meta: record.meta, record: record.data, history },
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

export async function searchRecords(principal: Principal, query: string, types: string[] | undefined, options: ServiceOptions = {}) {
  const ctx = await getDataset(principal, options.rev);
  const hits = search(ctx.ds, query, { types: types?.map(requireType), limit: 60 });
  return envelope(principal, ctx, { query, total: hits.length, hits }, null);
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
    .object({
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
    if (error instanceof HqError && (error.status === 403 || error.status === 409)) {
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
    if (type === "decision") {
      throw forbidden("Decision records are written only by a founder decision; they cannot be changed by proposal.");
    }
    const blocked = Object.keys(body.set).filter((key) => (PROTECTED_FIELDS as readonly string[]).includes(key));
    if (blocked.length > 0) {
      await audit(claimsFor(principal), {
        action: "proposal.submit",
        objectType: type,
        objectId: body.target.id,
        outcome: "denied",
        detail: { reason: "protected fields", fields: blocked },
      });
      throw forbidden(
        `Protected fields cannot be changed by a proposal: ${blocked.join(", ")}. ` +
          "Original wording and provenance never change; dispositions and acceptance change only by founder decision.",
        { protected_fields: blocked },
      );
    }
    const current = ctx.ds.get(type, body.target.id);
    if (!current) throw notFound(`No ${type} "${body.target.id}" to change.`);
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
    const merged = { ...(current.data as Record<string, unknown>), ...body.set };
    const check = safeParseRecord(type, merged);
    if (!check.ok) throw invalid(`The proposed change would make ${body.target.id} invalid.`, check.issues);
    return submit(principal, {
      kind: body.kind,
      title: body.title,
      rationale: body.rationale,
      baseRev: body.base_rev,
      target: { type, id: body.target.id, baseVersion: body.target.base_version },
      payload: { op: "update", set: body.set },
      evidence: body.evidence,
      idempotencyKey: body.idempotency_key,
    });
  }

  const create = body.create!;
  const type = requireType(create.record_type);
  if (!(CREATABLE_TYPES as readonly string[]).includes(type)) {
    throw forbidden(`Records of type "${type}" cannot be created by proposal.`);
  }
  const blocked = Object.keys(create.record).filter(
    (key) =>
      (PROTECTED_FIELDS as readonly string[]).includes(key) &&
      !["source_id", "locator", "source_date", "attribution", "exact_wording"].includes(key),
  );
  if (blocked.length > 0) {
    throw forbidden(`Protected fields cannot be set by a proposal: ${blocked.join(", ")}.`, { protected_fields: blocked });
  }
  const candidate = withPlaceholders(type, create.record);
  const check = safeParseRecord(type, candidate);
  if (!check.ok) throw invalid(`The proposed ${type} record is not valid.`, check.issues);
  return submit(principal, {
    kind: body.kind,
    title: body.title,
    rationale: body.rationale,
    baseRev: body.base_rev,
    payload: { op: "create", record_type: type, record: create.record },
    evidence: body.evidence,
    idempotencyKey: body.idempotency_key,
  });
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
  };
}

function assertModulesExist(ds: Dataset, moduleIds: string[]) {
  const unknown = moduleIds.filter((id) => !ds.module(id));
  if (unknown.length > 0) throw invalid(`Unknown module id(s): ${unknown.join(", ")}.`);
}

export async function submitDefectReport(principal: Principal, input: unknown) {
  await requireProposer(principal, "defect.report");
  const body = parseInput(DefectReportInput, input);
  const ctx = await getDataset(principal);
  assertModulesExist(ctx.ds, body.module_ids);
  if (body.build_id && !ctx.ds.get("build", body.build_id)) throw invalid(`Unknown build id: ${body.build_id}.`);
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
  return submit(principal, {
    kind: "defect_report",
    title: body.title,
    rationale: body.description,
    baseRev: body.base_rev,
    payload: { op: "create", record_type: "defect", record },
    evidence: body.evidence,
    idempotencyKey: body.idempotency_key,
  });
}

export async function recordTestEvidence(principal: Principal, input: unknown) {
  await requireProposer(principal, "evidence.submit");
  const body = parseInput(TestEvidenceInput, input);
  const ctx = await getDataset(principal);
  assertModulesExist(ctx.ds, body.module_ids);
  if (body.build_id && !ctx.ds.get("build", body.build_id)) throw invalid(`Unknown build id: ${body.build_id}.`);
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
  return {
    ...result,
    note:
      "Recorded as a SUBMISSION in the isolated inbox. Even after the founder files it, it stays labelled as an unverified submission: " +
      "a statement that tests passed is a claim, not evidence of completion, and never implies founder acceptance.",
  };
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

export async function reviewProposal(principal: Principal, id: string, decision: "accept" | "reject" | "needs_changes", note?: string) {
  await requireFounder(principal, "proposal.review", "proposal", id);
  const claims = claimsFor(principal);
  let result: Record<string, unknown>;
  try {
    result = await writeAs(claims, async (q) => {
      const row = await q.query<{ r: Record<string, unknown> }>("select hq.review_proposal($1, $2, $3) as r", [id, decision, note ?? null]);
      return row.rows[0].r;
    });
  } catch (error) {
    if (error instanceof HqError && error.status === 403) {
      await audit(claims, { action: "proposal.review", objectType: "proposal", objectId: id, outcome: "denied", detail: { message: error.message } });
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

export async function recordFounderDecision(principal: Principal, input: unknown) {
  await requireFounder(principal, "decision.record", "decision", null);
  const body = parseInput(DecisionInput, input);
  const claims = claimsFor(principal);
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

/** What accepting a proposal would do: current vs proposed values, and what else refers to the target. */
export async function proposalImpact(principal: Principal, proposal: ProposalView) {
  const ctx = await getDataset(principal);
  const payload = proposal.payload as { op?: string; set?: Record<string, unknown>; record_type?: string; record?: Record<string, unknown> };
  if (payload.op === "update" && proposal.target_type && proposal.target_id && isRecordType(proposal.target_type)) {
    const current = ctx.ds.get(proposal.target_type, proposal.target_id);
    // While a proposal is open, "before" is the record as it stands now. Once it is closed, "before" is the
    // version the proposal was written against — otherwise an accepted proposal would show its own result as "before".
    const closed = proposal.status !== "submitted";
    const base = closed && proposal.base_version ? await recordVersion(principal, proposal.target_type, proposal.target_id, proposal.base_version) : null;
    const data = ((base as Record<string, unknown> | null) ?? current?.data ?? {}) as Record<string, unknown>;
    const changes = Object.entries(payload.set ?? {}).map(([field, value]) => ({ field, before: data[field] ?? null, after: value }));
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
      sensitive_fields: changes.map((c) => c.field).filter((f) => ["status", "standing", "implementation_state", "lifecycle"].includes(f)),
    };
  }
  const record = (payload.record ?? {}) as Record<string, unknown>;
  const moduleIds = Array.isArray(record.module_ids) ? (record.module_ids as string[]) : [];
  return {
    op: "create" as const,
    record_type: payload.record_type ?? "unknown",
    record,
    affected: moduleIds.map((id) => describeRef(ctx.ds, id)),
    stale: false,
    current_version: null,
    changes: [],
    depends_on: [],
    sources: [],
    sensitive_fields: [],
    target: null,
  };
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
