import pg from "pg";
import { loadEnv, requireEnv } from "./env";

/** Administrative (owner) connection. Used only by setup, migration, seeding and tests — never by the web app. */
export async function adminClient(urlOverride?: string): Promise<pg.Client> {
  loadEnv();
  const client = new pg.Client({ connectionString: urlOverride ?? requireEnv("HQ_ADMIN_DATABASE_URL") });
  await client.connect();
  return client;
}

export function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}${u.pathname} as ${u.username}`;
  } catch {
    return "(unparseable connection string)";
  }
}
