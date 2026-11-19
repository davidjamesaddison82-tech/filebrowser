import { beforeAll, describe, expect, it } from "vitest";
import { getProposal, proposalImpact, submitChangeProposal } from "@/lib/server/services";
import { clearDatasetCache, getDataset } from "@/lib/server/store";
import { admin, freshWorld, type TestWorld } from "../helpers/db";
import { fuzz, plantOddRecords } from "../helpers/odd-values";

/**
 * G11b: one proposal-impact function, the one the review screen calls (services.proposalImpact, given
 * the page's loaded dataset). It follows references through every record on the conformed view, so a
 * stored record of the wrong shape cannot make the review of any proposal fail; and it shows as
 * "before" the value as stored, which is what the change replaces and what the acceptance rules compare.
 */
let w: TestWorld;
let openId: string;

beforeAll(async () => {
  w = await freshWorld();
  // A proposal open on the module the odd records point at, filed before they are stored.
  const head = (await getDataset(w.founder)).head;
  const version = (await getDataset(w.founder)).stored.get("module", "MOD-FX-ALPHA")!.meta.version;
  const submitted = await submitChangeProposal(w.claude, {
    title: "Reword Alpha",
    rationale: "Impact test.",
    base_rev: head,
    target: { type: "module", id: "MOD-FX-ALPHA", base_version: version },
    set: { summary: "Alpha, reworded." },
  });
  openId = (submitted.proposal as { id: string }).id;
  await plantOddRecords(fuzz(), "Records holding values of the wrong kind (impact test)");
  clearDatasetCache();
});

/** Put a proposal in the inbox as the owner, past every submission check (as tests/e2e/plant-proposal.ts does). */
async function plantProposal(id: string, type: string, target: string, set: Record<string, unknown>) {
  const client = await admin();
  try {
    const version = await client.query<{ v: number }>("select max(version) as v from hq.record_versions where record_type = $1 and record_id = $2", [type, target]);
    const head = await client.query<{ rev: string }>("select hq.head_rev() as rev");
    await client.query(
      `insert into hq.proposals (id, kind, target_type, target_id, base_version, base_rev, title, rationale, payload, submitted_by)
       values ($1, 'change_proposal', $2, $3, $4, $5, 'Planted proposal (impact test)', 'Past the submission checks.', $6::jsonb, $7)`,
      [id, type, target, version.rows[0].v, Number(head.rows[0].rev), JSON.stringify({ op: "update", set }), w.developer.id],
    );
    await client.query("insert into hq.proposal_events (proposal_id, event, actor) values ($1, 'submitted', $2)", [id, w.developer.id]);
  } finally {
    await client.end();
  }
}

describe("G11b — the review screen's impact, with records of the wrong shape stored", () => {
  it("works out what refers to the target from the conformed view, without failing", async () => {
    const proposal = await getProposal(w.founder, openId);
    const loaded = await getDataset(w.founder);
    // All but two of the 336 fail validation (two sources only gain an extra text in a list of texts).
    expect(loaded.warnings.length).toBe(334);
    const impact = await proposalImpact(w.founder, proposal, loaded);
    expect(impact.op).toBe("update");
    expect(impact.target).toMatchObject({ id: "MOD-FX-ALPHA", exists: true });
    // Odd records that still name the module (their references were kept) are among what it affects.
    expect(impact.affected.map((r) => r.id).filter((id) => id.includes("-ODD-")).length).toBeGreaterThan(0);
    expect(impact.changes).toEqual([{ field: "summary", before: loaded.stored.get("module", "MOD-FX-ALPHA")!.data.summary, after: "Alpha, reworded." }]);
    // Called without the page's dataset, it reads the same one itself.
    expect(await proposalImpact(w.founder, proposal)).toEqual(impact);
  });

  it('shows as "before" the value as stored, not the conformed one', async () => {
    await plantProposal("PROP-910001", "build", "BLD-FX-01-ODD-A0", { standing: "development" });
    const loaded = await getDataset(w.founder);
    expect(loaded.ds.get("build", "BLD-FX-01-ODD-A0")!.data.standing).toBe("Not a valid value");
    const impact = await proposalImpact(w.founder, await getProposal(w.founder, "PROP-910001"), loaded);
    expect(impact.changes).toEqual([{ field: "standing", before: ["accepted_reported"], after: "development" }]);
    expect(impact.sensitive_fields).toEqual(["standing"]);
    expect(impact.target_acceptance).toBeNull();
  });
});
