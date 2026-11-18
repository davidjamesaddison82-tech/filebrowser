import { beforeAll, describe, expect, it } from "vitest";
import { claimsFor } from "@/lib/auth/principal";
import { acceptanceStatus } from "@/lib/domain/derive";
import { getRecord, listProposals, recordFounderDecision, recordTestEvidence, reviewProposal, submitChangeProposal, submitDefectReport } from "@/lib/server/services";
import { getDataset } from "@/lib/server/store";
import { admin, asAppRole, expectStatus, freshWorld, type TestWorld } from "../helpers/db";

let w: TestWorld;
let evidenceProposal: string;
const idOf = (result: { proposal: unknown }) => (result.proposal as { id: string }).id;

beforeAll(async () => {
  w = await freshWorld();
  evidenceProposal = idOf(
    await recordTestEvidence(w.claude, {
      title: "alpha-candidate-7 full suite re-run",
      result_summary: "All tests pass. The work is complete and ready for release.",
      module_ids: ["MOD-FX-ALPHA"],
      build_id: "BLD-FX-01",
      counts: { passed: 42, failed: 0, skipped: 0 },
      code_ref: { repository: "fixture/alpha", ref: "0".repeat(40) },
      base_rev: 1,
    }),
  );
});

describe("AC8 — an AI client cannot create founder acceptance", () => {
  it("an AI client cannot review its own proposal", async () => {
    const err = await expectStatus(reviewProposal(w.claude, evidenceProposal, "accept"), 403);
    expect(err.message).toMatch(/Founder authority is required/);
    expect(err.message).toMatch(/cannot approve work, including its own/);
    expect((await listProposals(w.founder)).find((p) => p.id === evidenceProposal)?.status).toBe("submitted");
  });

  it("another AI client, a developer and a reader cannot review it either", async () => {
    for (const who of [w.chatgpt, w.developer, w.reader]) {
      await expectStatus(reviewProposal(who, evidenceProposal, "accept"), 403);
    }
  });

  it("no AI client or developer can record a founder decision or an acceptance", async () => {
    const decision = {
      title: "Accept alpha-candidate-7",
      exact_text: "I accept alpha-candidate-7.",
      effects: [{ type: "set_acceptance", record_type: "build", record_id: "BLD-FX-01", state: "accepted" }],
    };
    for (const who of [w.claude, w.chatgpt, w.developer, w.reader]) {
      const err = await expectStatus(recordFounderDecision(who, decision), 403);
      expect(err.message).toMatch(/Founder authority is required/);
    }
    const ctx = await getDataset(w.founder);
    expect(acceptanceStatus(ctx.ds, "build", "BLD-FX-01")?.recorded_in_hq).toBeNull();
    expect(ctx.head).toBe(1);
  });

  it("calling the database functions directly as an AI client is refused by the database itself", async () => {
    const claims = claimsFor(w.claude);
    await expect(asAppRole("authenticated", claims, (c) => c.query("select hq.review_proposal($1, 'accept', null)", [evidenceProposal]))).rejects.toMatchObject({ code: "HQ403" });
    await expect(
      asAppRole("authenticated", claims, (c) =>
        c.query("select hq.record_founder_decision('Accept', 'accepted', null, $1::jsonb)", [
          JSON.stringify([{ type: "set_acceptance", record_type: "build", record_id: "BLD-FX-01", state: "accepted" }]),
        ]),
      ),
    ).rejects.toMatchObject({ code: "HQ403" });
  });

  it("claiming to be the founder in the token does not help", async () => {
    const forged = { ...claimsFor(w.claude), app_role: "founder", kind: "human", amr: "session" };
    await expect(asAppRole("authenticated", forged, (c) => c.query("select hq.review_proposal($1, 'accept', null)", [evidenceProposal]))).rejects.toMatchObject({ code: "HQ403" });
  });

  it("founder authority requires an interactive session: the founder's identity over an API token is refused", async () => {
    const founderByToken = { ...w.founder, amr: "api_token" as const };
    await expectStatus(reviewProposal(founderByToken, evidenceProposal, "accept"), 403);
    await expect(asAppRole("authenticated", claimsFor(founderByToken), (c) => c.query("select hq.review_proposal($1, 'accept', null)", [evidenceProposal]))).rejects.toMatchObject({
      code: "HQ403",
      message: expect.stringMatching(/interactive founder session/),
    });
  });

  it("the database refuses to issue an API token to a founder, or to promote a token-holder to founder", async () => {
    const client = await admin();
    try {
      await expect(
        client.query("insert into hq.api_credentials (principal_id, label, token_prefix, token_hash) select id, 'x', 'hbq_ffffffff', repeat('f', 64) from hq.principals where handle = 'founder'"),
      ).rejects.toMatchObject({ code: "HQ403" });
      await expect(client.query("update hq.principals set app_role = 'founder' where handle = 'developer'")).rejects.toMatchObject({ code: "HQ403" });
      // An AI client is refused twice over: by the credential guard and by the role constraint. Either is a refusal.
      await expect(client.query("update hq.principals set app_role = 'founder' where handle = 'claude'")).rejects.toMatchObject({
        code: expect.stringMatching(/^(HQ403|23514)$/),
      });
      // An AI client with no credentials at all is still refused, by the constraint alone.
      await client.query("insert into hq.principals (handle, display_name, kind, app_role) values ('bare-robot', 'Bare', 'ai_client', 'ai_agent')");
      await expect(client.query("update hq.principals set app_role = 'founder' where handle = 'bare-robot'")).rejects.toMatchObject({ code: "23514" });
      await expect(client.query("insert into hq.principals (handle, display_name, kind, app_role) values ('robot-founder', 'R', 'ai_client', 'founder')")).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.end();
    }
  });

  it("a proposal cannot carry acceptance, a requirement's standing, or altered original wording", async () => {
    const base = { title: "Sneak a status in", rationale: "x x x", base_rev: 1 };
    const attempts: Record<string, unknown>[] = [
      { target: { type: "build", id: "BLD-FX-01", base_version: 1 }, set: { hq_acceptance: { state: "accepted", decision_id: "FD-HQ-0001", decided_at: "now", decided_by: "claude" } } },
      { target: { type: "requirement", id: "FR-FX-002", base_version: 1 }, set: { disposition: "satisfied" } },
      { target: { type: "requirement", id: "FR-FX-002", base_version: 1 }, set: { exact_wording: "Always show a score out of ten." } },
      { target: { type: "requirement", id: "FR-FX-002", base_version: 1 }, set: { source_id: "SRC-F02" } },
      { target: { type: "evidence", id: "EV-FX-01", base_version: 1 }, set: { verification: "hq_verified" } },
      { create: { record_type: "build", record: { label: "x", standing: "development", hq_acceptance: { state: "accepted" } } } },
    ];
    for (const attempt of attempts) {
      const err = await expectStatus(submitChangeProposal(w.claude, { ...base, ...attempt }), 403);
      expect(err.message).toMatch(/[Pp]rotected fields/);
    }
    await expectStatus(submitChangeProposal(w.claude, { ...base, target: { type: "decision", id: "FD-FX-02", base_version: 1 }, set: { status: "issued" } }), 403);
    await expectStatus(submitChangeProposal(w.claude, { ...base, create: { record_type: "decision", record: { title: "x", status: "issued" } } }), 403);
    expect(await listProposals(w.claude)).toHaveLength(1);
  });

  it("the database enforces the same protections if the application layer is bypassed", async () => {
    const claims = claimsFor(w.claude);
    const call = (payload: unknown, type = "build", id = "BLD-FX-01") =>
      asAppRole("authenticated", claims, (c) =>
        c.query("select hq.submit_proposal('change_proposal', $1, $2, 1, 1, 'Bypass attempt', 'x x x', $3::jsonb)", [type, id, JSON.stringify(payload)]),
      );
    await expect(call({ op: "update", set: { hq_acceptance: { state: "accepted" } } })).rejects.toMatchObject({ code: "HQ403" });
    await expect(call({ op: "update", set: { disposition: "satisfied" } }, "requirement", "FR-FX-002")).rejects.toMatchObject({ code: "HQ403" });
    await expect(call({ op: "update", set: { status: "issued" } }, "decision", "FD-FX-02")).rejects.toMatchObject({ code: "HQ403" });
    await expect(call({ op: "create", record_type: "decision", record: {} })).rejects.toMatchObject({ code: "HQ403" });
  });

  it("an evidence pack cannot import founder acceptance or an HQ decision", async () => {
    const client = await admin();
    try {
      await expect(
        client.query("select hq.admin_put_records($1::jsonb, 'bad import', null, 'hq-import', false)", [
          JSON.stringify([{ type: "build", id: "BLD-FX-09", data: { id: "BLD-FX-09", hq_acceptance: { state: "accepted" } } }]),
        ]),
      ).rejects.toMatchObject({ code: "HQ403" });
      await expect(
        client.query("select hq.admin_put_records($1::jsonb, 'bad import', null, 'hq-import', false)", [
          JSON.stringify([{ type: "decision", id: "FD-FX-09", data: { id: "FD-FX-09", recorded_in: "hq" } }]),
        ]),
      ).rejects.toMatchObject({ code: "HQ403" });
    } finally {
      await client.end();
    }
  });

  it("when the founder files an agent's test evidence it stays labelled as an unverified agent claim, not acceptance", async () => {
    const filed = await reviewProposal(w.founder, evidenceProposal, "accept", "Filed for the record.");
    expect(filed.record_type).toBe("evidence");
    const record = await getRecord(w.founder, "evidence", String(filed.record_id));
    expect(record.data.record).toMatchObject({ verification: "agent_submitted_unverified", submitted_by: "claude" });
    expect((record.data.record as { result: { epistemic: string } }).result.epistemic).toBe("submitter_claim");
    const ctx = await getDataset(w.founder);
    expect(acceptanceStatus(ctx.ds, "build", "BLD-FX-01")).toMatchObject({ headline: "build_candidate", recorded_in_hq: null });
    expect(acceptanceStatus(ctx.ds, "evidence", String(filed.record_id))?.recorded_in_hq).toBeNull();
  });

  it("a defect report by a developer is filed as an open defect only after founder review", async () => {
    const id = idOf(await submitDefectReport(w.developer, { title: "Metronome drifts", description: "Drifts by a beat after 64 bars.", module_ids: ["MOD-FX-ALPHA"], severity: "major", base_rev: 2 }));
    expect((await getDataset(w.founder)).ds.defects).toHaveLength(2);
    const filed = await reviewProposal(w.founder, id, "accept");
    const record = await getRecord(w.developer, "defect", String(filed.record_id));
    expect(record.data.record).toMatchObject({ status: "open", severity: "major", reported_by: "developer" });
    expect((await getDataset(w.founder)).ds.defects).toHaveLength(3);
  });
});

describe("the founder's own decision path works, and is the only one that records acceptance", () => {
  it("records a decision with the founder's exact words and applies its effects", async () => {
    const result = await recordFounderDecision(w.founder, {
      title: "Accept alpha-candidate-7 for desktop",
      exact_text: "I accept alpha-candidate-7 for desktop browsers only. The dropped-note defect must be fixed before mobile.",
      rationale: "Reviewed at the keyboard.",
      effects: [
        { type: "set_acceptance", record_type: "build", record_id: "BLD-FX-01", state: "accepted", scope_note: "desktop browsers only" },
        { type: "set_requirement_disposition", requirement_id: "FR-FX-001", disposition: "active" },
      ],
      resolves: ["OPEN-FX-01"],
      module_ids: ["MOD-FX-ALPHA"],
      commission_ref: "FX-COM-1",
    });
    expect(result.decision_id).toBe("FD-HQ-0001");
    const ctx = await getDataset(w.founder);
    const decision = ctx.ds.get("decision", "FD-HQ-0001")!;
    expect(decision.data).toMatchObject({ recorded_in: "hq", status: "issued", decided_by: "founder" });
    expect(decision.data.exact_text).toBe("I accept alpha-candidate-7 for desktop browsers only. The dropped-note defect must be fixed before mobile.");
    expect(decision.meta.origin).toBe("founder_decision");
    expect(acceptanceStatus(ctx.ds, "build", "BLD-FX-01")).toMatchObject({ headline: "accepted_in_hq", recorded_in_hq: { state: "accepted", decision_id: "FD-HQ-0001", decided_by: "founder", scope_note: "desktop browsers only" } });
    expect(ctx.ds.get("requirement", "FR-FX-001")!.data).toMatchObject({ disposition: "active", disposition_decision_id: "FD-HQ-0001" });
    expect(ctx.warnings).toEqual([]);
  });

  it("accepting a build does not silently accept its module", async () => {
    const ctx = await getDataset(w.founder);
    expect(acceptanceStatus(ctx.ds, "module", "MOD-FX-ALPHA")).toMatchObject({ headline: "tested_not_accepted", recorded_in_hq: null });
  });

  it("an invalid decision changes nothing", async () => {
    const before = (await getDataset(w.founder)).head;
    await expectStatus(recordFounderDecision(w.founder, { title: "Bad", exact_text: "x x x", effects: [{ type: "set_acceptance", record_type: "build", record_id: "BLD-NOPE", state: "accepted" }] }), 404);
    await expectStatus(recordFounderDecision(w.founder, { title: "", exact_text: "" }), 422);
    expect((await getDataset(w.founder)).head).toBe(before);
  });
});
