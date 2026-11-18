import { beforeAll, describe, expect, it } from "vitest";
import { getProposal, getRecord, listProposals, reviewProposal, submitChangeProposal, withdrawProposal } from "@/lib/server/services";
import { getDataset } from "@/lib/server/store";
import { admin, expectStatus, freshWorld, type TestWorld } from "../helpers/db";

let w: TestWorld;
beforeAll(async () => {
  w = await freshWorld();
});

const change = (interpretation: string, baseVersion = 1, extra: Record<string, unknown> = {}) => ({
  title: `Interpretation: ${interpretation}`,
  rationale: "Test proposal.",
  base_rev: 1,
  target: { type: "requirement", id: "FR-FX-002", base_version: baseVersion },
  set: { interpretation },
  ...extra,
});
const idOf = (result: { proposal: unknown }) => (result.proposal as { id: string }).id;

describe("AC6 — stale and conflicting writes are rejected explicitly", () => {
  it("refuses a proposal written against a version that is no longer current", async () => {
    const err = await expectStatus(submitChangeProposal(w.claude, change("x", 7)), 409);
    expect(err.code).toBe("conflict");
    expect(err.message).toMatch(/Stale revision/);
    expect(err.detail).toMatchObject({ current_version: 1, base_version: 7 });
    expect(await listProposals(w.claude)).toHaveLength(0);
  });

  it("refuses a proposal that cites a dataset revision that does not exist yet", async () => {
    const err = await expectStatus(submitChangeProposal(w.claude, { ...change("x"), base_rev: 42 }), 422);
    expect(err.message).toMatch(/not a known dataset revision/);
  });

  it("when two clients propose against the same version, the second acceptance is refused and marked stale", async () => {
    const first = idOf(await submitChangeProposal(w.claude, change("Claude's reading")));
    const second = idOf(await submitChangeProposal(w.chatgpt, change("ChatGPT's reading")));

    const accepted = await reviewProposal(w.founder, first, "accept", "Agreed.");
    expect(accepted).toMatchObject({ resulting_rev: 2, record_id: "FR-FX-002", version: 2 });

    const err = await expectStatus(reviewProposal(w.founder, second, "accept"), 409);
    expect(err.message).toMatch(/stale/i);
    expect(err.detail).toMatchObject({ proposal_id: second, base_version: 1, current_version: 2, marked: "stale" });

    // The conflict is on the record: the proposal is marked stale, and the record kept the first change only.
    const stale = await getProposal(w.chatgpt, second);
    expect(stale.status).toBe("marked_stale");
    expect(stale.events.map((e) => e.event)).toEqual(["submitted", "marked_stale"]);
    const record = await getRecord(w.claude, "requirement", "FR-FX-002");
    expect((record.data.record as { interpretation: string }).interpretation).toBe("Claude's reading");
    expect(record.data.meta.version).toBe(2);
    expect((await getDataset(w.founder)).head).toBe(2);
  });

  it("a stale proposal cannot be reviewed again", async () => {
    const [stale] = (await listProposals(w.founder)).filter((p) => p.status === "marked_stale");
    const err = await expectStatus(reviewProposal(w.founder, stale.id, "accept"), 409);
    expect(err.message).toMatch(/already marked_stale/);
  });

  it("a proposal re-read against the current version is accepted", async () => {
    const id = idOf(await submitChangeProposal(w.chatgpt, { ...change("ChatGPT's reading, rebased", 2), base_rev: 2 }));
    const accepted = await reviewProposal(w.founder, id, "accept");
    expect(accepted).toMatchObject({ resulting_rev: 3, version: 3 });
  });

  it("resubmitting with the same idempotency key returns the first proposal instead of a duplicate", async () => {
    const body = { ...change("Idempotent", 3), base_rev: 3, idempotency_key: "retry-key-0001" };
    const a = await submitChangeProposal(w.claude, body);
    const b = await submitChangeProposal(w.claude, body);
    expect(idOf(b)).toBe(idOf(a));
    expect((b.proposal as { idempotent_replay?: boolean }).idempotent_replay).toBe(true);
    expect((await listProposals(w.claude)).filter((p) => p.title === "Interpretation: Idempotent")).toHaveLength(1);
    await withdrawProposal(w.claude, idOf(a));
    expect((await getProposal(w.claude, idOf(a))).status).toBe("withdrawn");
  });

  it("an accepted or rejected proposal cannot be reviewed twice", async () => {
    const id = idOf(await submitChangeProposal(w.claude, { ...change("To be rejected", 3), base_rev: 3 }));
    await reviewProposal(w.founder, id, "reject", "Not needed.");
    await expectStatus(reviewProposal(w.founder, id, "accept"), 409);
    const record = await getRecord(w.claude, "requirement", "FR-FX-002");
    expect(record.data.meta.version).toBe(3);
  });

  it("a proposal that would make the record invalid is refused before it reaches the inbox", async () => {
    const err = await expectStatus(
      submitChangeProposal(w.claude, { title: "Bad category", rationale: "x x x", base_rev: 3, target: { type: "requirement", id: "FR-FX-002", base_version: 3 }, set: { category: "astrology" } }),
      422,
    );
    expect(err.message).toMatch(/would make FR-FX-002 invalid/);
  });

  it("revision numbers are gapless and every revision is sealed with a hash", async () => {
    const client = await admin();
    try {
      const rows = await client.query<{ rev: string; parent_rev: string | null; content_hash: string }>(
        "select rev, parent_rev, content_hash from hq.dataset_revisions order by rev",
      );
      expect(rows.rows.map((r) => Number(r.rev))).toEqual([1, 2, 3]);
      expect(rows.rows.map((r) => (r.parent_rev === null ? null : Number(r.parent_rev)))).toEqual([null, 1, 2]);
      expect(rows.rows.every((r) => /^[0-9a-f]{64}$/.test(r.content_hash))).toBe(true);
      expect(new Set(rows.rows.map((r) => r.content_hash)).size).toBe(3);
    } finally {
      await client.end();
    }
  });
});
