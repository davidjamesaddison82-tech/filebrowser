/**
 * HarmonyByrd HQ record schemas.
 *
 * These are the typed shapes of every authoritative record. They are used to validate
 * evidence packs before import, to validate proposals before they enter the inbox, and to
 * type every read path (UI, REST API and MCP tools read the same objects).
 *
 * Epistemic discipline is part of the type system: a factual field is a `Claim`, and a claim
 * always says what kind of statement it is and where it came from.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** What kind of statement a claim is. Never collapse these into one "status". */
export const EPISTEMIC = [
  "verified", // checked directly by HQ in this build (e.g. a checksum recomputed from the bytes)
  "reported", // a source document states it as fact or history; HQ has not independently verified it
  "design_intention", // a source states it as a plan, design, proposal or specification
  "source_recommendation", // the recommendation or opinion of a source document's author
  "founder_statement", // words or a ruling a source attributes to the founder
  "hq_recommendation", // a recommendation made by HQ's builder; never an approval
  "submitter_claim", // stated by whoever submitted the record through the proposal inbox; unverified
  "no_evidence", // nothing accessible supports a statement either way
] as const;
export type Epistemic = (typeof EPISTEMIC)[number];

export const EPISTEMIC_LABEL: Record<Epistemic, string> = {
  verified: "Verified by HQ",
  reported: "Reported in source",
  design_intention: "Design intention",
  source_recommendation: "Source author's recommendation",
  founder_statement: "Founder statement (as recorded in source)",
  hq_recommendation: "HQ recommendation",
  submitter_claim: "Submitter's claim (unverified)",
  no_evidence: "No evidence accessible",
};

/** The shared learning progression named in commission HB-HQ-P02-R1 §7. */
export const STAGES = [
  "encounter",
  "understand",
  "predict",
  "hear",
  "perform",
  "create",
  "capture_reflect",
  "retrieve",
  "transfer",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  encounter: "Encounter",
  understand: "Understand",
  predict: "Predict",
  hear: "Hear",
  perform: "Physically perform",
  create: "Use creatively",
  capture_reflect: "Capture / reflect",
  retrieve: "Retrieve later",
  transfer: "Transfer",
};

/**
 * Independent lifecycle dimensions. A module is never summarised as one percentage:
 * it can be documented, prototyped and browser-tested while still unaccepted and unintegrated.
 */
export const LIFECYCLE_DIMENSIONS = [
  "documented",
  "designed",
  "prototyped",
  "implemented",
  "automated_tests",
  "browser_tested",
  "hardware_tested",
  "independently_assessed",
  "founder_accepted",
  "integrated",
  "released",
  "learner_validated",
] as const;
export type LifecycleDimension = (typeof LIFECYCLE_DIMENSIONS)[number];

export const LIFECYCLE_LABEL: Record<LifecycleDimension, { label: string; short: string; question: string }> = {
  documented: { label: "Documented", short: "Doc", question: "Is there a written record of what it is for?" },
  designed: { label: "Designed", short: "Design", question: "Is there a design or specification?" },
  prototyped: { label: "Prototyped", short: "Proto", question: "Does a runnable prototype or candidate exist?" },
  implemented: { label: "Implemented", short: "Impl", question: "Is there an implementation beyond a prototype?" },
  automated_tests: { label: "Automated tests", short: "Tests", question: "Are automated test results on record?" },
  browser_tested: { label: "Browser tested", short: "Browser", question: "Has it been exercised in a real browser?" },
  hardware_tested: { label: "Hardware / MIDI tested", short: "MIDI", question: "Has it been tried on real instruments or hardware?" },
  independently_assessed: { label: "Independently assessed", short: "Audit", question: "Has someone other than the builder assessed it?" },
  founder_accepted: { label: "Founder accepted", short: "Accepted", question: "Is a founder acceptance on record?" },
  integrated: { label: "Integrated", short: "Integr", question: "Is it connected to the rest of the ecosystem?" },
  released: { label: "Released", short: "Release", question: "Has it been released to users?" },
  learner_validated: { label: "Validated with learners", short: "Learners", question: "Is there evidence from real learners?" },
};

export const LIFECYCLE_STATES = ["yes", "partial", "no", "unknown", "not_applicable"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const RECORD_TYPES = [
  "source",
  "module",
  "loop",
  "pathway",
  "requirement",
  "decision",
  "commission",
  "build",
  "evidence",
  "defect",
  "open_item",
  "recommendation",
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const RECORD_TYPE_LABEL: Record<RecordType, string> = {
  source: "Source",
  module: "Module",
  loop: "Learning loop",
  pathway: "Cross-module pathway",
  requirement: "Founder requirement",
  decision: "Founder decision",
  commission: "Commission",
  build: "Build",
  evidence: "Evidence",
  defect: "Defect",
  open_item: "Open item",
  recommendation: "Recommendation",
};

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const id = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}-[A-Z0-9][A-Z0-9.-]{0,60}$`), `must look like ${prefix}-…`);

export const SourceId = id("SRC");
export const ModuleId = id("MOD");

/** A verbatim excerpt of a source. `quote` is machine-checked against the source snapshot. */
export const Citation = z.object({
  source_id: SourceId,
  locator: z.string().nullish(),
  quote: z.string().min(12, "a citation needs a verbatim quote of at least 12 characters"),
});
export type Citation = z.infer<typeof Citation>;

/** A statement together with what kind of statement it is and what supports it. */
export const Claim = z
  .object({
    text: z.string().min(1),
    epistemic: z.enum(EPISTEMIC),
    citations: z.array(Citation).default([]),
  })
  .superRefine((claim, ctx) => {
    const needsSource = ["reported", "design_intention", "source_recommendation", "founder_statement"].includes(
      claim.epistemic,
    );
    if (needsSource && claim.citations.length === 0) {
      ctx.addIssue({ code: "custom", message: `a "${claim.epistemic}" claim must cite at least one source` });
    }
  });
export type Claim = z.infer<typeof Claim>;

const NullableClaim = Claim.nullable().default(null);

/** Acceptance recorded inside HQ by a founder decision. Never importable, never set by a proposal. */
export const HqAcceptance = z.object({
  state: z.enum(["accepted", "rejected", "none"]),
  decision_id: z.string(),
  decided_at: z.string(),
  decided_by: z.string(),
  scope_note: z.string().nullish(),
});

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export const SOURCE_KINDS = [
  "claude_artifact_docs",
  "claude_artifact_html",
  "claude_artifact_design",
  "commission_text",
  "github_repository",
  "google_drive",
  "named_not_accessible",
  "fixture",
] as const;

export const SOURCE_ACCESS = ["read_full", "read_partial", "inventoried_not_ingested", "not_accessible"] as const;

/** How much authority a source carries. Assigned by HQ's builder as a classification, not a founder ruling. */
export const SOURCE_AUTHORITY = [
  "founder_instrument", // written by the founder (e.g. a commission)
  "founder_decision_record", // records a decision the founder made
  "decision_preparation", // prepares options for the founder; issues nothing
  "design_package", // design or specification output of a commission
  "assessment_or_research", // orientation, audit, research or review
  "executable_candidate", // a runnable build or prototype
  "test_or_field_record", // test sheet, field log, acceptance run
  "production_asset", // film / media production notes
  "referenced_only", // named by other sources but not accessible
  "out_of_scope", // accessible but belongs to a different product
  "fixture", // synthetic test data
] as const;

export const SourceRecord = z.looseObject({
  id: SourceId,
  title: z.string().min(1),
  kind: z.enum(SOURCE_KINDS),
  location: z.string().nullable(),
  version: z.string().nullable().default(null),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null),
  bytes: z.number().int().nonnegative().nullable().default(null),
  retrieved_at: z.string().nullable().default(null),
  doc_date: z.string().nullable().default(null),
  updated: z.string().nullable().default(null),
  access: z.enum(SOURCE_ACCESS),
  authority: z.enum(SOURCE_AUTHORITY),
  authority_note: z.string().default(""),
  summary: z.string().default(""),
  product_scope: z.string().default(""),
  prepared_by: z.string().nullable().default(null),
  commission_codes: z.array(z.string()).default([]),
  parts: z
    .array(
      z.object({
        name: z.string(),
        sha256: z.string().nullable().default(null),
        bytes: z.number().nullable().default(null),
        rev: z.number().nullable().default(null),
      }),
    )
    .default([]),
  text_snapshot: z
    .object({ file: z.string(), sha256: z.string(), chars: z.number() })
    .nullable()
    .default(null),
  /** For sources that are only named elsewhere: where they are named. */
  named_in: z.array(Citation).default([]),
  /** What HQ itself checked about this source. */
  hq_checks: z.array(z.object({ check: z.string(), result: z.string() })).default([]),
});
export type SourceRecord = z.infer<typeof SourceRecord>;

const LifecycleEntry = z
  .object({
    state: z.enum(LIFECYCLE_STATES),
    basis: z.enum(EPISTEMIC),
    note: z.string().default(""),
    citations: z.array(Citation).default([]),
  })
  .superRefine((entry, ctx) => {
    if ((entry.state === "yes" || entry.state === "partial") && entry.citations.length === 0 && entry.basis !== "verified") {
      ctx.addIssue({
        code: "custom",
        message: `a lifecycle state of "${entry.state}" must cite the source that supports it`,
      });
    }
  });

export const Capability = z.object({
  title: z.string().min(1),
  detail: z.string().default(""),
  state: z.enum(["existing", "partial", "intended_absent", "unknown"]),
  epistemic: z.enum(EPISTEMIC),
  citations: z.array(Citation).default([]),
});

export const MODULE_KINDS = ["module", "submodule", "workstream", "shared_engine", "programme", "experiment", "product"] as const;

export const EVIDENCE_LEVELS = [
  "documented_in_sources", // at least one accessible source describes it
  "named_only", // accessible sources name it but say little or nothing more
  "commission_list_only", // named only in the illustrative list of commission HB-HQ-P02-R1 §6
] as const;

export const ModuleRecord = z.looseObject({
  id: ModuleId,
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  kind: z.enum(MODULE_KINDS),
  parent_id: ModuleId.nullable().default(null),
  family: z.string().min(1),
  commission_listed: z.boolean().default(false),
  evidence_level: z.enum(EVIDENCE_LEVELS),
  summary: z.string().default(""),
  objective: NullableClaim,
  intended_user: NullableClaim,
  why_exists: NullableClaim,
  learner_outcome: NullableClaim,
  core_loop: NullableClaim,
  capabilities: z.array(Capability).default([]),
  ui_requirements: z.array(Claim).default([]),
  lifecycle: z.record(z.enum(LIFECYCLE_DIMENSIONS), LifecycleEntry),
  blockers: z.array(Claim).default([]),
  next_actions: z.array(Claim).default([]),
  loop_ids: z.array(id("LOOP")).default([]),
  connections: z
    .array(
      z.object({
        to: ModuleId,
        nature: z.string().min(1),
        epistemic: z.enum(EPISTEMIC),
        citations: z.array(Citation).default([]),
      }),
    )
    .default([]),
  citations: z.array(Citation).default([]),
  hq_acceptance: HqAcceptance.optional(),
});
export type ModuleRecord = z.infer<typeof ModuleRecord>;

export const LoopStep = z.object({
  order: z.number().int().nonnegative(),
  source_term: z.string().min(1),
  description: z.string().default(""),
  /** HQ's mapping onto the shared progression. "none" when the source step does not map. */
  shared_stage: z.enum([...STAGES, "none"]),
  module_id: ModuleId.nullable().default(null),
  citations: z.array(Citation).default([]),
});

export const LoopRecord = z.looseObject({
  id: id("LOOP"),
  name: z.string().min(1),
  module_ids: z.array(ModuleId).default([]),
  variant_of: id("LOOP").nullable().default(null),
  /** Is this loop reported as built, or is it a design? */
  standing: z.enum(EPISTEMIC),
  objective: NullableClaim,
  concepts: z.array(z.string()).default([]),
  student_does: NullableClaim,
  system_observes: NullableClaim,
  feedback_scaffolding: NullableClaim,
  retrieval_transfer: NullableClaim,
  success_evidence: NullableClaim,
  /** Who decides what is musically correct in this loop (deterministic engine, founder, …). */
  assessment_authority: NullableClaim,
  steps: z.array(LoopStep).default([]),
  citations: z.array(Citation).default([]),
  hq_acceptance: HqAcceptance.optional(),
});
export type LoopRecord = z.infer<typeof LoopRecord>;

export const PathwayRecord = z.looseObject({
  id: id("PATH"),
  name: z.string().min(1),
  description: z.string().default(""),
  basis: z.enum(["reported", "design_intention", "commission_example", "hq_recommendation", "source_recommendation"]),
  steps: z
    .array(
      z.object({
        order: z.number().int().nonnegative(),
        module_id: ModuleId,
        role: z.string().min(1),
        shared_stage: z.enum([...STAGES, "none"]).default("none"),
        citations: z.array(Citation).default([]),
      }),
    )
    .min(2),
  citations: z.array(Citation).default([]),
});
export type PathwayRecord = z.infer<typeof PathwayRecord>;

export const REQUIREMENT_DISPOSITIONS = [
  "unreviewed", // registered; the founder has not yet confirmed its standing in HQ
  "active",
  "superseded",
  "conflicted",
  "deferred",
  "withdrawn",
  "satisfied",
] as const;

export const IMPLEMENTATION_STATES = [
  "no_record", // nothing accessible says whether it was implemented
  "not_started",
  "in_progress",
  "implemented_unverified", // a source or agent says it is implemented; no test evidence linked
  "implemented_tested", // implementation and test evidence are linked
] as const;

export const REQUIREMENT_CATEGORIES = [
  "scope",
  "pedagogy",
  "ui_ux",
  "assessment_authority",
  "governance",
  "testing",
  "release",
  "privacy",
  "technical",
  "content",
  "other",
] as const;

export const RequirementRecord = z.looseObject({
  id: id("FR"),
  // -- immutable original (enforced in the database) --
  exact_wording: z.string().min(3),
  source_id: SourceId,
  locator: z.string().nullable().default(null),
  source_date: z.string().nullable().default(null),
  attribution: z.enum(["commission_text", "direct_quote", "ruling_recorded_by_source", "restated_by_source"]),
  // -- HQ's working fields, kept visibly separate from the original --
  title: z.string().min(1),
  category: z.enum(REQUIREMENT_CATEGORIES),
  interpretation: z.string().nullable().default(null),
  module_ids: z.array(ModuleId).default([]),
  disposition: z.enum(REQUIREMENT_DISPOSITIONS),
  disposition_decision_id: z.string().nullish(),
  implementation_state: z.enum(IMPLEMENTATION_STATES),
  implementation_note: NullableClaim,
  acceptance_criteria: z.array(Claim).default([]),
  depends_on: z.array(id("FR")).default([]),
  linked_code: z
    .array(
      z.object({
        repository: z.string(),
        ref: z.string(),
        path: z.string().nullish(),
        note: z.string().nullish(),
      }),
    )
    .default([]),
  linked_evidence_ids: z.array(id("EV")).default([]),
  linked_build_ids: z.array(id("BLD")).default([]),
  decision_ids: z.array(id("FD")).default([]),
  conflicts_with: z.array(z.object({ id: id("FR"), note: z.string() })).default([]),
  supersedes: z.array(id("FR")).default([]),
  superseded_by: z.array(id("FR")).default([]),
  duplicate_of: id("FR").nullable().default(null),
  citations: z.array(Citation).default([]),
  hq_acceptance: HqAcceptance.optional(),
});
export type RequirementRecord = z.infer<typeof RequirementRecord>;

export const DECISION_STATUSES = ["issued", "unissued", "pending", "held", "rejected", "superseded", "unknown"] as const;

export const DecisionRecord = z.looseObject({
  id: id("FD"),
  /** The decision's own identifier in the source (e.g. "FD-P2-01"), preserved exactly. */
  code: z.string().nullable().default(null),
  title: z.string().min(1),
  status: z.enum(DECISION_STATUSES),
  /** "source": reported by a source document. "hq": recorded by the founder inside HQ. */
  recorded_in: z.enum(["source", "hq"]),
  date: z.string().nullable().default(null),
  statement: Claim,
  exact_text: z.string().nullable().default(null),
  rationale: z.string().nullish(),
  module_ids: z.array(ModuleId).default([]),
  requirement_ids: z.array(id("FR")).default([]),
  commission_code: z.string().nullable().default(null),
  resolves: z.array(z.string()).default([]),
  effects: z.array(z.record(z.string(), z.unknown())).default([]),
  decided_by: z.string().nullish(),
  decided_at: z.string().nullish(),
  citations: z.array(Citation).default([]),
});
export type DecisionRecord = z.infer<typeof DecisionRecord>;

export const CommissionRecord = z.looseObject({
  id: id("COM"),
  code: z.string().min(1),
  title: z.string().min(1),
  date: z.string().nullable().default(null),
  status: z.enum(["delivered", "in_progress", "proposed", "closed", "deferred", "unknown"]),
  scope: NullableClaim,
  module_ids: z.array(ModuleId).default([]),
  output_source_ids: z.array(SourceId).default([]),
  citations: z.array(Citation).default([]),
  hq_acceptance: HqAcceptance.optional(),
});
export type CommissionRecord = z.infer<typeof CommissionRecord>;

export const BUILD_STANDINGS = [
  "accepted_reported", // a source reports founder acceptance (scope as stated in the source)
  "candidate_not_accepted",
  "development",
  "superseded",
  "withdrawn",
  "unknown",
] as const;

export const BuildRecord = z.looseObject({
  id: id("BLD"),
  label: z.string().min(1),
  module_id: ModuleId.nullable().default(null),
  filename: z.string().nullable().default(null),
  sha256: z.string().nullable().default(null),
  bytes: z.string().nullable().default(null),
  standing: z.enum(BUILD_STANDINGS),
  statement: Claim,
  /** Set when the build itself is one of the captured sources (HQ holds its bytes' checksum). */
  artifact_source_id: SourceId.nullable().default(null),
  hq_checks: z.array(z.object({ check: z.string(), result: z.string() })).default([]),
  citations: z.array(Citation).default([]),
  hq_acceptance: HqAcceptance.optional(),
});
export type BuildRecord = z.infer<typeof BuildRecord>;

export const EVIDENCE_TYPES = [
  "automated_test",
  "browser_test",
  "manual_test",
  "hardware_midi_test",
  "musical_correctness",
  "independent_audit",
  "founder_acceptance",
  "founder_observation",
  "hash_manifest",
  "failure_ledger",
  "screenshot",
  "research_evidence",
  "release_reference",
  "hq_check",
  "other",
] as const;

export const EVIDENCE_VERIFICATION = [
  "hq_verified", // HQ produced or re-checked this evidence itself
  "source_reported", // a source document reports it
  "submitted_unverified", // submitted through the proposal inbox by a human; not verified
  "agent_submitted_unverified", // submitted by an AI client; an agent's claim is not evidence of completion
] as const;

export const EvidenceRecord = z.looseObject({
  id: id("EV"),
  type: z.enum(EVIDENCE_TYPES),
  title: z.string().min(1),
  module_ids: z.array(ModuleId).default([]),
  build_id: id("BLD").nullable().default(null),
  result: Claim,
  verification: z.enum(EVIDENCE_VERIFICATION),
  submitted_by: z.string().nullish(),
  date: z.string().nullable().default(null),
  sha256: z.string().nullable().default(null),
  citations: z.array(Citation).default([]),
  hq_acceptance: HqAcceptance.optional(),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecord>;

export const DefectRecord = z.looseObject({
  id: id("DEF"),
  title: z.string().min(1),
  module_ids: z.array(ModuleId).default([]),
  build_id: id("BLD").nullable().default(null),
  status: z.enum(["open", "resolved", "deferred", "unknown"]),
  severity: z.enum(["blocking", "major", "minor", "unknown"]).default("unknown"),
  statement: Claim,
  citations: z.array(Citation).default([]),
});
export type DefectRecord = z.infer<typeof DefectRecord>;

export const OPEN_ITEM_KINDS = [
  "pending_founder_decision",
  "blocker",
  "unresolved_dependency",
  "unverified_claim",
  "risk",
  "not_authorised",
  "missing_evidence",
  "source_gap",
] as const;

export const OpenItemRecord = z.looseObject({
  id: id("OPEN"),
  kind: z.enum(OPEN_ITEM_KINDS),
  title: z.string().min(1),
  statement: Claim,
  module_ids: z.array(ModuleId).default([]),
  decision_id: id("FD").nullable().default(null),
  citations: z.array(Citation).default([]),
});
export type OpenItemRecord = z.infer<typeof OpenItemRecord>;

/** A proposed next step. Always a recommendation: only a founder decision can approve work. */
export const RecommendationRecord = z.looseObject({
  id: id("REC"),
  title: z.string().min(1),
  rationale: z.string().min(1),
  rank: z.number().int().positive(),
  status: z.literal("proposed"),
  made_by: z.string().default("HQ builder (commission HB-HQ-P02-R1)"),
  module_ids: z.array(ModuleId).default([]),
  prerequisite_ids: z.array(z.string()).default([]),
  blocked_by: z.array(z.string()).default([]),
  citations: z.array(Citation).default([]),
});
export type RecommendationRecord = z.infer<typeof RecommendationRecord>;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const RECORD_SCHEMAS = {
  source: SourceRecord,
  module: ModuleRecord,
  loop: LoopRecord,
  pathway: PathwayRecord,
  requirement: RequirementRecord,
  decision: DecisionRecord,
  commission: CommissionRecord,
  build: BuildRecord,
  evidence: EvidenceRecord,
  defect: DefectRecord,
  open_item: OpenItemRecord,
  recommendation: RecommendationRecord,
} as const satisfies Record<RecordType, z.ZodType>;

export type RecordOf<T extends RecordType> = z.infer<(typeof RECORD_SCHEMAS)[T]>;
export type AnyRecord = RecordOf<RecordType>;

export function isRecordType(value: string): value is RecordType {
  return (RECORD_TYPES as readonly string[]).includes(value);
}

export function parseRecord<T extends RecordType>(type: T, data: unknown): RecordOf<T> {
  return RECORD_SCHEMAS[type].parse(data) as RecordOf<T>;
}

export function safeParseRecord(type: RecordType, data: unknown): { ok: true; data: AnyRecord } | { ok: false; issues: string[] } {
  const result = RECORD_SCHEMAS[type].safeParse(data);
  if (result.success) return { ok: true, data: result.data as AnyRecord };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => `${issue.path.join(".") || "(record)"}: ${issue.message}`),
  };
}

/** Top-level fields that no proposal may set (mirrors hq.protected_fields() in the database). */
export const PROTECTED_FIELDS = [
  "id",
  "exact_wording",
  "source_id",
  "locator",
  "source_date",
  "attribution",
  "disposition",
  "disposition_decision_id",
  "hq_acceptance",
  "recorded_in",
  "decided_by",
  "decided_at",
  "verification",
  "submitted_by",
] as const;

/** Record types a proposal may create (mirrors hq.creatable_types() in the database). */
export const CREATABLE_TYPES = [
  "defect",
  "evidence",
  "open_item",
  "recommendation",
  "requirement",
  "module",
  "loop",
  "pathway",
  "commission",
  "build",
  "source",
] as const satisfies readonly RecordType[];
