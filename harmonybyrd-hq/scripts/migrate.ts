/**
 * Apply SQL migrations from supabase/migrations in filename order.
 *
 *   npm run db:migrate            apply anything not yet applied
 *   npm run db:reset              drop the hq schema and re-apply everything (local/test databases only)
 *
 * The same files can be pushed to a Supabase project with `supabase db push`; this runner exists so
 * the application can be installed against any plain PostgreSQL without the Supabase CLI.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { adminClient, describeUrl } from "./lib/admin";
import { loadEnv, projectRoot, requireEnv } from "./lib/env";

export async function migrate(options: { reset?: boolean; adminUrl?: string; appUrl?: string; quiet?: boolean } = {}) {
  loadEnv();
  const adminUrl = options.adminUrl ?? requireEnv("HQ_ADMIN_DATABASE_URL");
  const appUrl = options.appUrl ?? requireEnv("DATABASE_URL");
  const log = (line: string) => {
    if (!options.quiet) console.log(line);
  };
  const client = await adminClient(adminUrl);
  try {
    const dbName = (await client.query<{ db: string }>("select current_database() as db")).rows[0].db;
    if (options.reset) {
      const resettable = /^hq_(dev|test)(_[a-z0-9_]+)?$/.test(dbName) || process.env.HQ_ALLOW_RESET === "1";
      if (!resettable) {
        throw new Error(
          `Refusing to reset database "${dbName}". Only a database named hq_dev or hq_test, optionally followed by ` +
            `"_" and lower-case letters, digits or underscores (for example hq_test_2), is reset automatically; ` +
            `set HQ_ALLOW_RESET=1 if you really mean it.`,
        );
      }
      log(`Resetting schema hq in ${describeUrl(adminUrl)}`);
      await client.query("drop schema if exists hq cascade");
      await client.query("drop schema if exists hq_meta cascade");
    }

    await client.query("create schema if not exists hq_meta");
    await client.query(`create table if not exists hq_meta.schema_migrations (
      name text primary key, sha256 text not null, applied_at timestamptz not null default now())`);

    const dir = path.join(projectRoot(), "supabase", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const applied = new Map(
      (await client.query<{ name: string; sha256: string }>("select name, sha256 from hq_meta.schema_migrations")).rows.map(
        (r) => [r.name, r.sha256],
      ),
    );

    for (const file of files) {
      const sql = readFileSync(path.join(dir, file), "utf8");
      const sha = createHash("sha256").update(sql).digest("hex");
      const previous = applied.get(file);
      if (previous) {
        if (previous !== sha) {
          throw new Error(
            `Migration ${file} was already applied with different contents (${previous.slice(0, 12)}… vs ${sha.slice(0, 12)}…). ` +
              `Migrations are immutable once applied: add a new migration instead.`,
          );
        }
        continue;
      }
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into hq_meta.schema_migrations (name, sha256) values ($1, $2)", [file, sha]);
        await client.query("commit");
        log(`applied ${file} (${sha.slice(0, 12)}…)`);
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }

    await ensureAppLoginRole(client, appUrl, log);
    return { database: dbName, files: files.length };
  } finally {
    await client.end();
  }
}

/** The web application signs in as a NOINHERIT login role that can only assume the API roles. */
async function ensureAppLoginRole(client: import("pg").Client, appUrl: string, log: (l: string) => void) {
  const u = new URL(appUrl);
  const role = decodeURIComponent(u.username);
  const password = decodeURIComponent(u.password);
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error(`Unsupported application role name "${role}"`);
  if (!password) throw new Error("DATABASE_URL must include a password for the application role");
  // The placeholder is published in .env.example: it must never become a real password.
  if (/__GENERATED_[A-Z_]*__/.test(password)) {
    throw new Error("DATABASE_URL still contains the placeholder password from .env.example. Run `npm run setup` (it fills it in) or set a long random password.");
  }
  const literal = (await client.query<{ q: string }>("select quote_literal($1) as q", [password])).rows[0].q;
  const dbName = (await client.query<{ db: string }>("select current_database() as db")).rows[0].db;
  // Roles belong to the whole server, not to one database. Two migrations running at the same
  // moment against different databases (for example two test databases) both touch this role, and
  // PostgreSQL then refuses one of them ("tuple concurrently updated"). The statements are
  // idempotent, so a refused attempt is simply tried again.
  for (let attempt = 1; ; attempt += 1) {
    try {
      const exists = (await client.query("select 1 from pg_roles where rolname = $1", [role])).rowCount;
      if (!exists) {
        await client.query(`create role ${role} login noinherit password ${literal}`);
        log(`created application login role ${role}`);
      } else {
        await client.query(`alter role ${role} login noinherit password ${literal}`);
      }
      await client.query(`grant anon, authenticated, hq_auth to ${role}`);
      await client.query(`grant connect on database "${dbName}" to ${role}`);
      return;
    } catch (error) {
      const e = error as { code?: string; message?: string };
      const concurrent = e.code === "XX000" || e.code === "23505" || e.code === "42710" || /concurrently updated/.test(e.message ?? "");
      if (!concurrent || attempt >= 8) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 60)));
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate({ reset: process.argv.includes("--reset") })
    .then((r) => console.log(`Migrations up to date in "${r.database}" (${r.files} files).`))
    .catch((error) => {
      console.error(String(error.message ?? error));
      process.exit(1);
    });
}
