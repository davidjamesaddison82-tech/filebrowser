/**
 * D4 — what verify_chain detects (db-5, tests-11).
 *
 * Each case tampers as the database owner inside a transaction that is rolled back, with the
 * append-only (and, where needed, seal-once) triggers disabled — the only way history can be changed.
 * Each case asserts the exact problem verify_chain reports. Before migration 0006 verify_chain only
 * compared each version with the one before it, so deleting the newest version of a record, deleting a
 * record, or rewriting a version and its own hashes consistently returned no problem at all.
 */
import { createHash } from "node:crypto";
import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { recordFounderDecision, reviewProposal, submitChangeProposal } from "@/lib/server/services";
import { chainProblems, headSeal } from "@/lib/server/store";
import { admin, freshWorld, type TestWorld } from "../helpers/db";

let w: TestWorld;
type Problem = { record_type: string; record_id: string; version: number; problem: string };

beforeAll(async () => {
  w = await freshWorld();
  // FR-FX-004 gets three versions in revisions 1, 2 and 3.
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

const ROW_HASH = `encode(sha256(convert_to(coalesce(prev_hash, '') || '|' || record_type || '|' || record_id || '|' ||
  version::text || '|' || rev::text || '|' || deleted::text || '|' || content_hash, 'UTF8')), 'hex')`;

/** Tamper as the owner with the history triggers off, return verify_chain's answer, roll everything back. */
async function tampered(tamper: (c: pg.Client) => Promise<unknown>): Promise<Problem[]> {
  const client = await admin();
  try {
    await client.query("begin");
    await client.query("alter table hq.record_versions disable trigger record_versions_append_only");
    await client.query("alter table hq.dataset_revisions disable trigger dataset_revisions_seal_once");
    await tamper(client);
    return (await client.query<Problem>("select record_type, record_id, version, problem from hq.verify_chain()")).rows;
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

const rev = (n: number, problem: string): Problem => ({ record_type: "dataset_revision", record_id: String(n), version: 0, problem });
const perVersion = (problems: Problem[]) => problems.filter((p) => p.record_type !== "dataset_revision");
/** verify_chain gives no order; compare as sorted lists. */
const sorted = (problems: Problem[]) => [...problems].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe("D4 / tests-11 — verify_chain reports every kind of tampering", () => {
  it("the untouched history has no problems, and every seal is chained", async () => {
    expect(await chainProblems(w.founder)).toEqual([]);
  });

  it("deleting a middle version breaks the link of the next one, and the seal of its revision", async () => {
    const problems = await tampered((c) => c.query("delete from hq.record_versions where record_id = 'FR-FX-004' and version = 2"));
    expect(problems).toEqual(
      expect.arrayContaining([
        { record_type: "requirement", record_id: "FR-FX-004", version: 3, problem: "broken link to previous version" },
        rev(2, "revision seal mismatch"),
      ]),
    );
    expect(await chainProblems(w.founder)).toEqual([]);
  });

  it("changing a version's revision without fixing its row hash is a row hash mismatch", async () => {
    const problems = await tampered((c) => c.query("update hq.record_versions set rev = rev + 1 where record_id = 'FR-FX-003' and version = 1"));
    expect(perVersion(problems)).toEqual([{ record_type: "requirement", record_id: "FR-FX-003", version: 1, problem: "row hash mismatch" }]);
    expect(problems).toEqual(expect.arrayContaining([rev(1, "revision seal mismatch"), rev(1, "revision record count mismatch")]));
    expect(await chainProblems(w.founder)).toEqual([]);
  });

  it("renumbering the newest version, with its row hash recomputed, is a version gap", async () => {
    const problems = await tampered((c) =>
      c.query(`update hq.record_versions set version = 4, row_hash = ${ROW_HASH.replace("version::text", "'4'")} where record_id = 'FR-FX-004' and version = 3`),
    );
    expect(perVersion(problems)).toEqual([{ record_type: "requirement", record_id: "FR-FX-004", version: 4, problem: "version gap" }]);
    expect(await chainProblems(w.founder)).toEqual([]);
  });

  it("moving a version to an earlier revision, with its row hash recomputed, is a revision regression", async () => {
    const problems = await tampered(async (c) => {
      await c.query("update hq.record_versions set rev = 1 where record_id = 'FR-FX-004' and version = 3");
      await c.query(`update hq.record_versions set row_hash = ${ROW_HASH} where record_id = 'FR-FX-004' and version = 3`);
    });
    expect(perVersion(problems)).toEqual([{ record_type: "requirement", record_id: "FR-FX-004", version: 3, problem: "revision regression" }]);
    expect(await chainProblems(w.founder)).toEqual([]);
  });

  it("db-5: deleting the newest version of a record (nothing links to it) is caught by the seal of its revision", async () => {
    const problems = await tampered((c) => c.query("delete from hq.record_versions where record_id = 'FR-FX-004' and version = 3"));
    expect(perVersion(problems)).toEqual([]);
    expect(problems).toEqual([rev(3, "revision seal mismatch")]);
    expect(await chainProblems(w.founder)).toEqual([]);
  });

  it("db-5: deleting a whole record is caught by every seal and record count since it was imported", async () => {
    const problems = await tampered((c) => c.query("delete from hq.record_versions where record_id = 'DEF-FX-01'"));
    expect(perVersion(problems)).toEqual([]);
    expect(problems).toEqual(
      expect.arrayContaining([1, 2, 3].flatMap((n) => [rev(n, "revision seal mismatch"), rev(n, "revision record count mismatch")])),
    );
    expect(await chainProblems(w.founder)).toEqual([]);
  });

  it("db-5: rewriting a version and recomputing its own hashes is caught by every seal from its revision on", async () => {
    const problems = await tampered((c) =>
      c.query(
        `update hq.record_versions
            set data = jsonb_set(data, '{title}', '"Rewritten"'),
                content_hash = encode(sha256(convert_to(jsonb_set(data, '{title}', '"Rewritten"')::text, 'UTF8')), 'hex')
          where record_id = 'FR-FX-002' and version = 1;
         update hq.record_versions set row_hash = ${ROW_HASH} where record_id = 'FR-FX-002' and version = 1`,
      ),
    );
    expect(perVersion(problems)).toEqual([]);
    expect(sorted(problems)).toEqual(sorted([1, 2, 3].map((n) => rev(n, "revision seal mismatch"))));
    expect(await chainProblems(w.founder)).toEqual([]);
  });

  it("rewriting the seals to match is caught by the seal chain; rewriting the chain too changes the head seal", async () => {
    const before = await headSeal(w.founder);
    const client = await admin();
    try {
      await client.query("begin");
      await client.query("alter table hq.record_versions disable trigger record_versions_append_only");
      await client.query("alter table hq.dataset_revisions disable trigger dataset_revisions_seal_once");
      await client.query(
        `update hq.record_versions
            set data = jsonb_set(data, '{title}', '"Rewritten"'),
                content_hash = encode(sha256(convert_to(jsonb_set(data, '{title}', '"Rewritten"')::text, 'UTF8')), 'hex')
          where record_id = 'FR-FX-002' and version = 1;
         update hq.record_versions set row_hash = ${ROW_HASH} where record_id = 'FR-FX-002' and version = 1;
         update hq.dataset_revisions set content_hash = hq.dataset_hash(rev)`,
      );
      const problems = (await client.query<Problem>("select record_type, record_id, version, problem from hq.verify_chain()")).rows;
      expect(sorted(problems)).toEqual(sorted([1, 2, 3].map((n) => rev(n, "seal chain mismatch"))));

      // An owner who also recomputes the chain leaves nothing inside the database to compare with…
      for (const n of [1, 2, 3]) {
        await client.query(
          `update hq.dataset_revisions d
              set seal_hash = encode(sha256(convert_to(coalesce((select p.seal_hash from hq.dataset_revisions p where p.rev = d.parent_rev), '')
                              || '|' || d.rev::text || '|' || d.content_hash || '|' || d.record_count::text, 'UTF8')), 'hex')
            where d.rev = $1`,
          [n],
        );
      }
      expect((await client.query("select * from hq.verify_chain()")).rows).toEqual([]);
      // …but the head seal is no longer the one a founder kept outside it.
      const after = (await client.query<{ seal_hash: string }>("select seal_hash from hq.head_seal()")).rows[0];
      expect(after.seal_hash).not.toBe(before!.seal_hash);
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
    expect(await chainProblems(w.founder)).toEqual([]);
    expect(await headSeal(w.founder)).toEqual(before);
  });

  it("a gap in revision numbering and a version in an unsealed revision are reported", async () => {
    const gap = await tampered((c) =>
      c.query(
        `insert into hq.dataset_revisions (rev, parent_rev, kind, summary, created_by, record_count, content_hash)
         select 5, 3, 'seed_import', 'Skipped a number', created_by, record_count, content_hash from hq.dataset_revisions where rev = 3`,
      ),
    );
    expect(gap).toEqual(expect.arrayContaining([rev(5, "revision gap")]));

    const unsealed = await tampered((c) => c.query("update hq.dataset_revisions set content_hash = null, record_count = null where rev = 3"));
    expect(unsealed).toEqual(
      expect.arrayContaining([
        { record_type: "requirement", record_id: "FR-FX-004", version: 3, problem: "version in unsealed or missing revision" },
        { record_type: "decision", record_id: "FD-HQ-0001", version: 1, problem: "version in unsealed or missing revision" },
      ]),
    );
    expect(await chainProblems(w.founder)).toEqual([]);
  });
});

describe("D4 — the head seal", () => {
  it("head_seal gives the latest revision and a seal hash that chains every revision from 1, as documented", async () => {
    const client = await admin();
    let expected: string | null = null;
    let rows: { rev: string; content_hash: string; record_count: number }[];
    try {
      rows = (await client.query("select rev, content_hash, record_count from hq.dataset_revisions order by rev")).rows;
    } finally {
      await client.end();
    }
    for (const r of rows) {
      expected = createHash("sha256").update(`${expected ?? ""}|${r.rev}|${r.content_hash}|${r.record_count}`, "utf8").digest("hex");
    }
    const last = rows[rows.length - 1];
    expect(await headSeal(w.reader)).toEqual({ rev: Number(last.rev), content_hash: last.content_hash, seal_hash: expected });
  });

  it("every signed-in role may read it; an anonymous caller may not", async () => {
    for (const who of [w.reader, w.claude, w.developer]) expect((await headSeal(who))?.rev).toBe(3);
    const client = await admin();
    try {
      await client.query("begin");
      await client.query("set local role anon");
      await expect(client.query("select * from hq.head_seal()")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  });
});
