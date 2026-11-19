import { beforeAll, describe, expect, it } from "vitest";
import { claimsFor } from "@/lib/auth/principal";
import { getEcosystemOverview, getModuleBrief, getRecord, reviewProposal, searchFounderRequirements, submitChangeProposal } from "@/lib/server/services";
import { clearDatasetCache } from "@/lib/server/store";
import { asAppRole, expectStatus, freshWorld, type TestWorld } from "../helpers/db";

let w: TestWorld;
beforeAll(async () => {
  w = await freshWorld();
});

describe("AC5 — two independent clients retrieve the same pinned revision", () => {
  it("Claude and ChatGPT get identical data and revision for the same pinned revision", async () => {
    const a = await getModuleBrief(w.claude, "MOD-FX-ALPHA", { rev: 1 });
    const b = await getModuleBrief(w.chatgpt, "MOD-FX-ALPHA", { rev: 1 });
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
    expect(a.revision).toEqual(b.revision);
    expect(a.provenance).toEqual(b.provenance);
    // Only the identity of the asker differs.
    expect(a.requested_by.handle).toBe("claude");
    expect(b.requested_by.handle).toBe("chatgpt");
  });

  it("a pinned revision is unchanged by later writes, while the head moves on", async () => {
    const before = await getRecord(w.claude, "requirement", "FR-FX-004", { rev: 1 });
    const overviewBefore = await getEcosystemOverview(w.chatgpt, { rev: 1 });

    const submitted = await submitChangeProposal(w.claude, {
      title: "Record an interpretation",
      rationale: "The wording is clear; this records how HQ reads it.",
      base_rev: 1,
      target: { type: "requirement", id: "FR-FX-004", base_version: 1 },
      set: { interpretation: "No modal dialogs, toasts or overlays that cover content." },
    });
    const accepted = await reviewProposal(w.founder, (submitted.proposal as { id: string }).id, "accept");
    expect(accepted.resulting_rev).toBe(2);

    const pinnedClaude = await getRecord(w.claude, "requirement", "FR-FX-004", { rev: 1 });
    const pinnedChatgpt = await getRecord(w.chatgpt, "requirement", "FR-FX-004", { rev: 1 });
    expect(JSON.stringify(pinnedClaude.data)).toBe(JSON.stringify(before.data));
    expect(JSON.stringify(pinnedChatgpt.data)).toBe(JSON.stringify(before.data));
    expect((pinnedClaude.data.record as { interpretation: string | null }).interpretation).toBeNull();
    expect(pinnedClaude.revision).toMatchObject({ rev: 1, pinned: true, head_rev: 2, is_head: false });
    expect(pinnedClaude.revision.content_hash).toBe(before.revision.content_hash);

    const overviewAfter = await getEcosystemOverview(w.chatgpt, { rev: 1 });
    expect(JSON.stringify(overviewAfter.data)).toBe(JSON.stringify(overviewBefore.data));

    const head = await getRecord(w.chatgpt, "requirement", "FR-FX-004");
    expect(head.revision).toMatchObject({ rev: 2, pinned: false, is_head: true });
    expect(head.revision.content_hash).not.toBe(before.revision.content_hash);
    expect((head.data.record as { interpretation: string }).interpretation).toMatch(/modal dialogs/);
    expect(head.data.meta.version).toBe(2);
  });

  it("tests-4: a pinned read after a later write comes from the database, not from the in-process cache", async () => {
    // The previous test warmed the cache with revision 1 and moved the head to 2. getDataset caches by
    // (rev, stored seal), so without clearing it the pinned reads below would never reach hq.records_at.
    clearDatasetCache();
    const claude = await getRecord(w.claude, "requirement", "FR-FX-004", { rev: 1 });
    clearDatasetCache();
    const chatgpt = await getRecord(w.chatgpt, "requirement", "FR-FX-004", { rev: 1 });
    for (const r of [claude, chatgpt]) {
      expect(r.revision).toMatchObject({ rev: 1, pinned: true, head_rev: 2, is_head: false });
      expect(r.data.meta).toMatchObject({ version: 1, rev: 1, origin: "seed_import" });
      expect((r.data.record as { interpretation: string | null }).interpretation).toBeNull();
    }
    expect(JSON.stringify(claude.data)).toBe(JSON.stringify(chatgpt.data));
    // The seal both clients were given is the stored one, and recomputing it from the stored
    // records of revision 1 (as the API role, not the owner) gives the same value.
    const recomputed = await asAppRole("authenticated", claimsFor(w.claude), async (c) =>
      (await c.query<{ h: string }>("select hq.dataset_hash(1) as h")).rows[0].h,
    );
    expect(claude.revision.content_hash).toBe(recomputed);
    // And the head, read fresh, has moved on.
    clearDatasetCache();
    const head = await getRecord(w.chatgpt, "requirement", "FR-FX-004");
    expect(head.data.meta).toMatchObject({ version: 2, rev: 2, origin: "proposal_acceptance" });
  });

  it("search results at a pinned revision are identical for both clients", async () => {
    const a = await searchFounderRequirements(w.claude, { q: "score" }, { rev: 1 });
    const b = await searchFounderRequirements(w.chatgpt, { q: "score" }, { rev: 1 });
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
    expect(a.data.requirements.map((r) => r.id)).toEqual(["FR-FX-002", "FR-FX-003"]);
  });

  it("a revision that does not exist is refused", async () => {
    await expectStatus(getModuleBrief(w.claude, "MOD-FX-ALPHA", { rev: 99 }), 404);
    await expectStatus(getModuleBrief(w.claude, "MOD-FX-ALPHA", { rev: 0 }), 404);
  });
});
