import { beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { SourceTexts } from "@/lib/domain/pack";
import { collectCitations } from "@/lib/domain/dataset";
import { getEcosystemOverview, getModuleBrief, getRecord, getSourceLineage, listSources, searchFounderRequirements } from "@/lib/server/services";
import { expectStatus, freshWorld, type TestWorld } from "../helpers/db";
import { FIXTURE_DIR } from "../helpers/fixture";

let w: TestWorld;
beforeAll(async () => {
  w = await freshWorld();
});

describe("AC1 — module retrieval with exact provenance", () => {
  it("returns the module with the revision it came from and who asked", async () => {
    const res = await getModuleBrief(w.claude, "MOD-FX-ALPHA");
    expect(res.data.id).toBe("MOD-FX-ALPHA");
    expect(res.revision.rev).toBe(w.headRev);
    expect(res.revision.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.revision.is_head).toBe(true);
    expect(res.requested_by).toMatchObject({ handle: "claude", kind: "ai_client", role: "ai_agent", authenticated_by: "api_token" });
    expect(res.hq.authority).toBe("prototype_non_authoritative");
    expect(res.data.version).toBe(1);
    expect(res.data.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("names every source the module rests on, with location, version and checksum", async () => {
    const res = await getModuleBrief(w.claude, "MOD-FX-ALPHA");
    const sources = await listSources(w.claude);
    expect(res.provenance.sources.map((s) => s.id)).toEqual(["SRC-F01", "SRC-F02"]);
    for (const cited of res.provenance.sources) {
      const record = sources.data.sources.find((s) => s.id === cited.id)!;
      expect(cited.sha256).toBe(record.sha256);
      expect(cited.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(cited.version).toBe(record.version);
      expect(cited.access).toBe("read_full");
    }
  });

  it("every quotation returned for the module is verbatim in the cited source snapshot", async () => {
    const res = await getModuleBrief(w.claude, "MOD-FX-ALPHA");
    const texts = new SourceTexts(path.join(FIXTURE_DIR, "source-text"));
    const citations = collectCitations(res.data.record);
    expect(citations.length).toBeGreaterThan(8);
    for (const c of citations) expect(texts.contains(c.source_id, c.quote), c.quote).toBe(true);
  });

  it("accepts an exact module name or alias, and refuses an unknown module honestly", async () => {
    expect((await getModuleBrief(w.claude, "alpha (fixture)")).data.id).toBe("MOD-FX-ALPHA");
    expect((await getModuleBrief(w.claude, "alpha-candidate-7")).data.id).toBe("MOD-FX-ALPHA");
    const err = await expectStatus(getModuleBrief(w.claude, "MOD-DOES-NOT-EXIST"), 404);
    expect(err.message).toMatch(/No module/);
  });

  it("lineage returns the quotations used and the hash-chained version history", async () => {
    const res = await getSourceLineage(w.chatgpt, "build", "BLD-FX-02");
    expect(res.data.sources[0]).toMatchObject({ id: "SRC-F01", access: "read_full" });
    expect(res.data.sources[0].citations[0].quote).toContain("desktop browsers only");
    expect(res.data.history).toHaveLength(1);
    expect(res.data.history[0]).toMatchObject({ version: 1, origin: "seed_import", prev_hash: null });
    expect(res.data.history[0].row_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a requirement is returned with its original wording and source untouched", async () => {
    const res = await searchFounderRequirements(w.claude, { q: "pop-up" });
    expect(res.data.requirements).toHaveLength(1);
    expect(res.data.requirements[0]).toMatchObject({
      id: "FR-FX-004",
      exact_wording: "Keep the interface free of pop-up windows.",
      source_id: "SRC-F01",
      attribution: "direct_quote",
      disposition: "unreviewed",
    });
    expect(res.provenance.sources.map((s) => s.id)).toEqual(["SRC-F01"]);
  });

  it("the overview reports missing sources and modules without evidence rather than hiding them", async () => {
    const res = await getEcosystemOverview(w.reader);
    expect(res.data.counts.module).toBe(4);
    expect(res.data.missing_and_forgotten.sources_not_accessible.map((s) => s.id)).toEqual(["SRC-F03"]);
    expect(res.data.missing_and_forgotten.modules_without_source_evidence.map((m) => m.id)).toEqual(["MOD-FX-DELTA"]);
    expect(res.data.priorities.every((p) => p.status === "proposed" && /not approved/i.test(p.note))).toBe(true);
  });

  it("an unknown record type or id is refused, not guessed", async () => {
    await expectStatus(getRecord(w.claude, "rumour", "X-1"), 422);
    await expectStatus(getRecord(w.claude, "build", "BLD-NOPE"), 404);
  });
});
