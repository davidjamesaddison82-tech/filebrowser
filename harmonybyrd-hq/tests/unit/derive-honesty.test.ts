/**
 * Derived figures must say only what the records support (design D12). Each case builds an
 * adversarial dataset from the fixture, without parsing it, so it also models records stored
 * before a schema rule existed.
 */
import { describe, expect, it } from "vitest";
import {
  acceptanceStatus,
  developmentHealth,
  ecosystemOverview,
  filterRequirements,
  isOutstanding,
  missingWork,
  moduleBrief,
  moduleStanding,
  requirementTestEvidence,
  reviewItems,
} from "@/lib/domain/derive";
import type { PackRecord } from "@/lib/domain/pack";
import { EPISTEMIC_LABEL } from "@/lib/domain/schemas";
import { EPISTEMIC_TONE, statusLabel } from "@/lib/ui/format";
import { HEALTH_META } from "@/lib/ui/health-meta";
import { datasetFrom, fixtureRecords } from "../helpers/fixture";

type Data = Record<string, unknown>;
const CITE_F01 = { source_id: "SRC-F01", locator: null, quote: "Beta build 2 was accepted by the founder on 3 March 2031 for desktop browsers only." };

/** The fixture with `change` applied to copies of its records. */
function dataset(change: (find: (id: string) => Data, add: (type: PackRecord["type"], data: Data) => void) => void, meta?: Parameters<typeof datasetFrom>[1]) {
  const records = fixtureRecords();
  const find = (id: string) => records.find((r) => r.id === id)!.data as unknown as Data;
  const add = (type: PackRecord["type"], data: Data) => records.push({ type, id: data.id as string, data: data as never });
  change(find, add);
  return datasetFrom(records, meta);
}
const lifecycle = (module: Data) => module.lifecycle as Record<string, Data>;
const ids = (items: { id: string }[]) => items.map((i) => i.id).sort();

describe("a lifecycle flag counts only when a source supports it (honesty-2, evidence-7)", () => {
  it('founder_accepted "yes" with basis "verified" and no citation is not a reported acceptance', () => {
    const ds = dataset((find) => {
      lifecycle(find("MOD-FX-GAMMA")).founder_accepted = { state: "yes", basis: "verified", note: "Accepted (per Claude)", citations: [] };
    });
    const standing = moduleStanding(ds.module("MOD-FX-GAMMA")!.data);
    expect(standing.headline).toBe("designed_only");
    expect(standing.flags.acceptance_reported).toBe(false);
    expect(standing.claimed_only).toEqual(["founder_accepted"]);
    expect(acceptanceStatus(ds, "module", "MOD-FX-GAMMA")!.headline).toBe("designed_only");
    const health = developmentHealth(ds);
    expect(ids(health.acceptance_reported_only)).toEqual(["BLD-FX-02", "MOD-FX-BETA"]);
    expect(ids(health.unverified_claims)).toContain("MOD-FX-GAMMA");
  });

  it("a submitter's claim never raises a standing, even with a citation", () => {
    const ds = dataset((find) => {
      lifecycle(find("MOD-FX-GAMMA")).independently_assessed = { state: "partial", basis: "submitter_claim", note: "", citations: [CITE_F01] };
      lifecycle(find("MOD-FX-DELTA")).founder_accepted = { state: "yes", basis: "no_evidence", note: "", citations: [CITE_F01] };
    });
    const gamma = moduleStanding(ds.module("MOD-FX-GAMMA")!.data);
    expect(gamma.headline).toBe("designed_only");
    expect(gamma.flags.test_evidence).toBe(false);
    expect(moduleStanding(ds.module("MOD-FX-DELTA")!.data).headline).toBe("named_only");
    const health = developmentHealth(ds);
    expect(ids(health.tested_not_accepted)).toEqual(["MOD-FX-ALPHA"]);
    expect(ids(health.unverified_claims)).toEqual(expect.arrayContaining(["MOD-FX-DELTA", "MOD-FX-GAMMA"]));
    expect(reviewItems(ds).map((i) => i.key)).not.toContain("tna:MOD-FX-GAMMA");
  });

  it("a positive state with a source basis but no citation does not count", () => {
    const ds = dataset((find) => {
      lifecycle(find("MOD-FX-GAMMA")).founder_accepted = { state: "yes", basis: "reported", note: "", citations: [] };
    });
    expect(moduleStanding(ds.module("MOD-FX-GAMMA")!.data).headline).toBe("designed_only");
  });

  it("controls: a cited report counts, and a check by HQ's build counts for a test dimension", () => {
    const ds = dataset((find) => {
      lifecycle(find("MOD-FX-GAMMA")).founder_accepted = { state: "yes", basis: "reported", note: "", citations: [CITE_F01] };
      lifecycle(find("MOD-FX-DELTA")).automated_tests = { state: "yes", basis: "verified", note: "", citations: [] };
    });
    expect(moduleStanding(ds.module("MOD-FX-GAMMA")!.data).headline).toBe("acceptance_reported");
    expect(moduleStanding(ds.module("MOD-FX-DELTA")!.data).headline).toBe("tested_not_accepted");
  });
});

describe("only a real acceptance instrument silences 'acceptance claimed without an instrument' (evidence-5, honesty-3)", () => {
  const acceptanceEvidence = (verification: string): Data => ({
    id: "EV-HQ-0001",
    type: "founder_acceptance",
    title: "Founder accepted build 2",
    module_ids: ["MOD-FX-BETA"],
    build_id: "BLD-FX-02",
    result: { text: "Founder accepted build 2", epistemic: "submitter_claim", citations: [] },
    verification,
    submitted_by: "claude",
    date: null,
    sha256: null,
    citations: [],
  });
  const keys = (ds: ReturnType<typeof dataset>) => reviewItems(ds).map((i) => i.key);

  for (const verification of ["agent_submitted_unverified", "submitted_unverified"]) {
    it(`founder_acceptance evidence that is ${verification} is not an instrument`, () => {
      const ds = dataset((_, add) => add("evidence", acceptanceEvidence(verification)));
      expect(keys(ds)).toContain("acc:BLD-FX-02");
    });
  }

  it("an issued decision that only cites the same document is not an instrument", () => {
    // FD-FX-01 is issued, is about Gamma and Alpha, and cites SRC-F01.
    const ds = dataset((find) => {
      find("BLD-FX-02").citations = [CITE_F01];
    });
    expect(keys(ds)).toContain("acc:BLD-FX-02");
  });

  for (const verification of ["source_reported", "hq_verified"]) {
    it(`control: founder_acceptance evidence that is ${verification} is an instrument`, () => {
      const ds = dataset((_, add) => add("evidence", acceptanceEvidence(verification)));
      expect(keys(ds)).not.toContain("acc:BLD-FX-02");
    });
  }

  it("control: an issued decision about the build's module, or that names the build, is an instrument", () => {
    const aboutModule = dataset((find) => {
      (find("FD-FX-01").module_ids as string[]).push("MOD-FX-BETA");
    });
    expect(keys(aboutModule)).not.toContain("acc:BLD-FX-02");
    const namesBuild = dataset((find) => {
      find("FD-FX-01").effects = [{ type: "note", record_id: "BLD-FX-02" }];
    });
    expect(keys(namesBuild)).not.toContain("acc:BLD-FX-02");
  });
});

describe("a founder's rejection or cleared acceptance is classified, never shown as acceptance (honesty-4, tests-12)", () => {
  const decided = (state: "accepted" | "rejected" | "none") => ({
    state,
    decision_id: "FD-HQ-0001",
    decided_at: "2031-05-01T10:00:00Z",
    decided_by: "founder",
    scope_note: null,
  });
  const ds = dataset((find) => {
    find("MOD-FX-BETA").hq_acceptance = decided("rejected");
    find("BLD-FX-02").hq_acceptance = decided("rejected");
    find("EV-FX-01").hq_acceptance = decided("rejected");
    find("MOD-FX-ALPHA").hq_acceptance = decided("none");
    find("BLD-FX-01").hq_acceptance = decided("none");
    find("FR-FX-001").hq_acceptance = decided("none");
  });

  it("a rejected module, build or evidence record has the headline rejected_in_hq", () => {
    const beta = moduleStanding(ds.module("MOD-FX-BETA")!.data);
    expect(beta.headline).toBe("rejected_in_hq");
    expect(beta.flags.rejected_in_hq).toBe(true);
    expect(beta.flags.acceptance_recorded_in_hq).toBe(false);
    expect(beta.caution).toMatch(/FD-HQ-0001 rejected it/);
    for (const [type, id] of [
      ["module", "MOD-FX-BETA"],
      ["build", "BLD-FX-02"],
      ["evidence", "EV-FX-01"],
    ] as const) {
      const status = acceptanceStatus(ds, type, id)!;
      expect(status.headline, id).toBe("rejected_in_hq");
      expect(status.recorded_in_hq?.state, id).toBe("rejected");
    }
    expect(moduleBrief(ds, "MOD-FX-BETA")!.standing.headline).toBe("rejected_in_hq");
    expect(ecosystemOverview(ds).modules.find((m) => m.id === "MOD-FX-BETA")!.standing).toBe("rejected_in_hq");
  });

  it("development health lists rejections on their own and nowhere as accepted or pending", () => {
    const health = developmentHealth(ds);
    expect(health.accepted_in_hq).toEqual([]);
    expect(ids(health.rejected_in_hq)).toEqual(["BLD-FX-02", "EV-FX-01", "MOD-FX-BETA"]);
    expect(health.acceptance_reported_only).toEqual([]);
    expect(reviewItems(ds).map((i) => i.key)).not.toContain("acc:BLD-FX-02");
  });

  it('a cleared acceptance ("none") is not acceptance and leaves the reported standing as it was', () => {
    const alpha = moduleStanding(ds.module("MOD-FX-ALPHA")!.data);
    expect(alpha.headline).toBe("tested_not_accepted");
    expect(alpha.flags.acceptance_recorded_in_hq).toBe(false);
    expect(acceptanceStatus(ds, "build", "BLD-FX-01")!.headline).toBe("build_candidate");
    const requirement = acceptanceStatus(ds, "requirement", "FR-FX-001")!;
    expect(requirement.headline).toBe("not_applicable");
    expect(requirement.caution).toMatch(/FD-HQ-0001 cleared/);
    expect(ids(developmentHealth(ds).tested_not_accepted)).toEqual(["MOD-FX-ALPHA"]);
  });

  it("control: an acceptance recorded in HQ is accepted_in_hq", () => {
    const accepted = dataset((find) => {
      find("MOD-FX-GAMMA").hq_acceptance = decided("accepted");
      find("BLD-FX-02").hq_acceptance = decided("accepted");
    });
    expect(moduleStanding(accepted.module("MOD-FX-GAMMA")!.data).headline).toBe("accepted_in_hq");
    expect(acceptanceStatus(accepted, "build", "BLD-FX-02")!.headline).toBe("accepted_in_hq");
    expect(ids(developmentHealth(accepted).accepted_in_hq)).toEqual(["BLD-FX-02", "MOD-FX-GAMMA"]);
    expect(developmentHealth(accepted).rejected_in_hq).toEqual([]);
  });
});

describe("malformed dates never break derived figures (honesty-5)", () => {
  const source = (id: string, docDate: string): Data => ({
    id,
    title: `Roadmap ${id}`,
    kind: "google_drive",
    location: null,
    version: null,
    sha256: null,
    bytes: null,
    retrieved_at: null,
    doc_date: docDate,
    updated: null,
    access: "read_full",
    authority: "assessment_or_research",
    authority_note: "",
    summary: "",
    product_scope: "",
    prepared_by: null,
    commission_codes: [],
    parts: [],
    text_snapshot: null,
    named_in: [],
    hq_checks: [],
  });
  const ds = dataset((find, add) => {
    add("source", source("SRC-FX-X1", "April 2031"));
    add("source", source("SRC-FX-X2", "2031"));
    add("source", source("SRC-FX-X3", "Undated"));
    // Gamma is otherwise stale; a malformed date must not win the comparison and make it look recent.
    (find("MOD-FX-GAMMA").citations as unknown[]).push({ source_id: "SRC-FX-X3", locator: null, quote: "Gamma roadmap, undated." });
  });

  it("missingWork does not throw and ignores the malformed dates", () => {
    const missing = missingWork(ds);
    expect(missing.not_in_recent_sources.newest).toBe("2031-04-12");
    expect(missing.not_in_recent_sources.cutoff).toBe("2031-03-22");
    expect(ids(missing.not_in_recent_sources.items)).toContain("MOD-FX-GAMMA");
    expect(moduleBrief(ds, "MOD-FX-GAMMA")!.last_seen).not.toBe("Undated");
  });
});

describe("test evidence counts only when it exists and is verified (honesty-6)", () => {
  const withLinks = (links: string[], extra?: Data) =>
    dataset((find, add) => {
      const requirement = find("FR-FX-002");
      requirement.implementation_state = "implemented_tested";
      requirement.linked_evidence_ids = links;
      if (extra) add("evidence", extra);
    });
  const agentClaim: Data = {
    id: "EV-HQ-0001",
    type: "automated_test",
    title: "Claude says the tests pass",
    module_ids: ["MOD-FX-ALPHA"],
    build_id: null,
    result: { text: "All tests pass.", epistemic: "submitter_claim", citations: [] },
    verification: "agent_submitted_unverified",
    submitted_by: "claude",
    date: null,
    sha256: null,
    citations: [],
  };

  for (const [name, ds] of [
    ["a dangling id", withLinks(["EV-NOPE-1"])],
    ["an agent's unverified claim", withLinks(["EV-HQ-0001"], agentClaim)],
  ] as const) {
    it(`implemented_tested backed only by ${name} is still outstanding`, () => {
      const r = ds.get("requirement", "FR-FX-002")!.data;
      expect(isOutstanding(r, ds)).toBe(true);
      expect(ids(missingWork(ds).requirements_without_test_evidence)).toContain("FR-FX-002");
      expect(filterRequirements(ds, { outstanding: true }).map((x) => x.meta.id)).toContain("FR-FX-002");
      expect(moduleBrief(ds, "MOD-FX-ALPHA")!.requirements.find((x) => x.ref.id === "FR-FX-002")!.outstanding).toBe(true);
    });
  }

  it("a dangling id is a review item and is named in the missing-work note", () => {
    const ds = withLinks(["EV-NOPE-1"]);
    expect(requirementTestEvidence(ds, ds.get("requirement", "FR-FX-002")!.data)).toEqual({ verified: [], unverified: [], missing: ["EV-NOPE-1"] });
    expect(reviewItems(ds).map((i) => i.key)).toContain("tnoev:FR-FX-002");
    expect(missingWork(ds).requirements_without_test_evidence.find((i) => i.id === "FR-FX-002")!.note).toMatch(/EV-NOPE-1/);
  });

  it("an unverified claim is reported as such", () => {
    const ds = withLinks(["EV-HQ-0001"], agentClaim);
    expect(requirementTestEvidence(ds, ds.get("requirement", "FR-FX-002")!.data).unverified).toEqual(["EV-HQ-0001"]);
    expect(missingWork(ds).requirements_without_test_evidence.find((i) => i.id === "FR-FX-002")!.note).toMatch(/only unverified claims/);
  });

  it("control: verified evidence makes it no longer outstanding", () => {
    const ds = withLinks(["EV-FX-02"]);
    expect(isOutstanding(ds.get("requirement", "FR-FX-002")!.data, ds)).toBe(false);
    expect(ids(missingWork(ds).requirements_without_test_evidence)).not.toContain("FR-FX-002");
    expect(filterRequirements(ds, { outstanding: true }).map((x) => x.meta.id)).not.toContain("FR-FX-002");
    expect(reviewItems(ds).map((i) => i.key)).not.toContain("tnoev:FR-FX-002");
  });
});

describe("one pending decision and one blocker are counted once (honesty-9)", () => {
  it("a pending decision and the open item about it are one entry", () => {
    const health = developmentHealth(dataset(() => {}));
    expect(ids(health.pending_founder_decisions)).toEqual(["FD-FX-02"]);
  });

  it("resolving the decision in HQ also resolves the open item that points at it", () => {
    const ds = dataset((_, add) =>
      add("decision", {
        id: "FD-HQ-0001",
        code: null,
        title: "Gamma may not use recorded audio",
        status: "issued",
        recorded_in: "hq",
        date: "2031-05-01",
        statement: { text: "No recorded audio in Gamma.", epistemic: "founder_statement", citations: [CITE_F01] },
        exact_text: "No recorded audio in Gamma.",
        module_ids: ["MOD-FX-GAMMA"],
        requirement_ids: [],
        commission_code: null,
        resolves: ["FD-FX-02"],
        effects: [],
        citations: [],
      }),
    );
    expect(developmentHealth(ds).pending_founder_decisions).toEqual([]);
  });

  it("a blocker recorded as an open item and on its module is listed once", () => {
    const blocked = developmentHealth(dataset(() => {})).blocked;
    const shared = blocked.filter((i) => /shared pattern format/.test(i.note));
    expect(shared.map((i) => i.id)).toEqual(["OPEN-FX-02"]);
  });

  it("control: a module blocker with no matching open item is still listed", () => {
    const ds = dataset((find) => {
      (find("MOD-FX-GAMMA").blockers as unknown[]).push({ text: "Gamma waits for Alpha.", epistemic: "reported", citations: [CITE_F01] });
    });
    expect(developmentHealth(ds).blocked.map((i) => i.id)).toContain("MOD-FX-GAMMA");
  });
});

describe("records that entered through the inbox are marked as unverified (honesty-10)", () => {
  const inboxDefect: Data = {
    id: "DEF-HQ-0001",
    title: "Gamma crashes",
    module_ids: ["MOD-FX-ALPHA"],
    build_id: null,
    status: "open",
    severity: "unknown",
    statement: { text: "It crashes on load", epistemic: "submitter_claim", citations: [] },
    citations: [],
    reported_by: "claude",
    reported_via: "hq_proposal_inbox",
  };
  const ds = dataset(
    (find, add) => {
      add("defect", inboxDefect);
      find("OPEN-FX-02").title = "Shared pattern format not agreed (edited through the inbox)";
    },
    (r) => (r.id === "DEF-HQ-0001" || r.id === "OPEN-FX-02" ? { origin: "proposal_acceptance", proposal_id: `PROP-${r.id}` } : undefined),
  );

  it("an inbox defect is an open defect noted as an inbox report, and an unverified claim", () => {
    const health = developmentHealth(ds);
    const defect = health.open_defects.find((i) => i.id === "DEF-HQ-0001")!;
    expect(defect.note).toMatch(/^Reported through the inbox \(PROP-DEF-HQ-0001\); not verified\./);
    expect(ids(health.unverified_claims)).toContain("DEF-HQ-0001");
  });

  it("any record whose current version came through the inbox is counted as unverified, once", () => {
    const health = developmentHealth(ds);
    expect(health.unverified_claims.filter((i) => i.id === "OPEN-FX-02")).toHaveLength(1);
    expect(health.blocked.find((i) => i.id === "OPEN-FX-02")!.note).toMatch(/^Reported through the inbox/);
  });

  it("control: source records and founder-decision versions are not", () => {
    const health = developmentHealth(ds);
    expect(ids(health.unverified_claims)).not.toContain("DEF-FX-01");
    const decided = dataset(
      (_, add) => add("defect", inboxDefect),
      (r) => (r.id === "DEF-HQ-0001" ? { origin: "founder_decision" } : undefined),
    );
    expect(developmentHealth(decided).open_defects.find((i) => i.id === "DEF-HQ-0001")!.note).not.toMatch(/inbox/);
  });
});

describe("HQ's own checks are described as what they are (honesty-7)", () => {
  it("labels say the check was made by HQ's build", () => {
    expect(EPISTEMIC_LABEL.verified).toBe("Checked by HQ's build");
    expect(EPISTEMIC_TONE.verified.short).toBe("Checked by HQ's build");
    expect(statusLabel("hq_verified")).toBe("Checked by HQ's build");
    expect(HEALTH_META.hq_verified.title).toBe("Checks made by HQ's build");
    expect(HEALTH_META.hq_verified.description).toMatch(/does not re-run the other checks/);
    expect(HEALTH_META.open_defects.description).toMatch(/proposal inbox/);
    expect(HEALTH_META.rejected_in_hq.title).toBe("Founder rejected in HQ");
  });
});
