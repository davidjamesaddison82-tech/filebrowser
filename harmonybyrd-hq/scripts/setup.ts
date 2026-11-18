/**
 * One-step local setup.
 *
 *   npm run setup
 *
 * 1. Creates .env.local with generated secrets if it does not exist.
 * 2. Applies database migrations and creates the application login role.
 * 3. Creates the local identities: founder (human), developer (human), reader (human),
 *    and two AI clients — claude and chatgpt — each with its own API token.
 * 4. Imports the evidence pack at HQ_PACK_DIR.
 *
 * Generated passphrases and tokens are printed once and saved to .hq-local-credentials.json
 * (ignored by git) so a local installation can be signed into. Nothing here is a production secret store.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generatePassphrase } from "../src/lib/auth/secrets";
import { adminClient } from "./lib/admin";
import { loadEnv, projectRoot } from "./lib/env";
import { createCredential, ensurePrincipal, setPassphrase } from "./lib/principals";
import { migrate } from "./migrate";
import { seed } from "./seed";

async function main() {
  const root = projectRoot();
  const envFile = path.join(root, ".env.local");
  if (!existsSync(envFile)) {
    const appPassword = randomBytes(18).toString("base64url");
    const template = readFileSync(path.join(root, ".env.example"), "utf8")
      .replace("__GENERATED_JWT_SECRET__", randomBytes(48).toString("base64url"))
      .replaceAll("__GENERATED_APP_DB_PASSWORD__", appPassword);
    writeFileSync(envFile, template, { mode: 0o600 });
    console.log("Created .env.local with generated secrets.");
  }
  loadEnv();

  await migrate({ reset: process.argv.includes("--reset") });

  const credentialFile = path.join(root, ".hq-local-credentials.json");
  const saved: Record<string, unknown> = existsSync(credentialFile) ? JSON.parse(readFileSync(credentialFile, "utf8")) : {};
  const client = await adminClient();
  try {
    const humans = [
      { handle: "founder", displayName: "Founder", appRole: "founder" as const },
      { handle: "developer", displayName: "Developer", appRole: "developer" as const },
      { handle: "reader", displayName: "Read-only reviewer", appRole: "reader" as const },
    ];
    for (const human of humans) {
      const p = await ensurePrincipal(client, { ...human, kind: "human" });
      const hasSecret = (await client.query("select 1 from hq.login_secrets where principal_id = $1", [p.id])).rowCount;
      if (!hasSecret) {
        const passphrase = generatePassphrase();
        await setPassphrase(client, p.id, passphrase);
        saved[`${human.handle}_passphrase`] = passphrase;
        console.log(`  ${human.handle.padEnd(10)} passphrase: ${passphrase}`);
      }
    }
    const clients = [
      { handle: "claude", displayName: "Claude (Anthropic)" },
      { handle: "chatgpt", displayName: "ChatGPT (OpenAI)" },
    ];
    for (const ai of clients) {
      const p = await ensurePrincipal(client, { ...ai, kind: "ai_client", appRole: "ai_agent" });
      const live = (await client.query("select 1 from hq.api_credentials where principal_id = $1 and revoked_at is null", [p.id])).rowCount;
      if (!live) {
        const credential = await createCredential(client, p.id, "local setup token", ["read", "propose"]);
        saved[`${ai.handle}_api_token`] = credential.token;
        console.log(`  ${ai.handle.padEnd(10)} API token:  ${credential.token}`);
      }
    }
  } finally {
    await client.end();
  }
  writeFileSync(credentialFile, `${JSON.stringify(saved, null, 2)}\n`, { mode: 0o600 });

  await seed({});
  console.log("\nSetup complete. Start the application with:  npm run dev   (http://localhost:3210)");
  console.log("Sign in as  founder  with the passphrase above (also saved in .hq-local-credentials.json).");
}

main().catch((error) => {
  console.error(String(error.message ?? error));
  process.exit(1);
});
