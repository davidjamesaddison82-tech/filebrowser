import type pg from "pg";
import { hashPassphrase, issueToken } from "../../src/lib/auth/secrets";

export interface PrincipalSpec {
  handle: string;
  displayName: string;
  kind: "human" | "ai_client" | "service";
  appRole: "founder" | "developer" | "ai_agent" | "reader";
}

/** Create the principal if it does not exist. Never changes the role of an existing principal. */
export async function ensurePrincipal(client: pg.Client, spec: PrincipalSpec): Promise<{ id: string; created: boolean }> {
  const existing = await client.query<{ id: string }>("select id from hq.principals where handle = $1", [spec.handle]);
  if (existing.rowCount) return { id: existing.rows[0].id, created: false };
  const inserted = await client.query<{ id: string }>(
    "insert into hq.principals (handle, display_name, kind, app_role) values ($1, $2, $3, $4) returning id",
    [spec.handle, spec.displayName, spec.kind, spec.appRole],
  );
  return { id: inserted.rows[0].id, created: true };
}

export async function setPassphrase(client: pg.Client, principalId: string, passphrase: string): Promise<void> {
  await client.query(
    `insert into hq.login_secrets (principal_id, scheme, secret_hash) values ($1, 'scrypt-v1', $2)
     on conflict (principal_id) do update set secret_hash = excluded.secret_hash, updated_at = now()`,
    [principalId, hashPassphrase(passphrase)],
  );
}

/** Issue a new API token. The token itself is returned once and never stored. */
export async function createCredential(
  client: pg.Client,
  principalId: string,
  label: string,
  scopes: string[],
  expiresAt: Date | null = null,
): Promise<{ token: string; prefix: string; credentialId: string }> {
  const issued = issueToken();
  const row = await client.query<{ id: string }>(
    `insert into hq.api_credentials (principal_id, label, token_prefix, token_hash, scopes, expires_at)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [principalId, label, issued.prefix, issued.hash, scopes, expiresAt],
  );
  return { token: issued.token, prefix: issued.prefix, credentialId: row.rows[0].id };
}
