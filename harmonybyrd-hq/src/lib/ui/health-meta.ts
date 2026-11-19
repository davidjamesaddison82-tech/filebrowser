import type { DevelopmentHealth, MissingWork } from "@/lib/domain/derive";

export const HEALTH_META: Record<keyof DevelopmentHealth, { title: string; description: string; tone?: "ok" | "warn" | "bad" | "info" }> = {
  accepted_in_hq: {
    title: "Founder acceptance recorded in HQ",
    description: "Records carrying an acceptance made by a founder decision inside HQ. The only thing HQ itself calls accepted.",
    tone: "ok",
  },
  rejected_in_hq: {
    title: "Founder rejected in HQ",
    description: "Records a founder decision inside HQ rejected. Whatever a source reports, the rejection recorded in HQ stands.",
    tone: "bad",
  },
  hq_verified: {
    title: "Checks made by HQ's build",
    description:
      "Recorded by the build that produced this dataset (checksums recomputed, quotations verified, test runs). The running application re-verifies quotations at import; it does not re-run the other checks.",
    tone: "ok",
  },
  acceptance_reported_only: {
    title: "Acceptance reported in a source only",
    description: "A source document says the founder accepted this. No founder decision in HQ confirms it yet.",
    tone: "warn",
  },
  tested_not_accepted: {
    title: "Tested, not accepted",
    description: "Test evidence is on record and acceptance is not. Passing tests are not founder acceptance.",
    tone: "info",
  },
  open_defects: {
    title: "Open defects",
    description: "Defects recorded as open: from the sources, or reported through the proposal inbox and filed by the founder (those are marked as not verified).",
    tone: "bad",
  },
  blocked: { title: "Blocked or not authorised", description: "Blockers and explicit not-authorised boundaries recorded in the sources.", tone: "bad" },
  unverified_claims: {
    title: "Unverified claims",
    description:
      "Claims submitted through the proposal inbox (by an agent or a person) and filed by the founder, lifecycle states no source supports, and claims the sources themselves mark as unverified or lacking evidence.",
    tone: "warn",
  },
  pending_founder_decisions: {
    title: "Pending founder decisions",
    description:
      "Decisions the sources record as unissued, pending or held, and that no HQ decision has resolved. An open item about the same decision is listed with it, not counted again.",
    tone: "warn",
  },
  unresolved_dependencies: { title: "Unresolved dependencies", description: "Dependencies the sources record as unresolved.", tone: "warn" },
  unreadable_records: {
    title: "Records HQ cannot read",
    description:
      "Records stored in a form that does not pass validation. Nothing in them counts in HQ's figures, so the figures of every module they name may be incomplete. Each page shows the record exactly as stored.",
    tone: "bad",
  },
};

export type MissingKey = Exclude<keyof MissingWork, "not_in_recent_sources"> | "not_in_recent_sources";

export const MISSING_META: Record<MissingKey, { title: string; description: string }> = {
  requirements_without_implementation_record: {
    title: "Requirements with no implementation record",
    description: "Founder instructions for which nothing accessible says whether they were implemented.",
  },
  requirements_without_test_evidence: {
    title: "Requirements with no test or acceptance evidence",
    description: "Live founder instructions with no evidence record linked to them.",
  },
  requirements_unreviewed: {
    title: "Requirements the founder has not yet reviewed in HQ",
    description: "Registered from a source; their standing (active, superseded, withdrawn…) is the founder's to confirm.",
  },
  requirements_without_module: { title: "Requirements linked to no module", description: "Founder instructions not yet attached to any module." },
  modules_without_source_evidence: {
    title: "Modules with no supporting source",
    description: "Modules that are named — in the commission or in passing — but that no accessible source describes.",
  },
  modules_without_learning_loop: {
    title: "Modules with no learning loop recovered",
    description: "No accessible source describes how learning is meant to happen in these modules.",
  },
  modules_without_build: { title: "Modules with no executable version on record", description: "No build, candidate or prototype is recorded." },
  sources_not_accessible: {
    title: "Documents named but not accessible",
    description: "Governing and supporting documents that sources or the commission name, which HQ could not read.",
  },
  not_in_recent_sources: {
    title: "Not mentioned in recent sources",
    description: "Modules that no recent source refers to. They may be dormant, finished — or forgotten.",
  },
};
