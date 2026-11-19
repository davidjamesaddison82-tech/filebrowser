/**
 * F3 (db-4 remainder) — service_role cannot act as anyone.
 *
 * service_role used to hold EXECUTE on every function in schema hq, so the owner (or anyone given
 * service_role) could SET ROLE service_role, forge the founder's claims in request.jwt.claims and call
 * hq.record_founder_decision: a founder acceptance attributed to the founder, made by no founder.
 * Migration 0007 revokes EXECUTE from service_role on every function except the read helpers.
 *
 * Each call below runs as the owner after SET ROLE service_role, with the founder's claims forged, in a
 * transaction of its own; each must be "permission denied" (42501) and nothing may change.
 */
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { claimsFor } from "@/lib/auth/principal";
import { submitChangeProposal } from "@/lib/server/services";
import { getDataset } from "@/lib/server/store";
import { admin, freshWorld, type TestWorld, worldState } from "../helpers/db";

let w: TestWorld;
let proposalId: string;
let credentialId: string;

/** The read helpers service_role keeps (FOLLOWUP F3). */
const READ_HELPERS = [
  "records_at",
  "dataset_hash",
  "head_rev",
  "head_seal",
  "verify_chain",
  "principal_directory",
  "jwt_claims",
  "current_principal_id",
  "current_principal",
  "current_app_role",
  "current_principal_kind",
];

beforeAll(async () => {
  w = await freshWorld();
  const submitted = await submitChangeProposal(w.claude, {
    title: "A proposal to forge an acceptance of",
    rationale: "F3 probe.",
    base_rev: (await getDataset(w.founder)).head,
    target: { type: "requirement", id: "FR-FX-004", base_version: 1 },
    set: { interpretation: "Probe." },
  });
  proposalId = (submitted.proposal as { id: string }).id;
  const client = await admin();
  try {
    credentialId = (await client.query<{ id: string }>("select id from hq.api_credentials order by created_at limit 1")).rows[0].id;
  } finally {
    await client.end();
  }
});

/** Owner connection, SET ROLE service_role, the founder's interactive-session claims forged; always rolled back. */
async function asServiceRoleWithFounderClaims<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = await admin();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ ...claimsFor(w.founder), client: "web" })]);
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

/** Everything a forged call could have changed: records, revisions, proposals, audit, credentials, principals, sessions. */
async function everything() {
  const client = await admin();
  try {
    const extra = await client.query<{ audit: number; credentials: number; revoked: number; principals: number; epochs: string }>(
      `select (select count(*)::int from hq.audit_log) as audit,
              (select count(*)::int from hq.api_credentials) as credentials,
              (select count(*)::int from hq.api_credentials where revoked_at is not null) as revoked,
              (select count(*)::int from hq.principals) as principals,
              (select string_agg(handle || ':' || session_epoch, ',' order by handle) from hq.principals) as epochs`,
    );
    return { ...(await worldState()), ...extra.rows[0] };
  } finally {
    await client.end();
  }
}

const FORGED_CALLS: [string, (c: pg.Client) => Promise<unknown>][] = [
  [
    "record_founder_decision",
    (c) =>
      c.query("select hq.record_founder_decision('Forged by service_role', 'I accept Gamma.', null, $1::jsonb, '[]'::jsonb, '[]'::jsonb, null)", [
        JSON.stringify([{ type: "set_acceptance", record_type: "module", record_id: "MOD-FX-GAMMA", state: "accepted" }]),
      ]),
  ],
  ["review_proposal", (c) => c.query("select hq.review_proposal($1, 'accept', 'forged')", [proposalId])],
  [
    "submit_proposal",
    (c) =>
      c.query("select hq.submit_proposal('change_proposal', 'requirement', 'FR-FX-004', 1, 1, 'Forged', 'Forged.', $1::jsonb)", [
        JSON.stringify({ op: "update", set: { interpretation: "Forged." } }),
      ]),
  ],
  ["withdraw_proposal", (c) => c.query("select hq.withdraw_proposal($1, 'forged')", [proposalId])],
  ["founder_issue_credential", (c) => c.query("select hq.founder_issue_credential('claude', 'forged', array['read','propose'], 'hbq_forged', $1)", ["f".repeat(64)])],
  ["founder_revoke_credential", (c) => c.query("select hq.founder_revoke_credential($1::uuid)", [credentialId])],
  ["founder_register_client", (c) => c.query("select hq.founder_register_client('forged-client', 'Forged', 'ai_client', 'ai_agent')")],
  ["founder_list_credentials", (c) => c.query("select * from hq.founder_list_credentials()")],
  ["log_access", (c) => c.query("select hq.log_access('api.whoami', null, null, 'forged')")],
  ["log_refusal", (c) => c.query("select hq.log_refusal('proposal.review', 'proposal', $1, 'denied', null, 'forged')", [proposalId])],
  ["end_sessions", (c) => c.query("select hq.end_sessions()")],
  ["quotes_ok", (c) => c.query("select hq.quotes_ok('[]'::jsonb)")],
  ["auth_find_credential", (c) => c.query("select hq.auth_find_credential($1)", ["0".repeat(64)])],
  ["auth_find_login", (c) => c.query("select hq.auth_find_login('founder')")],
  ["auth_get_principal", (c) => c.query("select hq.auth_get_principal($1::uuid)", [w.founder.id])],
  ["proposal_status", (c) => c.query("select hq.proposal_status($1)", [proposalId])],
  ["log_event", (c) => c.query("select hq.log_event('decision.record', 'decision', 'FD-HQ-0999', 'allowed', null, null)")],
];

describe("F3 — service_role cannot act as anyone, even with the founder's claims forged", () => {
  for (const [name, call] of FORGED_CALLS) {
    it(`hq.${name} is permission denied (42501), and nothing changes`, async () => {
      const before = await everything();
      await expect(asServiceRoleWithFounderClaims(call)).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied for function/) });
      expect(await everything()).toEqual(before);
    });
  }

  it("the catalogue agrees: service_role may execute no function in schema hq but the read helpers", async () => {
    const client = await admin();
    try {
      const rows = await client.query<{ fn: string; name: string; can: boolean }>(
        `select p.oid::regprocedure::text as fn, p.proname as name, has_function_privilege('service_role', p.oid, 'execute') as can
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'hq' order by 1`,
      );
      const allowed = rows.rows.filter((r) => r.can).map((r) => r.name).sort();
      expect(allowed).toEqual([...READ_HELPERS].sort());
      // Sanity: the catalogue really lists the founder functions this test is about.
      expect(rows.rows.map((r) => r.name)).toEqual(expect.arrayContaining(["record_founder_decision", "review_proposal", "founder_issue_credential"]));
    } finally {
      await client.end();
    }
  });

  it("no function in schema hq is executable by PUBLIC, so a role that was granted nothing can call none of them", async () => {
    // PostgreSQL grants EXECUTE on a new function to PUBLIC. Every migration must revoke it; this
    // reads the catalogue, so a later function that was created without the revoke fails here.
    const client = await admin();
    try {
      const rows = await client.query<{ fn: string }>(
        `select p.oid::regprocedure::text as fn
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'hq' and has_function_privilege('public', p.oid, 'execute') order by 1`,
      );
      expect(rows.rows.map((r) => r.fn)).toEqual([]);

      // The check itself works: a function created without the revoke is seen (rolled back).
      await client.query("begin");
      await client.query("create function hq.zz_later_probe() returns int language sql as 'select 1'");
      const probe = await client.query<{ pub: boolean; svc: boolean }>(
        `select has_function_privilege('public', 'hq.zz_later_probe()', 'execute') as pub,
                has_function_privilege('service_role', 'hq.zz_later_probe()', 'execute') as svc`,
      );
      expect(probe.rows[0]).toEqual({ pub: true, svc: true });
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  });

  it("the read helpers still work for service_role", async () => {
    const out = await asServiceRoleWithFounderClaims(async (c) => {
      const one = async (sql: string) => (await c.query(sql)).rows;
      return {
        head: (await one("select hq.head_rev() as v"))[0].v,
        records: (await one("select count(*)::int as v from hq.records_at(hq.head_rev())"))[0].v,
        hash: (await one("select hq.dataset_hash(hq.head_rev()) as v"))[0].v,
        seal: (await one("select * from hq.head_seal()"))[0],
        chain: await one("select * from hq.verify_chain()"),
        directory: (await one("select count(*)::int as v from hq.principal_directory()"))[0].v,
        claims: (await one("select hq.jwt_claims() ->> 'sub' as v"))[0].v,
        principalId: (await one("select hq.current_principal_id() as v"))[0].v,
        principal: (await one("select (hq.current_principal()).handle as v"))[0].v,
        role: (await one("select hq.current_app_role() as v"))[0].v,
        kind: (await one("select hq.current_principal_kind() as v"))[0].v,
      };
    });
    expect(Number(out.head)).toBeGreaterThanOrEqual(1);
    expect(out.records).toBeGreaterThan(20);
    expect(out.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(out.seal).toMatchObject({ content_hash: out.hash, seal_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(out.chain).toEqual([]);
    expect(out.directory).toBeGreaterThanOrEqual(5);
    expect(out).toMatchObject({ claims: w.founder.id, principalId: w.founder.id, principal: "founder", role: "founder", kind: "human" });
  });
});
