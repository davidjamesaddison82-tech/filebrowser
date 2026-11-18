/**
 * D7 — sessions can be ended (database side of api-5 and docs-13).
 *
 * principals.session_epoch is returned by the two authentication look-ups; hq.end_sessions() increments
 * the caller's own epoch (only for a person signed in interactively), and a passphrase change increments
 * it too. The application (AUTH lane) signs the epoch into the session and refuses a session whose epoch
 * is no longer current; this file checks the database half, and that today's code keeps working.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { authenticatePassphrase, authenticateSessionToken } from "@/lib/auth/authenticate";
import { claimsFor } from "@/lib/auth/principal";
import { signSession } from "@/lib/auth/session";
import { setPassphrase } from "../../scripts/lib/principals";
import { admin, asAppRole, freshWorld, type TestWorld } from "../helpers/db";

let w: TestWorld;
beforeAll(async () => {
  w = await freshWorld();
});

async function epochOf(handle: string): Promise<number> {
  const client = await admin();
  try {
    return (await client.query<{ e: number }>("select session_epoch as e from hq.principals where handle = $1", [handle])).rows[0].e;
  } finally {
    await client.end();
  }
}

const lookups = (id: string, handle: string) =>
  asAppRole("hq_auth", null, async (c) => ({
    principal: (await c.query("select hq.auth_get_principal($1::uuid) as p", [id])).rows[0].p,
    login: (await c.query("select hq.auth_find_login($1) as l", [handle])).rows[0].l,
  }));

describe("D7 — the session epoch", () => {
  it("both authentication look-ups return the current epoch, alongside every key they returned before", async () => {
    const { principal, login } = await lookups(w.founder.id, "founder");
    const epoch = await epochOf("founder");
    expect(principal).toEqual({ principal_id: w.founder.id, handle: "founder", display_name: "Founder", kind: "human", app_role: "founder", session_epoch: epoch });
    expect(login).toMatchObject({ principal_id: w.founder.id, handle: "founder", kind: "human", app_role: "founder", scheme: "scrypt-v1", session_epoch: epoch });
    expect(typeof login.secret_hash).toBe("string");
  });

  it("the existing sign-in and session code keeps working with the extra key", async () => {
    expect(await authenticatePassphrase("developer", w.passphrases.developer)).toMatchObject({ handle: "developer", amr: "session" });
    expect(await authenticateSessionToken(await signSession(w.founder.id))).toMatchObject({ handle: "founder", appRole: "founder", amr: "session" });
  });

  it("end_sessions increments only the caller's own epoch, and records it", async () => {
    const [founder, developer] = [await epochOf("founder"), await epochOf("developer")];
    await asAppRole("authenticated", claimsFor(w.founder), (c) => c.query("select hq.end_sessions()"));
    expect(await epochOf("founder")).toBe(founder + 1);
    expect(await epochOf("developer")).toBe(developer);
    await asAppRole("authenticated", claimsFor(w.developer), (c) => c.query("select hq.end_sessions()"));
    expect(await epochOf("developer")).toBe(developer + 1);
    expect((await lookups(w.founder.id, "founder")).principal.session_epoch).toBe(founder + 1);

    const client = await admin();
    try {
      const row = (await client.query("select principal_handle, action, outcome, detail from hq.audit_log where action = 'session.end_all' order by id desc limit 1")).rows[0];
      expect(row).toEqual({ principal_handle: "developer", action: "session.end_all", outcome: "allowed", detail: { session_epoch: developer + 1 } });
    } finally {
      await client.end();
    }
  });

  it("API tokens and callers without a session cannot use it, and nothing changes", async () => {
    const before = await Promise.all(["founder", "developer", "claude"].map(epochOf));
    const ghost = { sub: "00000000-0000-4000-8000-00000000dead", role: "authenticated", amr: "session", client: null };
    const refused: [string, object, string][] = [
      ["AI client token", claimsFor(w.claude), "HQ403"],
      ["developer token", { ...claimsFor(w.developer), amr: "api_token", scopes: ["read", "propose"] }, "HQ403"],
      ["no claims", {}, "HQ401"],
      ["unknown subject", ghost, "HQ401"],
    ];
    for (const [what, claims, code] of refused) {
      await expect(asAppRole("authenticated", claims, (c) => c.query("select hq.end_sessions()")), what).rejects.toMatchObject({ code });
    }
    for (const role of ["anon", "hq_auth"] as const) {
      await expect(asAppRole(role, claimsFor(w.founder), (c) => c.query("select hq.end_sessions()")), role).rejects.toMatchObject({ code: "42501" });
    }
    expect(await Promise.all(["founder", "developer", "claude"].map(epochOf))).toEqual(before);
  });

  it("a new passphrase increments the epoch (docs-13: a passphrase reset ends existing sessions)", async () => {
    const before = await epochOf("reader");
    const client = await admin();
    try {
      await setPassphrase(client, w.reader.id, "a-new-reader-passphrase");
    } finally {
      await client.end();
    }
    expect(await epochOf("reader")).toBe(before + 1);
    expect(await authenticatePassphrase("reader", "a-new-reader-passphrase")).toMatchObject({ handle: "reader" });
  });

  it("API roles cannot read the look-ups (only hq_auth can)", async () => {
    for (const fn of ["select hq.auth_get_principal($1::uuid)", "select hq.auth_find_login('founder')"]) {
      await expect(
        asAppRole("authenticated", claimsFor(w.founder), (c) => c.query(fn, fn.includes("$1") ? [w.founder.id] : [])),
        fn,
      ).rejects.toMatchObject({ code: "42501" });
    }
  });
});
