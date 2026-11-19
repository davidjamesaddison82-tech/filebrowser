/**
 * H9 (Y8) — installing beside another installation.
 *
 * The application login role belongs to the whole PostgreSQL server, not to one database. Migrating a
 * second database with the same role name and another password used to run `alter role … password`,
 * so the first installation's DATABASE_URL stopped working and the second password opened the first
 * database. Now an existing role is first tried with the password in DATABASE_URL: if that works only
 * the grants are made; if not, migration stops (unless HQ_ALLOW_ROLE_PASSWORD_CHANGE=1) and nothing changes.
 *
 * This test uses a role and two databases of its own, never the role of the real installation.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { TEST_ADMIN_URL, TEST_DATABASE } from "../helpers/env";

const ROLE = `${TEST_DATABASE}_approle`.slice(0, 63);
const DB_A = `${TEST_DATABASE}_role_a`.slice(0, 63);
const DB_B = `${TEST_DATABASE}_role_b`.slice(0, 63);
/** ROUND5 K8: a role of this test's own, given attributes HQ's application role must not have. */
const ODD_ROLE = `${TEST_DATABASE}_oddrole`.slice(0, 63);
const DB_C = `${TEST_DATABASE}_role_c`.slice(0, 63);
const ODD_PASSWORD = "odd-role-password-0123456789";
const PASSWORD_A = "first-installation-password-0123456789";
const PASSWORD_B = "second-installation-password-0123456789";
const REFUSAL = new RegExp(
  `role ${ROLE} already exists on this server with a different password\\. It may belong to another HQ installation: ` +
    "use a different role name in DATABASE_URL, or set HQ_ALLOW_ROLE_PASSWORD_CHANGE=1 to change its password\\.",
);

function at(url: string, database: string, user?: string, password?: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
}
const adminUrl = (database: string) => at(TEST_ADMIN_URL, database);
const appUrl = (database: string, password: string) => at(TEST_ADMIN_URL, database, ROLE, password);

/** The owner, on the server's maintenance database (the test database itself may not exist yet). */
async function asOwner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl("postgres") });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Whether the role can sign in to `database` with `password`. */
async function signsIn(database: string, password: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: appUrl(database, password) });
  try {
    await client.connect();
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "28P01") return false;
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** The stored password verifier: a new salt is drawn on every `alter role … password`, so any reset changes it. */
const verifier = () => asOwner(async (c) => (await c.query<{ p: string }>("select rolpassword as p from pg_authid where rolname = $1", [ROLE])).rows[0]?.p ?? null);
const roleExists = () => asOwner(async (c) => ((await c.query("select 1 from pg_roles where rolname = $1", [ROLE])).rowCount ?? 0) > 0);
const migrationsIn = (database: string) =>
  asOwner(async () => {
    const c = new pg.Client({ connectionString: adminUrl(database) });
    await c.connect();
    try {
      const t = await c.query("select to_regclass('hq_meta.schema_migrations') as t");
      if (!t.rows[0].t) return 0;
      return Number((await c.query("select count(*)::int as n from hq_meta.schema_migrations")).rows[0].n);
    } finally {
      await c.end();
    }
  });
const mayConnect = (database: string) =>
  asOwner(async (c) => (await c.query<{ ok: boolean }>("select has_database_privilege($1, $2, 'connect') as ok", [ROLE, database])).rows[0].ok);

async function cleanUp() {
  await asOwner(async (c) => {
    for (const db of [DB_A, DB_B, DB_C]) await c.query(`drop database if exists "${db}" with (force)`);
    await c.query(`drop role if exists ${ROLE}`);
    await c.query(`drop role if exists ${ODD_ROLE}`);
  });
}

beforeAll(async () => {
  await cleanUp();
  await asOwner(async (c) => {
    // Neither database lets PUBLIC connect, so the connect grant made by migration is what lets the role in.
    for (const db of [DB_A, DB_B, DB_C]) {
      await c.query(`create database "${db}"`);
      await c.query(`revoke connect on database "${db}" from public`);
    }
  });
}, 60_000);

afterAll(async () => {
  delete process.env.HQ_ALLOW_ROLE_PASSWORD_CHANGE;
  await cleanUp();
}, 60_000);

describe("the application role is server-wide: an existing one is never silently given another password (H9)", () => {
  it("a first installation creates the role and grants it the database", async () => {
    expect(await roleExists()).toBe(false);
    await migrate({ adminUrl: adminUrl(DB_A), appUrl: appUrl(DB_A, PASSWORD_A), quiet: true });
    expect(await roleExists()).toBe(true);
    expect(await signsIn(DB_A, PASSWORD_A)).toBe(true);
    expect(await mayConnect(DB_A)).toBe(true);
  }, 120_000);

  it("running it again with the same password changes nothing", async () => {
    const before = await verifier();
    await migrate({ adminUrl: adminUrl(DB_A), appUrl: appUrl(DB_A, PASSWORD_A), quiet: true });
    expect(await verifier()).toBe(before);
    expect(await signsIn(DB_A, PASSWORD_A)).toBe(true);
  }, 120_000);

  it("a second database with another password is refused before anything is applied, and the first password still works", async () => {
    const before = await verifier();
    await expect(migrate({ adminUrl: adminUrl(DB_B), appUrl: appUrl(DB_B, PASSWORD_B), quiet: true })).rejects.toThrow(REFUSAL);
    expect(await verifier()).toBe(before);
    expect(await signsIn(DB_A, PASSWORD_A)).toBe(true);
    expect(await signsIn(DB_A, PASSWORD_B)).toBe(false);
    // Nothing was done in the second database: no migration recorded, no connect grant.
    expect(await migrationsIn(DB_B)).toBe(0);
    expect(await mayConnect(DB_B)).toBe(false);
  }, 120_000);

  it("the same database with a changed password is refused the same way", async () => {
    const before = await verifier();
    await expect(migrate({ adminUrl: adminUrl(DB_A), appUrl: appUrl(DB_A, PASSWORD_B), quiet: true })).rejects.toThrow(REFUSAL);
    expect(await verifier()).toBe(before);
    expect(await signsIn(DB_A, PASSWORD_A)).toBe(true);
  }, 120_000);

  it("a second database with the same password is installed: the password is accepted before the role may connect there", async () => {
    // The role has no CONNECT on the second database yet (PUBLIC's is revoked): the server accepts the
    // password and only then refuses the database (42501), which counts as the password working.
    expect(await mayConnect(DB_B)).toBe(false);
    const before = await verifier();
    await migrate({ adminUrl: adminUrl(DB_B), appUrl: appUrl(DB_B, PASSWORD_A), quiet: true });
    expect(await verifier()).toBe(before);
    expect(await mayConnect(DB_B)).toBe(true);
    expect(await signsIn(DB_B, PASSWORD_A)).toBe(true);
    expect(await migrationsIn(DB_B)).toBeGreaterThan(0);
  }, 120_000);

  it("only HQ_ALLOW_ROLE_PASSWORD_CHANGE=1 changes the password of an existing role", async () => {
    process.env.HQ_ALLOW_ROLE_PASSWORD_CHANGE = "true"; // anything but "1" is not the flag
    await expect(migrate({ adminUrl: adminUrl(DB_B), appUrl: appUrl(DB_B, PASSWORD_B), quiet: true })).rejects.toThrow(REFUSAL);
    expect(await signsIn(DB_A, PASSWORD_A)).toBe(true);

    process.env.HQ_ALLOW_ROLE_PASSWORD_CHANGE = "1";
    try {
      await migrate({ adminUrl: adminUrl(DB_B), appUrl: appUrl(DB_B, PASSWORD_B), quiet: true });
    } finally {
      delete process.env.HQ_ALLOW_ROLE_PASSWORD_CHANGE;
    }
    expect(await signsIn(DB_B, PASSWORD_B)).toBe(true);
    expect(await signsIn(DB_A, PASSWORD_B)).toBe(true);
    expect(await signsIn(DB_A, PASSWORD_A)).toBe(false);
    expect(await mayConnect(DB_B)).toBe(true);
  }, 180_000);
});

describe("ROUND5 K8 (Z13) — an existing role with an attribute HQ's application role must not have is refused, naming it", () => {
  const oddUrl = (database: string) => at(TEST_ADMIN_URL, database, ODD_ROLE, ODD_PASSWORD);
  const attributes = () =>
    asOwner(async (c) =>
      (
        await c.query<{ rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolinherit: boolean; rolcanlogin: boolean }>(
          "select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit, rolcanlogin from pg_roles where rolname = $1",
          [ODD_ROLE],
        )
      ).rows[0],
    );
  const make = (attrs: string) =>
    asOwner(async (c) => {
      await c.query(`drop role if exists ${ODD_ROLE}`);
      await c.query(`create role ${ODD_ROLE} ${attrs} password '${ODD_PASSWORD}'`);
    });

  for (const [attrs, named] of [
    ["superuser login inherit", /is SUPERUSER, INHERIT\./],
    ["login noinherit bypassrls", /is BYPASSRLS\./],
    ["login noinherit createrole", /is CREATEROLE\./],
    ["login noinherit createdb", /is CREATEDB\./],
    ["login inherit", /is INHERIT\./],
    ["nologin noinherit", /is NOLOGIN\./],
  ] as const) {
    it(`a role created "${attrs}" is refused before anything is applied, and keeps its attributes`, async () => {
      await make(attrs);
      const before = await attributes();
      await expect(migrate({ adminUrl: adminUrl(DB_C), appUrl: oddUrl(DB_C), quiet: true })).rejects.toThrow(named);
      await expect(migrate({ adminUrl: adminUrl(DB_C), appUrl: oddUrl(DB_C), quiet: true })).rejects.toThrow(/HQ's application role must not be a superuser/);
      expect(await attributes()).toEqual(before);
      expect(await migrationsIn(DB_C)).toBe(0);
    }, 120_000);
  }

  it("with HQ_ALLOW_ROLE_PASSWORD_CHANGE=1, migration sets it to LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB", async () => {
    await make("superuser createdb createrole bypassrls inherit nologin");
    process.env.HQ_ALLOW_ROLE_PASSWORD_CHANGE = "1";
    try {
      await migrate({ adminUrl: adminUrl(DB_C), appUrl: oddUrl(DB_C), quiet: true });
    } finally {
      delete process.env.HQ_ALLOW_ROLE_PASSWORD_CHANGE;
    }
    expect(await attributes()).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolinherit: false, rolcanlogin: true });
    expect(await migrationsIn(DB_C)).toBeGreaterThan(0);
  }, 180_000);
});
