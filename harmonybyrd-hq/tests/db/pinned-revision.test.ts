import { beforeAll, describe, expect, it } from "vitest";
import { getEcosystemOverview, getModuleBrief, getRecord, reviewProposal, searchFounderRequirements, submitChangeProposal } from "@/lib/server/services";
import { expectStatus, freshWorld, type TestWorld } from "../helpers/db";

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
