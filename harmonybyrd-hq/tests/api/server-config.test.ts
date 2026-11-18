import type { ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshWorld, type TestWorld } from "../helpers/db";
import { TEST_PORT } from "../helpers/env";
import { sessionCookie } from "../helpers/http";
import { startServer } from "../helpers/server";

/**
 * Behaviour that depends on the server's configuration, so it runs a second server with its own
 * environment next to the shared one: Drive look-ups with a configured credential (docs-5, D17),
 * and the start-up refusal of a placeholder session secret (docs-7).
 */
const PORT = TEST_PORT + 2;
const FAKE_DRIVE_PORT = TEST_PORT + 3;
const BAD_PORT = TEST_PORT + 4;
const ALLOWED = "AllowedFile0001";

let w: TestWorld;
let hq: ChildProcess | null = null;
let fake: Server;
const driveRequests: { url: string; authorization?: string }[] = [];

beforeAll(async () => {
  w = await freshWorld();
  fake = createServer((req, res) => {
    driveRequests.push({ url: req.url ?? "", authorization: req.headers.authorization });
    const id = /\/files\/([^?]+)/.exec(req.url ?? "")?.[1] ?? "";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id, name: "Founder private notes.docx", mimeType: "application/vnd.google-apps.document", size: "42" }));
  });
  await new Promise<void>((resolve) => fake.listen(FAKE_DRIVE_PORT, "127.0.0.1", resolve));
  hq = await startServer(PORT, {
    HQ_GOOGLE_DRIVE_ACCESS_TOKEN: "founder-drive-secret",
    HQ_GOOGLE_DRIVE_API: `http://127.0.0.1:${FAKE_DRIVE_PORT}`,
    HQ_GOOGLE_DRIVE_FILE_IDS: ALLOWED,
  });
}, 120_000);

afterAll(async () => {
  hq?.kill("SIGTERM");
  await new Promise<void>((resolve) => fake.close(() => resolve()));
});

async function lookup(fileId: string, auth: { token?: string; cookie?: string }) {
  const headers: Record<string, string> = {};
  if (auth.token) headers.authorization = `Bearer ${auth.token}`;
  if (auth.cookie) headers.cookie = auth.cookie;
  const res = await fetch(`http://127.0.0.1:${PORT}/api/v1/integrations?drive_file=${fileId}`, { headers });
  return { status: res.status, body: (await res.json()) as { google_drive: { configured: boolean }; lookup: { ok: boolean; reason?: string; data?: { id: string } } } };
}

describe("Drive look-ups use the founder's Drive credential only for people, and only for listed files (docs-5)", () => {
  it("no API token can make HQ ask Drive anything", async () => {
    for (const token of [w.tokens.claude, w.tokens.chatgpt, w.tokens.claudeReadOnly, w.tokens.developer]) {
      const res = await lookup(ALLOWED, { token });
      expect(res.status).toBe(200);
      expect(res.body.google_drive.configured).toBe(true);
      expect(res.body.lookup).toMatchObject({ ok: false, reason: "forbidden" });
    }
    expect(driveRequests).toHaveLength(0);
  });

  it("a developer's session asks only about a listed file id", async () => {
    const cookie = await sessionCookie(w.developer.id);
    expect((await lookup("OtherFile00001", { cookie })).body.lookup).toMatchObject({ ok: false, reason: "not_configured" });
    expect(driveRequests).toHaveLength(0);
    expect((await lookup(ALLOWED, { cookie })).body.lookup).toMatchObject({ ok: true, data: { id: ALLOWED } });
    expect(driveRequests).toHaveLength(1);
    expect(driveRequests[0].authorization).toBe("Bearer founder-drive-secret");
  });
});

describe("the application will not start with a placeholder or short session secret (docs-7)", () => {
  it.each(["__GENERATED_JWT_SECRET__", "too-short-secret"])("refuses HQ_JWT_SECRET=%j", async (secret) => {
    let child: ChildProcess | null = null;
    try {
      const started = startServer(BAD_PORT, { HQ_JWT_SECRET: secret }).then((c) => (child = c));
      await expect(started).rejects.toThrow(/will not start: HQ_JWT_SECRET/);
    } finally {
      (child as ChildProcess | null)?.kill("SIGTERM");
    }
  }, 90_000);

  it("refuses a placeholder database password", async () => {
    let child: ChildProcess | null = null;
    try {
      const started = startServer(BAD_PORT, { DATABASE_URL: "postgres://hq_app:__GENERATED_APP_DB_PASSWORD__@127.0.0.1:54329/none" }).then((c) => (child = c));
      await expect(started).rejects.toThrow(/will not start: DATABASE_URL/);
    } finally {
      (child as ChildProcess | null)?.kill("SIGTERM");
    }
  }, 90_000);
});
