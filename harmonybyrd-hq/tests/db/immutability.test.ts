import { beforeAll, describe, expect, it } from "vitest";
import { claimsFor } from "@/lib/auth/principal";
import { readAs } from "@/lib/server/db";
import { getEcosystemOverview, getModuleBrief, getRecord, getReviewItems, getSourceLineage, listSources, recordFounderDecision, reviewProposal, searchFounderRequirements, searchRecords, submitChangeProposal } from "@/lib/server/services";
import { chainProblems, getDataset, listChanges } from "@/lib/server/store";
import { admin, expectStatus, freshWorld, type TestWorld } from "../helpers/db";

let w: TestWorld;
beforeAll(async () => {
  w = await freshWorld();
  const submitted = await submitChangeProposal(w.developer, {
    title: "Interpretation for FR-FX-004",
    rationale: "Clarifies scope.",
    base_rev: 1,
    target: { type: "requirement", id: "FR-FX-004", base_version: 1 },
    set: { interpretation: "No overlays that cover content." },
  });
  await reviewProposal(w.founder, (submitted.proposal as { id: string }).id, "accept");
  await recordFounderDecision(w.founder, {
    title: "FR-FX-004 is active",
    exact_text: "Keep it. FR-FX-004 is an active requirement.",
    effects: [{ type: "set_requirement_disposition", requirement_id: "FR-FX-004", disposition: "active" }],
  });
});

async function counts() {
  const client = await admin();
  try {
    const row = await client.query<{ versions: number; revisions: number; proposals: number; events: number }>(
      `select (select count(*)::int from hq.record_versions) as versions, (select count(*)::int from hq.dataset_revisions) as revisions,
              (select count(*)::int from hq.proposals) as proposals, (select count(*)::int from hq.proposal_events) as events`,
    );
    return row.rows[0];
  } finally {
    await client.end();
  }
}

describe("AC9 — source lineage and immutable historical records", () => {
  it("every earlier version of a changed record is retained and retrievable", async () => {
    const lineage = await getSourceLineage(w.reader, "requirement", "FR-FX-004");
    expect(lineage.data.history.map((h) => [h.version, h.rev, h.origin, h.created_by])).toEqual([
      [1, 1, "seed_import", "hq-import"],
      [2, 2, "proposal_acceptance", "founder"],
      [3, 3, "founder_decision", "founder"],
    ]);
    expect(lineage.data.history[1].proposal_id).toBe("PROP-000001");
    const v1 = await getRecord(w.reader, "requirement", "FR-FX-004", { rev: 1 });
    const v2 = await getRecord(w.reader, "requirement", "FR-FX-004", { rev: 2 });
    const v3 = await getRecord(w.reader, "requirement", "FR-FX-004");
    expect(v1.data.record).toMatchObject({ interpretation: null, disposition: "unreviewed" });
    expect(v2.data.record).toMatchObject({ interpretation: "No overlays that cover content.", disposition: "unreviewed" });
    expect(v3.data.record).toMatchObject({ interpretation: "No overlays that cover content.", disposition: "active" });
    // The original wording is identical in every version.
    for (const v of [v1, v2, v3]) expect((v.data.record as { exact_wording: string }).exact_wording).toBe("Keep the interface free of pop-up windows.");
  });

  it("each version is chained to the one before it by hash", async () => {
    const history = (await getSourceLineage(w.reader, "requirement", "FR-FX-004")).data.history;
    expect(history[0].prev_hash).toBeNull();
    expect(history[1].prev_hash).toBe(history[0].row_hash);
    expect(history[2].prev_hash).toBe(history[1].row_hash);
    expect(new Set(history.map((h) => h.content_hash)).size).toBe(3);
    expect(await chainProblems(w.founder)).toEqual([]);
  });

  it("the change log records what changed, when, why, by whom and under which commission", async () => {
    const changes = await listChanges(w.reader);
    expect(changes.map((c) => [c.rev, c.kind, c.created_by])).toEqual([
      [3, "founder_decision", "founder"],
      [2, "proposal_acceptance", "founder"],
      [1, "seed_import", "hq-import"],
    ]);
    expect(changes[1].summary).toContain("PROP-000001");
    expect(changes[1].changes).toEqual([{ type: "requirement", id: "FR-FX-004", version: 2, deleted: false, proposal_id: "PROP-000001" }]);
    expect(changes[2].commission_ref).toBe("FIXTURE");
    expect(changes[0].changes.map((c) => c.id).sort()).toEqual(["FD-HQ-0001", "FR-FX-004"]);
  });

  it("history cannot be updated, deleted or truncated — not even by the database owner", async () => {
    const client = await admin();
    try {
      const refused = [
        "update hq.record_versions set data = '{\"id\":\"FR-FX-004\"}' where record_id = 'FR-FX-004'",
        "delete from hq.record_versions where record_id = 'FR-FX-004'",
        "truncate hq.record_versions",
        "update hq.dataset_revisions set summary = 'rewritten history' where rev = 1",
        "update hq.dataset_revisions set content_hash = repeat('0', 64) where rev = 1",
        "delete from hq.dataset_revisions where rev = 3",
        "update hq.proposal_events set event = 'rejected'",
        "delete from hq.proposals",
        "delete from hq.audit_log",
        "update hq.audit_log set outcome = 'allowed'",
        "truncate hq.audit_log",
      ];
      for (const sql of refused) await expect(client.query(sql), sql).rejects.toMatchObject({ code: "HQ405" });
    } finally {
      await client.end();
    }
    expect(await chainProblems(w.founder)).toEqual([]);
  });

  it("a requirement's original wording and provenance cannot be changed by any write path", async () => {
    const client = await admin();
    try {
      const current = (await client.query("select data from hq.record_versions where record_id = 'FR-FX-002' order by version desc limit 1")).rows[0].data;
      for (const [field, value] of [["exact_wording", "Always show a score out of ten."], ["source_id", "SRC-F02"], ["attribution", "commission_text"]] as const) {
        await expect(
          client.query("select hq.admin_put_records($1::jsonb, 'rewrite attempt', null, 'hq-import', false)", [
            JSON.stringify([{ type: "requirement", id: "FR-FX-002", data: { ...current, [field]: value } }]),
          ]),
          field,
        ).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(/immutable/) });
      }
      // …and an import cannot change a requirement's standing either.
      await expect(
        client.query("select hq.admin_put_records($1::jsonb, 'standing change attempt', null, 'hq-import', false)", [
          JSON.stringify([{ type: "requirement", id: "FR-FX-002", data: { ...current, disposition: "satisfied" } }]),
        ]),
      ).rejects.toMatchObject({ code: "HQ403" });
    } finally {
      await client.end();
    }
    expect((await getDataset(w.founder)).head).toBe(3);
  });

  it("a re-import never overwrites a record changed through governance; it reports the divergence", async () => {
    const client = await admin();
    try {
      const original = (await client.query("select data from hq.record_versions where record_id = 'FR-FX-004' and version = 1")).rows[0].data;
      const result = (
        await client.query("select hq.admin_put_records($1::jsonb, 're-import', null, 'hq-import', false) as r", [
          JSON.stringify([{ type: "requirement", id: "FR-FX-004", data: original }]),
        ])
      ).rows[0].r;
      expect(result).toMatchObject({ changed: 0, rev: 3, diverged: [{ type: "requirement", id: "FR-FX-004", version: 3 }] });
    } finally {
      await client.end();
    }
    expect((await getRecord(w.reader, "requirement", "FR-FX-004")).data.record).toMatchObject({ disposition: "active" });
  });

  it("tampering that bypasses the triggers is detected by the hash chain", async () => {
    const client = await admin();
    try {
      await client.query("begin");
      await client.query("alter table hq.record_versions disable trigger record_versions_append_only");
      await client.query(`update hq.record_versions set data = jsonb_set(data, '{exact_wording}', '"Tampered."') where record_id = 'FR-FX-003' and version = 1`);
      const problems = (await client.query("select record_id, version, problem from hq.verify_chain()")).rows;
      expect(problems).toEqual([{ record_id: "FR-FX-003", version: 1, problem: "content hash mismatch" }]);
      await client.query("rollback");
    } finally {
      await client.end();
    }
    expect(await chainProblems(w.founder)).toEqual([]);
  });
});

describe("read operations do not mutate records", () => {
  it("every read service leaves records, revisions and the inbox untouched", async () => {
    const before = await counts();
    const headBefore = (await getDataset(w.claude)).ds.revision;
    await getEcosystemOverview(w.claude);
    await getModuleBrief(w.claude, "MOD-FX-ALPHA");
    await getModuleBrief(w.chatgpt, "MOD-FX-BETA", { rev: 1 });
    await searchFounderRequirements(w.claude, { q: "score", outstanding: true });
    await searchRecords(w.claude, "pattern", undefined);
    await getSourceLineage(w.claude, "build", "BLD-FX-01");
    await getReviewItems(w.reader);
    await listSources(w.reader);
    await listChanges(w.reader);
    await expectStatus(getRecord(w.claude, "build", "BLD-NOPE"), 404);
    expect(await counts()).toEqual(before);
    expect((await getDataset(w.claude)).ds.revision).toEqual(headBefore);
  });

  it("the read path runs in a read-only transaction: a write attempted there is refused by the database", async () => {
    const err = await expectStatus(
      readAs(claimsFor(w.founder), (q) => q.query("select hq.record_founder_decision('Smuggled write', 'This must not be recorded.')")),
      403,
    );
    expect(err.code).toBe("read_only_transaction");
    expect((await getDataset(w.founder)).head).toBe(3);
  });
});
