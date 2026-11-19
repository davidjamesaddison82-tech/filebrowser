/**
 * The database's own founder gate and inbox checks, called directly (database half of tests-1 and
 * tests-6). Migration 0006 rewrites hq._require_founder and hq.submit_proposal (dropping the audit
 * calls that a refusal rolled back), so these pin that every rule they enforced still fires on its own:
 * the application refuses the same callers first, so only a direct call reaches these checks.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { claimsFor } from "@/lib/auth/principal";
import { PROPOSAL_PROTECTED_FIELDS, submitChangeProposal } from "@/lib/server/services";
import { admin, asAppRole, expectStatus, freshWorld, type TestWorld, worldState } from "../helpers/db";

let w: TestWorld;
let proposal: string;
beforeAll(async () => {
  w = await freshWorld();
  const submitted = await submitChangeProposal(w.claude, {
    title: "Claude's proposal",
    rationale: "For the founder-gate tests.",
    base_rev: 1,
    target: { type: "requirement", id: "FR-FX-004", base_version: 1 },
    set: { interpretation: "No overlays." },
  });
  proposal = (submitted.proposal as { id: string }).id;
});

async function credentialsAndPrincipals() {
  const client = await admin();
  try {
    return (
      await client.query<{ creds: number; unrevoked: number; principals: number; denied: number }>(
        `select (select count(*)::int from hq.api_credentials) as creds,
                (select count(*)::int from hq.api_credentials where revoked_at is null) as unrevoked,
                (select count(*)::int from hq.principals) as principals,
                (select count(*)::int from hq.audit_log where outcome = 'denied') as denied`,
      )
    ).rows[0];
  } finally {
    await client.end();
  }
}

describe("tests-1 — the database refuses founder acts from non-founder interactive sessions", () => {
  it("a developer or reader session is refused every founder function by the role check itself (HQ403), and nothing changes", async () => {
    const client = await admin();
    let credentialId: string;
    try {
      credentialId = (await client.query<{ id: string }>("select id from hq.api_credentials where label = 'test' order by created_at limit 1")).rows[0].id;
    } finally {
      await client.end();
    }
    const before = { world: await worldState(), other: await credentialsAndPrincipals() };
    const calls: [string, unknown[]][] = [
      ["select hq.review_proposal($1, 'reject', null)", [proposal]],
      ["select hq.review_proposal($1, 'needs_changes', null)", [proposal]],
      ["select hq.review_proposal($1, 'accept', null)", [proposal]],
      ["select hq.record_founder_decision('A decision', 'I decide this.')", []],
      ["select hq.founder_register_client('robot2', 'Robot', 'ai_client', 'ai_agent')", []],
      ["select hq.founder_issue_credential('claude', 'self', array['read','propose'], 'hbq_abcdef01', repeat('a', 64))", []],
      ["select hq.founder_revoke_credential($1::uuid)", [credentialId]],
    ];
    for (const who of [w.developer, w.reader]) {
      for (const [sql, args] of calls) {
        await expect(asAppRole("authenticated", claimsFor(who), (c) => c.query(sql, args)), `${who.handle}: ${sql}`).rejects.toMatchObject({
          code: "HQ403",
          message: expect.stringMatching(new RegExp(`founder authority is required for .*"${who.handle}" \\(human / ${who.appRole}\\)`)),
        });
      }
    }
    expect(await worldState()).toEqual(before.world);
    expect(await credentialsAndPrincipals()).toEqual(before.other);
  });
});

async function protectedFieldsFromDatabase(): Promise<string[]> {
  const client = await admin();
  try {
    return (await client.query<{ f: string }>("select unnest(hq.protected_fields()) as f")).rows.map((r) => r.f);
  } finally {
    await client.end();
  }
}

describe("tests-6 — submit_proposal's own role, scope, protected-field and stale checks", () => {
  const submit = (claims: object, payload: object, baseVersion = 1, type = "requirement", id = "FR-FX-002") =>
    asAppRole("authenticated", claims, (c) =>
      c.query("select hq.submit_proposal('change_proposal', $1, $2, $3, 1, 'Direct call', 'Direct call.', $4::jsonb)", [type, id, baseVersion, JSON.stringify(payload)]),
    );
  const valid = { op: "update", set: { interpretation: "A direct reading." } };

  it("the protected field list is the expected set, and every field in it is refused in an update (HQ403)", async () => {
    // Read at run time, so a field dropped from the function fails the expected-set check below.
    const client = await admin();
    let fields: string[];
    try {
      fields = (await client.query<{ f: string }>("select unnest(hq.protected_fields()) as f")).rows.map((r) => r.f);
    } finally {
      await client.end();
    }
    expect([...fields].sort()).toEqual(
      [
        "id", "exact_wording", "source_id", "locator", "source_date", "attribution", "disposition", "disposition_decision_id",
        "hq_acceptance", "recorded_in", "decided_by", "decided_at", "verification", "submitted_by", "hq_checks", "made_by", "recorded_from_cluster",
      ].sort(),
    );
    const before = await worldState();
    for (const field of fields) {
      await expect(submit(claimsFor(w.claude), { op: "update", set: { [field]: "x" } }), field).rejects.toMatchObject({
        code: "HQ403",
        message: expect.stringMatching(/protected/),
      });
    }
    expect(await worldState()).toEqual(before);
  });

  it("on create, every protected field outside the provenance allow-list is refused (HQ403)", async () => {
    // A created record may state where it comes from (source_id, locator, source_date, attribution,
    // exact_wording); every other protected field is HQ's or the founder's to write.
    const fields = await protectedFieldsFromDatabase();
    const mayGive = ["exact_wording", "source_id", "locator", "source_date", "attribution"];
    const refused = fields.filter((f) => !mayGive.includes(f));
    expect(refused.length).toBe(fields.length - mayGive.length);
    const before = await worldState();
    for (const field of refused) {
      await expect(
        submit(claimsFor(w.claude), { op: "create", record_type: "evidence", record: { title: "A test run", type: "test_run", [field]: "x" } }, 0, "evidence", "EV-FX-01"),
        field,
      ).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(new RegExp(`field "${field}" is protected`)) });
    }
    expect(await worldState()).toEqual(before);
  });

  it("a top-level source label the record does not already hold is refused by the database (HQ403; ROUND4 H1, was HQ422)", async () => {
    // PATH-FX-01's basis is design_intention and LOOP-FX-02's standing is design_intention: a proposal
    // cannot make either "reported", with or without citations. Before ROUND4 this was the HQ422 "must
    // cite at least one source"; a source label is now set only by an import.
    const before = await worldState();
    await expect(submit(claimsFor(w.claude), { op: "update", set: { basis: "reported" } }, 1, "pathway", "PATH-FX-01")).rejects.toMatchObject({
      code: "HQ403",
      message: expect.stringMatching(/field "basis": a proposal's claim is the submitter's own: label it submitter_claim/),
    });
    await expect(submit(claimsFor(w.developer), { op: "update", set: { standing: "reported" } }, 1, "loop", "LOOP-FX-02")).rejects.toMatchObject({
      code: "HQ403",
      message: expect.stringMatching(/field "standing": a proposal's claim is the submitter's own/),
    });
    expect(await worldState()).toEqual(before);
  });

  it("a created requirement whose exact wording has fewer than 8 visible characters is refused, even if the source contains it (HQ422)", async () => {
    const before = await worldState();
    await expect(
      submit(claimsFor(w.claude), { op: "create", record_type: "requirement", record: { title: "Tempo", exact_wording: " tempo ", source_id: "SRC-F01", locator: "Alpha module" } }, 0, "requirement", null as unknown as string),
    ).rejects.toMatchObject({ code: "HQ422", message: expect.stringMatching(/exact_wording quoting SRC-F01 has fewer than 8 characters other than spaces/) });
    expect(await worldState()).toEqual(before);
  });

  it("a citation without a verbatim quote, or with a source id that is not text, is refused by the database (HQ422)", async () => {
    // Such a citation would otherwise skip the quotation check, which only looks at {source_id, quote} pairs.
    const before = await worldState();
    for (const citation of [{ source_id: "SRC-F01", locator: "Alpha module" }, { source_id: 7, quote: "Alpha lets a learner practise a scale pattern slowly" }, "SRC-F01"]) {
      await expect(
        submit(claimsFor(w.claude), { op: "update", set: { statement: { text: "A sourced reading.", epistemic: "reported", citations: [citation] } } }, 1, "module", "MOD-FX-ALPHA"),
        JSON.stringify(citation),
      ).rejects.toMatchObject({ code: "HQ422", message: expect.stringMatching(/each citation needs a source_id and a verbatim quote/) });
    }
    expect(await worldState()).toEqual(before);
  });

  it("a reader, a token without the propose scope and a stale base version are refused, and nothing is written", async () => {
    const before = await worldState();
    await expect(submit(claimsFor(w.reader), valid)).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(/role "reader" may not submit proposals/) });
    await expect(submit(claimsFor(w.claudeReadOnly), valid)).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(/"propose" scope/) });
    await expect(submit(claimsFor(w.claude), valid, 9)).rejects.toMatchObject({ code: "HQ409", message: expect.stringMatching(/stale revision/) });
    await expect(submit({}, valid)).rejects.toMatchObject({ code: "HQ401" });
    expect(await worldState()).toEqual(before);
    // The valid call itself is accepted into the inbox.
    expect((await submit(claimsFor(w.claude), valid)).rows[0].submit_proposal).toMatchObject({ status: "submitted" });
  });
});

describe("docs-11 — every protected field is refused through the application too, and the two lists agree", () => {
  it("the application's protected list is exactly the database's", async () => {
    expect([...PROPOSAL_PROTECTED_FIELDS].sort()).toEqual((await protectedFieldsFromDatabase()).sort());
  });

  it("a proposal setting any protected field is refused with 403 by the service, on update and on create, and nothing is written", async () => {
    const before = await worldState();
    const base = { title: "Set a protected field", rationale: "Testing every protected field.", base_rev: 1 };
    const mayGive = ["exact_wording", "source_id", "locator", "source_date", "attribution"];
    for (const field of PROPOSAL_PROTECTED_FIELDS) {
      const err = await expectStatus(
        submitChangeProposal(w.claude, { ...base, target: { type: "requirement", id: "FR-FX-002", base_version: 1 }, set: { [field]: "x" } }),
        403,
      );
      expect(err.message, field).toMatch(new RegExp(`Protected fields cannot be changed by a proposal: ${field}\\.`));
      if (mayGive.includes(field)) continue;
      const created = await expectStatus(
        submitChangeProposal(w.developer, { ...base, create: { record_type: "evidence", record: { title: "A test run", type: "test_run", [field]: "x" } } }),
        403,
      );
      expect(created.message, field).toMatch(new RegExp(`Protected fields cannot be set by a proposal: ${field}\\.`));
    }
    expect(await worldState()).toEqual(before);
  });
});
