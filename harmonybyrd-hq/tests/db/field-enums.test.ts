/**
 * ROUND3 G1c — the database's own list of allowed values (hq.field_enums, migration 0008) is the
 * application's (FIELD_ENUMS in src/lib/domain/schemas.ts), row for row, so the two cannot drift.
 * tests/unit/schemas.test.ts pins FIELD_ENUMS to the record schemas themselves; between them, a value
 * the schema refuses is refused by the database too.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { FIELD_ENUMS } from "@/lib/domain/schemas";
import { admin, freshWorld } from "../helpers/db";

beforeAll(async () => {
  await freshWorld();
});

const key = (r: { record_type: string; path: string }) => `${r.record_type} ${r.path}`;

describe("G1c — hq.field_enums matches the application's FIELD_ENUMS", () => {
  it("the same rows: record type, path, allowed values in the same order, and which drive acceptance", async () => {
    const client = await admin();
    try {
      const rows = (
        await client.query<{ record_type: string; path: string; allowed: string[]; drives_acceptance: boolean }>(
          `select record_type, path, allowed, drives_acceptance from hq.field_enums order by record_type collate "C", path collate "C"`,
        )
      ).rows;
      const app = FIELD_ENUMS.map((f) => ({ record_type: f.type, path: f.path, allowed: [...f.allowed], drives_acceptance: f.drivesAcceptance })).sort((a, b) =>
        key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0,
      );
      expect(rows).toEqual(app);
    } finally {
      await client.end();
    }
  });

  it("the fields that drive acceptance are among those checked in the whole record", () => {
    const driving = FIELD_ENUMS.filter((f) => f.drivesAcceptance).map((f) => `${f.type} ${f.path}`);
    expect(driving).toEqual(expect.arrayContaining(["build standing", "module lifecycle.*.state", "module lifecycle.*.basis", "evidence type"]));
  });

  it("no API role can read or change the table", async () => {
    const client = await admin();
    try {
      for (const role of ["anon", "authenticated", "hq_auth", "service_role"]) {
        const r = await client.query<{ s: boolean; i: boolean; d: boolean }>(
          "select has_table_privilege($1, 'hq.field_enums', 'select') as s, has_table_privilege($1, 'hq.field_enums', 'insert') as i, has_table_privilege($1, 'hq.field_enums', 'delete') as d",
          [role],
        );
        expect(r.rows[0], role).toEqual({ s: false, i: false, d: false });
      }
    } finally {
      await client.end();
    }
  });
});
