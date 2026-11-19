/**
 * ROUND4 H4 — the fields a proposal may set. The database's list (hq.record_fields, migration 0009) is
 * the record schemas' own (RECORD_FIELDS in src/lib/domain/schemas.ts, taken from each schema's shape),
 * row for row, so a schema change without a migration fails here.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { RECORD_FIELDS, RECORD_SCHEMAS, RECORD_TYPES } from "@/lib/domain/schemas";
import { admin, freshWorld } from "../helpers/db";

beforeAll(async () => {
  await freshWorld();
});

describe("H4 — hq.record_fields matches the record schemas", () => {
  it("the same fields for every record type", async () => {
    const client = await admin();
    try {
      const rows = (await client.query<{ record_type: string; fields: string[] }>(
        `select record_type, array_agg(field order by field collate "C") as fields from hq.record_fields group by record_type order by record_type collate "C"`,
      )).rows;
      const fromSchemas = [...RECORD_TYPES]
        .sort()
        .map((type) => ({ record_type: type, fields: Object.keys((RECORD_SCHEMAS[type] as unknown as { shape: Record<string, unknown> }).shape).sort() }));
      expect(rows).toEqual(fromSchemas);
      expect(Object.fromEntries(rows.map((r) => [r.record_type, r.fields]))).toEqual(Object.fromEntries(RECORD_TYPES.map((t) => [t, [...RECORD_FIELDS[t]]])));
    } finally {
      await client.end();
    }
  });

  it("no API role can read or change the table", async () => {
    const client = await admin();
    try {
      for (const role of ["anon", "authenticated", "hq_auth", "service_role"]) {
        const r = await client.query<{ s: boolean; i: boolean; d: boolean }>(
          "select has_table_privilege($1, 'hq.record_fields', 'select') as s, has_table_privilege($1, 'hq.record_fields', 'insert') as i, has_table_privilege($1, 'hq.record_fields', 'delete') as d",
          [role],
        );
        expect(r.rows[0], role).toEqual({ s: false, i: false, d: false });
      }
    } finally {
      await client.end();
    }
  });
});
