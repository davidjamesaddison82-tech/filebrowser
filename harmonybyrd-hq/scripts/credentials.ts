/**
 * Administrative credential management (uses the owner connection; for local setup and recovery).
 *
 *   npm run credentials -- add-client <handle> "<display name>" [--scopes read,propose]
 *   npm run credentials -- add-human <handle> "<display name>" <founder|developer|reader>
 *   npm run credentials -- token <handle> "<label>" [--scopes read,propose] [--days 90]
 *   npm run credentials -- passphrase <handle>
 *   npm run credentials -- list
 *
 * Founder identities cannot hold API tokens; the database refuses to create one.
 * In the running application the founder manages client tokens from the "AI access" page instead.
 */
import { generatePassphrase } from "../src/lib/auth/secrets";
import { adminClient } from "./lib/admin";
import { createCredential, ensurePrincipal, setPassphrase } from "./lib/principals";

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const option = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const scopes = (option("--scopes") ?? "read,propose").split(",").map((s) => s.trim());
  const client = await adminClient();
  try {
    if (command === "add-client") {
      const [handle, name] = rest;
      const p = await ensurePrincipal(client, { handle, displayName: name ?? handle, kind: "ai_client", appRole: "ai_agent" });
      const c = await createCredential(client, p.id, "initial token", scopes);
      console.log(`AI client "${handle}" ${p.created ? "created" : "already existed"}. New token (shown once):\n${c.token}`);
    } else if (command === "add-human") {
      const [handle, name, role] = rest;
      if (!["founder", "developer", "reader"].includes(role)) throw new Error("role must be founder, developer or reader");
      const p = await ensurePrincipal(client, { handle, displayName: name ?? handle, kind: "human", appRole: role as "founder" });
      const passphrase = generatePassphrase();
      await setPassphrase(client, p.id, passphrase);
      console.log(`Human "${handle}" (${role}) ${p.created ? "created" : "already existed"}. Passphrase (shown once):\n${passphrase}`);
    } else if (command === "token") {
      const [handle, label] = rest;
      const row = await client.query<{ id: string }>("select id from hq.principals where handle = $1", [handle]);
      if (!row.rowCount) throw new Error(`no principal "${handle}"`);
      const days = option("--days");
      const expires = days ? new Date(Date.now() + Number(days) * 86_400_000) : null;
      const c = await createCredential(client, row.rows[0].id, label ?? "token", scopes, expires);
      console.log(`Token for "${handle}" (shown once):\n${c.token}`);
    } else if (command === "passphrase") {
      const [handle] = rest;
      const row = await client.query<{ id: string }>("select id from hq.principals where handle = $1 and kind = 'human'", [handle]);
      if (!row.rowCount) throw new Error(`no human principal "${handle}"`);
      const passphrase = generatePassphrase();
      await setPassphrase(client, row.rows[0].id, passphrase);
      console.log(`New passphrase for "${handle}" (shown once):\n${passphrase}`);
    } else if (command === "list") {
      const rows = await client.query(
        `select p.handle, p.kind, p.app_role, p.active,
                (select count(*) from hq.api_credentials c where c.principal_id = p.id and c.revoked_at is null) as live_tokens
           from hq.principals p order by p.kind, p.handle`,
      );
      console.table(rows.rows);
    } else {
      console.log("commands: add-client, add-human, token, passphrase, list  (see the header of scripts/credentials.ts)");
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(String(error.message ?? error));
  process.exit(1);
});
