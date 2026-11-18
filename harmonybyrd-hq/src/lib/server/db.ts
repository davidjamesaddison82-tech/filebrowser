/**
 * Database access for the web application.
 *
 * The application connects as a NOINHERIT login role that holds no privileges of its own. For
 * every request it opens a transaction, switches to the Supabase-style API role and installs
 * the caller's claims — exactly what PostgREST does — so the same row-level security policies
 * and SECURITY DEFINER functions govern access whether HQ runs on plain PostgreSQL or Supabase.
 */
import pg from "pg";
import { fromDatabaseError, unavailable } from "./errors";

export interface DbClaims {
  sub: string;
  role: "authenticated";
  /** How the caller authenticated. Founder acts require "session". */
  amr: "session" | "api_token";
  client: string | null;
  /** Present only for API tokens. */
  scopes?: string[];
}

export interface Queryer {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

declare global {
  // eslint-disable-next-line no-var
  var __hqPool: pg.Pool | undefined;
}

function pool(): pg.Pool {
  if (!globalThis.__hqPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw unavailable("DATABASE_URL is not configured. Run `npm run setup` or copy .env.example to .env.local.");
    }
    const created = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
    created.on("error", () => {
      /* idle client errors are surfaced on next use */
    });
    globalThis.__hqPool = created;
  }
  return globalThis.__hqPool;
}

type DbRole = "authenticated" | "anon" | "hq_auth";

async function run<T>(role: DbRole, claims: DbClaims | null, readOnly: boolean, fn: (q: Queryer) => Promise<T>): Promise<T> {
  let client: pg.PoolClient;
  try {
    client = await pool().connect();
  } catch (error) {
    throw fromDatabaseError(error);
  }
  try {
    await client.query(readOnly ? "begin transaction read only" : "begin");
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? {})]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      /* connection already broken */
    }
    throw fromDatabaseError(error);
  } finally {
    client.release();
  }
}

/** Read as the given principal inside a READ ONLY transaction: a read path physically cannot write. */
export function readAs<T>(claims: DbClaims, fn: (q: Queryer) => Promise<T>): Promise<T> {
  return run("authenticated", claims, true, fn);
}

/** Write as the given principal. Only SECURITY DEFINER functions can change anything. */
export function writeAs<T>(claims: DbClaims, fn: (q: Queryer) => Promise<T>): Promise<T> {
  return run("authenticated", claims, false, fn);
}

/** Credential lookup role: used by the authentication layer and nothing else. */
export function asAuthRole<T>(fn: (q: Queryer) => Promise<T>): Promise<T> {
  return run("hq_auth", null, false, fn);
}

/** hq.log_refusal refuses a detail over 8192 bytes; stay well under it so a refusal is never lost. */
const AUDIT_DETAIL_MAX_BYTES = 6000;

/** The detail as JSON text, or a short preview of it when it is too large to store whole. */
export function auditDetailJson(detail: unknown): string | null {
  if (detail === undefined || detail === null) return null;
  const text = JSON.stringify(detail);
  if (text === undefined) return null;
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= AUDIT_DETAIL_MAX_BYTES) return text;
  // 1500 characters are at most 6000 bytes in UTF-8, so the preview always fits.
  return JSON.stringify({ truncated: true, original_bytes: bytes, preview: text.slice(0, 1500) });
}

/**
 * Append an audit event in its own transaction, so that denials are recorded even though the request failed.
 * Refusals go through hq.log_refusal and allowed uses through hq.log_access: the database decides who the
 * caller is from the claims, and an allowed use is recorded only for an active principal (no detail).
 */
export async function audit(
  claims: DbClaims | null,
  event: { action: string; objectType?: string | null; objectId?: string | null; outcome: "allowed" | "denied" | "error"; detail?: unknown; requestId?: string | null },
): Promise<void> {
  try {
    await run(claims ? "authenticated" : "anon", claims, false, (q) =>
      event.outcome === "allowed"
        ? q.query("select hq.log_access($1, $2, $3, $4)", [event.action, event.objectType ?? null, event.objectId ?? null, event.requestId ?? null])
        : q.query("select hq.log_refusal($1, $2, $3, $4, $5::jsonb, $6)", [
            event.action,
            event.objectType ?? null,
            event.objectId ?? null,
            event.outcome,
            auditDetailJson(event.detail),
            event.requestId ?? null,
          ]),
    );
  } catch {
    /* auditing must never turn a refusal into a different error */
  }
}

export async function databaseHealthy(): Promise<{ ok: boolean; error?: string }> {
  try {
    await run("anon", null, true, (q) => q.query("select 1"));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
