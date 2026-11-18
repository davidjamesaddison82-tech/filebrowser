import type { Epistemic } from "@/lib/domain/schemas";

export type Tone = "ok" | "warn" | "bad" | "info" | "design" | "founder" | "accent" | "ghost" | "outline" | "plain";

export const EPISTEMIC_TONE: Record<Epistemic, { tone: Tone; glyph: string; short: string }> = {
  verified: { tone: "ok", glyph: "✓", short: "Verified by HQ" },
  reported: { tone: "plain", glyph: "❝", short: "Reported in source" },
  design_intention: { tone: "design", glyph: "✎", short: "Design intention" },
  source_recommendation: { tone: "info", glyph: "➜", short: "Source author's view" },
  founder_statement: { tone: "founder", glyph: "★", short: "Founder (per source)" },
  hq_recommendation: { tone: "accent", glyph: "➜", short: "HQ recommendation" },
  submitter_claim: { tone: "warn", glyph: "?", short: "Submitter's claim" },
  no_evidence: { tone: "ghost", glyph: "∅", short: "No evidence" },
};

export function humanise(value: string | null | undefined): string {
  if (!value) return "—";
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function shortHash(hash: string | null | undefined, length = 12): string {
  if (!hash) return "—";
  return hash.length > length + 1 ? `${hash.slice(0, length)}…` : hash;
}

/** Dates are shown as written (ISO), never re-interpreted in the viewer's time zone. */
export function isoDate(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

export function isoDateTime(value: string | null | undefined): string {
  if (!value) return "—";
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

export function statusTone(value: string): Tone {
  return STATUS_TONE[value] ?? "plain";
}

const STATUS_LABEL: Record<string, string> = {
  accepted_reported: "Acceptance reported in source",
  candidate_not_accepted: "Candidate — not accepted",
  no_record: "No implementation record",
  implemented_unverified: "Implemented — unverified",
  implemented_tested: "Implemented and tested",
  hq_verified: "Verified by HQ",
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

export function statusLabel(value: string): string {
  return STATUS_LABEL[value] ?? humanise(value);
}
