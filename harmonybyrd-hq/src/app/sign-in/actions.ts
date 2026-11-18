"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticatePassphrase, authenticateSessionToken, type SignedIn } from "@/lib/auth/authenticate";
import { claimsFor } from "@/lib/auth/principal";
import { safeNext } from "@/lib/auth/safe-next";
import { SESSION_COOKIE, SESSION_HOURS, signSession } from "@/lib/auth/session";
import { signInThrottle } from "@/lib/auth/throttle";
import { audit, writeAs } from "@/lib/server/db";

/**
 * The client's address, for the audit log only. X-Forwarded-For is read only when HQ_TRUST_PROXY=1
 * says a proxy HQ trusts sets it (then the right-most hop, the one that proxy appended); otherwise a
 * client could write anything there. It never affects the throttle, which is keyed on the name.
 */
async function clientAddress(): Promise<string | null> {
  if (process.env.HQ_TRUST_PROXY !== "1") return null;
  const hops = ((await headers()).get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops.at(-1)?.slice(0, 64) ?? null;
}

export async function signIn(_previous: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const handle = String(formData.get("handle") ?? "").trim().toLowerCase();
  const passphrase = String(formData.get("passphrase") ?? "");
  const next = safeNext(formData.get("next"));

  if (!handle || !passphrase) return { error: "Enter your name and passphrase." };
  const address = await clientAddress();

  const { value: principal } = await signInThrottle().run<SignedIn | null | "unavailable">(handle, async () => {
    try {
      const found = await authenticatePassphrase(handle, passphrase);
      return { outcome: found ? "success" : "failure", value: found };
    } catch {
      return { outcome: "error", value: "unavailable" };
    }
  });
  if (principal === "unavailable") {
    return { error: "HQ cannot reach its database right now. Check that the database is running and try again." };
  }
  if (!principal) {
    await audit(null, {
      action: "session.sign_in",
      objectType: "principal",
      objectId: handle,
      outcome: "denied",
      detail: { failures: signInThrottle().failures(handle), ...(address ? { client_address: address } : {}) },
    });
    return { error: "That name and passphrase do not match." };
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession(principal.id, principal.sessionEpoch), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.HQ_INSECURE_COOKIES !== "1",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  await audit(claimsFor(principal), { action: "session.sign_in", objectType: "principal", objectId: principal.handle, outcome: "allowed" });
  redirect(next);
}

/**
 * Sign out everywhere: hq.end_sessions() increments the person's session epoch, so this cookie and any
 * copy of it (or another browser's session) stop working, then the cookie is removed from this browser.
 */
export async function signOut(): Promise<void> {
  const store = await cookies();
  let principal = null;
  try {
    principal = await authenticateSessionToken(store.get(SESSION_COOKIE)?.value);
    if (principal) await writeAs(claimsFor(principal), (q) => q.query("select hq.end_sessions()"));
  } catch {
    // The database is unreachable: the cookie is still removed below, but other copies stay valid
    // until they expire. Record that the sign-out could not end them.
    if (principal) {
      await audit(claimsFor(principal), { action: "session.end_all", objectType: "principal", objectId: principal.handle, outcome: "error" });
    }
  }
  store.delete(SESSION_COOKIE);
  redirect("/sign-in");
}
