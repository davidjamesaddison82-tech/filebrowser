import { beforeAll, describe, expect, it } from "vitest";
import { authenticatePassphrase, authenticateToken } from "@/lib/auth/authenticate";
import { claimsFor } from "@/lib/auth/principal";
import { getEcosystemOverview, getProposal, listProposals, recordTestEvidence, submitChangeProposal, submitDefectReport } from "@/lib/server/services";
import { admin, asAppRole, expectStatus, freshWorld, type TestWorld } from "../helpers/db";

let w: TestWorld;
let claudeProposal: string;
beforeAll(async () => {
  w = await freshWorld();
  const submitted = await submitChangeProposal(w.claude, {
    title: "Claude's private proposal",
    rationale: "Only Claude and the founder should see this.",
    base_rev: 1,
    target: { type: "requirement", id: "FR-FX-004", base_version: 1 },
    set: { interpretation: "No overlays." },
  });
  claudeProposal = (submitted.proposal as { id: string }).id;
});

describe("AC7 — cross-role and unauthorised access is prevented", () => {
  it("the reader role can read but cannot submit anything to the inbox", async () => {
    expect((await getEcosystemOverview(w.reader)).data.counts.module).toBe(4);
    const body = { title: "Reader proposal", rationale: "x x x", base_rev: 1, target: { type: "requirement", id: "FR-FX-004", base_version: 1 }, set: { interpretation: "y" } };
    expect((await expectStatus(submitChangeProposal(w.reader, body), 403)).message).toMatch(/reader role cannot submit/);
    await expectStatus(submitDefectReport(w.reader, { title: "Defect", description: "x x x", module_ids: ["MOD-FX-ALPHA"], base_rev: 1 }), 403);
    await expectStatus(recordTestEvidence(w.reader, { title: "Tests", result_summary: "passed", base_rev: 1 }), 403);
  });

  it("a token without the propose scope cannot submit, even for a client that otherwise may", async () => {
    const err = await expectStatus(
      submitChangeProposal(w.claudeReadOnly, { title: "Read-only token", rationale: "x x x", base_rev: 1, target: { type: "requirement", id: "FR-FX-004", base_version: 1 }, set: { interpretation: "y" } }),
      403,
    );
    expect(err.message).toMatch(/"propose" scope/);
  });

  it("one AI client cannot see another AI client's proposals", async () => {
    expect((await listProposals(w.claude)).map((p) => p.id)).toEqual([claudeProposal]);
    expect(await listProposals(w.chatgpt)).toEqual([]);
    const err = await expectStatus(getProposal(w.chatgpt, claudeProposal), 404);
    expect(err.message).toMatch(/not found/);
    await expectStatus(getProposal(w.developer, claudeProposal), 404);
    await expectStatus(getProposal(w.reader, claudeProposal), 404);
  });

  it("the founder sees every proposal", async () => {
    expect((await listProposals(w.founder)).map((p) => p.id)).toEqual([claudeProposal]);
    expect((await getProposal(w.founder, claudeProposal)).submitted_by).toBe("claude");
  });

  it("row-level security isolates proposals even for raw SQL issued as the API role", async () => {
    const seen = await asAppRole("authenticated", claimsFor(w.chatgpt), async (c) => (await c.query("select id from hq.proposals")).rows);
    expect(seen).toEqual([]);
    const events = await asAppRole("authenticated", claimsFor(w.chatgpt), async (c) => (await c.query("select id from hq.proposal_events")).rows);
    expect(events).toEqual([]);
    const own = await asAppRole("authenticated", claimsFor(w.claude), async (c) => (await c.query("select id from hq.proposals")).rows);
    expect(own).toHaveLength(1);
  });

  it("the application login role has no access at all until it assumes an API role", async () => {
    await expect(asAppRole(null, null, (c) => c.query("select count(*) from hq.record_versions"))).rejects.toMatchObject({ code: "42501" });
  });

  it("an anonymous caller cannot read any record", async () => {
    await expect(asAppRole("anon", null, (c) => c.query("select count(*) from hq.record_versions"))).rejects.toMatchObject({ code: "42501" });
    await expect(asAppRole("anon", null, (c) => c.query("select hq.head_rev()"))).rejects.toMatchObject({ code: "42501" });
  });

  it("an authenticated caller with unknown or inactive identity sees nothing", async () => {
    const ghost = { sub: "00000000-0000-4000-8000-00000000dead", role: "authenticated", amr: "api_token", client: null };
    const rows = await asAppRole("authenticated", ghost, async (c) => (await c.query("select count(*)::int as n from hq.record_versions")).rows[0].n);
    expect(rows).toBe(0);
    const forged = { sub: "not-a-uuid", role: "authenticated", app_role: "founder" };
    const forgedRows = await asAppRole("authenticated", forged, async (c) => (await c.query("select count(*)::int as n from hq.record_versions")).rows[0].n);
    expect(forgedRows).toBe(0);
  });

  it("a role named in the claims is ignored: authority comes from the principals table", async () => {
    const lying = { ...claimsFor(w.claude), app_role: "founder", role: "authenticated" };
    const role = await asAppRole("authenticated", lying, async (c) => (await c.query("select hq.current_app_role() as r")).rows[0].r);
    expect(role).toBe("ai_agent");
  });

  it("no API role can write records, revisions, proposals or the audit log directly", async () => {
    const claims = claimsFor(w.developer);
    const attempts = [
      "insert into hq.record_versions (record_type, record_id, version, rev, data, content_hash, row_hash, created_by, origin) select 'module','MOD-X',1,1,'{\"id\":\"MOD-X\"}','','',id,'seed_import' from hq.principals limit 1",
      "update hq.record_versions set data = data",
      "delete from hq.record_versions",
      "insert into hq.dataset_revisions (rev, kind, summary, created_by) select 99,'seed_import','x x x',id from hq.principals limit 1",
      "delete from hq.proposals",
      "update hq.proposal_events set event = 'accepted'",
      "insert into hq.audit_log (action, outcome) values ('forged', 'allowed')",
      "delete from hq.audit_log",
      "update hq.principals set app_role = 'founder'",
    ];
    for (const sql of attempts) {
      await expect(asAppRole("authenticated", claims, (c) => c.query(sql)), sql).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("credential hashes and login secrets are unreadable by API roles", async () => {
    for (const table of ["hq.api_credentials", "hq.login_secrets", "hq.id_counters"]) {
      await expect(asAppRole("authenticated", claimsFor(w.founder), (c) => c.query(`select * from ${table}`)), table).rejects.toMatchObject({ code: "42501" });
    }
    await expect(asAppRole("authenticated", claimsFor(w.claude), (c) => c.query("select hq.auth_find_login('founder')"))).rejects.toMatchObject({ code: "42501" });
    await expect(asAppRole("authenticated", claimsFor(w.claude), (c) => c.query("select hq.admin_put_records('[]'::jsonb, 'x x x', null, 'hq-import', false)"))).rejects.toMatchObject({ code: "42501" });
  });

  it("only the founder can read the audit log or list credentials", async () => {
    const forClaude = await asAppRole("authenticated", claimsFor(w.claude), async (c) => (await c.query("select count(*)::int as n from hq.audit_log")).rows[0].n);
    expect(forClaude).toBe(0);
    const forFounder = await asAppRole("authenticated", claimsFor(w.founder), async (c) => (await c.query("select count(*)::int as n from hq.audit_log")).rows[0].n);
    expect(forFounder).toBeGreaterThan(0);
    await expect(asAppRole("authenticated", claimsFor(w.developer), (c) => c.query("select * from hq.founder_list_credentials()"))).rejects.toMatchObject({ code: "HQ403" });
  });

  // The application writes these rows in a separate transaction (db.ts audit()); a refusal raised inside a
  // database function cannot write its own (see tests/db/audit-log.test.ts).
  it("denied attempts made through the application are written to the audit log, by the application, with who tried", async () => {
    const rows = await asAppRole("authenticated", claimsFor(w.founder), async (c) =>
      (await c.query<{ principal_handle: string; action: string }>("select principal_handle, action from hq.audit_log where outcome = 'denied' order by id")).rows,
    );
    expect(rows.some((r) => r.principal_handle === "reader" && r.action === "proposal.submit")).toBe(true);
  });
});

describe("credentials", () => {
  it("authenticates a valid token to the right client with the right scopes", async () => {
    const claude = await authenticateToken(w.tokens.claude);
    expect(claude).toMatchObject({ handle: "claude", kind: "ai_client", appRole: "ai_agent", amr: "api_token", scopes: ["read", "propose"] });
    const chatgpt = await authenticateToken(w.tokens.chatgpt);
    expect(chatgpt?.handle).toBe("chatgpt");
    expect(chatgpt?.id).not.toBe(claude?.id);
    expect((await authenticateToken(w.tokens.claudeReadOnly))?.scopes).toEqual(["read"]);
  });

  it("rejects unknown, malformed, revoked and expired tokens", async () => {
    expect(await authenticateToken("hbq_00000000_0000000000000000000000000000000000000000000")).toBeNull();
    expect(await authenticateToken("not a token")).toBeNull();
    expect(await authenticateToken(`${w.tokens.claude.slice(0, -1)}x`)).toBeNull();
    const client = await admin();
    try {
      await client.query("update hq.api_credentials set revoked_at = now() where label = 'test read-only'");
      await client.query("update hq.api_credentials set expires_at = now() - interval '1 minute' where label = 'test developer token'");
    } finally {
      await client.end();
    }
    expect(await authenticateToken(w.tokens.claudeReadOnly)).toBeNull();
    expect(await authenticateToken(w.tokens.developer)).toBeNull();
    expect((await authenticateToken(w.tokens.claude))?.handle).toBe("claude");
  });

  it("verifies passphrases for humans only and gives nothing away on failure", async () => {
    expect(await authenticatePassphrase("founder", w.passphrases.founder)).toMatchObject({ handle: "founder", appRole: "founder", amr: "session" });
    expect(await authenticatePassphrase("founder", "wrong")).toBeNull();
    expect(await authenticatePassphrase("nobody", w.passphrases.founder)).toBeNull();
    expect(await authenticatePassphrase("claude", w.passphrases.founder)).toBeNull();
  });

  it("a deactivated principal can no longer authenticate", async () => {
    const client = await admin();
    try {
      await client.query("update hq.principals set active = false where handle = 'chatgpt'");
      expect(await authenticateToken(w.tokens.chatgpt)).toBeNull();
      await client.query("update hq.principals set active = true where handle = 'chatgpt'");
      expect((await authenticateToken(w.tokens.chatgpt))?.handle).toBe("chatgpt");
    } finally {
      await client.end();
    }
  });
});
