/**
 * D5 — the audit log (db-6, db-8, the database half of api-8).
 *
 *   * API roles can no longer call the free-form hq.log_event (any outcome, any size, any action);
 *   * hq.log_refusal records only denied / error, a dotted action name, at most 8192 bytes of detail, a
 *     checked request id, and the principal only when the claims name an active one outside anon;
 *   * hq.log_access records "allowed" only for an active principal;
 *   * audit() in src/lib/server/db.ts routes to the two wrappers and shortens an oversized detail.
 * Refusals raised inside a database function leave no audit row (the raise rolls it back): that is
 * pinned here so nothing relies on it again.
 */
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { claimsFor } from "@/lib/auth/principal";
import { audit } from "@/lib/server/db";
import { submitChangeProposal } from "@/lib/server/services";
import { admin, asAppRole, freshWorld, type TestWorld } from "../helpers/db";

let w: TestWorld;
let proposal: string;
beforeAll(async () => {
  w = await freshWorld();
  const submitted = await submitChangeProposal(w.claude, {
    title: "Claude's proposal",
    rationale: "For the audit tests.",
    base_rev: 1,
    target: { type: "requirement", id: "FR-FX-004", base_version: 1 },
    set: { interpretation: "No overlays." },
  });
  proposal = (submitted.proposal as { id: string }).id;
});

interface AuditRow {
  id: string;
  principal_id: string | null;
  principal_handle: string | null;
  app_role: string | null;
  client: string | null;
  action: string;
  object_type: string | null;
  object_id: string | null;
  outcome: string;
  detail: Record<string, unknown> | null;
  request_id: string | null;
}

async function auditCount(): Promise<number> {
  const client = await admin();
  try {
    return (await client.query<{ n: number }>("select count(*)::int as n from hq.audit_log")).rows[0].n;
  } finally {
    await client.end();
  }
}

async function lastAudit(): Promise<AuditRow> {
  const client = await admin();
  try {
    return (await client.query<AuditRow>("select * from hq.audit_log order by id desc limit 1")).rows[0];
  } finally {
    await client.end();
  }
}

/** As the owner after SET ROLE service_role (the administrative role on Supabase). */
async function asServiceRole<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = await admin();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

const refusal = (args: [string, string | null, string | null, string, string | null, string | null]) => (c: pg.Client) =>
  c.query("select hq.log_refusal($1, $2, $3, $4, $5::jsonb, $6)", args);

describe("D5 / db-6 — API roles cannot forge audit entries", () => {
  it("hq.log_event is refused (42501) to authenticated, anon, hq_auth and service_role, and nothing is written", async () => {
    const before = await auditCount();
    const forge = "select hq.log_event('decision.record', 'decision', 'FD-HQ-0999', 'allowed', '{\"decision\":\"accept\"}'::jsonb, null)";
    for (const [role, claims] of [
      ["authenticated", claimsFor(w.claude)],
      ["authenticated", claimsFor(w.developer)],
      ["authenticated", claimsFor(w.founder)],
      ["anon", claimsFor(w.founder)],
      ["hq_auth", null],
    ] as const) {
      await expect(asAppRole(role, claims, (c) => c.query(forge)), role).rejects.toMatchObject({ code: "42501" });
    }
    await expect(asServiceRole((c) => c.query(forge))).rejects.toMatchObject({ code: "42501" });
    await expect(asServiceRole(refusal(["proposal.review", null, null, "denied", null, null]))).rejects.toMatchObject({ code: "42501" });
    expect(await auditCount()).toBe(before);
  });

  it("hq.log_refusal refuses an 'allowed' outcome, an invalid action name and a detail over 8192 bytes (HQ422)", async () => {
    const before = await auditCount();
    const cases: [string, string, unknown][] = [
      ["decision.record", "allowed", null],
      ["Decision Record", "denied", null],
      ["decision", "denied", null],
      ["decision.record.a.b.c", "denied", null],
      ["proposal.submit", "denied", { pad: "x".repeat(100_000) }],
    ];
    for (const [action, outcome, detail] of cases) {
      await expect(
        asAppRole("authenticated", claimsFor(w.claude), refusal([action, "decision", "FD-X", outcome, detail === null ? null : JSON.stringify(detail), null])),
        `${action} ${outcome}`,
      ).rejects.toMatchObject({ code: "HQ422" });
    }
    expect(await auditCount()).toBe(before);
  });

  it("as anon with the founder's claims, a refusal is recorded with no principal and the claimed subject in detail", async () => {
    await asAppRole("anon", claimsFor(w.founder), refusal(["session.sign_in", "principal", "founder", "denied", '{"reason":"test"}', "req-anon-1"]));
    expect(await lastAudit()).toMatchObject({
      principal_id: null,
      principal_handle: null,
      app_role: null,
      client: null,
      action: "session.sign_in",
      outcome: "denied",
      detail: { reason: "test", claimed_sub: w.founder.id },
      request_id: "req-anon-1",
    });
  });

  it("an unknown or inactive principal is not recorded as the actor either", async () => {
    const ghost = { sub: "00000000-0000-4000-8000-00000000dead", role: "authenticated", amr: "api_token", client: "ghost" };
    await asAppRole("authenticated", ghost, refusal(["proposal.submit", null, null, "denied", null, null]));
    expect(await lastAudit()).toMatchObject({ principal_id: null, principal_handle: null, client: null, detail: { claimed_sub: ghost.sub } });

    const client = await admin();
    try {
      await client.query("update hq.principals set active = false where handle = 'developer'");
      await asAppRole("authenticated", claimsFor(w.developer), refusal(["proposal.submit", null, null, "denied", null, null]));
    } finally {
      await client.query("update hq.principals set active = true where handle = 'developer'");
      await client.end();
    }
    expect(await lastAudit()).toMatchObject({ principal_id: null, detail: { claimed_sub: w.developer.id } });
  });

  it("an active principal's refusal is recorded against that principal", async () => {
    await asAppRole("authenticated", claimsFor(w.claude), refusal(["mcp.submit_change_proposal", "proposal", null, "denied", '{"reason":"scope"}', "abc-123"]));
    expect(await lastAudit()).toMatchObject({
      principal_id: w.claude.id,
      principal_handle: "claude",
      app_role: "ai_agent",
      client: "claude",
      outcome: "denied",
      detail: { reason: "scope" },
      request_id: "abc-123",
    });
  });

  it("api-8: a request id that is not 1-64 of [A-Za-z0-9._-] is not stored, and the row says so", async () => {
    for (const bad of ["forged id with spaces", "x".repeat(65), "<script>", "id\nnext"]) {
      await asAppRole("authenticated", claimsFor(w.claude), refusal(["api.whoami", null, null, "denied", null, bad]));
      expect(await lastAudit(), bad).toMatchObject({ principal_handle: "claude", request_id: null, detail: { request_id_refused: true } });
    }
    await asAppRole("authenticated", claimsFor(w.claude), (c) => c.query("select hq.log_access('api.whoami', null, null, $1)", ["bad id"]));
    expect(await lastAudit()).toMatchObject({ outcome: "allowed", request_id: null, detail: { request_id_refused: true } });
  });

  it("hq.log_access records 'allowed' only for an active principal; anon, unknown and inactive callers are refused (HQ401)", async () => {
    await asAppRole("authenticated", claimsFor(w.claude), (c) => c.query("select hq.log_access('api.whoami', null, null, 'req-ok')"));
    expect(await lastAudit()).toMatchObject({ principal_handle: "claude", client: "claude", action: "api.whoami", outcome: "allowed", detail: null, request_id: "req-ok" });

    const before = await auditCount();
    const ghost = { sub: "00000000-0000-4000-8000-00000000dead", role: "authenticated", amr: "session", client: null };
    for (const [role, claims] of [["anon", claimsFor(w.founder)], ["authenticated", ghost], ["authenticated", {}]] as const) {
      await expect(
        asAppRole(role, claims, (c) => c.query("select hq.log_access('proposal.review', 'proposal', $1, null)", [proposal])),
        `${role} ${JSON.stringify(claims)}`,
      ).rejects.toMatchObject({ code: "HQ401" });
    }
    await expect(asAppRole("authenticated", claimsFor(w.claude), (c) => c.query("select hq.log_access('not an action', null, null, null)"))).rejects.toMatchObject({ code: "HQ422" });
    expect(await auditCount()).toBe(before);
  });
});

describe("F4 — hq.log_access accepts only what the application logs as allowed", () => {
  // Every action family the application passes to audit(…, outcome "allowed") (src/lib/server/http.ts
  // withApi: api.*, tool.<name>, tools.list, integrations.read, proposal.read; src/app/api/mcp:
  // mcp.<tool>; sign-in: session.sign_in), plus session.sign_out and session.end_all.
  const APPLICATION_ACTIONS = [
    "api.index",
    "api.whoami",
    "tool.get_record",
    "tool.submit_change_proposal",
    "tools.list",
    "integrations.read",
    "proposal.read",
    "mcp.get_module_brief",
    "session.sign_in",
    "session.sign_out",
    "session.end_all",
  ];
  // Founder acts and proposal writes are logged as allowed only by the functions that perform them.
  const FOUNDER_ACTS = [
    "proposal.review",
    "decision.record",
    "credential.issue",
    "credential.revoke",
    "credential.register_client",
    "proposal.submit",
    "proposal.withdraw",
    "session.forged",
    "tool.get-record",
    "api",
    "tools.list.more",
    "proposal.read.x",
  ];

  it("a founder act (and anything else outside the families) is refused with HQ422, for any caller, and nothing is written", async () => {
    const before = await auditCount();
    for (const action of FOUNDER_ACTS) {
      for (const who of [w.claude, w.claudeReadOnly, w.developer, w.founder]) {
        await expect(
          asAppRole("authenticated", claimsFor(who), (c) => c.query("select hq.log_access($1, 'proposal', $2, 'forged-1')", [action, proposal])),
          `${who.handle} ${action}`,
        ).rejects.toMatchObject({ code: "HQ422", message: expect.stringMatching(/cannot be recorded as allowed here/) });
      }
    }
    expect(await auditCount()).toBe(before);
  });

  it("every action family the application logs as allowed is still recorded", async () => {
    for (const action of APPLICATION_ACTIONS) {
      await asAppRole("authenticated", claimsFor(w.claude), (c) => c.query("select hq.log_access($1, null, null, 'req-f4')", [action]));
      expect(await lastAudit(), action).toMatchObject({ principal_handle: "claude", action, outcome: "allowed", request_id: "req-f4" });
    }
  });

  it("F6: the id a client sent is kept apart from the request id, only if well formed; four arguments still work", async () => {
    const call = (args: (string | null)[]) =>
      asAppRole("authenticated", claimsFor(w.claude), (c) =>
        c.query("select hq.log_access(" + args.map((_, i) => "$" + (i + 1)).join(", ") + ")", args),
      );
    await call(["api.whoami", null, null, "srv-1", "client-run-42.a"]);
    expect(await lastAudit()).toMatchObject({ action: "api.whoami", outcome: "allowed", request_id: "srv-1", detail: { client_request_id: "client-run-42.a" } });

    // A malformed client id is dropped; it never reaches the request id column or the detail.
    for (const bad of ["has space", "a".repeat(65), "<script>", ""]) {
      await call(["api.whoami", null, null, "srv-2", bad]);
      const row = await lastAudit();
      expect(row, JSON.stringify(bad)).toMatchObject({ request_id: "srv-2", detail: null });
    }

    // A malformed request id is still refused on its own, and the client's id is kept beside the note.
    await call(["api.whoami", null, null, "bad id", "client-7"]);
    expect(await lastAudit()).toMatchObject({ request_id: null, detail: { request_id_refused: true, client_request_id: "client-7" } });

    // The four-argument call of migration 0006 still resolves, and stores no client id.
    await call(["api.whoami", null, null, "srv-3"]);
    expect(await lastAudit()).toMatchObject({ request_id: "srv-3", detail: null });

    // The client's id cannot make a founder act loggable.
    await expect(call(["decision.record", null, null, "srv-4", "client-8"])).rejects.toMatchObject({ code: "HQ422" });
  });

  it("the founder functions still record their own allowed rows (log_refusal keeps its own rules)", async () => {
    const client = await admin();
    try {
      const rows = await client.query<{ action: string }>("select distinct action from hq.audit_log where outcome = 'allowed' and action = 'proposal.submit'");
      expect(rows.rows).toEqual([{ action: "proposal.submit" }]);
    } finally {
      await client.end();
    }
    await asAppRole("authenticated", claimsFor(w.claude), refusal(["proposal.review", "proposal", proposal, "denied", '{"reason":"f4"}', null]));
    expect(await lastAudit()).toMatchObject({ action: "proposal.review", outcome: "denied", principal_handle: "claude" });
  });

  it("an audit detail over 16384 bytes is refused for every new row, whoever writes it; rows already there were not re-checked", async () => {
    const client = await admin();
    try {
      const constraint = await client.query<{ convalidated: boolean; def: string }>(
        "select convalidated, pg_get_constraintdef(oid) as def from pg_constraint where conname = 'audit_log_detail_size' and conrelid = 'hq.audit_log'::regclass",
      );
      expect(constraint.rows).toEqual([{ convalidated: false, def: expect.stringMatching(/pg_column_size\(detail\) <= 16384/) }]);
      const before = await auditCount();
      // Random text does not compress, so its stored size is its length.
      const big = JSON.stringify({ pad: Array.from({ length: 2500 }, () => Math.random().toString(36).slice(2, 10)).join("") });
      await expect(client.query("select hq.log_event('proposal.submit', null, null, 'denied', $1::jsonb, null)", [big])).rejects.toMatchObject({ code: "23514" });
      expect(await auditCount()).toBe(before);
      await client.query("select hq.log_event('proposal.submit', null, null, 'denied', $1::jsonb, null)", [JSON.stringify({ pad: "small" })]);
      expect(await auditCount()).toBe(before + 1);
    } finally {
      await client.end();
    }
  });
});

describe("D5 — audit() in the application uses the wrappers", () => {
  it("an allowed use goes through log_access and a refusal through log_refusal", async () => {
    await audit(claimsFor(w.claude), { action: "api.whoami", outcome: "allowed", requestId: "app-allowed-1" });
    expect(await lastAudit()).toMatchObject({ principal_handle: "claude", action: "api.whoami", outcome: "allowed", request_id: "app-allowed-1" });

    await audit(null, { action: "session.sign_in", objectType: "principal", objectId: "founder", outcome: "denied", detail: { reason: "wrong passphrase" } });
    expect(await lastAudit()).toMatchObject({ principal_id: null, action: "session.sign_in", object_id: "founder", outcome: "denied", detail: { reason: "wrong passphrase" } });
  });

  it("an oversized detail is shortened rather than lost, so the refusal is still recorded", async () => {
    const before = await auditCount();
    await audit(claimsFor(w.claude), { action: "proposal.submit", outcome: "denied", detail: { unverified_quotations: Array.from({ length: 500 }, (_, i) => `quotation ${i} `.repeat(20)) } });
    expect(await auditCount()).toBe(before + 1);
    const row = await lastAudit();
    expect(row).toMatchObject({ principal_handle: "claude", outcome: "denied", detail: { truncated: true } });
    expect((row.detail as { original_bytes: number }).original_bytes).toBeGreaterThan(8192);
    expect(typeof (row.detail as { preview: string }).preview).toBe("string");
  });

  it("an 'allowed' audit without a signed-in principal records nothing (it is not an access)", async () => {
    const before = await auditCount();
    await audit(null, { action: "api.whoami", outcome: "allowed" });
    expect(await auditCount()).toBe(before);
  });
});

describe("D5 / db-8 — refusals raised inside the database leave no audit row, by design", () => {
  it("calling the database directly as a non-founder or without the propose scope is refused, and the audit log is unchanged", async () => {
    const before = await auditCount();
    const payload = JSON.stringify({ op: "update", set: { interpretation: "x" } });
    const submit = "select hq.submit_proposal('change_proposal', 'requirement', 'FR-FX-004', 1, 1, 'Direct', 'Direct call.', $1::jsonb)";
    await expect(asAppRole("authenticated", claimsFor(w.claude), (c) => c.query("select hq.review_proposal($1, 'accept', null)", [proposal]))).rejects.toMatchObject({ code: "HQ403" });
    await expect(asAppRole("authenticated", claimsFor(w.reader), (c) => c.query(submit, [payload]))).rejects.toMatchObject({ code: "HQ403" });
    await expect(asAppRole("authenticated", claimsFor(w.claudeReadOnly), (c) => c.query(submit, [payload]))).rejects.toMatchObject({ code: "HQ403" });
    expect(await auditCount()).toBe(before);
  });
});
