/** Database harness: a freshly migrated, freshly seeded test database with known identities. */
import pg from "pg";
import type { Principal } from "@/lib/auth/principal";
import { clearDatasetCache } from "@/lib/server/store";
import { createCredential, ensurePrincipal, setPassphrase } from "../../scripts/lib/principals";
import { migrate } from "../../scripts/migrate";
import { seed } from "../../scripts/seed";
import { DEV_ADMIN_URL, TEST_ADMIN_URL, TEST_APP_URL, TEST_DATABASE } from "./env";

export interface TestWorld {
  founder: Principal;
  developer: Principal;
  reader: Principal;
  /** AI client principals as authenticated by API token. */
  claude: Principal;
  chatgpt: Principal;
  /** A Claude credential that carries only the read scope. */
  claudeReadOnly: Principal;
  tokens: { claude: string; chatgpt: string; claudeReadOnly: string; developer: string };
  passphrases: { founder: string; developer: string; reader: string };
  headRev: number;
}

export const PASSPHRASES = { founder: "founder-test-passphrase", developer: "developer-test-passphrase", reader: "reader-test-passphrase" };

async function ensureTestDatabase(): Promise<void> {
  const client = new pg.Client({ connectionString: DEV_ADMIN_URL });
  await client.connect();
  try {
    const exists = await client.query("select 1 from pg_database where datname = $1", [TEST_DATABASE]);
    if (!exists.rowCount) await client.query(`create database "${TEST_DATABASE}"`);
  } finally {
    await client.end();
  }
}

export async function admin(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: TEST_ADMIN_URL });
  await client.connect();
  return client;
}

/** Run SQL as the application login role, optionally assuming an API role with claims (as PostgREST would). */
export async function asAppRole<T>(
  role: "authenticated" | "anon" | "hq_auth" | null,
  claims: object | null,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: TEST_APP_URL });
  await client.connect();
  try {
    await client.query("begin");
    if (role) await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? {})]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

function principal(row: { id: string; handle: string; display: string; kind: Principal["kind"]; role: Principal["appRole"] }, amr: Principal["amr"], scopes: string[]): Principal {
  return { id: row.id, handle: row.handle, displayName: row.display, kind: row.kind, appRole: row.role, amr, scopes };
}

/** Reset the test database, apply migrations, create identities and import the fixture pack. */
export async function freshWorld(): Promise<TestWorld> {
  await ensureTestDatabase();
  await migrate({ reset: true, adminUrl: TEST_ADMIN_URL, appUrl: TEST_APP_URL, quiet: true });
  const client = await admin();
  try {
    const mk = async (handle: string, display: string, kind: Principal["kind"], role: Principal["appRole"]) => {
      const p = await ensurePrincipal(client, { handle, displayName: display, kind, appRole: role });
      return { id: p.id, handle, display, kind, role };
    };
    const founder = await mk("founder", "Founder", "human", "founder");
    const developer = await mk("developer", "Developer", "human", "developer");
    const reader = await mk("reader", "Reader", "human", "reader");
    const claude = await mk("claude", "Claude", "ai_client", "ai_agent");
    const chatgpt = await mk("chatgpt", "ChatGPT", "ai_client", "ai_agent");
    await setPassphrase(client, founder.id, PASSPHRASES.founder);
    await setPassphrase(client, developer.id, PASSPHRASES.developer);
    await setPassphrase(client, reader.id, PASSPHRASES.reader);
    const tClaude = await createCredential(client, claude.id, "test", ["read", "propose"]);
    const tChatgpt = await createCredential(client, chatgpt.id, "test", ["read", "propose"]);
    const tReadOnly = await createCredential(client, claude.id, "test read-only", ["read"]);
    const tDeveloper = await createCredential(client, developer.id, "test developer token", ["read", "propose"]);
    const seeded = await seed({ packDir: "data/packs/fixture", adminUrl: TEST_ADMIN_URL, quiet: true });
    clearDatasetCache();
    return {
      founder: principal(founder, "session", ["read", "propose", "decide"]),
      developer: principal(developer, "session", ["read", "propose"]),
      reader: principal(reader, "session", ["read"]),
      claude: principal(claude, "api_token", ["read", "propose"]),
      chatgpt: principal(chatgpt, "api_token", ["read", "propose"]),
      claudeReadOnly: principal(claude, "api_token", ["read"]),
      tokens: { claude: tClaude.token, chatgpt: tChatgpt.token, claudeReadOnly: tReadOnly.token, developer: tDeveloper.token },
      passphrases: PASSPHRASES,
      headRev: seeded.rev,
    };
  } finally {
    await client.end();
  }
}

/** What a refused write must leave untouched: sealed head, every record version, every proposal and its events. */
export interface WorldState {
  head: number;
  versions: number;
  proposals: number;
  events: number;
}

export async function worldState(): Promise<WorldState> {
  const client = await admin();
  try {
    const row = await client.query<{ head: string; versions: number; proposals: number; events: number }>(
      `select hq.head_rev() as head, (select count(*)::int from hq.record_versions) as versions,
              (select count(*)::int from hq.proposals) as proposals, (select count(*)::int from hq.proposal_events) as events`,
    );
    const r = row.rows[0];
    return { head: Number(r.head), versions: r.versions, proposals: r.proposals, events: r.events };
  } finally {
    await client.end();
  }
}

/** Expect a promise to reject with an HqError of the given HTTP status; returns the error. */
export async function expectStatus(promise: Promise<unknown>, status: number): Promise<{ status: number; code: string; message: string; detail?: unknown }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { status?: number; code?: string; message?: string; detail?: unknown };
    if (e.status !== status) throw new Error(`expected status ${status}, got ${e.status} (${e.message})`);
    return e as { status: number; code: string; message: string; detail?: unknown };
  }
  throw new Error(`expected the call to be refused with status ${status}, but it succeeded`);
}
