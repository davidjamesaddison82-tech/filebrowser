import { describe, expect, it } from "vitest";
import pg from "pg";
import { databaseHealthy } from "@/lib/server/db";
import { getEcosystemOverview, getModuleBrief, getReviewItems, searchFounderRequirements } from "@/lib/server/services";
import { seed } from "../../scripts/seed";
import { admin, freshWorld } from "../helpers/db";
import { TEST_ADMIN_URL } from "../helpers/env";

async function datasetHash(): Promise<{ rev: number; hash: string; versions: number }> {
  const client = await admin();
  try {
    const row = await client.query<{ rev: string; content_hash: string; versions: number }>(
      "select rev, content_hash, (select count(*)::int from hq.record_versions) as versions from hq.dataset_revisions order by rev desc limit 1",
    );
    return { rev: Number(row.rows[0].rev), hash: row.rows[0].content_hash, versions: row.rows[0].versions };
  } finally {
    await client.end();
  }
}

describe("AC13 — critical results are deterministic and repeatable", () => {
  it("importing the same pack into a fresh database twice yields the same dataset hash", async () => {
    const a = await freshWorld();
    const first = await datasetHash();
    const overviewA = JSON.stringify((await getEcosystemOverview(a.claude)).data);
    const briefA = JSON.stringify((await getModuleBrief(a.claude, "MOD-FX-ALPHA")).data.record);
    const reviewA = JSON.stringify((await getReviewItems(a.claude)).data.items);
    const searchA = JSON.stringify((await searchFounderRequirements(a.claude, { q: "pattern" })).data.requirements.map((r) => r.id));

    const b = await freshWorld();
    const second = await datasetHash();
    expect(second).toEqual(first);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify((await getEcosystemOverview(b.claude)).data)).toBe(overviewA);
    expect(JSON.stringify((await getModuleBrief(b.claude, "MOD-FX-ALPHA")).data.record)).toBe(briefA);
    expect(JSON.stringify((await getReviewItems(b.claude)).data.items)).toBe(reviewA);
    expect(JSON.stringify((await searchFounderRequirements(b.claude, { q: "pattern" })).data.requirements.map((r) => r.id))).toBe(searchA);
  });

  it("importing the same pack again changes nothing and creates no revision", async () => {
    await freshWorld();
    const before = await datasetHash();
    const result = await seed({ packDir: "data/packs/fixture", adminUrl: TEST_ADMIN_URL, quiet: true });
    expect(result).toMatchObject({ rev: 1, changed: 0, retired: 0, unchanged: 29 });
    expect(await datasetHash()).toEqual(before);
  });

  it("the dataset hash is recomputable from the stored records", async () => {
    await freshWorld();
    const client = await admin();
    try {
      const row = await client.query<{ stored: string; recomputed: string }>("select content_hash as stored, hq.dataset_hash(rev) as recomputed from hq.dataset_revisions where rev = 1");
      expect(row.rows[0].recomputed).toBe(row.rows[0].stored);
    } finally {
      await client.end();
    }
  });
});

describe("AC12 — an unavailable database is handled safely", () => {
  it("reports the database as unreachable instead of crashing or serving stale data", async () => {
    const world = await freshWorld();
    const originalUrl = process.env.DATABASE_URL!;
    const originalPool = globalThis.__hqPool;
    // Point the application at a port where nothing listens.
    const dead = new URL(originalUrl);
    dead.port = "1";
    process.env.DATABASE_URL = dead.toString();
    globalThis.__hqPool = new pg.Pool({ connectionString: dead.toString(), connectionTimeoutMillis: 1500 });
    try {
      expect(await databaseHealthy()).toMatchObject({ ok: false });
      await expect(getEcosystemOverview(world.claude)).rejects.toMatchObject({ status: 503, code: "service_unavailable" });
      await expect(getModuleBrief(world.claude, "MOD-FX-ALPHA", { rev: 1 })).rejects.toMatchObject({ status: 503 });
    } finally {
      await globalThis.__hqPool.end().catch(() => undefined);
      process.env.DATABASE_URL = originalUrl;
      globalThis.__hqPool = originalPool;
    }
    // And it recovers as soon as the database is back.
    expect(await databaseHealthy()).toEqual({ ok: true });
    expect((await getEcosystemOverview(world.claude)).data.counts.module).toBe(4);
  });
});
