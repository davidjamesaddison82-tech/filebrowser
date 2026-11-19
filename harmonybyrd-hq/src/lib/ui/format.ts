import { NOT_VALID } from "@/lib/domain/conform";
import {
  BUILD_STANDINGS,
  COMMISSION_STATUSES,
  DECISION_STATUSES,
  DEFECT_SEVERITIES,
  DEFECT_STATUSES,
  type Epistemic,
  EVIDENCE_LEVELS,
  EVIDENCE_TYPES,
  EVIDENCE_VERIFICATION,
  IMPLEMENTATION_STATES,
  LIFECYCLE_STATES,
  MODULE_KINDS,
  OPEN_ITEM_KINDS,
  PATHWAY_BASES,
  RECOMMENDATION_STATUSES,
  REQUIREMENT_ATTRIBUTIONS,
  REQUIREMENT_CATEGORIES,
  REQUIREMENT_DISPOSITIONS,
  SOURCE_ACCESS,
  SOURCE_AUTHORITY,
  SOURCE_KINDS,
} from "@/lib/domain/schemas";

export type Tone = "ok" | "warn" | "bad" | "info" | "design" | "founder" | "accent" | "ghost" | "outline" | "plain";

export const EPISTEMIC_TONE: Record<Epistemic, { tone: Tone; glyph: string; short: string }> = {
  verified: { tone: "ok", glyph: "✓", short: "Checked by HQ's build" },
  reported: { tone: "plain", glyph: "❝", short: "Reported in source" },
  design_intention: { tone: "design", glyph: "✎", short: "Design intention" },
  source_recommendation: { tone: "info", glyph: "➜", short: "Source author's view" },
  founder_statement: { tone: "founder", glyph: "★", short: "Founder (per source)" },
  hq_recommendation: { tone: "accent", glyph: "➜", short: "HQ recommendation" },
  submitter_claim: { tone: "warn", glyph: "?", short: "Submitter's claim" },
  no_evidence: { tone: "ghost", glyph: "∅", short: "No evidence" },
};

/** What a screen shows in place of a stored value of the wrong kind, or one outside its field's list (G1f). Defined with the conformer. */
export { NOT_VALID };

/**
 * Loose stored values reach the screens too (a record that failed validation is shown as stored), so
 * anything that is not text is "—". A field whose values come from a list is shown with fieldLabel
 * instead, which says "Not a valid value" for anything outside the list.
 */
export function humanise(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A stored value as a short text for a tooltip: a string as it is, anything else as JSON; 60 characters at most. */
export function storedValueText(value: unknown): string {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/**
 * The fields the screens show whose values come from a fixed list, with that list: the record schemas'
 * own lists, which the database checks too (hq.field_enums, migration 0008). A screen shows such a
 * field through fieldLabel / StatusChip's `field`, never the stored value as it is (G1f).
 */
const LISTED = {
  "build.standing": BUILD_STANDINGS,
  "commission.status": COMMISSION_STATUSES,
  "decision.status": DECISION_STATUSES,
  "defect.severity": DEFECT_SEVERITIES,
  "defect.status": DEFECT_STATUSES,
  "evidence.type": EVIDENCE_TYPES,
  "evidence.verification": EVIDENCE_VERIFICATION,
  "module.evidence_level": EVIDENCE_LEVELS,
  "module.kind": MODULE_KINDS,
  "module.lifecycle.*.state": LIFECYCLE_STATES,
  "open_item.kind": OPEN_ITEM_KINDS,
  "pathway.basis": PATHWAY_BASES,
  "recommendation.status": RECOMMENDATION_STATUSES,
  "requirement.attribution": REQUIREMENT_ATTRIBUTIONS,
  "requirement.category": REQUIREMENT_CATEGORIES,
  "requirement.disposition": REQUIREMENT_DISPOSITIONS,
  "requirement.implementation_state": IMPLEMENTATION_STATES,
  "source.access": SOURCE_ACCESS,
  "source.authority": SOURCE_AUTHORITY,
  "source.kind": SOURCE_KINDS,
} as const satisfies Record<string, readonly string[]>;

export type ListedField = keyof typeof LISTED;

/** The values a listed field may hold. */
export function allowedValues(field: ListedField): readonly string[] {
  return LISTED[field];
}

/** Whether a stored value is one of its field's listed values. Anything that is not a string is not. */
export function isListedValue(field: ListedField, value: unknown): value is string {
  return typeof value === "string" && allowedValues(field).includes(value);
}

/** A listed field's value for the screen: its label, or "Not a valid value" for anything outside the list, null included. */
export function fieldLabel(field: ListedField, value: unknown): string {
  return isListedValue(field, value) ? statusLabel(value) : NOT_VALID;
}

export function shortHash(hash: unknown, length = 12): string {
  if (typeof hash !== "string" || !hash) return "—";
  return hash.length > length + 1 ? `${hash.slice(0, length)}…` : hash;
}

/** Dates are shown as written (ISO), never re-interpreted in the viewer's time zone. */
export function isoDate(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  return value.slice(0, 10);
}

export function isoDateTime(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  return `${value.slice(0, 10)} ${value.slice(11, 16)} UTC`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const STATUS_TONE: Record<string, Tone> = {
  // decisions
  issued: "founder",
  unissued: "warn",
  pending: "warn",
  held: "warn",
  rejected: "bad",
  superseded: "ghost",
  unknown: "ghost",
  // standings
  rejected_in_hq: "bad",
  // builds
  accepted_reported: "founder",
  candidate_not_accepted: "info",
  development: "plain",
  withdrawn: "ghost",
  // defects
  open: "bad",
  resolved: "ok",
  deferred: "warn",
  // requirements
  unreviewed: "warn",
  active: "accent",
  conflicted: "bad",
  satisfied: "ok",
  no_record: "ghost",
  not_started: "plain",
  in_progress: "info",
  implemented_unverified: "warn",
  implemented_tested: "ok",
  // evidence
  hq_verified: "ok",
  source_reported: "plain",
  submitted_unverified: "warn",
  agent_submitted_unverified: "warn",
  // proposals
  submitted: "info",
  accepted: "ok",
  needs_changes: "warn",
  marked_stale: "bad",
  // commissions
  delivered: "plain",
  proposed: "info",
  closed: "ghost",
  // sources
  read_full: "ok",
  read_partial: "warn",
  inventoried_not_ingested: "plain",
  not_accessible: "bad",
};

export function statusTone(value: unknown): Tone {
  return (typeof value === "string" && Object.hasOwn(STATUS_TONE, value) ? STATUS_TONE[value] : undefined) ?? "plain";
}

const STATUS_LABEL: Record<string, string> = {
  accepted_reported: "Acceptance reported in source",
  rejected_in_hq: "Founder rejected in HQ",
  candidate_not_accepted: "Candidate — not accepted",
  no_record: "No implementation record",
  implemented_unverified: "Implemented — unverified",
  implemented_tested: "Implemented and tested",
  hq_verified: "Checked by HQ's build",
  source_reported: "Reported in source",
  submitted_unverified: "Submitted — unverified",
  agent_submitted_unverified: "Agent-submitted — unverified",
  marked_stale: "Stale — not applied",
  needs_changes: "Changes requested",
  unreviewed: "Unreviewed by founder",
  read_full: "Read in full",
  read_partial: "Read in part",
  inventoried_not_ingested: "Inventoried, not ingested",
  not_accessible: "Not accessible",
};

export function statusLabel(value: unknown): string {
  return (typeof value === "string" && Object.hasOwn(STATUS_LABEL, value) ? STATUS_LABEL[value] : undefined) ?? humanise(value);
}
