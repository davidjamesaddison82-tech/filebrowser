/**
 * The tool registry: one definition of every operation HQ offers to programmatic clients.
 *
 * The REST API (/api/v1/tools/<name>) and the MCP endpoint (/api/mcp) are both generated from
 * this list, so Claude, ChatGPT and any script call exactly the same functions with exactly the
 * same permission checks. There is deliberately no tool that reviews a proposal, records a
 * decision or records acceptance: those are founder acts and exist only in the founder's
 * interactive session.
 */
import { z } from "zod";
import type { Principal } from "@/lib/auth/principal";
import { RECORD_TYPES } from "@/lib/domain/schemas";
import { invalid } from "./errors";
import * as services from "./services";

const rev = z
  .number()
  .int()
  .positive()
  .optional()
  .describe(
    "Pin a dataset revision. Omit for the latest. The same revision always returns identical data. Every read tool takes it except get_recent_changes and list_my_proposals.",
  );

const recordType = z.enum(RECORD_TYPES).describe(`Record type: ${RECORD_TYPES.join(", ")}.`);

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  /** "read" tools never change anything. "propose" tools add to the isolated proposal inbox only. */
  mode: "read" | "propose";
  input: z.ZodObject;
  run: (principal: Principal, input: Record<string, unknown>) => Promise<unknown>;
}

/** At most this many characters of anything the client sent are echoed back in an error (H7). */
const ECHO_MAX = 80;
/** At most this many unknown arguments or problems are listed in an error, then a count of the rest. */
const LIST_MAX = 10;

/** Client text as echoed in an error: its first 80 characters, marked when cut. */
export function echoed(text: string): string {
  return text.length > ECHO_MAX ? `${text.slice(0, ECHO_MAX)}…` : text;
}

/** A path of argument names (which the client chose) as echoed in an error. */
const pathOf = (path: readonly PropertyKey[]) => echoed(path.map(String).join("."));

/** The first LIST_MAX items, then one line saying how many more there are. */
function bounded<T>(items: T[], more: (count: number) => T): T[] {
  return items.length > LIST_MAX ? [...items.slice(0, LIST_MAX), more(items.length - LIST_MAX)] : items;
}

function define<S extends z.ZodObject>(tool: {
  name: string;
  title: string;
  description: string;
  mode: "read" | "propose";
  input: S;
  run: (principal: Principal, input: z.output<S>) => Promise<unknown>;
}): ToolDefinition {
  return {
    ...tool,
    run: async (principal, raw) => {
      const parsed = tool.input.safeParse(raw ?? {});
      if (!parsed.success) {
        // An argument a tool does not take is refused, never silently dropped (e.g. `rev` on a tool
        // that always answers at the latest revision). Names are the client's: each is cut to 80
        // characters, and at most 10 are listed, with a count of the rest.
        const unknown = parsed.error.issues.flatMap((issue) =>
          issue.code === "unrecognized_keys" ? issue.keys.map((key) => pathOf([...issue.path, key])) : [],
        );
        const listed = unknown.slice(0, LIST_MAX).map((k) => `"${k}"`).join(", ");
        const rest = unknown.length > LIST_MAX ? ` and ${unknown.length - LIST_MAX} more` : "";
        const problems = parsed.error.issues.flatMap((issue) =>
          issue.code === "unrecognized_keys"
            ? issue.keys.map((key) => `${pathOf([...issue.path, key])}: not an argument of ${tool.name}`)
            : [`${issue.path.length > 0 ? pathOf(issue.path) : "(arguments)"}: ${issue.message.slice(0, 200)}`],
        );
        throw invalid(
          unknown.length > 0
            ? `${tool.name} does not take the argument${unknown.length > 1 ? "s" : ""} ${listed}${rest}.`
            : `Invalid arguments for ${tool.name}.`,
          bounded(problems, (count) => `(${count} more problem(s) not listed)`),
        );
      }
      return tool.run(principal, parsed.data);
    },
  };
}

const evidenceRef = z.strictObject({
  description: z.string().min(1).describe("What this evidence is."),
  reference: z.string().optional().describe("Where it can be found (URL, repository path, document id)."),
  sha256: z.string().optional().describe("SHA-256 of the artefact, if there is one."),
});

export const TOOLS: ToolDefinition[] = [
  define({
    name: "get_ecosystem_overview",
    title: "Ecosystem overview",
    description:
      "The whole HarmonyByrd ecosystem at a glance: every module with its family and honest standing, the connections between modules, development health (acceptance, tests, defects, blockers, pending founder decisions), missing and forgotten work, and proposed priorities. Start here.",
    mode: "read",
    input: z.strictObject({ rev }),
    run: (p, a) => services.getEcosystemOverview(p, { rev: a.rev }),
  }),
  define({
    name: "get_module_brief",
    title: "Module brief",
    description:
      "Everything HQ holds about one module: objective, intended user, core learning loop, existing and intended-but-absent capabilities, builds with hashes, lifecycle by independent dimension, defects, requirements, decisions, connections, blockers, next actions and exact source references. Accepts a module id (MOD-…) or an exact module name or alias.",
    mode: "read",
    input: z.strictObject({ module: z.string().min(1).describe("Module id (MOD-…) or exact name/alias."), rev }),
    run: (p, a) => services.getModuleBrief(p, a.module, { rev: a.rev }),
  }),
  define({
    name: "list_learning_loops",
    title: "Learning loops",
    description:
      "All recovered learning loops laid against the shared progression (encounter, understand, predict, hear, perform, create, capture/reflect, retrieve, transfer), which modules cover each stage, and the cross-module pathways.",
    mode: "read",
    input: z.strictObject({ rev }),
    run: (p, a) => services.listLearningLoops(p, { rev: a.rev }),
  }),
  define({
    name: "get_learning_loop",
    title: "Learning loop",
    description:
      "One learning loop in full: objective, musical concepts, what the student does, what HarmonyByrd observes, feedback and scaffolding, when retrieval or transfer occurs, what evidence would show success, its steps in the source's own terms, and the other modules contributing to the same stages.",
    mode: "read",
    input: z.strictObject({ loop_id: z.string().min(1).describe("Loop id (LOOP-…)."), rev }),
    run: (p, a) => services.getLearningLoop(p, a.loop_id, { rev: a.rev }),
  }),
  define({
    name: "search_founder_requirements",
    title: "Search founder requirements",
    description:
      "Search the register of founder instructions. Each result carries its durable id, the exact original wording, source and date, related modules, disposition and implementation state. Original wording is never altered; interpretations are returned separately.",
    mode: "read",
    input: z.strictObject({
      query: z.string().optional().describe("Words that must all appear (in wording, title, id, interpretation…)."),
      module: z.string().optional().describe("Limit to a module id."),
      category: z.string().optional(),
      disposition: z.string().optional().describe("unreviewed, active, superseded, conflicted, deferred, withdrawn or satisfied."),
      implementation_state: z.string().optional(),
      source_id: z.string().optional(),
      outstanding: z.boolean().optional().describe("Only requirements that are live and lack implementation or test evidence."),
      rev,
    }),
    run: (p, a) =>
      services.searchFounderRequirements(
        p,
        {
          q: a.query,
          module_id: a.module,
          category: a.category,
          disposition: a.disposition,
          implementation_state: a.implementation_state,
          source_id: a.source_id,
          outstanding: a.outstanding,
        },
        { rev: a.rev },
      ),
  }),
  define({
    name: "find_outstanding_requirements",
    title: "Outstanding requirements",
    description:
      "Founder requirements with no corresponding implementation record, test evidence or founder disposition — the list of what has not been fulfilled — plus modules with no supporting source and governing documents HQ could not read.",
    mode: "read",
    input: z.strictObject({ module: z.string().optional().describe("Limit to a module id."), rev }),
    run: (p, a) => services.findOutstandingRequirements(p, { module_id: a.module }, { rev: a.rev }),
  }),
  define({
    name: "get_acceptance_status",
    title: "Acceptance status",
    description:
      "The acceptance standing of a module, build or other record, keeping four things apart: proposal, prototype/candidate, tested, and accepted. Distinguishes acceptance reported by a source document from acceptance recorded in HQ by a founder decision. Passing tests are never reported as acceptance.",
    mode: "read",
    input: z.strictObject({ type: recordType, id: z.string().min(1), rev }),
    run: (p, a) => services.getAcceptanceStatus(p, a.type, a.id, { rev: a.rev }),
  }),
  define({
    name: "get_source_lineage",
    title: "Source lineage",
    description:
      "Where a record comes from: the source documents it cites (location, version, SHA-256, access and authority), the exact quotations used, its full version history with hash chain, and the records that refer to it.",
    mode: "read",
    input: z.strictObject({ type: recordType, id: z.string().min(1), rev }),
    run: (p, a) => services.getSourceLineage(p, a.type, a.id, { rev: a.rev }),
  }),
  define({
    name: "get_development_dependencies",
    title: "Development dependencies",
    description:
      "What a record depends on, what depends on it, and what blocks it (prerequisites, parent modules, connections, open blockers). On a record that does not pass validation, a list HQ cannot read is named in unreadable_fields (\"Not readable — see the stored record\"): an empty list there does not mean nothing is recorded.",
    mode: "read",
    input: z.strictObject({ type: recordType, id: z.string().min(1), rev }),
    run: (p, a) => services.getDevelopmentDependencies(p, a.type, a.id, { rev: a.rev }),
  }),
  define({
    name: "get_record",
    title: "Get record",
    description:
      "Any single record by type and id, with its version history. A record that does not pass validation is returned conformed to its schema (a value of the wrong kind reads \"Not a valid value\"), with valid: false, its validation problems, the record exactly as stored (stored) and, for each list HQ cannot read and so returns empty, unreadable_fields (\"Not readable — see the stored record\"). Use the version number when proposing a change.",
    mode: "read",
    input: z.strictObject({ type: recordType, id: z.string().min(1), rev }),
    run: (p, a) => services.getRecord(p, a.type, a.id, { rev: a.rev }),
  }),
  define({
    name: "search_records",
    title: "Search all records",
    description: "Full-text search across every record type. Every word must match. Results carry stable ids.",
    mode: "read",
    input: z.strictObject({ query: z.string().min(1), types: z.array(recordType).optional(), rev }),
    run: (p, a) => services.searchRecords(p, a.query, a.types, { rev: a.rev }),
  }),
  define({
    name: "list_sources",
    title: "Source inventory",
    description:
      "The source-access inventory: every document HQ knows of, whether it was actually read, its location, version, checksum and authority classification — including documents that are named but could not be read.",
    mode: "read",
    input: z.strictObject({ rev }),
    run: (p, a) => services.listSources(p, { rev: a.rev }),
  }),
  define({
    name: "get_review_items",
    title: "Review items",
    description: "Conflicting requirements, possible duplicates, acceptance claimed without an instrument on record, unverified agent claims and dangling references.",
    mode: "read",
    input: z.strictObject({ rev }),
    run: (p, a) => services.getReviewItems(p, { rev: a.rev }),
  }),
  define({
    name: "get_recent_changes",
    title: "Recent changes",
    description:
      "Dataset revisions, newest first: what changed, when, why, by whom and under which commission. Always answers from the latest revision; it does not take `rev`.",
    mode: "read",
    input: z.strictObject({ limit: z.number().int().min(1).max(100).optional() }),
    run: (p, a) => services.getRecentChanges(p, a.limit ?? 30),
  }),
  define({
    name: "list_my_proposals",
    title: "My proposals",
    description:
      "The proposals this client has submitted, with their status (submitted, accepted, rejected, needs_changes, marked_stale, withdrawn) and review notes. Proposals are inbox items, not dataset records: this always answers at the latest revision and does not take `rev`.",
    mode: "read",
    input: z.strictObject({ status: z.string().optional() }),
    run: (p, a) => services.listMyProposals(p, { status: a.status }),
  }),
  define({
    name: "submit_change_proposal",
    title: "Submit a change proposal",
    description:
      "Propose a change to an existing record (provide target + set) or propose a new record (provide create). The proposal enters an isolated inbox and changes NOTHING until the founder reviews it. You must state the record version you read (target.base_version) and the dataset revision (base_rev): a proposal written against an out-of-date version is refused as stale. Original wording, provenance, dispositions and acceptance cannot be changed by proposal.",
    mode: "propose",
    input: z.strictObject({
      kind: z.enum(["change_proposal", "classification", "reconciliation"]).optional(),
      title: z.string().min(3).max(200),
      rationale: z.string().min(3).max(8000).describe("Why the change is right, and what supports it."),
      base_rev: z.number().int().positive().describe("The dataset revision you read."),
      target: z
        .strictObject({ type: recordType, id: z.string(), base_version: z.number().int().positive().describe("The record version you read.") })
        .optional(),
      set: z.record(z.string(), z.unknown()).optional().describe("Top-level fields to replace on the target record."),
      create: z.strictObject({ record_type: recordType, record: z.record(z.string(), z.unknown()) }).optional(),
      evidence: z.array(evidenceRef).optional(),
      idempotency_key: z.string().min(8).max(120).optional().describe("Repeat-safe key: resubmitting with the same key returns the first proposal."),
    }),
    run: (p, a) => services.submitChangeProposal(p, a),
  }),
  define({
    name: "submit_defect_report",
    title: "Report a defect",
    description:
      "Report a defect against one or more modules. It enters the proposal inbox; if the founder files it, it becomes an open defect record that stays visible until its resolution is recorded.",
    mode: "propose",
    input: z.strictObject({
      title: z.string().min(3).max(200),
      description: z.string().min(3).max(8000).describe("What happens, how to reproduce it, and what was expected."),
      module_ids: z.array(z.string()).min(1),
      build_id: z.string().optional(),
      severity: z.enum(["blocking", "major", "minor", "unknown"]).optional(),
      base_rev: z.number().int().positive(),
      evidence: z.array(evidenceRef).optional(),
      idempotency_key: z.string().min(8).max(120).optional(),
    }),
    run: (p, a) => services.submitDefectReport(p, a),
  }),
  define({
    name: "record_test_evidence",
    title: "Submit test evidence",
    description:
      "Submit the result of a test run as evidence. It is recorded as an UNVERIFIED SUBMISSION in the inbox and stays labelled that way even after the founder files it: a statement that tests passed is a claim, not evidence of completion, and never implies founder acceptance. Reference the code revision; do not send code.",
    mode: "propose",
    input: z.strictObject({
      title: z.string().min(3).max(200),
      type: z.string().optional().describe("automated_test (default), browser_test, manual_test, hardware_midi_test, musical_correctness, independent_audit…"),
      result_summary: z.string().min(3).max(8000),
      module_ids: z.array(z.string()).optional(),
      build_id: z.string().optional(),
      code_ref: z.strictObject({ repository: z.string(), ref: z.string().describe("Commit SHA or tag."), path: z.string().optional() }).optional(),
      counts: z.strictObject({ passed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() }).optional(),
      artifact_sha256: z.string().optional(),
      date: z.string().optional(),
      base_rev: z.number().int().positive(),
      idempotency_key: z.string().min(8).max(120).optional(),
    }),
    run: (p, a) => services.recordTestEvidence(p, a),
  }),
];

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

export function findTool(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name);
}

/** JSON Schema for a tool's arguments (used by tools/list and the API documentation). */
export function toolInputSchema(tool: ToolDefinition): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

export function describeTools() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    mode: tool.mode,
    required_scope: tool.mode === "read" ? "read" : "propose",
    input_schema: toolInputSchema(tool),
  }));
}

/** Operations that exist in HQ but are deliberately NOT available as tools. */
export const FOUNDER_ONLY_OPERATIONS = [
  "review_proposal (accept / reject / ask for changes)",
  "record_founder_decision (acceptance, requirement standing, resolving conflicts)",
  "issue or revoke client credentials",
];
