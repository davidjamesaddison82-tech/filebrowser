/**
 * Pure derived views over a Dataset. No I/O, no clock, no randomness: the same Dataset always
 * yields the same result, which is what makes pinned-revision retrieval reproducible.
 *
 * Every derivation takes the conformed view (DatasetView, conform.ts), never the dataset as stored:
 * the code below reads fields as the record schemas declare them, and a stored record of the wrong
 * shape would make it throw or read as something it does not validly hold. The type says so, so a
 * stored dataset cannot be passed by accident.
 */
import type { DatasetView } from "./conform";
import { citedSourceIds, collectCitations, type Dataset, type Envelope, outgoingRefs, type RecordRef, refKey } from "./dataset";
import { normaliseForQuote } from "./quote";
import {
  type AnyRecord,
  type BuildRecord,
  type Citation,
  type Epistemic,
  FOUNDER_ACCEPTED_BASES,
  LIFECYCLE_DIMENSIONS,
  LIFECYCLE_LABEL,
  type LifecycleDimension,
  type ModuleRecord,
  RECORD_TYPE_LABEL,
  type RecordType,
  type RequirementRecord,
  type SourceRecord,
  STAGES,
  type Stage,
} from "./schemas";

// ---------------------------------------------------------------------------
// Titles and references
// ---------------------------------------------------------------------------

export function recordTitle(type: RecordType, data: AnyRecord): string {
  const d = data as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = d[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    return data.id;
  };
  switch (type) {
    case "module":
    case "loop":
    case "pathway":
      return pick("name");
    case "build":
      return pick("label");
    case "commission": {
      const code = typeof d.code === "string" ? d.code : "";
      const title = typeof d.title === "string" ? d.title : "";
      return code && title && !title.includes(code) ? `${code} — ${title}` : title || code || data.id;
    }
    case "decision": {
      const code = typeof d.code === "string" && d.code ? `${d.code} — ` : "";
      return `${code}${pick("title")}`;
    }
    default:
      return pick("title", "name", "label");
  }
}

export interface RefSummary extends RecordRef {
  title: string;
  type_label: string;
  exists: boolean;
}

export function describeRef(ds: DatasetView, id: string): RefSummary {
  const envelope = ds.byId(id);
  if (!envelope) {
    return { type: guessType(id), id, title: id, type_label: RECORD_TYPE_LABEL[guessType(id)], exists: false };
  }
  return {
    type: envelope.meta.type,
    id,
    title: recordTitle(envelope.meta.type, envelope.data),
    type_label: RECORD_TYPE_LABEL[envelope.meta.type],
    exists: true,
  };
}

const PREFIX_TYPE: Record<string, RecordType> = {
  SRC: "source",
  MOD: "module",
  LOOP: "loop",
  PATH: "pathway",
  FR: "requirement",
  FD: "decision",
  COM: "commission",
  BLD: "build",
  EV: "evidence",
  DEF: "defect",
  OPEN: "open_item",
  REC: "recommendation",
};

export function guessType(id: string): RecordType {
  return PREFIX_TYPE[id.split("-")[0]] ?? "source";
}

const incomingCache = new WeakMap<Dataset, Map<string, RecordRef[]>>();

/** Records that refer to the given id. */
export function incomingRefs(ds: DatasetView, id: string): RecordRef[] {
  let map = incomingCache.get(ds);
  if (!map) {
    map = new Map();
    for (const envelope of ds.all()) {
      const targets = new Set<string>([...outgoingRefs(envelope.meta.type, envelope.data), ...citedSourceIds(envelope.data)]);
      targets.delete(envelope.meta.id);
      for (const target of targets) {
        const list = map.get(target) ?? [];
        list.push({ type: envelope.meta.type, id: envelope.meta.id });
        map.set(target, list);
      }
    }
    incomingCache.set(ds, map);
  }
  return map.get(id) ?? [];
}

// ---------------------------------------------------------------------------
// Standing: proposal vs prototype vs tested vs accepted are never collapsed
// ---------------------------------------------------------------------------

export type StandingHeadline =
  | "accepted_in_hq"
  | "rejected_in_hq"
  | "acceptance_reported"
  | "tested_not_accepted"
  | "prototype_untested"
  | "designed_only"
  | "documented_only"
  | "named_only";

export const STANDING_LABEL: Record<StandingHeadline, string> = {
  accepted_in_hq: "Founder acceptance recorded in HQ",
  rejected_in_hq: "Founder rejected in HQ",
  acceptance_reported: "Acceptance reported in a source — not recorded in HQ",
  tested_not_accepted: "Tested — not accepted",
  prototype_untested: "Prototype — no test evidence on record",
  designed_only: "Designed — nothing runnable on record",
  documented_only: "Documented only",
  named_only: "Named only — no supporting evidence",
};

export interface ModuleStanding {
  headline: StandingHeadline;
  label: string;
  flags: {
    documented: boolean;
    designed: boolean;
    runnable: boolean;
    test_evidence: boolean;
    acceptance_reported: boolean;
    acceptance_recorded_in_hq: boolean;
    /** A founder decision recorded in HQ rejected it. Outranks everything a source reports. */
    rejected_in_hq: boolean;
  };
  /**
   * Dimensions stated as "yes" or "partial" that do not count towards the standing, because
   * nothing supports them (a submitter's claim, no citation, or a basis a source cannot give).
   */
  claimed_only: LifecycleDimension[];
  caution: string | null;
}

const positive = (state: string | undefined) => state === "yes" || state === "partial";

/** Bases that come from a source; they count only with at least one citation. */
const SOURCED_BASES: readonly string[] = ["reported", "design_intention", "source_recommendation", "founder_statement"];

type LifecycleEntryLike = { state?: string; basis?: string; citations?: unknown } | undefined;

/**
 * Does a lifecycle entry raise a module's standing? Only a positive state that a cited source
 * supports, or that HQ's build checked itself ("verified"). A submitter's claim never does.
 * A reported founder acceptance must additionally have a basis a source can give.
 */
export function lifecycleEntryCounts(dimension: LifecycleDimension, entry: LifecycleEntryLike): boolean {
  if (!entry || !positive(entry.state)) return false;
  const cited = Array.isArray(entry.citations) && entry.citations.length > 0;
  if (dimension === "founder_accepted") {
    return (FOUNDER_ACCEPTED_BASES as readonly string[]).includes(entry.basis ?? "") && cited;
  }
  if (entry.basis === "verified") return true;
  return SOURCED_BASES.includes(entry.basis ?? "") && cited;
}

type AcceptanceLike = { state?: string; decision_id?: string; scope_note?: string | null } | undefined;

const acceptanceOf = (data: unknown): AcceptanceLike => {
  const value = (data as { hq_acceptance?: unknown } | null)?.hq_acceptance;
  return value && typeof value === "object" ? (value as AcceptanceLike) : undefined;
};

export function moduleStanding(module: ModuleRecord): ModuleStanding {
  const lc = (module.lifecycle ?? {}) as Partial<ModuleRecord["lifecycle"]>;
  const counts = (dimension: LifecycleDimension) => lifecycleEntryCounts(dimension, lc[dimension]);
  const hq = acceptanceOf(module);
  const flags = {
    documented: counts("documented"),
    designed: counts("designed"),
    runnable: counts("prototyped") || counts("implemented"),
    test_evidence: counts("automated_tests") || counts("browser_tested") || counts("hardware_tested") || counts("independently_assessed"),
    acceptance_reported: counts("founder_accepted"),
    acceptance_recorded_in_hq: hq?.state === "accepted",
    rejected_in_hq: hq?.state === "rejected",
  };
  const claimed_only = LIFECYCLE_DIMENSIONS.filter((d) => positive(lc[d]?.state) && !counts(d));
  let headline: StandingHeadline = "named_only";
  if (flags.rejected_in_hq) headline = "rejected_in_hq";
  else if (flags.acceptance_recorded_in_hq) headline = "accepted_in_hq";
  else if (flags.acceptance_reported) headline = "acceptance_reported";
  else if (flags.test_evidence) headline = "tested_not_accepted";
  else if (flags.runnable) headline = "prototype_untested";
  else if (flags.designed) headline = "designed_only";
  else if (flags.documented) headline = "documented_only";

  let caution: string | null = null;
  if (headline === "rejected_in_hq") {
    caution = flags.acceptance_reported
      ? `A source reports founder acceptance, but founder decision ${hq?.decision_id ?? "(unknown)"} rejected it in HQ.`
      : `Founder decision ${hq?.decision_id ?? "(unknown)"} rejected it in HQ.`;
  } else if (headline === "acceptance_reported") {
    caution =
      lc.founder_accepted?.state === "partial"
        ? "A source reports a scoped or partial founder acceptance. Read its scope; it is not recorded in HQ."
        : "A source reports founder acceptance. HQ has not recorded a founder decision confirming it.";
  } else if (headline === "tested_not_accepted") {
    caution = "Test results are on record. Passing tests are not founder acceptance.";
  }
  if (caution === null && claimed_only.length > 0) {
    caution = `Not counted, because no source supports it: ${claimed_only.map((d) => LIFECYCLE_LABEL[d].label.toLowerCase()).join(", ")}.`;
  }
  return { headline, label: STANDING_LABEL[headline], flags, claimed_only, caution };
}

/** Labels for a build's acceptance as HQ shows it (F1). */
export const BUILD_ACCEPTANCE_LABEL = {
  build_accepted_reported: "Acceptance reported in a source — not recorded in HQ",
  build_acceptance_claimed: "Acceptance claimed — no source quoted",
} as const;

/** Statement labels under which a source can report a founder acceptance. */
const ACCEPTANCE_REPORT_LABELS: readonly string[] = FOUNDER_ACCEPTED_BASES;

/**
 * Is a build's standing "accepted_reported" backed by a source (F1)? Only when its statement is
 * labelled "reported" or "founder_statement" and quotes at least one source. Otherwise the standing is
 * a bare claim: it is shown as "Acceptance claimed — no source quoted" and listed under unverified
 * claims, never as a reported acceptance.
 */
export function buildAcceptanceIsSourced(build: BuildRecord): boolean {
  if (build.standing !== "accepted_reported") return false;
  const statement = build.statement as { epistemic?: string; citations?: unknown } | undefined;
  return ACCEPTANCE_REPORT_LABELS.includes(statement?.epistemic ?? "") && Array.isArray(statement?.citations) && statement.citations.length > 0;
}

export interface AcceptanceStatus {
  ref: RecordRef;
  title: string;
  /** One of the mutually exclusive headline states. */
  headline: StandingHeadline | "build_candidate" | "build_accepted_reported" | "build_acceptance_claimed" | "build_development" | "not_applicable";
  label: string;
  recorded_in_hq: null | { state: string; decision_id: string; decided_by: string; decided_at: string; scope_note?: string | null };
  reported_in_sources: { state: string; note: string; citations: Citation[] } | null;
  tests: { dimension: LifecycleDimension; state: string; note: string }[];
  caution: string | null;
}

export function acceptanceStatus(ds: DatasetView, type: RecordType, id: string): AcceptanceStatus | null {
  const envelope = ds.get(type, id);
  if (!envelope) return null;
  const data = envelope.data as Record<string, unknown>;
  const hq = (data.hq_acceptance as AcceptanceStatus["recorded_in_hq"]) ?? null;
  const base = { ref: { type, id }, title: recordTitle(type, envelope.data), recorded_in_hq: hq };
  // An acceptance or rejection cleared by a later founder decision is shown as cleared, not as absent.
  const cleared = hq?.state === "none" ? `Founder decision ${hq.decision_id} cleared an earlier acceptance or rejection recorded in HQ.` : null;
  const withCleared = (caution: string | null) => (cleared ? (caution ? `${caution} ${cleared}` : cleared) : caution);


  if (type === "module") {
    const module = envelope.data as ModuleRecord;
    const standing = moduleStanding(module);
    const fa = module.lifecycle.founder_accepted;
    return {
      ...base,
      headline: standing.headline,
      label: standing.label,
      reported_in_sources: fa ? { state: fa.state, note: fa.note, citations: fa.citations } : null,
      tests: (["automated_tests", "browser_tested", "hardware_tested", "independently_assessed"] as const).map((dimension) => ({
        dimension,
        state: module.lifecycle[dimension]?.state ?? "unknown",
        note: module.lifecycle[dimension]?.note ?? "",
      })),
      caution: withCleared(standing.caution),
    };
  }

  if (type === "build") {
    const build = envelope.data as BuildRecord;
    const accepted = hq?.state === "accepted";
    const rejected = hq?.state === "rejected";
    if (rejected) {
      return {
        ...base,
        headline: "rejected_in_hq",
        label: STANDING_LABEL.rejected_in_hq,
        reported_in_sources: { state: build.standing, note: build.statement.text, citations: build.statement.citations },
        tests: [],
        caution:
          buildAcceptanceIsSourced(build)
            ? `A source reports this build as accepted, but founder decision ${hq.decision_id} rejected it in HQ.`
            : `Founder decision ${hq.decision_id} rejected this build in HQ.`,
      };
    }
    const sourced = buildAcceptanceIsSourced(build);
    const claimed = build.standing === "accepted_reported" && !sourced;
    const headline = accepted
      ? "accepted_in_hq"
      : sourced
        ? "build_accepted_reported"
        : claimed
          ? "build_acceptance_claimed"
          : build.standing === "candidate_not_accepted"
            ? "build_candidate"
            : "build_development";
    const label = accepted
      ? STANDING_LABEL.accepted_in_hq
      : sourced
        ? BUILD_ACCEPTANCE_LABEL.build_accepted_reported
        : claimed
          ? BUILD_ACCEPTANCE_LABEL.build_acceptance_claimed
          : build.standing === "candidate_not_accepted"
            ? "Candidate — not accepted"
            : `Build standing: ${typeof build.standing === "string" ? build.standing.replaceAll("_", " ") : "not a valid value"}`;
    return {
      ...base,
      headline,
      label,
      // A claimed acceptance with no source quoted is not something a source reports.
      reported_in_sources: claimed ? null : { state: build.standing, note: build.statement.text, citations: build.statement.citations },
      tests: [],
      caution: withCleared(
        sourced && !accepted
          ? "The acceptance is as reported by the source, within the scope the source states."
          : claimed && !accepted
            ? "This build is marked as accepted, but its statement quotes no source that reports it. It is counted as an unverified claim."
            : build.standing === "candidate_not_accepted"
              ? "A candidate is not an accepted build, however many tests it passes."
              : null,
      ),
    };
  }

  if (hq?.state === "rejected") {
    return {
      ...base,
      headline: "rejected_in_hq",
      label: STANDING_LABEL.rejected_in_hq,
      reported_in_sources: null,
      tests: [],
      caution: `Founder decision ${hq.decision_id} rejected it in HQ.`,
    };
  }
  return {
    ...base,
    headline: hq?.state === "accepted" ? "accepted_in_hq" : "not_applicable",
    label: hq?.state === "accepted" ? STANDING_LABEL.accepted_in_hq : "No founder acceptance recorded in HQ",
    reported_in_sources: null,
    tests: [],
    caution: withCleared(null),
  };
}

// ---------------------------------------------------------------------------
// Ecosystem overview
// ---------------------------------------------------------------------------

export interface ModuleNode {
  id: string;
  name: string;
  family: string;
  kind: string;
  parent_id: string | null;
  evidence_level: string;
  standing: StandingHeadline;
  standing_label: string;
  open_defects: number;
  blockers: number;
  loops: number;
  requirements: number;
  summary: string;
}

export interface ModuleEdge {
  from: string;
  to: string;
  nature: string;
  basis: string;
}

export interface EcosystemOverview {
  counts: Record<RecordType, number>;
  families: { family: string; module_ids: string[] }[];
  modules: ModuleNode[];
  edges: ModuleEdge[];
}

/**
 * A defect counts as open when its status says so, and also when HQ cannot read its status at all (a
 * stored value that is not one of the listed ones). A defect must not drop out of the open work
 * because its record is damaged: an unreadable status is counted on the cautious side. "unknown",
 * "resolved" and "deferred" are statuses a source really gave, and are not open.
 */
const SETTLED_DEFECT_STATUSES = new Set(["resolved", "deferred", "unknown"]);
export const isOpenDefect = (status: unknown) => !(typeof status === "string" && SETTLED_DEFECT_STATUSES.has(status));

export function ecosystemOverview(ds: DatasetView): EcosystemOverview {
  const openDefects = countBy(
    ds.defects.filter((d) => isOpenDefect(d.data.status)),
    (d) => d.data.module_ids,
  );
  const reqCount = countBy(ds.requirements, (r) => r.data.module_ids);
  const loopCount = countBy(ds.loops, (l) => l.data.module_ids);
  const blockerItems = countBy(
    ds.openItems.filter((o) => ["blocker", "unresolved_dependency", "not_authorised"].includes(o.data.kind)),
    (o) => o.data.module_ids,
  );

  const modules: ModuleNode[] = ds.modules.map(({ data }) => {
    const standing = moduleStanding(data);
    return {
      id: data.id,
      name: data.name,
      family: data.family,
      kind: data.kind,
      parent_id: data.parent_id,
      evidence_level: data.evidence_level,
      standing: standing.headline,
      standing_label: standing.label,
      open_defects: openDefects.get(data.id) ?? 0,
      blockers: data.blockers.length + (blockerItems.get(data.id) ?? 0),
      loops: Math.max(loopCount.get(data.id) ?? 0, data.loop_ids.length),
      requirements: reqCount.get(data.id) ?? 0,
      summary: data.summary,
    };
  });

  const familyMap = new Map<string, string[]>();
  for (const node of modules) {
    const list = familyMap.get(node.family) ?? [];
    list.push(node.id);
    familyMap.set(node.family, list);
  }
  const families = [...familyMap.entries()]
    .map(([family, module_ids]) => ({ family, module_ids }))
    .sort((a, b) => a.family.localeCompare(b.family));

  const edgeMap = new Map<string, ModuleEdge>();
  const known = new Set(modules.map((m) => m.id));
  for (const { data } of ds.modules) {
    for (const connection of data.connections) {
      if (!known.has(connection.to) || connection.to === data.id) continue;
      const key = [data.id, connection.to].sort().join("|");
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { from: data.id, to: connection.to, nature: connection.nature, basis: connection.epistemic });
      }
    }
  }
  const edges = [...edgeMap.values()].sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));

  const counts = Object.fromEntries(
    (Object.keys(ds.records) as RecordType[]).map((t) => [t, ds.records[t].length]),
  ) as Record<RecordType, number>;

  return { counts, families, modules, edges };
}

function countBy<T>(items: T[], keys: (item: T) => string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) for (const key of keys(item)) map.set(key, (map.get(key) ?? 0) + 1);
  return map;
}

// ---------------------------------------------------------------------------
// Development health
// ---------------------------------------------------------------------------

export interface HealthItem extends RecordRef {
  title: string;
  note: string;
}

export interface DevelopmentHealth {
  /** Founder acceptance recorded in HQ by a founder decision. The only thing HQ calls "accepted". */
  accepted_in_hq: HealthItem[];
  /** Records a founder decision in HQ rejected. Never counted as reported or pending acceptance. */
  rejected_in_hq: HealthItem[];
  /** Evidence marked as checked by the build that produced this dataset. */
  hq_verified: HealthItem[];
  /** Acceptance that a source reports but that no founder decision in HQ confirms. */
  acceptance_reported_only: HealthItem[];
  /** Modules with test evidence and no acceptance: tests passing is not acceptance. */
  tested_not_accepted: HealthItem[];
  open_defects: HealthItem[];
  blocked: HealthItem[];
  unverified_claims: HealthItem[];
  pending_founder_decisions: HealthItem[];
  unresolved_dependencies: HealthItem[];
}

/**
 * Did this version of the record enter through the proposal inbox, with no founder acceptance
 * recorded since? Its content is then the submitter's, filed by the founder, not a source's.
 */
export function enteredThroughInbox(envelope: Envelope<AnyRecord>): boolean {
  return envelope.meta.origin === "proposal_acceptance" && acceptanceOf(envelope.data)?.state !== "accepted";
}

export function developmentHealth(ds: DatasetView): DevelopmentHealth {
  const item = (envelope: Envelope<AnyRecord>, note: string): HealthItem => ({
    type: envelope.meta.type,
    id: envelope.meta.id,
    title: recordTitle(envelope.meta.type, envelope.data),
    note: enteredThroughInbox(envelope)
      ? `Reported through the inbox${envelope.meta.proposal_id ? ` (${envelope.meta.proposal_id})` : ""}; not verified. ${note}`
      : note,
  });
  const decisionNote = (acc: AcceptanceLike) => `Decision ${acc?.decision_id ?? "(unknown)"}${acc?.scope_note ? ` — ${acc.scope_note}` : ""}`;

  const accepted_in_hq = ds
    .all()
    .filter((e) => acceptanceOf(e.data)?.state === "accepted")
    .map((e) => item(e, decisionNote(acceptanceOf(e.data))));

  const rejected_in_hq = ds
    .all()
    .filter((e) => acceptanceOf(e.data)?.state === "rejected")
    .map((e) => item(e, decisionNote(acceptanceOf(e.data))));

  const hq_verified = ds.evidence
    .filter((e) => e.data.verification === "hq_verified")
    .map((e) => item(e, e.data.result.text));

  const acceptance_reported_only: HealthItem[] = [];
  for (const b of ds.builds) {
    const decided = acceptanceOf(b.data)?.state === "accepted" || acceptanceOf(b.data)?.state === "rejected";
    if (buildAcceptanceIsSourced(b.data) && !decided) {
      acceptance_reported_only.push(item(b, b.data.statement.text));
    }
  }
  const tested_not_accepted: HealthItem[] = [];
  for (const m of ds.modules) {
    const standing = moduleStanding(m.data);
    if (standing.headline === "acceptance_reported") {
      acceptance_reported_only.push(item(m, m.data.lifecycle.founder_accepted.note || standing.label));
    } else if (standing.headline === "tested_not_accepted") {
      tested_not_accepted.push(item(m, "Test evidence on record; no founder acceptance on record."));
    }
  }

  const open_defects = ds.defects.filter((d) => isOpenDefect(d.data.status)).map((d) => item(d, d.data.statement.text));

  // A blocker recorded both as an open item and on the module it names, quoting the same
  // sentence, is one blocker: the module's copy is not counted again.
  const blockerItems = ds.openItems.filter((o) => o.data.kind === "blocker" || o.data.kind === "not_authorised");
  const quotedBy = (citations: Citation[]) => citations.map((c) => `${c.source_id}|${normaliseForQuote(c.quote)}`);
  const blocked: HealthItem[] = blockerItems.map((o) => item(o, o.data.statement.text));
  for (const m of ds.modules) {
    const alreadyListed = new Set(
      blockerItems.filter((o) => o.data.module_ids.includes(m.meta.id)).flatMap((o) => quotedBy(collectCitations(o.data))),
    );
    for (const blocker of m.data.blockers) {
      const quotes = quotedBy(blocker.citations);
      if (quotes.length > 0 && quotes.every((q) => alreadyListed.has(q))) continue;
      blocked.push(item(m, blocker.text));
    }
  }

  const unverified_claims: HealthItem[] = [];
  const claimed = new Set<string>();
  const addClaim = (envelope: Envelope<AnyRecord>, note: string) => {
    const key = refKey(envelope.meta.type, envelope.meta.id);
    if (claimed.has(key)) return;
    claimed.add(key);
    unverified_claims.push(item(envelope, note));
  };
  // F1: a build marked as accepted whose statement quotes no source is a claim, not a report.
  // Listed first, so this is the note it carries.
  for (const b of ds.builds) {
    const state = acceptanceOf(b.data)?.state;
    if (b.data.standing === "accepted_reported" && !buildAcceptanceIsSourced(b.data) && state !== "accepted" && state !== "rejected") {
      addClaim(b, `${BUILD_ACCEPTANCE_LABEL.build_acceptance_claimed}.`);
    }
  }
  for (const e of ds.evidence) {
    if (e.data.verification === "agent_submitted_unverified" || e.data.verification === "submitted_unverified") {
      addClaim(e, "Submitted through the proposal inbox; not independently verified.");
    }
  }
  for (const o of ds.openItems) {
    if (o.data.kind === "unverified_claim" || o.data.kind === "missing_evidence") addClaim(o, o.data.statement.text);
  }
  for (const envelope of ds.all()) {
    const d = envelope.data as { statement?: { epistemic?: Epistemic; text?: string }; result?: { epistemic?: Epistemic; text?: string } };
    const primary = d.statement ?? d.result;
    if (primary?.epistemic === "submitter_claim") addClaim(envelope, primary.text ?? "A submitter's claim.");
    else if (enteredThroughInbox(envelope)) addClaim(envelope, "Its content was proposed through the inbox and filed by the founder.");
  }
  for (const m of ds.modules) {
    const { claimed_only } = moduleStanding(m.data);
    if (claimed_only.length > 0) {
      addClaim(m, `Lifecycle states with no source behind them: ${claimed_only.map((d) => LIFECYCLE_LABEL[d].label.toLowerCase()).join(", ")}.`);
    }
  }

  // One entry per pending decision: an open item that points at a decision already listed is
  // folded into that decision's entry instead of being counted a second time.
  const resolved = resolvedByHqDecisions(ds);
  const pendingDecisions = ds.decisions.filter(
    (d) => d.data.recorded_in === "source" && ["unissued", "pending", "held"].includes(d.data.status) && !resolved.has(d.meta.id),
  );
  const pendingIds = new Set(pendingDecisions.map((d) => d.meta.id));
  const pendingItems = ds.openItems.filter((o) => o.data.kind === "pending_founder_decision" && !resolved.has(o.meta.id));
  const pending_founder_decisions: HealthItem[] = [
    ...pendingDecisions.map((d) => {
      const alsoAs = pendingItems.filter((o) => o.data.decision_id === d.meta.id).map((o) => o.meta.id);
      return item(d, `${d.data.status.toUpperCase()} — ${d.data.statement.text}${alsoAs.length ? ` (also recorded as ${alsoAs.join(", ")})` : ""}`);
    }),
    ...pendingItems.filter((o) => !(o.data.decision_id && pendingIds.has(o.data.decision_id))).map((o) => item(o, o.data.statement.text)),
  ];

  const unresolved_dependencies = ds.openItems
    .filter((o) => o.data.kind === "unresolved_dependency" && !resolved.has(o.meta.id))
    .map((o) => item(o, o.data.statement.text));

  return {
    accepted_in_hq,
    rejected_in_hq,
    hq_verified,
    acceptance_reported_only,
    tested_not_accepted,
    open_defects,
    blocked,
    unverified_claims,
    pending_founder_decisions,
    unresolved_dependencies,
  };
}

/**
 * Ids that an HQ-recorded founder decision says it resolves, plus every open item that points
 * at a decision so resolved (resolving a decision also settles the items waiting on it).
 */
export function resolvedByHqDecisions(ds: DatasetView): Set<string> {
  const resolved = new Set<string>();
  for (const d of ds.decisions) {
    if (d.data.recorded_in === "hq" && d.data.status === "issued") {
      for (const id of d.data.resolves) resolved.add(id);
    }
  }
  for (const o of ds.openItems) {
    if (o.data.decision_id && resolved.has(o.data.decision_id)) resolved.add(o.meta.id);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Missing and forgotten work
// ---------------------------------------------------------------------------

export interface MissingWork {
  requirements_without_implementation_record: HealthItem[];
  requirements_without_test_evidence: HealthItem[];
  requirements_unreviewed: HealthItem[];
  requirements_without_module: HealthItem[];
  modules_without_source_evidence: HealthItem[];
  modules_without_learning_loop: HealthItem[];
  modules_without_build: HealthItem[];
  sources_not_accessible: HealthItem[];
  /** Modules that no source dated within `window_days` of the newest source refers to. */
  not_in_recent_sources: { cutoff: string | null; newest: string | null; window_days: number; items: HealthItem[] };
}

/** Dispositions that close a requirement. Every other one is live. */
const CLOSED_DISPOSITIONS = new Set(["superseded", "withdrawn", "satisfied"]);

/**
 * Is a requirement still live (unreviewed, active, conflicted or deferred)? A disposition HQ cannot
 * read ("Not a valid value" in the conformed view) closes nothing: the requirement stays live, so it
 * cannot drop out of the outstanding work just because its stored disposition is of the wrong kind (G11a).
 */
const isLive = (disposition: unknown) => !(typeof disposition === "string" && CLOSED_DISPOSITIONS.has(disposition));

export function missingWork(ds: DatasetView, windowDays = 21): MissingWork {
  const item = (envelope: Envelope<AnyRecord>, note: string): HealthItem => ({
    type: envelope.meta.type,
    id: envelope.meta.id,
    title: recordTitle(envelope.meta.type, envelope.data),
    note,
  });
  const live = ds.requirements.filter((r) => isLive(r.data.disposition));

  const modulesWithLoop = new Set<string>();
  for (const l of ds.loops) l.data.module_ids.forEach((m) => modulesWithLoop.add(m));
  for (const m of ds.modules) if (m.data.loop_ids.length) modulesWithLoop.add(m.meta.id);
  const modulesWithBuild = new Set(ds.builds.map((b) => b.data.module_id).filter(Boolean) as string[]);

  // Recency: which modules do the most recent sources still talk about?
  const ingested = ds.sources.filter((s) => s.data.access === "read_full" || s.data.access === "read_partial");
  const newest = ingested.map((s) => sourceDate(s.data)).filter((d): d is string => d !== null).sort().at(-1) ?? null;
  const cutoff: string | null = newest ? shiftDate(newest, -windowDays) : null;
  const stale: HealthItem[] = [];
  if (newest && cutoff) {
    const lastSeen = moduleLastSeen(ds);
    for (const m of ds.modules) {
      const seen = lastSeen.get(m.meta.id) ?? null;
      if (!seen) {
        stale.push(item(m, "No dated source refers to this module."));
      } else if (seen < cutoff) {
        stale.push(item(m, `Last referred to by a source dated ${seen}.`));
      }
    }
  }

  return {
    requirements_without_implementation_record: live
      .filter((r) => r.data.implementation_state === "no_record")
      .map((r) => item(r, "No implementation record is linked or reported.")),
    requirements_without_test_evidence: live.flatMap((r) => {
      const evidence = requirementTestEvidence(ds, r.data);
      if (evidence.verified.length > 0) return [];
      const parts: string[] = [];
      if (evidence.unverified.length > 0) parts.push(`only unverified claims are linked (${evidence.unverified.join(", ")})`);
      if (evidence.missing.length > 0) parts.push(`linked ids that are not evidence records: ${evidence.missing.join(", ")}`);
      const note = parts.length === 0 ? "No test or acceptance evidence is linked." : `No verified evidence: ${parts.join("; ")}.`;
      return [item(r, note)];
    }),
    requirements_unreviewed: ds.requirements
      .filter((r) => r.data.disposition === "unreviewed")
      .map((r) => item(r, "Registered from a source; the founder has not confirmed its standing in HQ.")),
    requirements_without_module: live
      .filter((r) => r.data.module_ids.length === 0)
      .map((r) => item(r, "Not linked to any module.")),
    modules_without_source_evidence: ds.modules
      .filter((m) => m.data.evidence_level !== "documented_in_sources")
      .map((m) =>
        item(
          m,
          m.data.evidence_level === "commission_list_only"
            ? "Named in the commission's illustrative module list; no accessible source describes it."
            : "Named in accessible sources, but no source describes it in substance.",
        ),
      ),
    modules_without_learning_loop: ds.modules
      .filter((m) => ["module", "product", "programme", "submodule"].includes(m.data.kind) && !modulesWithLoop.has(m.meta.id))
      .map((m) => item(m, "No learning loop has been recovered for this module.")),
    modules_without_build: ds.modules
      .filter((m) => ["module", "product", "submodule"].includes(m.data.kind) && !modulesWithBuild.has(m.meta.id))
      .map((m) => item(m, "No executable version is on record.")),
    sources_not_accessible: ds.sources
      .filter((s) => s.data.access === "not_accessible")
      .map((s) => item(s, s.data.authority_note || "Named, but not accessible to this build.")),
    not_in_recent_sources: { cutoff, newest, window_days: windowDays, items: stale },
  };
}

/** "YYYY-MM-DD…" with a real month and day. Only such strings are treated as dates. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** A source's date for recency: its document date, else its last update; a malformed value is ignored. */
function sourceDate(s: SourceRecord): string | null {
  for (const value of [s.doc_date, s.updated]) if (isIsoDate(value)) return value.slice(0, 10);
  return null;
}

/** For each module, the latest date of any source that a record about that module cites. */
export function moduleLastSeen(ds: DatasetView): Map<string, string> {
  const dateOf = new Map<string, string>();
  for (const s of ds.sources) {
    const date = sourceDate(s.data);
    if (date) dateOf.set(s.meta.id, date);
  }
  const lastSeen = new Map<string, string>();
  const bump = (moduleId: string, sourceIds: string[]) => {
    for (const sourceId of sourceIds) {
      const date = dateOf.get(sourceId);
      if (!date) continue;
      const current = lastSeen.get(moduleId);
      if (!current || date > current) lastSeen.set(moduleId, date);
    }
  };
  for (const m of ds.modules) bump(m.meta.id, citedSourceIds(m.data));
  for (const envelope of ds.all()) {
    if (envelope.meta.type === "module" || envelope.meta.type === "source") continue;
    const data = envelope.data as { module_ids?: string[]; module_id?: string | null };
    const moduleIds = [...(data.module_ids ?? []), ...(data.module_id ? [data.module_id] : [])];
    if (moduleIds.length === 0) continue;
    const sources = citedSourceIds(envelope.data);
    for (const moduleId of moduleIds) bump(moduleId, sources);
  }
  return lastSeen;
}

/** Shift an ISO date by whole days; null (never an exception) for anything that is not one. */
function shiftDate(isoDate: string, days: number): string | null {
  if (!isIsoDate(isoDate)) return null;
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Review items: omissions, duplicates, conflicts, missing acceptance evidence
// ---------------------------------------------------------------------------

export type ReviewKind =
  | "conflict"
  | "possible_duplicate"
  | "missing_acceptance_evidence"
  | "tests_without_acceptance"
  | "agent_claim_unverified"
  | "dangling_reference"
  | "tested_without_evidence"
  | "superseded_without_successor"
  | "possible_duplicate_module"
  | "governing_source_missing";

export const REVIEW_KIND_LABEL: Record<ReviewKind, string> = {
  conflict: "Conflicting requirements",
  possible_duplicate: "Possible duplicate requirement",
  missing_acceptance_evidence: "Acceptance claimed without an acceptance instrument on record",
  tests_without_acceptance: "Tests on record, acceptance not on record",
  agent_claim_unverified: "Agent-submitted claim awaiting verification",
  dangling_reference: "Reference to a record that does not exist",
  tested_without_evidence: "Implementation state claims tests but no evidence record is linked",
  superseded_without_successor: "Superseded requirement with no successor named",
  possible_duplicate_module: "Modules that may be the same thing under two names",
  governing_source_missing: "Governing document named but not accessible",
};

export interface ReviewItem {
  key: string;
  kind: ReviewKind;
  title: string;
  detail: string;
  refs: RefSummary[];
}

export function reviewItems(ds: DatasetView): ReviewItem[] {
  const items: ReviewItem[] = [];
  const ref = (id: string) => describeRef(ds, id);

  // Conflicts explicitly recorded between requirements (reported once per pair).
  const seenPairs = new Set<string>();
  for (const r of ds.requirements) {
    for (const conflict of r.data.conflicts_with) {
      const pair = [r.meta.id, conflict.id].sort().join("|");
      if (seenPairs.has(pair)) continue;
      seenPairs.add(pair);
      items.push({
        key: `conflict:${pair}`,
        kind: "conflict",
        title: `${r.meta.id} conflicts with ${conflict.id}`,
        detail: conflict.note,
        refs: [ref(r.meta.id), ref(conflict.id)],
      });
    }
  }

  // Duplicates: explicit, or identical wording after normalisation.
  const byWording = new Map<string, string[]>();
  for (const r of ds.requirements) {
    if (r.data.duplicate_of) {
      items.push({
        key: `dup:${r.meta.id}`,
        kind: "possible_duplicate",
        title: `${r.meta.id} is recorded as a duplicate of ${r.data.duplicate_of}`,
        detail: "Both records are kept. Deciding which stands is a founder decision.",
        refs: [ref(r.meta.id), ref(r.data.duplicate_of)],
      });
    }
    const norm = normaliseWording(r.data.exact_wording);
    if (norm.length >= 24) byWording.set(norm, [...(byWording.get(norm) ?? []), r.meta.id]);
  }
  for (const ids of byWording.values()) {
    if (ids.length > 1) {
      items.push({
        key: `dupw:${ids.join("|")}`,
        kind: "possible_duplicate",
        title: `Same wording recorded ${ids.length} times`,
        detail: "These requirements have identical wording but come from different places in the sources.",
        refs: ids.map(ref),
      });
    }
  }

  // Superseded with no successor.
  for (const r of ds.requirements) {
    if (r.data.disposition === "superseded" && r.data.superseded_by.length === 0) {
      items.push({
        key: `sup:${r.meta.id}`,
        kind: "superseded_without_successor",
        title: `${r.meta.id} is marked superseded but names no successor`,
        detail: "A superseded instruction should point at the instruction that replaced it.",
        refs: [ref(r.meta.id)],
      });
    }
  }

  // Acceptance reported for a build with no acceptance instrument or decision on record.
  // A build the founder has accepted or rejected in HQ is decided; nothing is pending for it.
  for (const b of ds.builds) {
    const state = acceptanceOf(b.data)?.state;
    if (b.data.standing !== "accepted_reported" || state === "accepted" || state === "rejected") continue;
    if (!hasAcceptanceInstrument(ds, b)) {
      const sourced = buildAcceptanceIsSourced(b.data);
      items.push({
        key: `acc:${b.meta.id}`,
        kind: "missing_acceptance_evidence",
        title: sourced ? `${recordTitle("build", b.data)} is reported as accepted` : `${recordTitle("build", b.data)} is claimed as accepted, with no source quoted`,
        detail: sourced
          ? "A source states this build was accepted, but HQ holds no founder-acceptance evidence for it and no founder decision recorded in HQ accepts it."
          : "This build is marked as accepted with no source quoted, and HQ holds no founder-acceptance evidence for it and no founder decision recorded in HQ accepts it.",
        refs: [ref(b.meta.id)],
      });
    }
  }

  // An implementation state that claims tests, with no evidence record behind it.
  for (const r of ds.requirements) {
    if (r.data.implementation_state !== "implemented_tested") continue;
    const evidence = requirementTestEvidence(ds, r.data);
    if (evidence.verified.length + evidence.unverified.length > 0) continue;
    items.push({
      key: `tnoev:${r.meta.id}`,
      kind: "tested_without_evidence",
      title: `${r.meta.id} is marked "implemented and tested", but no evidence record is linked`,
      detail:
        evidence.missing.length > 0
          ? `The linked ids are not evidence records in the register: ${evidence.missing.join(", ")}.`
          : "Link the evidence record that shows the tests, or change the implementation state.",
      refs: [ref(r.meta.id)],
    });
  }

  // Tests without acceptance.
  for (const m of ds.modules) {
    if (moduleStanding(m.data).headline === "tested_not_accepted") {
      items.push({
        key: `tna:${m.meta.id}`,
        kind: "tests_without_acceptance",
        title: `${m.data.name}: test evidence is on record, founder acceptance is not`,
        detail: "Do not read passing tests as acceptance. Acceptance is a founder decision.",
        refs: [ref(m.meta.id)],
      });
    }
  }

  // Agent claims.
  for (const e of ds.evidence) {
    if (e.data.verification === "agent_submitted_unverified") {
      items.push({
        key: `agent:${e.meta.id}`,
        kind: "agent_claim_unverified",
        title: `${e.data.title} — submitted by ${e.data.submitted_by ?? "an AI client"}`,
        detail: "An agent's statement that something passed or is complete is a claim, not evidence of completion.",
        refs: [ref(e.meta.id)],
      });
    }
  }

  // Dangling references.
  for (const envelope of ds.all()) {
    const missing = [...outgoingRefs(envelope.meta.type, envelope.data), ...citedSourceIds(envelope.data)].filter(
      (id) => !ds.byId(id) && !/^(FD|OPEN|PROP)-HQ-/.test(id),
    );
    for (const id of new Set(missing)) {
      items.push({
        key: `dangling:${envelope.meta.id}:${id}`,
        kind: "dangling_reference",
        title: `${envelope.meta.id} refers to ${id}, which is not in the register`,
        detail: "Either the referenced record was never captured or the reference is wrong.",
        refs: [ref(envelope.meta.id)],
      });
    }
  }

  // Possible duplicate modules (shared name or alias).
  const names = new Map<string, string[]>();
  for (const m of ds.modules) {
    for (const name of [m.data.name, ...m.data.aliases]) {
      const key = name.trim().toLowerCase();
      if (key.length < 3) continue;
      names.set(key, [...new Set([...(names.get(key) ?? []), m.meta.id])]);
    }
  }
  const reportedModulePairs = new Set<string>();
  for (const [name, ids] of names) {
    if (ids.length < 2) continue;
    const key = [...ids].sort().join("|");
    if (reportedModulePairs.has(key)) continue;
    reportedModulePairs.add(key);
    items.push({
      key: `dupm:${key}`,
      kind: "possible_duplicate_module",
      title: `"${name}" is used as a name or alias by ${ids.length} modules`,
      detail: "They may be the same module recorded twice, or two things sharing a historical name.",
      refs: ids.map(ref),
    });
  }

  // Governing documents that are named but not accessible.
  for (const s of ds.sources) {
    if (s.data.access === "not_accessible") {
      items.push({
        key: `src:${s.meta.id}`,
        kind: "governing_source_missing",
        title: `${s.data.title} could not be read`,
        detail: s.data.authority_note || "Named as a source, but not accessible to this build.",
        refs: [ref(s.meta.id)],
      });
    }
  }

  return items.sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
}

/**
 * What counts as an acceptance instrument for a build marked as accepted (F2). Only:
 *   (a) evidence of type founder_acceptance that a source reports or HQ's build checked, whose
 *       build_id is this build; or
 *   (b) a decision recorded in HQ and issued, with a set_acceptance effect that accepts this build,
 *       and only while the build's current hq_acceptance names that decision with state accepted
 *       (G1e: an acceptance the founder cleared or replaced by a rejection is no instrument).
 * Nothing else counts: not a decision that merely lists the build's module, not a decision a source
 * reports (those carry no reference to a build), and never a link the build itself carries
 * (decision_ids and the like), because a proposal can set those.
 */
export function hasAcceptanceInstrument(ds: DatasetView, b: Envelope<BuildRecord>): boolean {
  const evidence = ds.evidence.some(
    (e) =>
      e.data.build_id === b.meta.id &&
      e.data.type === "founder_acceptance" &&
      (e.data.verification === "source_reported" || e.data.verification === "hq_verified"),
  );
  if (evidence) return true;
  // G1e: a founder decision counts only while it is the one the build's current HQ acceptance names,
  // with state accepted. An acceptance the founder later cleared, or replaced by a rejection, is none.
  const current = acceptanceOf(b.data);
  if (current?.state !== "accepted") return false;
  return ds.decisions.some(
    (d) =>
      d.meta.id === current.decision_id &&
      d.data.recorded_in === "hq" &&
      d.data.status === "issued" &&
      Array.isArray(d.data.effects) &&
      d.data.effects.some(
        (effect) => effect.type === "set_acceptance" && effect.record_type === "build" && effect.record_id === b.meta.id && effect.state === "accepted",
      ),
  );
}

function normaliseWording(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchHit extends RecordRef {
  title: string;
  type_label: string;
  snippet: string;
  score: number;
}

const haystackCache = new WeakMap<Dataset, Map<string, { title: string; body: string }>>();

function haystacks(ds: DatasetView) {
  let map = haystackCache.get(ds);
  if (!map) {
    map = new Map();
    for (const envelope of ds.all()) {
      map.set(`${envelope.meta.type}:${envelope.meta.id}`, {
        title: `${envelope.meta.id} ${recordTitle(envelope.meta.type, envelope.data)}`.toLowerCase(),
        body: flattenText(envelope.data).toLowerCase(),
      });
    }
    haystackCache.set(ds, map);
  }
  return map;
}

function flattenText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(flattenText).join(" \n ");
  if (value && typeof value === "object") return Object.values(value).map(flattenText).join(" \n ");
  return "";
}

/** Deterministic search: every term must match; ties are broken by id. */
export function search(ds: DatasetView, query: string, options: { types?: RecordType[]; limit?: number } = {}): SearchHit[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (terms.length === 0) return [];
  const hay = haystacks(ds);
  const hits: SearchHit[] = [];
  for (const envelope of ds.all()) {
    if (options.types && !options.types.includes(envelope.meta.type)) continue;
    const h = hay.get(`${envelope.meta.type}:${envelope.meta.id}`)!;
    let score = 0;
    let matchedAll = true;
    for (const term of terms) {
      const inTitle = h.title.includes(term);
      const inBody = h.body.includes(term);
      if (!inTitle && !inBody) {
        matchedAll = false;
        break;
      }
      score += inTitle ? 6 : 1;
      if (envelope.meta.id.toLowerCase() === term) score += 20;
    }
    if (!matchedAll) continue;
    hits.push({
      type: envelope.meta.type,
      id: envelope.meta.id,
      title: recordTitle(envelope.meta.type, envelope.data),
      type_label: RECORD_TYPE_LABEL[envelope.meta.type],
      snippet: snippetFor(flattenText(envelope.data), terms[0]),
      score,
    });
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return hits.slice(0, options.limit ?? 50);
}

function snippetFor(text: string, term: string): string {
  const flat = text.replace(/\s+/g, " ");
  const index = flat.toLowerCase().indexOf(term);
  if (index < 0) return flat.slice(0, 160);
  const start = Math.max(0, index - 60);
  const end = Math.min(flat.length, index + term.length + 100);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

// ---------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------

export interface RequirementFilter {
  q?: string;
  module_id?: string;
  category?: string;
  disposition?: string;
  implementation_state?: string;
  source_id?: string;
  outstanding?: boolean;
}

export interface RequirementTestEvidence {
  /** Linked evidence that a source reports or HQ's build checked. */
  verified: string[];
  /** Linked evidence that is only a submission through the inbox. */
  unverified: string[];
  /** Linked ids that are not evidence records in this dataset. */
  missing: string[];
}

/** Resolve a requirement's linked evidence ids against the dataset and sort them by what they prove. */
export function requirementTestEvidence(ds: DatasetView, r: RequirementRecord): RequirementTestEvidence {
  const out: RequirementTestEvidence = { verified: [], unverified: [], missing: [] };
  for (const id of Array.isArray(r.linked_evidence_ids) ? r.linked_evidence_ids : []) {
    const e = ds.get("evidence", id);
    if (!e) out.missing.push(id);
    else if (e.data.verification === "source_reported" || e.data.verification === "hq_verified") out.verified.push(id);
    else out.unverified.push(id);
  }
  return out;
}

/**
 * A requirement is outstanding while it is live and is not both implemented-and-tested and backed
 * by verified evidence. Pass the dataset: without it the linked ids cannot be resolved, and only
 * their number is checked (the older, weaker rule).
 */
export function isOutstanding(r: RequirementRecord, ds?: DatasetView): boolean {
  if (!isLive(r.disposition)) return false;
  if (r.implementation_state !== "implemented_tested") return true;
  return ds ? requirementTestEvidence(ds, r).verified.length === 0 : r.linked_evidence_ids.length === 0;
}

export function filterRequirements(ds: DatasetView, filter: RequirementFilter): Envelope<RequirementRecord>[] {
  let list = ds.requirements;
  if (filter.q?.trim()) {
    const ids = new Set(search(ds, filter.q, { types: ["requirement"], limit: 10_000 }).map((h) => h.id));
    list = list.filter((r) => ids.has(r.meta.id));
  }
  if (filter.module_id) list = list.filter((r) => r.data.module_ids.includes(filter.module_id!));
  if (filter.category) list = list.filter((r) => r.data.category === filter.category);
  if (filter.disposition) list = list.filter((r) => r.data.disposition === filter.disposition);
  if (filter.implementation_state) list = list.filter((r) => r.data.implementation_state === filter.implementation_state);
  if (filter.source_id) list = list.filter((r) => r.data.source_id === filter.source_id);
  if (filter.outstanding) list = list.filter((r) => isOutstanding(r.data, ds));
  return list;
}

// ---------------------------------------------------------------------------
// Module brief
// ---------------------------------------------------------------------------

export interface ModuleBrief {
  module: Envelope<ModuleRecord>;
  standing: ModuleStanding;
  parent: RefSummary | null;
  children: RefSummary[];
  loops: RefSummary[];
  pathways: RefSummary[];
  requirements: { ref: RefSummary; disposition: string; implementation_state: string; outstanding: boolean }[];
  decisions: { ref: RefSummary; status: string; recorded_in: string }[];
  commissions: RefSummary[];
  builds: { ref: RefSummary; standing: string; sha256: string | null; filename: string | null }[];
  evidence: { ref: RefSummary; type: string; verification: string }[];
  defects: { ref: RefSummary; status: string }[];
  open_items: { ref: RefSummary; kind: string }[];
  recommendations: RefSummary[];
  connections_out: { ref: RefSummary; nature: string; basis: string }[];
  connections_in: { ref: RefSummary; nature: string; basis: string }[];
  sources: SourceSummary[];
  last_seen: string | null;
}

export interface SourceSummary {
  id: string;
  title: string;
  kind: string;
  location: string | null;
  version: string | null;
  sha256: string | null;
  access: string;
  authority: string;
  date: string | null;
}

export function sourceSummary(ds: DatasetView, id: string): SourceSummary {
  const s = ds.source(id)?.data;
  return {
    id,
    title: s?.title ?? `${id} (not in register)`,
    kind: s?.kind ?? "unknown",
    location: s?.location ?? null,
    version: s?.version ?? null,
    sha256: s?.sha256 ?? null,
    access: s?.access ?? "unknown",
    authority: s?.authority ?? "unknown",
    date: s?.doc_date ?? s?.updated ?? null,
  };
}

export function moduleBrief(ds: DatasetView, id: string): ModuleBrief | null {
  const module = ds.module(id);
  if (!module) return null;
  const ref = (rid: string) => describeRef(ds, rid);
  const touches = (data: { module_ids?: string[]; module_id?: string | null }) =>
    (data.module_ids ?? []).includes(id) || data.module_id === id;

  const loopIds = new Set<string>([
    ...module.data.loop_ids,
    ...ds.loops.filter((l) => l.data.module_ids.includes(id)).map((l) => l.meta.id),
  ]);
  const sourceIds = new Set<string>(citedSourceIds(module.data));
  const related = ds.all().filter((e) => e.meta.type !== "module" && e.meta.type !== "source" && touches(e.data as never));
  for (const envelope of related) citedSourceIds(envelope.data).forEach((s) => sourceIds.add(s));

  return {
    module,
    standing: moduleStanding(module.data),
    parent: module.data.parent_id ? ref(module.data.parent_id) : null,
    children: ds.modules.filter((m) => m.data.parent_id === id).map((m) => ref(m.meta.id)),
    loops: [...loopIds].sort().map(ref),
    pathways: ds.pathways.filter((p) => p.data.steps.some((s) => s.module_id === id)).map((p) => ref(p.meta.id)),
    requirements: ds.requirements
      .filter((r) => r.data.module_ids.includes(id))
      .map((r) => ({
        ref: ref(r.meta.id),
        disposition: r.data.disposition,
        implementation_state: r.data.implementation_state,
        outstanding: isOutstanding(r.data, ds),
      })),
    decisions: ds.decisions
      .filter((d) => d.data.module_ids.includes(id))
      .map((d) => ({ ref: ref(d.meta.id), status: d.data.status, recorded_in: d.data.recorded_in })),
    commissions: ds.commissions.filter((c) => c.data.module_ids.includes(id)).map((c) => ref(c.meta.id)),
    builds: ds.builds
      .filter((b) => b.data.module_id === id)
      .map((b) => ({ ref: ref(b.meta.id), standing: b.data.standing, sha256: b.data.sha256, filename: b.data.filename })),
    evidence: ds.evidence
      .filter((e) => e.data.module_ids.includes(id))
      .map((e) => ({ ref: ref(e.meta.id), type: e.data.type, verification: e.data.verification })),
    defects: ds.defects.filter((d) => d.data.module_ids.includes(id)).map((d) => ({ ref: ref(d.meta.id), status: d.data.status })),
    open_items: ds.openItems.filter((o) => o.data.module_ids.includes(id)).map((o) => ({ ref: ref(o.meta.id), kind: o.data.kind })),
    recommendations: ds.recommendations.filter((r) => r.data.module_ids.includes(id)).map((r) => ref(r.meta.id)),
    connections_out: module.data.connections.map((c) => ({ ref: ref(c.to), nature: c.nature, basis: c.epistemic })),
    connections_in: ds.modules
      .filter((m) => m.meta.id !== id)
      .flatMap((m) =>
        m.data.connections
          .filter((c) => c.to === id)
          .map((c) => ({ ref: ref(m.meta.id), nature: c.nature, basis: c.epistemic })),
      ),
    sources: [...sourceIds].sort().map((sid) => sourceSummary(ds, sid)),
    last_seen: moduleLastSeen(ds).get(id) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Learning loops
// ---------------------------------------------------------------------------

export interface LoopStageMatrixRow {
  loop_id: string;
  name: string;
  standing: string;
  module_ids: string[];
  /** For each shared stage, the source's own terms for the steps mapped to it. */
  stages: Record<Stage, string[]>;
  unmapped: string[];
}

export function loopStageMatrix(ds: DatasetView): LoopStageMatrixRow[] {
  return ds.loops.map(({ data }) => {
    const stages = Object.fromEntries(STAGES.map((s) => [s, [] as string[]])) as Record<Stage, string[]>;
    const unmapped: string[] = [];
    for (const step of [...data.steps].sort((a, b) => a.order - b.order)) {
      if (step.shared_stage === "none") unmapped.push(step.source_term);
      else stages[step.shared_stage].push(step.source_term);
    }
    return { loop_id: data.id, name: data.name, standing: data.standing, module_ids: data.module_ids, stages, unmapped };
  });
}

/** Which modules contribute to each stage of the shared progression (from recovered loop steps). */
export function stageCoverage(ds: DatasetView): Record<Stage, { module_id: string; loop_ids: string[] }[]> {
  const coverage = Object.fromEntries(STAGES.map((s) => [s, new Map<string, Set<string>>()])) as Record<
    Stage,
    Map<string, Set<string>>
  >;
  for (const { data } of ds.loops) {
    for (const step of data.steps) {
      if (step.shared_stage === "none") continue;
      const modules = step.module_id ? [step.module_id] : data.module_ids;
      for (const moduleId of modules) {
        const set = coverage[step.shared_stage].get(moduleId) ?? new Set<string>();
        set.add(data.id);
        coverage[step.shared_stage].set(moduleId, set);
      }
    }
  }
  return Object.fromEntries(
    STAGES.map((s) => [
      s,
      [...coverage[s].entries()]
        .map(([module_id, loops]) => ({ module_id, loop_ids: [...loops].sort() }))
        .sort((a, b) => a.module_id.localeCompare(b.module_id)),
    ]),
  ) as Record<Stage, { module_id: string; loop_ids: string[] }[]>;
}

// ---------------------------------------------------------------------------
// Lineage and dependencies
// ---------------------------------------------------------------------------

export interface Lineage {
  ref: RecordRef;
  title: string;
  version: number;
  introduced_in_rev: number;
  origin: string;
  content_hash: string;
  sources: (SourceSummary & { citations: { locator: string | null; quote: string }[] })[];
  /** Records this one points at, and records that point at it. */
  upstream: RefSummary[];
  downstream: RefSummary[];
}

export function lineage(ds: DatasetView, type: RecordType, id: string): Lineage | null {
  const envelope = ds.get(type, id);
  if (!envelope) return null;
  const citations = collectCitations(envelope.data);
  const bySource = new Map<string, { locator: string | null; quote: string }[]>();
  for (const sourceId of citedSourceIds(envelope.data)) bySource.set(sourceId, []);
  for (const c of citations) {
    const list = bySource.get(c.source_id) ?? [];
    if (!list.some((x) => x.quote === c.quote)) list.push({ locator: c.locator ?? null, quote: c.quote });
    bySource.set(c.source_id, list);
  }
  const upstream = outgoingRefs(type, envelope.data)
    .filter((rid) => !rid.startsWith("SRC-"))
    .sort()
    .map((rid) => describeRef(ds, rid));
  const downstream = incomingRefs(ds, id)
    .map((r) => describeRef(ds, r.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    ref: { type, id },
    title: recordTitle(type, envelope.data),
    version: envelope.meta.version,
    introduced_in_rev: envelope.meta.rev,
    origin: envelope.meta.origin,
    content_hash: envelope.meta.content_hash,
    sources: [...bySource.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sourceId, cites]) => ({ ...sourceSummary(ds, sourceId), citations: cites })),
    upstream,
    downstream,
  };
}

export interface Dependencies {
  ref: RecordRef;
  title: string;
  depends_on: { ref: RefSummary; relation: string }[];
  depended_on_by: { ref: RefSummary; relation: string }[];
  blockers: { ref: RefSummary | null; text: string }[];
}

export function dependencies(ds: DatasetView, type: RecordType, id: string): Dependencies | null {
  const envelope = ds.get(type, id);
  if (!envelope) return null;
  const data = envelope.data as Record<string, unknown>;
  const depends_on: Dependencies["depends_on"] = [];
  const depended_on_by: Dependencies["depended_on_by"] = [];
  const blockers: Dependencies["blockers"] = [];
  const ref = (rid: string) => describeRef(ds, rid);

  const list = (key: string) => (Array.isArray(data[key]) ? (data[key] as string[]) : []);
  for (const rid of list("depends_on")) depends_on.push({ ref: ref(rid), relation: "depends on" });
  for (const rid of list("prerequisite_ids")) depends_on.push({ ref: ref(rid), relation: "requires first" });
  for (const rid of list("blocked_by")) blockers.push({ ref: ref(rid), text: `Blocked by ${rid}` });
  if (typeof data.parent_id === "string") depends_on.push({ ref: ref(data.parent_id), relation: "is part of" });
  if (typeof data.variant_of === "string") depends_on.push({ ref: ref(data.variant_of), relation: "is a variant of" });

  if (type === "module") {
    const module = envelope.data as ModuleRecord;
    for (const c of module.connections) depends_on.push({ ref: ref(c.to), relation: c.nature });
    for (const b of module.blockers) blockers.push({ ref: null, text: b.text });
    for (const m of ds.modules) {
      if (m.meta.id === id) continue;
      for (const c of m.data.connections) {
        if (c.to === id) depended_on_by.push({ ref: ref(m.meta.id), relation: c.nature });
      }
      if (m.data.parent_id === id) depended_on_by.push({ ref: ref(m.meta.id), relation: "is part of this module" });
    }
    for (const o of ds.openItems) {
      if (o.data.module_ids.includes(id) && ["blocker", "unresolved_dependency", "not_authorised"].includes(o.data.kind)) {
        blockers.push({ ref: ref(o.meta.id), text: o.data.statement.text });
      }
    }
  }

  for (const r of ds.requirements) {
    if (r.data.depends_on.includes(id)) depended_on_by.push({ ref: ref(r.meta.id), relation: "depends on this" });
  }
  for (const r of ds.recommendations) {
    if (r.data.prerequisite_ids.includes(id)) depended_on_by.push({ ref: ref(r.meta.id), relation: "requires this first" });
    if (r.data.blocked_by.includes(id)) depended_on_by.push({ ref: ref(r.meta.id), relation: "is blocked by this" });
  }

  return { ref: { type, id }, title: recordTitle(type, envelope.data), depends_on, depended_on_by, blockers };
}

// ---------------------------------------------------------------------------
// Lifecycle matrix
// ---------------------------------------------------------------------------

export interface LifecycleRow {
  module_id: string;
  name: string;
  family: string;
  cells: { dimension: LifecycleDimension; state: string; basis: string; note: string }[];
}

export function lifecycleMatrix(ds: DatasetView): LifecycleRow[] {
  return ds.modules.map(({ data }) => ({
    module_id: data.id,
    name: data.name,
    family: data.family,
    cells: LIFECYCLE_DIMENSIONS.map((dimension) => ({
      dimension,
      state: data.lifecycle[dimension]?.state ?? "unknown",
      basis: data.lifecycle[dimension]?.basis ?? "no_evidence",
      note: data.lifecycle[dimension]?.note ?? "",
    })),
  }));
}
