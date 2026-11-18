import { describe, expect, it } from "vitest";
import { collectCitations, outgoingRefs } from "@/lib/domain/dataset";
import {
  acceptanceStatus,
  dependencies,
  developmentHealth,
  ecosystemOverview,
  filterRequirements,
  incomingRefs,
  isOutstanding,
  lifecycleMatrix,
  lineage,
  loopStageMatrix,
  missingWork,
  moduleBrief,
  moduleStanding,
  reviewItems,
  search,
  stageCoverage,
} from "@/lib/domain/derive";
import { LIFECYCLE_DIMENSIONS } from "@/lib/domain/schemas";
import { fixtureDataset } from "../helpers/fixture";

const ds = fixtureDataset();

describe("AC4 — proposal, prototype, tested and accepted are never collapsed", () => {
  it("a module with passing tests and no acceptance is 'tested, not accepted'", () => {
    const standing = moduleStanding(ds.module("MOD-FX-ALPHA")!.data);
    expect(standing.headline).toBe("tested_not_accepted");
    expect(standing.flags.test_evidence).toBe(true);
    expect(standing.flags.acceptance_reported).toBe(false);
    expect(standing.flags.acceptance_recorded_in_hq).toBe(false);
    expect(standing.caution).toMatch(/not founder acceptance/i);
  });

  it("acceptance stated by a source is 'reported', never 'recorded in HQ'", () => {
    const standing = moduleStanding(ds.module("MOD-FX-BETA")!.data);
    expect(standing.headline).toBe("acceptance_reported");
    expect(standing.flags.acceptance_recorded_in_hq).toBe(false);
    expect(standing.caution).toMatch(/scoped or partial/i);
  });

  it("a design with nothing runnable is 'designed only'; a bare name is 'named only'", () => {
    expect(moduleStanding(ds.module("MOD-FX-GAMMA")!.data).headline).toBe("designed_only");
    expect(moduleStanding(ds.module("MOD-FX-DELTA")!.data).headline).toBe("named_only");
  });

  it("a candidate build is reported as a candidate, an accepted build as reported-only", () => {
    const candidate = acceptanceStatus(ds, "build", "BLD-FX-01")!;
    expect(candidate.headline).toBe("build_candidate");
    expect(candidate.recorded_in_hq).toBeNull();
    expect(candidate.caution).toMatch(/not an accepted build/i);
    const reported = acceptanceStatus(ds, "build", "BLD-FX-02")!;
    expect(reported.headline).toBe("build_accepted_reported");
    expect(reported.recorded_in_hq).toBeNull();
  });

  it("the four headline standings in the fixture are all different", () => {
    const headlines = ds.modules.map((m) => moduleStanding(m.data).headline);
    expect(new Set(headlines).size).toBe(4);
  });

  it("health counts tests and acceptance separately and reports no HQ acceptance", () => {
    const health = developmentHealth(ds);
    expect(health.accepted_in_hq).toHaveLength(0);
    expect(health.tested_not_accepted.map((i) => i.id)).toEqual(["MOD-FX-ALPHA"]);
    expect(health.acceptance_reported_only.map((i) => i.id).sort()).toEqual(["BLD-FX-02", "MOD-FX-BETA"]);
    expect(health.hq_verified.map((i) => i.id)).toEqual(["EV-FX-02"]);
    expect(health.open_defects.map((i) => i.id)).toEqual(["DEF-FX-01"]);
    expect(health.pending_founder_decisions.map((i) => i.id).sort()).toEqual(["FD-FX-02", "OPEN-FX-01"]);
  });

  it("the lifecycle matrix has every dimension for every module and no aggregate figure", () => {
    const rows = lifecycleMatrix(ds);
    expect(rows).toHaveLength(ds.modules.length);
    for (const row of rows) {
      expect(row.cells.map((c) => c.dimension)).toEqual([...LIFECYCLE_DIMENSIONS]);
      expect(Object.keys(row)).not.toContain("percent");
      expect(Object.keys(row)).not.toContain("completion");
    }
  });
});

describe("AC2 — requirement search with stable identifiers", () => {
  it("finds requirements by words in the exact wording and returns durable ids", () => {
    const hits = filterRequirements(ds, { q: "slow tempo" }).map((r) => r.meta.id);
    expect(hits).toEqual(["FR-FX-001", "FR-FX-005"]);
  });

  it("finds a requirement by its id", () => {
    expect(search(ds, "FR-FX-004", { types: ["requirement"] })[0].id).toBe("FR-FX-004");
  });

  it("returns the same ids in the same order every time", () => {
    const run = () => search(ds, "pattern").map((h) => `${h.type}:${h.id}`);
    expect(run()).toEqual(run());
    expect(run().length).toBeGreaterThan(5);
  });

  it("requires every term to match", () => {
    expect(search(ds, "slow nonexistentword")).toHaveLength(0);
  });

  it("filters by module, disposition and outstanding state", () => {
    expect(filterRequirements(ds, { module_id: "MOD-FX-GAMMA" }).map((r) => r.meta.id)).toEqual(["FR-FX-006"]);
    expect(filterRequirements(ds, { disposition: "superseded" }).map((r) => r.meta.id)).toEqual(["FR-FX-006"]);
    const outstanding = filterRequirements(ds, { outstanding: true }).map((r) => r.meta.id);
    expect(outstanding).toEqual(["FR-FX-002", "FR-FX-003", "FR-FX-004", "FR-FX-005"]);
    expect(isOutstanding(ds.get("requirement", "FR-FX-001")!.data)).toBe(false);
  });

  it("never alters the exact wording when returning it", () => {
    const record = ds.get("requirement", "FR-FX-002")!.data;
    expect(record.exact_wording).toBe("Never show a score out of ten.");
  });
});

describe("AC3 — complete linked requirement and module relationships", () => {
  it("every reference in the fixture resolves to a record", () => {
    for (const envelope of ds.all()) {
      for (const ref of outgoingRefs(envelope.meta.type, envelope.data)) {
        expect(ds.byId(ref), `${envelope.meta.id} → ${ref}`).toBeDefined();
      }
      for (const citation of collectCitations(envelope.data)) {
        expect(ds.source(citation.source_id), `${envelope.meta.id} cites ${citation.source_id}`).toBeDefined();
      }
    }
  });

  it("links run both ways: a requirement's module lists the requirement", () => {
    for (const requirement of ds.requirements) {
      for (const moduleId of requirement.data.module_ids) {
        const brief = moduleBrief(ds, moduleId)!;
        expect(brief.requirements.map((r) => r.ref.id)).toContain(requirement.meta.id);
        expect(incomingRefs(ds, moduleId).map((r) => r.id)).toContain(requirement.meta.id);
      }
    }
  });

  it("a module brief gathers loops, builds, evidence, defects, decisions, connections and sources", () => {
    const brief = moduleBrief(ds, "MOD-FX-ALPHA")!;
    expect(brief.loops.map((l) => l.id)).toEqual(["LOOP-FX-01"]);
    expect(brief.builds.map((b) => b.ref.id)).toEqual(["BLD-FX-01"]);
    expect(brief.evidence.map((e) => e.ref.id)).toEqual(["EV-FX-01"]);
    expect(brief.defects.map((d) => d.ref.id)).toEqual(["DEF-FX-01"]);
    expect(brief.decisions.map((d) => d.ref.id)).toEqual(["FD-FX-01"]);
    expect(brief.connections_out.map((c) => c.ref.id)).toEqual(["MOD-FX-BETA"]);
    expect(brief.connections_in.map((c) => c.ref.id)).toEqual(["MOD-FX-GAMMA"]);
    expect(brief.pathways.map((p) => p.id)).toEqual(["PATH-FX-01"]);
    expect(brief.sources.map((s) => s.id)).toEqual(["SRC-F01", "SRC-F02"]);
    expect(brief.last_seen).toBe("2031-04-12");
  });

  it("dependencies report prerequisites, dependants and blockers", () => {
    const rec = dependencies(ds, "recommendation", "REC-FX-02")!;
    expect(rec.depends_on.map((d) => d.ref.id)).toEqual(["REC-FX-01"]);
    expect(rec.blockers.map((b) => b.ref?.id)).toEqual(["DEF-FX-01"]);
    const beta = dependencies(ds, "module", "MOD-FX-BETA")!;
    expect(beta.depended_on_by.map((d) => d.ref.id)).toContain("MOD-FX-ALPHA");
    expect(beta.blockers.length).toBeGreaterThanOrEqual(2);
  });

  it("the ecosystem overview draws each connection once", () => {
    const overview = ecosystemOverview(ds);
    expect(overview.modules).toHaveLength(4);
    expect(overview.edges.map((e) => [e.from, e.to].sort().join("~")).sort()).toEqual(["MOD-FX-ALPHA~MOD-FX-BETA", "MOD-FX-ALPHA~MOD-FX-GAMMA"]);
  });
});

describe("source lineage", () => {
  it("returns the cited sources with their checksums and the exact quotations used", () => {
    const lin = lineage(ds, "build", "BLD-FX-02")!;
    expect(lin.sources).toHaveLength(1);
    expect(lin.sources[0].id).toBe("SRC-F01");
    expect(lin.sources[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(lin.sources[0].citations[0].quote).toBe("Beta build 2 was accepted by the founder on 3 March 2031 for desktop browsers only.");
    expect(lin.downstream.map((r) => r.id)).toContain("DEF-FX-02");
  });

  it("returns null for a record that does not exist", () => {
    expect(lineage(ds, "build", "BLD-NOPE")).toBeNull();
  });
});

describe("missing and forgotten work is exposed, not omitted", () => {
  const missing = missingWork(ds);

  it("lists requirements with no implementation record or evidence", () => {
    expect(missing.requirements_without_implementation_record.map((i) => i.id)).toEqual(["FR-FX-002", "FR-FX-003", "FR-FX-004", "FR-FX-005"]);
    expect(missing.requirements_without_test_evidence.map((i) => i.id)).not.toContain("FR-FX-001");
    expect(missing.requirements_without_module.map((i) => i.id)).toEqual(["FR-FX-004"]);
  });

  it("lists modules with no supporting source and documents that could not be read", () => {
    expect(missing.modules_without_source_evidence.map((i) => i.id)).toEqual(["MOD-FX-DELTA"]);
    expect(missing.sources_not_accessible.map((i) => i.id)).toEqual(["SRC-F03"]);
  });

  it("flags a module that the most recent source no longer mentions", () => {
    const stale = missing.not_in_recent_sources.items.map((i) => i.id);
    expect(missing.not_in_recent_sources.newest).toBe("2031-04-12");
    expect(stale).toContain("MOD-FX-GAMMA");
    expect(stale).toContain("MOD-FX-DELTA");
    expect(stale).not.toContain("MOD-FX-ALPHA");
  });
});

describe("review items", () => {
  const items = reviewItems(ds);
  const kinds = (kind: string) => items.filter((i) => i.kind === kind);

  it("reports a conflict between requirements once", () => {
    const conflicts = kinds("conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].refs.map((r) => r.id).sort()).toEqual(["FR-FX-002", "FR-FX-003"]);
  });

  it("reports identical wording recorded twice", () => {
    expect(kinds("possible_duplicate")[0].refs.map((r) => r.id).sort()).toEqual(["FR-FX-001", "FR-FX-005"]);
  });

  it("reports a superseded requirement that names no successor", () => {
    expect(kinds("superseded_without_successor")[0].refs[0].id).toBe("FR-FX-006");
  });

  it("reports acceptance claimed without an acceptance instrument, and tests without acceptance", () => {
    expect(kinds("missing_acceptance_evidence")[0].refs[0].id).toBe("BLD-FX-02");
    expect(kinds("tests_without_acceptance")[0].refs[0].id).toBe("MOD-FX-ALPHA");
  });

  it("reports a governing document that could not be read", () => {
    expect(kinds("governing_source_missing")[0].refs[0].id).toBe("SRC-F03");
  });

  it("has no dangling references in the fixture", () => {
    expect(kinds("dangling_reference")).toHaveLength(0);
  });
});

describe("learning loops", () => {
  it("keeps each loop's own step names and maps them to the shared progression", () => {
    const row = loopStageMatrix(ds).find((r) => r.loop_id === "LOOP-FX-01")!;
    expect(row.stages.encounter).toEqual(["Meet the pattern"]);
    expect(row.stages.perform).toEqual(["play it slowly", "play it at tempo"]);
    expect(row.stages.retrieve).toEqual(["come back to it after three days"]);
    expect(row.stages.predict).toEqual([]);
  });

  it("does not force every stage onto every loop", () => {
    const design = loopStageMatrix(ds).find((r) => r.loop_id === "LOOP-FX-02")!;
    const filled = Object.values(design.stages).filter((v) => v.length > 0);
    expect(filled).toHaveLength(1);
  });

  it("shows which modules contribute to each stage", () => {
    const coverage = stageCoverage(ds);
    expect(coverage.retrieve.map((c) => c.module_id)).toEqual(["MOD-FX-BETA"]);
    expect(coverage.create.map((c) => c.module_id)).toEqual(["MOD-FX-GAMMA"]);
    expect(coverage.transfer).toEqual([]);
  });
});
