/**
 * D6 — a proposal's history is a valid state machine (db-3, db-7, db-8; append-only half of tests-5).
 *
 *   * withdraw and accept are serialised on the dataset write lock, in both orders, with two real
 *     connections; the event trigger refuses any event after a closing one, even from a writer that
 *     skips the lock;
 *   * withdraw_proposal checks the caller as submit_proposal does (active principal, propose scope);
 *   * proposal_status tells nothing to callers who cannot see the proposal.
 */
import pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { claimsFor, type Principal } from "@/lib/auth/principal";
import { submitChangeProposal, withdrawProposal } from "@/lib/server/services";
import { getDataset } from "@/lib/server/store";
import { admin, asAppRole, freshWorld, type TestWorld } from "../helpers/db";
import { TEST_APP_URL } from "../helpers/env";

let w: TestWorld;
beforeAll(async () => {
  w = await freshWorld();
});

const idOf = (result: { proposal: unknown }) => (result.proposal as { id: string }).id;

async function propose(who: Principal, requirement: string, interpretation: string): Promise<string> {
  const ctx = await getDataset(w.founder);
  return idOf(
    await submitChangeProposal(who, {
      title: `Interpretation of ${requirement}`,
      rationale: "Test proposal.",
      base_rev: ctx.head,
      target: { type: "requirement", id: requirement, base_version: ctx.ds.get("requirement", requirement)!.meta.version },
      set: { interpretation },
    }),
  );
}

/** What the owner sees: the event list, the status and the record versions that came from this proposal. */
async function history(id: string) {
  const client = await admin();
  try {
    const events = (await client.query<{ event: string }>("select event from hq.proposal_events where proposal_id = $1 order by id", [id])).rows.map((r) => r.event);
    const status = (await client.query<{ s: string }>("select hq._proposal_status($1) as s", [id])).rows[0].s;
    const applied = (await client.query<{ record_id: string; version: number }>("select record_id, version from hq.record_versions where proposal_id = $1", [id])).rows;
    return { events, status, applied };
  } finally {
    await client.end();
  }
}

/** An application-role connection with an open transaction, as the given principal. */
async function openSession(who: Principal): Promise<{ client: pg.Client; pid: number }> {
  const client = new pg.Client({ connectionString: TEST_APP_URL });
  await client.connect();
  await client.query("begin");
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claimsFor(who))]);
  const pid = (await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
  return { client, pid };
}

async function close(session: { client: pg.Client }) {
  await session.client.query("rollback").catch(() => undefined);
  await session.client.end();
}

/** Resolves "blocked" once the backend waits on a lock, or "finished" if the call completed first. */
async function blockedOrFinished(pid: number, call: Promise<unknown>): Promise<"blocked" | "finished"> {
  let settled = false;
  call.then(
    () => (settled = true),
    () => (settled = true),
  );
  const watcher = await admin();
  try {
    for (let i = 0; i < 100; i++) {
      if (settled) return "finished";
      const row = await watcher.query<{ w: string | null }>("select wait_event_type as w from pg_stat_activity where pid = $1", [pid]);
      if (row.rows[0]?.w === "Lock") return "blocked";
      await new Promise((r) => setTimeout(r, 50));
    }
    return settled ? "finished" : "blocked";
  } finally {
    await watcher.end();
  }
}

describe("D6 / db-3 — withdraw and accept cannot both succeed", () => {
  it("accept in flight, then withdraw: the withdraw waits, then is refused (HQ409); the proposal is accepted and applied", async () => {
    const id = await propose(w.claude, "FR-FX-002", "Accept first.");
    const founder = await openSession(w.founder);
    const claude = await openSession(w.claude);
    try {
      const accepted = (await founder.client.query("select hq.review_proposal($1, 'accept', null) as r", [id])).rows[0].r;
      expect(accepted).toMatchObject({ record_id: "FR-FX-002" });

      const withdraw = claude.client.query("select hq.withdraw_proposal($1, 'never mind') as r", [id]);
      const outcome = expect(withdraw).rejects.toMatchObject({ code: "HQ409", message: expect.stringMatching(/is accepted and can no longer be withdrawn/) });
      expect(await blockedOrFinished(claude.pid, withdraw)).toBe("blocked");
      await founder.client.query("commit");
      await outcome;
    } finally {
      await close(founder);
      await close(claude);
    }
    const h = await history(id);
    expect(h.events).toEqual(["submitted", "accepted"]);
    expect(h.status).toBe("accepted");
    expect(h.applied).toHaveLength(1);
    expect((await getDataset(w.founder)).ds.get("requirement", "FR-FX-002")!.meta.proposal_id).toBe(id);
  });

  it("withdraw in flight, then accept: the accept waits, then is refused (HQ409); nothing is applied", async () => {
    const id = await propose(w.claude, "FR-FX-003", "Withdraw first.");
    const headBefore = (await getDataset(w.founder)).head;
    const founder = await openSession(w.founder);
    const claude = await openSession(w.claude);
    try {
      await claude.client.query("select hq.withdraw_proposal($1, 'never mind') as r", [id]);

      const accept = founder.client.query("select hq.review_proposal($1, 'accept', null) as r", [id]);
      const outcome = expect(accept).rejects.toMatchObject({ code: "HQ409", message: expect.stringMatching(/is already withdrawn and cannot be reviewed again/) });
      expect(await blockedOrFinished(founder.pid, accept)).toBe("blocked");
      await claude.client.query("commit");
      await outcome;
    } finally {
      await close(founder);
      await close(claude);
    }
    const h = await history(id);
    expect(h.events).toEqual(["submitted", "withdrawn"]);
    expect(h.status).toBe("withdrawn");
    expect(h.applied).toEqual([]);
    expect((await getDataset(w.founder)).head).toBe(headBefore);
  });

  it("the event trigger alone serialises two writers that skip the lock: the second is refused once the first commits", async () => {
    const id = await propose(w.chatgpt, "FR-FX-004", "Two writers.");
    const first = await admin();
    const second = await admin();
    try {
      await first.query("begin");
      await second.query("begin");
      await first.query("insert into hq.proposal_events (proposal_id, event, actor) values ($1, 'rejected', $2)", [id, w.founder.id]);
      const secondPid = (await second.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
      const late = second.query("insert into hq.proposal_events (proposal_id, event, actor) values ($1, 'withdrawn', $2)", [id, w.chatgpt.id]);
      const outcome = expect(late).rejects.toMatchObject({ code: "HQ409", message: expect.stringMatching(/is rejected and cannot also be withdrawn/) });
      expect(await blockedOrFinished(secondPid, late)).toBe("blocked");
      await first.query("commit");
      await outcome;
    } finally {
      await second.query("rollback").catch(() => undefined);
      await first.end();
      await second.end();
    }
    expect((await history(id)).events).toEqual(["submitted", "rejected"]);
  });

  it("the owner cannot append an event after a closing one, nor a second 'submitted' (HQ409)", async () => {
    const id = await propose(w.claude, "FR-FX-002", "Closed.");
    await withdrawProposal(w.claude, id);
    const client = await admin();
    try {
      for (const event of ["accepted", "rejected", "needs_changes", "withdrawn", "marked_stale", "submitted"]) {
        await expect(
          client.query("insert into hq.proposal_events (proposal_id, event, actor) values ($1, $2, $3)", [id, event, w.founder.id]),
          event,
        ).rejects.toMatchObject({ code: "HQ409" });
      }
    } finally {
      await client.end();
    }
    expect((await history(id)).events).toEqual(["submitted", "withdrawn"]);
  });
});

describe("D6 / db-8 — withdraw_proposal checks the caller", () => {
  it("a token without the propose scope cannot withdraw, even its principal's own proposal (HQ403)", async () => {
    const id = await propose(w.claude, "FR-FX-003", "Scope check.");
    await expect(
      asAppRole("authenticated", claimsFor(w.claudeReadOnly), (c) => c.query("select hq.withdraw_proposal($1)", [id])),
    ).rejects.toMatchObject({ code: "HQ403", message: expect.stringMatching(/"propose" scope/) });
    expect((await history(id)).events).toEqual(["submitted"]);
  });

  it("an inactive principal cannot withdraw (HQ401)", async () => {
    const id = await propose(w.claude, "FR-FX-004", "Active check.");
    const client = await admin();
    try {
      await client.query("update hq.principals set active = false where handle = 'claude'");
      await expect(asAppRole("authenticated", claimsFor(w.claude), (c) => c.query("select hq.withdraw_proposal($1)", [id]))).rejects.toMatchObject({ code: "HQ401" });
    } finally {
      await client.query("update hq.principals set active = true where handle = 'claude'");
      await client.end();
    }
    expect((await history(id)).events).toEqual(["submitted"]);
  });

  it("a principal whose role was lowered to reader cannot withdraw a proposal it made before (HQ403)", async () => {
    const id = await propose(w.developer, "FR-FX-001", "Role check.");
    const client = await admin();
    try {
      await client.query("update hq.principals set app_role = 'reader' where handle = 'developer'");
      await expect(asAppRole("authenticated", claimsFor(w.developer), (c) => c.query("select hq.withdraw_proposal($1)", [id]))).rejects.toMatchObject({
        code: "HQ403",
        message: expect.stringMatching(/role "reader" may not withdraw proposals/),
      });
    } finally {
      await client.query("update hq.principals set app_role = 'developer' where handle = 'developer'");
      await client.end();
    }
    expect((await history(id)).events).toEqual(["submitted"]);
  });

  it("another principal cannot withdraw it (HQ404), and the submitter still can", async () => {
    const id = await propose(w.claude, "FR-FX-002", "Ownership check.");
    for (const who of [w.chatgpt, w.developer]) {
      await expect(asAppRole("authenticated", claimsFor(who), (c) => c.query("select hq.withdraw_proposal($1)", [id]))).rejects.toMatchObject({ code: "HQ404" });
    }
    expect((await history(id)).events).toEqual(["submitted"]);
    await withdrawProposal(w.claude, id);
    expect((await history(id)).events).toEqual(["submitted", "withdrawn"]);
  });
});

describe("D6 / db-7 — proposal_status reveals nothing about proposals the caller cannot see", () => {
  const status = (claims: object, id: string) =>
    asAppRole("authenticated", claims, async (c) => (await c.query<{ s: string | null }>("select hq.proposal_status($1) as s", [id])).rows[0].s);

  it("only the submitter and the founder's session get an answer; everyone else gets null, as for a proposal that does not exist", async () => {
    const open = await propose(w.claude, "FR-FX-003", "Status check.");
    const withdrawn = await propose(w.claude, "FR-FX-004", "Status check, withdrawn.");
    await withdrawProposal(w.claude, withdrawn);

    for (const [id, expected] of [[open, "submitted"], [withdrawn, "withdrawn"]] as const) {
      expect(await status(claimsFor(w.claude), id)).toBe(expected);
      expect(await status(claimsFor(w.founder), id)).toBe(expected);
      for (const claims of [claimsFor(w.chatgpt), claimsFor(w.developer), claimsFor(w.reader), {}, { ...claimsFor(w.founder), amr: "api_token" }]) {
        expect(await status(claims, id), JSON.stringify(claims)).toBeNull();
      }
    }
    expect(await status(claimsFor(w.claude), "PROP-999999")).toBeNull();

    const client = await admin();
    try {
      await client.query("begin");
      await client.query("set local role service_role");
      // F3: service_role no longer calls any function but the read helpers.
      await expect(client.query("select hq.proposal_status($1) as s", [open])).rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  });
});
