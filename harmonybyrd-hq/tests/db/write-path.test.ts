/**
 * D3 — the write path (db-4, and the trigger-level half of tests-3).
 *
 * The write context used to be a setting any session could set, and the sealing trigger accepted any
 * existing revision, sealed or not. Now the context is a row _begin_revision writes for the current
 * transaction, versions can only go into the open, latest, unsealed revision by its author, and
 * service_role can no longer write any table or call the internal primitives.
 *
 * Every forging attempt below runs on a real connection: the owner, the owner after SET ROLE
 * service_role, or the application role. Each one asserts the exact SQLSTATE and that nothing changed.
 */
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { recordFounderDecision, reviewProposal, submitChangeProposal } from "@/lib/server/services";
import { chainProblems, getDataset } from "@/lib/server/store";
import { admin, freshWorld, type TestWorld, worldState } from "../helpers/db";

let w: TestWorld;
const ids: Record<string, string> = {};

beforeAll(async () => {
  w = await freshWorld();
  const client = await admin();
  try {
    for (const row of (await client.query<{ handle: string; id: string }>("select handle, id from hq.principals")).rows) ids[row.handle] = row.id;
  } finally {
    await client.end();
  }
});

/** Run fn on the owner connection inside a transaction that is always rolled back. */
async function ownerTx<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = await admin();
  try {
    await client.query("begin");
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

/** Every sealed revision still hashes to its seal (the pinned reads have not changed). */
async function sealsHold(): Promise<boolean> {
  const client = await admin();
  try {
    const rows = await client.query<{ ok: boolean }>(
      "select content_hash = hq.dataset_hash(rev) as ok from hq.dataset_revisions where content_hash is not null",
    );
    return rows.rowCount! > 0 && rows.rows.every((r) => r.ok);
  } finally {
    await client.end();
  }
}

const insertVersion = (c: pg.Client, v: { type: string; id: string; data: object; rev: number | string; by: string; origin: string }) =>
  c.query(
    `insert into hq.record_versions (record_type, record_id, version, rev, data, content_hash, row_hash, created_by, origin)
     values ($1, $2, 1, $3, $4::jsonb, '', '', $5, $6)`,
    [v.type, v.id, v.rev, JSON.stringify(v.data), v.by, v.origin],
  );

const forgedAcceptance = () => ({
  type: "module",
  id: "MOD-FX-GAMMA",
  data: { id: "MOD-FX-GAMMA", title: "Gamma", hq_acceptance: { state: "accepted", decision_id: "FD-HQ-0999", decided_by: "founder" } },
});
const forgedDecision = () => ({
  type: "decision",
  id: "FD-HQ-0999",
  data: { id: "FD-HQ-0999", title: "Forged", status: "issued", recorded_in: "hq", decided_by: "founder" },
});

describe("D3 — service_role cannot write history or forge a founder act", () => {
  it("as the owner after SET ROLE service_role, with the old context setting forged, every direct write is refused (42501)", async () => {
    const before = await worldState();
    const attempts: [string, (c: pg.Client) => Promise<unknown>][] = [
      ["forged founder acceptance", (c) => insertVersion(c, { ...forgedAcceptance(), rev: 1, by: ids.founder, origin: "founder_decision" })],
      ["forged HQ decision", (c) => insertVersion(c, { ...forgedDecision(), rev: 1, by: ids.founder, origin: "founder_decision" })],
      ["new revision row", (c) => c.query("insert into hq.dataset_revisions (rev, parent_rev, kind, summary, created_by) values (99, 1, 'founder_decision', 'Forged revision', $1)", [ids.founder])],
      ["proposal event", (c) => c.query("insert into hq.proposal_events (proposal_id, event, actor) values ('PROP-000001', 'accepted', $1)", [ids.founder])],
      ["audit row", (c) => c.query("insert into hq.audit_log (action, outcome) values ('decision.record', 'allowed')")],
      ["principal promotion", (c) => c.query("update hq.principals set app_role = 'founder' where handle = 'developer'")],
      ["id counter", (c) => c.query("insert into hq.id_counters (prefix, n) values ('FD-HQ-', 998)")],
      ["_begin_revision", (c) => c.query("select hq._begin_revision('founder_decision', 'Forged revision', null, $1)", [ids.founder])],
      ["_append_record", (c) => c.query("select hq._append_record('module', 'MOD-FX-GAMMA', '{\"id\":\"MOD-FX-GAMMA\"}'::jsonb, false, 1, $1, 'founder_decision', null)", [ids.founder])],
      ["_seal_revision", (c) => c.query("select hq._seal_revision(1)")],
      ["_next_id", (c) => c.query("select hq._next_id('FD-HQ-', 4)")],
      ["admin_put_records", (c) => c.query("select hq.admin_put_records('[]'::jsonb, 'Import as service', null, 'hq-import', false)")],
      ["admin_put_source_texts", (c) => c.query("select hq.admin_put_source_texts('[]'::jsonb)")],
      ["log_event", (c) => c.query("select hq.log_event('decision.record', 'decision', 'FD-HQ-0999', 'allowed', null, null)")],
    ];
    for (const [what, attempt] of attempts) {
      await expect(
        ownerTx(async (c) => {
          await c.query("set local role service_role");
          await c.query("select set_config('hq.write_context', 'founder_decision', true)");
          return attempt(c);
        }),
        what,
      ).rejects.toMatchObject({ code: "42501" });
    }
    expect(await worldState()).toEqual(before);
    expect(await sealsHold()).toBe(true);
  });

  it("service_role can still read (it keeps SELECT and bypasses row-level security, as on Supabase)", async () => {
    const n = await ownerTx(async (c) => {
      await c.query("set local role service_role");
      return (await c.query<{ n: number }>("select count(*)::int as n from hq.record_versions")).rows[0].n;
    });
    expect(n).toBeGreaterThan(0);
  });
});

describe("D3 — the sealing trigger no longer trusts a setting, and sealed revisions are final", () => {
  it("the old context setting no longer authorises anything: a forged founder acceptance into an unsealed latest revision is refused (HQ403)", async () => {
    const before = await worldState();
    for (const forged of [forgedAcceptance(), forgedDecision()]) {
      await expect(
        ownerTx(async (c) => {
          // An unsealed latest revision created by hand (not through _begin_revision), and the old setting.
          await c.query("insert into hq.dataset_revisions (rev, parent_rev, kind, summary, created_by) values (hq.head_rev() + 1, hq.head_rev(), 'founder_decision', 'Forged revision', $1)", [ids.founder]);
          await c.query("select set_config('hq.write_context', 'founder_decision', true)");
          return insertVersion(c, { ...forged, rev: before.head + 1, by: ids.founder, origin: "founder_decision" });
        }),
        forged.id,
      ).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(/founder_decision records can only be written by hq.record_founder_decision/) });
    }
    expect(await worldState()).toEqual(before);
  });

  it("a version cannot be added to a sealed revision, directly or through _append_record, even with the old setting (HQ403)", async () => {
    const before = await worldState();
    await expect(
      ownerTx(async (c) => {
        await c.query("select set_config('hq.write_context', 'founder_decision', true)");
        return insertVersion(c, { ...forgedAcceptance(), rev: 1, by: ids.founder, origin: "founder_decision" });
      }),
    ).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(/dataset revision 1 is sealed/) });
    await expect(
      ownerTx(async (c) => {
        await c.query("select set_config('hq.write_context', 'admin_import', true)");
        return c.query("select hq._append_record('requirement', 'FR-FX-NEW', '{\"id\":\"FR-FX-NEW\"}'::jsonb, false, 1, $1, 'seed_import', null)", [ids["hq-import"]]);
      }),
    ).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(/dataset revision 1 is sealed/) });
    expect(await worldState()).toEqual(before);
    expect(await sealsHold()).toBe(true);
  });

  it("Rule 1: an origin is refused unless this transaction opened a revision for it", async () => {
    const cases: [string, string, string, RegExp][] = [
      ["seed_import", "hq-import", "founder_decision", /founder_decision records can only be written by hq.record_founder_decision/],
      ["seed_import", "hq-import", "proposal_acceptance", /proposal_acceptance records can only be written by hq.review_proposal/],
      ["founder_decision", "founder", "seed_import", /seed_import records can only be written by the administrative import function/],
      ["proposal_acceptance", "founder", "founder_decision", /founder_decision records can only be written by hq.record_founder_decision/],
    ];
    for (const [kind, author, origin, message] of cases) {
      await expect(
        ownerTx(async (c) => {
          const rev = (await c.query<{ r: string }>("select hq._begin_revision($1, 'Rule 1 case', null, $2) as r", [kind, ids[author]])).rows[0].r;
          return c.query("select hq._append_record('open_item', 'OPEN-FX-R1', '{\"id\":\"OPEN-FX-R1\"}'::jsonb, false, $1, $2, $3, null)", [rev, ids[author], origin]);
        }),
        `${origin} in a ${kind} revision`,
      ).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(message) });
    }
  });

  it("a version must be written by the author of the revision it goes into", async () => {
    await expect(
      ownerTx(async (c) => {
        const rev = (await c.query<{ r: string }>("select hq._begin_revision('seed_import', 'Import', null, $1) as r", [ids["hq-import"]])).rows[0].r;
        return c.query("select hq._append_record('open_item', 'OPEN-FX-AU', '{\"id\":\"OPEN-FX-AU\"}'::jsonb, false, $1, $2, 'seed_import', null)", [rev, ids.founder]);
      }),
    ).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(/by that revision's author/) });
  });

  it("Rule 2: a founder-decision revision opened for a developer or an AI client cannot write anything", async () => {
    for (const who of ["developer", "claude"]) {
      await expect(
        ownerTx(async (c) => {
          const rev = (await c.query<{ r: string }>("select hq._begin_revision('founder_decision', 'Rule 2 case', null, $1) as r", [ids[who]])).rows[0].r;
          return c.query("select hq._append_record('open_item', 'OPEN-FX-R2', '{\"id\":\"OPEN-FX-R2\"}'::jsonb, false, $1, $2, 'founder_decision', null)", [rev, ids[who]]);
        }),
        who,
      ).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(/only an active human founder can author founder_decision records/) });
    }
  });

  it("Rules 3 and 4: an import cannot carry an HQ acceptance or an HQ-recorded decision, even below admin_put_records' own check", async () => {
    const cases: [string, string, object, RegExp][] = [
      ["build", "BLD-FX-NEW", { id: "BLD-FX-NEW", hq_acceptance: { state: "accepted" } }, /hq_acceptance can only be set by a recorded founder decision/],
      ["decision", "DEC-FX-NEW", { id: "DEC-FX-NEW", recorded_in: "hq" }, /decisions recorded in HQ can only be written by hq.record_founder_decision/],
    ];
    for (const [type, id, data, message] of cases) {
      await expect(
        ownerTx(async (c) => {
          const rev = (await c.query<{ r: string }>("select hq._begin_revision('seed_import', 'Rule 3/4 case', null, $1) as r", [ids["hq-import"]])).rows[0].r;
          return c.query("select hq._append_record($1, $2, $3::jsonb, false, $4, $5, 'seed_import', null)", [type, id, JSON.stringify(data), rev, ids["hq-import"]]);
        }),
        id,
      ).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(message) });
    }
  });

  it("Rule 6: a requirement's locator and source date are as permanent as its wording", async () => {
    const client = await admin();
    try {
      const current = (await client.query("select data from hq.record_versions where record_id = 'FR-FX-002' order by version desc limit 1")).rows[0].data;
      for (const [field, value] of [["locator", "p. 999"], ["source_date", "1999-01-01"]] as const) {
        await expect(
          client.query("select hq.admin_put_records($1::jsonb, 'rewrite attempt', null, 'hq-import', false)", [
            JSON.stringify([{ type: "requirement", id: "FR-FX-002", data: { ...current, [field]: value } }]),
          ]),
          field,
        ).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(new RegExp(`requirement field "${field}" is immutable`)) });
      }
    } finally {
      await client.end();
    }
  });

  it("a transaction can open only one revision, and cannot commit one it did not seal (HQ409)", async () => {
    const before = await worldState();
    await expect(
      ownerTx(async (c) => {
        await c.query("select hq._begin_revision('seed_import', 'First', null, $1)", [ids["hq-import"]]);
        return c.query("select hq._begin_revision('seed_import', 'Second', null, $1)", [ids["hq-import"]]);
      }),
    ).rejects.toMatchObject({ code: "HQ409", message: expect.stringMatching(/already open in this transaction/) });

    const client = await admin();
    try {
      await client.query("begin");
      await client.query("select hq._begin_revision('seed_import', 'Left open', null, $1)", [ids["hq-import"]]);
      await expect(client.query("commit")).rejects.toMatchObject({ code: "HQ409", message: expect.stringMatching(/opened but not sealed/) });
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
    expect(await worldState()).toEqual(before);
  });
});

describe("D3 — the legitimate write paths still work", () => {
  it("an import on the owner connection, an accepted proposal and a founder decision each write one sealed, chained revision", async () => {
    const start = (await getDataset(w.founder)).head;
    const client = await admin();
    try {
      const current = (await client.query("select data from hq.record_versions where record_id = 'DEF-FX-01' order by version desc limit 1")).rows[0].data;
      const imported = (
        await client.query("select hq.admin_put_records($1::jsonb, 'Re-import with a corrected title', null, 'hq-import', false) as r", [
          JSON.stringify([{ type: "defect", id: "DEF-FX-01", data: { ...current, title: `${current.title} (corrected)` } }]),
        ])
      ).rows[0].r;
      expect(imported).toMatchObject({ rev: start + 1, changed: 1 });
    } finally {
      await client.end();
    }

    const submitted = await submitChangeProposal(w.claude, {
      title: "Interpretation for FR-FX-003",
      rationale: "Clarifies scope.",
      base_rev: start + 1,
      target: { type: "requirement", id: "FR-FX-003", base_version: 1 },
      set: { interpretation: "Applies to the main screen." },
    });
    expect(await reviewProposal(w.founder, (submitted.proposal as { id: string }).id, "accept")).toMatchObject({ resulting_rev: start + 2 });
    expect(await recordFounderDecision(w.founder, { title: "Noted", exact_text: "I have read the write-path tests." })).toMatchObject({ rev: start + 3 });

    const check = await admin();
    try {
      const revs = (
        await check.query<{ rev: string; sealed: boolean; seal_ok: boolean; open: number }>(
          `select d.rev, d.content_hash = hq.dataset_hash(d.rev) as sealed, d.seal_hash is not null as seal_ok,
                  (select count(*)::int from hq._write_context) as open
             from hq.dataset_revisions d order by d.rev`,
        )
      ).rows;
      expect(revs.map((r) => Number(r.rev))).toEqual(Array.from({ length: start + 3 }, (_, i) => i + 1));
      expect(revs.every((r) => r.sealed && r.seal_ok && r.open === 0)).toBe(true);
    } finally {
      await check.end();
    }
    expect(await chainProblems(w.founder)).toEqual([]);
  });
});
