/**
 * A founder acceptance binds to what was accepted (D2), a founder decision names only real records
 * (D13), ids of the form XX-HQ-n are HQ's alone (D11), and the inbox answers carry the standard
 * envelope (D17). Negative tests assert the refusal and that nothing changed.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { claimsFor } from "@/lib/auth/principal";
import { acceptanceStatus } from "@/lib/domain/derive";
import {
  getProposal,
  HQ_NOTICE,
  listMyProposals,
  proposalImpact,
  recordFounderDecision,
  recordTestEvidence,
  reviewProposal,
  searchRecords,
  submitChangeProposal,
  submitDefectReport,
} from "@/lib/server/services";
import { getDataset } from "@/lib/server/store";
import { seed } from "../../scripts/seed";
import { admin, asAppRole, expectStatus, freshWorld, type TestWorld, worldState } from "../helpers/db";
import { TEST_ADMIN_URL } from "../helpers/env";

let w: TestWorld;
const idOf = (result: { proposal: unknown }) => (result.proposal as { id: string }).id;
const head = async () => (await getDataset(w.founder)).head;
const versionOf = async (type: "build" | "module" | "evidence", id: string) => (await getDataset(w.founder)).ds.get(type, id)!.meta.version;

async function accept(type: "build" | "module", id: string, state: "accepted" | "rejected" | "none" = "accepted") {
  return recordFounderDecision(w.founder, {
    title: `${state} ${id}`,
    exact_text: `I record ${state} for ${id}.`,
    effects: [{ type: "set_acceptance", record_type: type, record_id: id, state, scope_note: "desktop only" }],
  });
}

describe("D2 — a founder acceptance binds to what was accepted", () => {
  beforeAll(async () => {
    w = await freshWorld();
  });

  it("the acceptance records the version it was written at", async () => {
    await accept("build", "BLD-FX-02");
    const build = (await getDataset(w.founder)).ds.get("build", "BLD-FX-02")!;
    expect(build.meta.version).toBe(2);
    expect((build.data as { hq_acceptance: { accepted_version: number } }).hq_acceptance.accepted_version).toBe(2);
  });

  it("a proposal to change an accepted record is refused with 409, for an AI token and a developer session, and nothing changes", async () => {
    for (const who of [w.claude, w.developer]) {
      const before = await worldState();
      const err = await expectStatus(
        submitChangeProposal(who, {
          title: "Record checksum",
          rationale: "Metadata correction.",
          base_rev: await head(),
          target: { type: "build", id: "BLD-FX-02", base_version: await versionOf("build", "BLD-FX-02") },
          set: { filename: "beta-build-3-untested.html", sha256: "2".repeat(64), label: "Beta build 3" },
        }),
        409,
      );
      expect(err.message).toMatch(/BLD-FX-02 carries a founder acceptance recorded in HQ \(FD-HQ-0001\)\. Record a founder decision that clears it first/);
      expect(await worldState()).toEqual(before);
    }
  });

  it("the database refuses the same proposal on its own with HQ409", async () => {
    const before = await worldState();
    const version = await versionOf("build", "BLD-FX-02");
    await expect(
      asAppRole("authenticated", claimsFor(w.claude), (c) =>
        c.query("select hq.submit_proposal('change_proposal', 'build', 'BLD-FX-02', $1, $2, 'Direct', 'Direct probe.', $3::jsonb)", [
          version,
          w.headRev,
          JSON.stringify({ op: "update", set: { label: "Beta build 3" } }),
        ]),
      ),
    ).rejects.toMatchObject({ code: "HQ409", message: expect.stringMatching(/carries a founder acceptance recorded in HQ \(FD-HQ-0001\)/) });
    expect(await worldState()).toEqual(before);
  });

  it("an acceptance that arrives after submission blocks the accept; the proposal is not marked stale and stays submitted", async () => {
    const id = idOf(
      await submitChangeProposal(w.claude, {
        title: "Rename alpha build",
        rationale: "Clearer label.",
        base_rev: await head(),
        target: { type: "build", id: "BLD-FX-01", base_version: await versionOf("build", "BLD-FX-01") },
        set: { label: "alpha-candidate-7 (renamed)" },
      }),
    );
    await accept("build", "BLD-FX-01");
    const before = await worldState();
    const err = await expectStatus(reviewProposal(w.founder, id, "accept"), 409);
    expect(err.message).toMatch(/BLD-FX-01 carries a founder acceptance recorded in HQ \(FD-HQ-0002\)/);
    expect(await worldState()).toEqual(before);
    const proposal = await getProposal(w.founder, id);
    expect(proposal.status).toBe("submitted");
    expect(proposal.events.map((e) => e.event)).toEqual(["submitted"]);
    const impact = await proposalImpact(w.founder, proposal);
    expect(impact.target_acceptance).toMatchObject({ state: "accepted", decision_id: "FD-HQ-0002" });
    expect((await getDataset(w.founder)).ds.get("build", "BLD-FX-01")!.data.label).toBe("alpha-candidate-7");
  });

  it("a rejection binds the same way", async () => {
    await accept("module", "MOD-FX-BETA", "rejected");
    await expectStatus(
      submitChangeProposal(w.developer, {
        title: "Beta summary",
        rationale: "Reword.",
        base_rev: await head(),
        target: { type: "module", id: "MOD-FX-BETA", base_version: await versionOf("module", "MOD-FX-BETA") },
        set: { summary: "Reworded." },
      }),
      409,
    );
    // The database binds a rejection on its own too, at submission and in the sealing trigger.
    const before = await worldState();
    const version = await versionOf("module", "MOD-FX-BETA");
    const headRev = await head();
    await expect(
      asAppRole("authenticated", claimsFor(w.developer), (c) =>
        c.query("select hq.submit_proposal('change_proposal', 'module', 'MOD-FX-BETA', $1, $2, 'Direct', 'Direct probe.', $3::jsonb)", [
          version,
          headRev,
          JSON.stringify({ op: "update", set: { summary: "Reworded." } }),
        ]),
      ),
    ).rejects.toMatchObject({ code: "HQ409", message: expect.stringMatching(/MOD-FX-BETA carries a founder acceptance recorded in HQ/) });
    const client = await admin();
    try {
      await client.query("begin");
      const founderId = (await client.query<{ id: string }>("select id from hq.principals where handle = 'founder'")).rows[0].id;
      const rev = (await client.query<{ r: string }>("select hq._begin_revision('proposal_acceptance', 'Forged write', null, $1) as r", [founderId])).rows[0].r;
      const current = (await client.query<{ data: Record<string, unknown> }>("select data from hq.record_versions where record_id = 'MOD-FX-BETA' order by version desc limit 1")).rows[0].data;
      await expect(
        client.query("select hq._append_record('module', 'MOD-FX-BETA', $1::jsonb, false, $2, $3, 'proposal_acceptance', null)", [
          JSON.stringify({ ...current, summary: "Reworded." }),
          rev,
          founderId,
        ]),
      ).rejects.toMatchObject({ code: "HQ409", message: expect.stringMatching(/only a founder decision can change it/) });
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
    expect(await worldState()).toEqual(before);
  });

  it("the sealing trigger refuses a non-founder write that keeps the acceptance over changed content", async () => {
    const client = await admin();
    try {
      await client.query("begin");
      const founderId = (await client.query<{ id: string }>("select id from hq.principals where handle = 'founder'")).rows[0].id;
      const rev = (await client.query<{ r: string }>("select hq._begin_revision('proposal_acceptance', 'Forged write', null, $1) as r", [founderId])).rows[0].r;
      const current = (await client.query<{ data: Record<string, unknown> }>("select data from hq.record_versions where record_id = 'BLD-FX-02' order by version desc limit 1")).rows[0].data;
      await expect(
        client.query("select hq._append_record('build', 'BLD-FX-02', $1::jsonb, false, $2, $3, 'proposal_acceptance', null)", [
          JSON.stringify({ ...current, label: "Beta build 3", sha256: "2".repeat(64) }),
          rev,
          founderId,
        ]),
      ).rejects.toMatchObject({ code: "HQ409", message: expect.stringMatching(/only a founder decision can change it/) });
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  });

  it("once a founder decision clears the acceptance (state none), proposals are possible again", async () => {
    await accept("build", "BLD-FX-02", "none");
    const id = idOf(
      await submitChangeProposal(w.claude, {
        title: "Name the file",
        rationale: "The handover names it.",
        base_rev: await head(),
        target: { type: "build", id: "BLD-FX-02", base_version: await versionOf("build", "BLD-FX-02") },
        set: { filename: "beta-build-2.html" },
      }),
    );
    const filed = await reviewProposal(w.founder, id, "accept");
    expect(filed.record_id).toBe("BLD-FX-02");
    const status = acceptanceStatus((await getDataset(w.founder)).ds, "build", "BLD-FX-02")!;
    expect(status.headline).not.toBe("accepted_in_hq");
  });
});

describe("D13 — a founder decision may name only records that exist", () => {
  beforeAll(async () => {
    w = await freshWorld();
  });

  const bad: { name: string; input: Record<string, unknown>; mentions: string }[] = [
    { name: "an id that does not exist in resolves", input: { resolves: ["NOPE-1"] }, mentions: "NOPE-1" },
    { name: "a record of the wrong type in resolves", input: { resolves: ["DEF-FX-01"] }, mentions: "DEF-FX-01" },
    { name: "free text in resolves", input: { resolves: ["free text not an id"] }, mentions: "free text not an id" },
    { name: "a module that does not exist", input: { module_ids: ["MOD-DOES-NOT-EXIST"] }, mentions: "MOD-DOES-NOT-EXIST" },
    {
      name: "an effect on a requirement that does not exist",
      input: { effects: [{ type: "set_requirement_disposition", requirement_id: "FR-NOPE-1", disposition: "active" }] },
      mentions: "FR-NOPE-1",
    },
  ];

  for (const b of bad) {
    it(`${b.name} is refused with 422 through the service and by the database, and nothing is written`, async () => {
      const before = await worldState();
      const err = await expectStatus(recordFounderDecision(w.founder, { title: "A decision", exact_text: "I decide this.", ...b.input }), 422);
      expect(err.message).toContain(b.mentions);
      const args = { resolves: [], module_ids: [], effects: [], ...b.input } as { resolves: unknown[]; module_ids: unknown[]; effects: unknown[] };
      await expect(
        asAppRole("authenticated", claimsFor(w.founder), (c) =>
          c.query("select hq.record_founder_decision('A decision', 'I decide this.', null, $1::jsonb, $2::jsonb, $3::jsonb)", [
            JSON.stringify(args.effects),
            JSON.stringify(args.resolves),
            JSON.stringify(args.module_ids),
          ]),
        ),
      ).rejects.toMatchObject({ code: "HQ422", message: expect.stringContaining(b.mentions) });
      expect(await worldState()).toEqual(before);
      expect((await getDataset(w.founder)).ds.get("decision", "FD-HQ-0001")).toBeUndefined();
    });
  }

  it("non-founders are still refused before any of this (403)", async () => {
    for (const who of [w.claude, w.developer]) await expectStatus(recordFounderDecision(who, { title: "A decision", exact_text: "I decide this.", resolves: ["NOPE-1"] }), 403);
  });

  it("a decision resolving a real pending decision, about a real module, is recorded", async () => {
    const result = await recordFounderDecision(w.founder, {
      title: "Gamma may use recorded audio",
      exact_text: "Gamma may use recorded audio.",
      resolves: ["FD-FX-02", "OPEN-FX-01"],
      module_ids: ["MOD-FX-GAMMA"],
    });
    expect(result.decision_id).toBe("FD-HQ-0001");
  });
});

describe("D11 — ids of the form XX-HQ-n are issued by HQ only", () => {
  beforeAll(async () => {
    w = await freshWorld();
  });

  it("an import that uses one is refused by the database, and nothing is written", async () => {
    const before = await worldState();
    const client = await admin();
    try {
      for (const [type, id] of [
        ["evidence", "EV-HQ-0001"],
        ["decision", "FD-HQ-0001"],
        ["requirement", "FR-HQ-0001"],
      ]) {
        await expect(
          client.query("select hq.admin_put_records($1::jsonb, 'Import with a reserved id', null, 'hq-import', false)", [
            JSON.stringify([{ type, id, data: { id, title: "Imported with an HQ id" } }]),
          ]),
        ).rejects.toMatchObject({ code: "HQ422", message: expect.stringMatching(/ids of this form are issued by HQ itself/) });
      }
    } finally {
      await client.end();
    }
    expect(await worldState()).toEqual(before);
  });

  it("ids already present (legacy data) are skipped, so HQ never appends to a record it did not create", async () => {
    // Simulate data imported before the guard existed: write EV-HQ-0001 and FD-HQ-0001 through the import path directly.
    const client = await admin();
    try {
      await client.query("begin");
      const importer = (await client.query<{ id: string }>("select id from hq.principals where handle = 'hq-import'")).rows[0].id;
      const rev = (await client.query<{ r: string }>("select hq._begin_revision('seed_import', 'Legacy import', null, $1) as r", [importer])).rows[0].r;
      const legacyEvidence = { id: "EV-HQ-0001", type: "other", title: "Legacy", module_ids: [], build_id: null, result: { text: "Legacy.", epistemic: "submitter_claim", citations: [] }, verification: "source_reported", date: null, sha256: null, citations: [] };
      await client.query("select hq._append_record('evidence', 'EV-HQ-0001', $1::jsonb, false, $2, $3, 'seed_import', null)", [JSON.stringify(legacyEvidence), rev, importer]);
      const legacyDecision = { id: "FD-HQ-0001", code: null, title: "Legacy decision", status: "unknown", recorded_in: "source", date: null, statement: { text: "Legacy.", epistemic: "submitter_claim", citations: [] }, citations: [] };
      await client.query("select hq._append_record('decision', 'FD-HQ-0001', $1::jsonb, false, $2, $3, 'seed_import', null)", [JSON.stringify(legacyDecision), rev, importer]);
      await client.query("select hq._seal_revision($1)", [rev]);
      await client.query("commit");
    } finally {
      await client.end();
    }

    const evidence = await reviewProposal(w.founder, idOf(await recordTestEvidence(w.claude, { title: "A run", result_summary: "Passed.", base_rev: await head() })), "accept");
    expect(evidence).toMatchObject({ record_id: "EV-HQ-0002", version: 1 });
    const decision = await recordFounderDecision(w.founder, { title: "A decision", exact_text: "I decide this." });
    expect(decision.decision_id).toBe("FD-HQ-0002");

    const requirement = () =>
      submitChangeProposal(w.claude, {
        title: "Register again",
        rationale: "Quoted.",
        base_rev: w.headRev,
        create: {
          record_type: "requirement",
          record: { exact_wording: "Keep the interface free of pop-up windows.", source_id: "SRC-F01", attribution: "direct_quote", title: "No pop-ups", category: "ui_ux", implementation_state: "no_record" },
        },
      });
    const first = await reviewProposal(w.founder, idOf(await requirement()), "accept");
    const second = await reviewProposal(w.founder, idOf(await requirement()), "accept");
    expect([first.record_id, second.record_id]).toEqual(["FR-HQ-0001", "FR-HQ-0002"]);
    expect([first.version, second.version]).toEqual([1, 1]);

    const check = await admin();
    try {
      const rows = await check.query<{ record_id: string; n: number }>(
        "select record_id, count(*)::int as n from hq.record_versions where record_id in ('EV-HQ-0001', 'FD-HQ-0001') group by record_id order by record_id",
      );
      expect(rows.rows).toEqual([
        { record_id: "EV-HQ-0001", n: 1 },
        { record_id: "FD-HQ-0001", n: 1 },
      ]);
    } finally {
      await check.end();
    }
  });

  it("the import summary names the pack's kind, id, version and content hash", async () => {
    const result = await seed({ packDir: "data/packs/fixture", adminUrl: TEST_ADMIN_URL, quiet: true });
    const ctx = await getDataset(w.founder, 1);
    expect(ctx.ds.revision.summary).toBe(`Import of fixture pack "hq-fixture" 1.0.0 (content sha256 ${result.pack.stats.content_sha256})`);
    expect(result.pack.stats.content_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("D17 — inbox answers carry the standard envelope; search reports its true total", () => {
  beforeAll(async () => {
    w = await freshWorld();
  });

  function expectEnvelope(answer: { hq?: { authority: string; notice: string }; revision?: { rev: number; is_head: boolean }; requested_by?: { handle: string } }, handle: string) {
    expect(answer.hq).toEqual({ authority: "prototype_non_authoritative", notice: HQ_NOTICE });
    expect(answer.revision).toMatchObject({ rev: w.headRev, is_head: true });
    expect(answer.requested_by).toMatchObject({ handle });
  }

  it("submit, defect report, test evidence and my-proposals all answer in the envelope", async () => {
    const change = await submitChangeProposal(w.claude, {
      title: "Interpretation",
      rationale: "Clarify.",
      base_rev: w.headRev,
      target: { type: "requirement", id: "FR-FX-004", base_version: 1 },
      set: { interpretation: "No overlays." },
    });
    expectEnvelope(change, "claude");
    expect(change.data.proposal).toMatchObject({ status: "submitted" });
    expectEnvelope(await submitDefectReport(w.developer, { title: "Drift", description: "Drifts after 64 bars.", module_ids: ["MOD-FX-ALPHA"], base_rev: w.headRev }), "developer");
    const evidence = await recordTestEvidence(w.claude, { title: "Run", result_summary: "Passed.", base_rev: w.headRev });
    expectEnvelope(evidence, "claude");
    expect(evidence.data.note).toMatch(/unverified submission/);
    const mine = await listMyProposals(w.claude);
    expectEnvelope(mine, "claude");
    expect(mine.data.proposals.map((p) => p.submitted_by)).toEqual(["claude", "claude"]);
  });

  it("search_records counts every match and says when the list was cut short", async () => {
    const client = await admin();
    try {
      const records = Array.from({ length: 70 }, (_, i) => {
        const id = `OPEN-ZZ-${String(i + 1).padStart(3, "0")}`;
        return { type: "open_item", id, data: { id, kind: "risk", title: `Zzfiller item ${i + 1}`, statement: { text: "Filler.", epistemic: "submitter_claim", citations: [] }, module_ids: [], decision_id: null, citations: [] } };
      });
      await client.query("select hq.admin_put_records($1::jsonb, 'Filler for the search limit', null, 'hq-import', false)", [JSON.stringify(records)]);
    } finally {
      await client.end();
    }
    const many = await searchRecords(w.claude, "zzfiller", undefined);
    expect(many.data).toMatchObject({ total: 70, returned: 60, truncated: true });
    expect(many.data.hits).toHaveLength(60);
    const few = await searchRecords(w.claude, "pop-up", undefined);
    expect(few.data.truncated).toBe(false);
    expect(few.data.total).toBe(few.data.hits.length);
  });
});
