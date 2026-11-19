"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticatePassphrase, authenticateSessionToken, loginPrincipalId, type SignedIn } from "@/lib/auth/authenticate";
import { DEVICE_COOKIE, DEVICE_DAYS, type DeviceClaims, secureCookies, signDevice, verifyDevice } from "@/lib/auth/device";
import { claimsFor } from "@/lib/auth/principal";
import { safeNext } from "@/lib/auth/safe-next";
import { SESSION_COOKIE, SESSION_HOURS, signSession } from "@/lib/auth/session";
import { tooLongSignInInput } from "@/lib/auth/sign-in-input";
import { type Lane, signInThrottle } from "@/lib/auth/throttle";
import { audit, writeAs } from "@/lib/server/db";

/**
 * The client's address, for the audit log only. X-Forwarded-For is read only when HQ_TRUST_PROXY=1
 * says a proxy HQ trusts sets it (then the right-most hop, the one that proxy appended); otherwise a
 * client could write anything there. It never affects the throttle, which is keyed on the name (and
 * the device cookie).
 */
async function clientAddress(): Promise<string | null> {
  if (process.env.HQ_TRUST_PROXY !== "1") return null;
  const hops = ((await headers()).get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops.at(-1)?.slice(0, 64) ?? null;
}

/**
 * The throttle lane for this attempt: the device lane when the browser carries a valid device cookie
 * for the principal of this name, otherwise the name's anonymous lane. A forged, expired or malformed
 * cookie, or one for another principal, gets the anonymous lane. The name is looked up only when a valid
 * cookie is present, so without one a known and an unknown name take exactly the same path.
 */
async function laneFor(handle: string, device: DeviceClaims | null): Promise<Lane> {
  if (!device) return { name: handle };
  try {
    return (await loginPrincipalId(handle)) === device.sub ? { name: handle, device: device.did } : { name: handle };
  } catch {
    // The database is unreachable: the attempt itself will say so.
    return { name: handle };
  }
}

const NO_MATCH = "That name and passphrase do not match.";

export async function signIn(_previous: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const typed = String(formData.get("handle") ?? "").trim();
  const passphrase = String(formData.get("passphrase") ?? "");

  // Before anything else (G7): an over-long name or passphrase never reaches the throttle, the
  // database or the passphrase check. The refusal is audited with the length only, never the value.
  const tooLong = tooLongSignInInput(typed, passphrase);
  if (tooLong) {
    await audit(null, {
      action: "session.sign_in",
      objectType: "principal",
      // The name is kept only when it is not the over-long value.
      objectId: tooLong.field === "passphrase" ? typed.toLowerCase() || null : null,
      outcome: "denied",
      detail: { reason: `${tooLong.field}_too_long`, [`${tooLong.field}_length`]: tooLong.length },
    });
    return { error: NO_MATCH };
  }

  const handle = typed.toLowerCase();
  const next = safeNext(formData.get("next"));
  if (!handle || !passphrase) return { error: "Enter your name and passphrase." };
  const address = await clientAddress();
  const store = await cookies();
  const device = await verifyDevice(store.get(DEVICE_COOKIE)?.value);
  const lane = await laneFor(handle, device);

  const result = await signInThrottle().run<SignedIn | null | "unavailable">(lane, async () => {
    try {
      const found = await authenticatePassphrase(handle, passphrase);
      return { outcome: found ? "success" : "failure", value: found };
    } catch {
      return { outcome: "error", value: "unavailable" };
    }
  });
  if (result.busy) {
    await audit(null, {
      action: "session.sign_in",
      objectType: "principal",
      objectId: handle,
      outcome: "denied",
      detail: { reason: "too_many_in_progress", lane: lane.device ? "device" : "anonymous", ...(address ? { client_address: address } : {}) },
    });
    return { error: "Too many sign-in attempts are in progress. Try again in a moment." };
  }
  const principal = result.value;
  if (principal === "unavailable") {
    return { error: "HQ cannot reach its database right now. Check that the database is running and try again." };
  }
  if (!principal) {
    await audit(null, {
      action: "session.sign_in",
      objectType: "principal",
      objectId: handle,
      outcome: "denied",
      detail: {
        reason: "no_match",
        failures: signInThrottle().failures(lane),
        lane: lane.device ? "device" : "anonymous",
        ...(address ? { client_address: address } : {}),
      },
    });
    return { error: NO_MATCH };
  }

  const secure = secureCookies();
  store.set(SESSION_COOKIE, await signSession(principal.id, principal.sessionEpoch), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  // Set only now, after the passphrase matched, so the cookie says nothing about a name that was not
  // signed in. A browser that already holds one for this person keeps its device id.
  store.set(DEVICE_COOKIE, await signDevice(principal.id, device?.sub === principal.id ? device.did : undefined), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: DEVICE_DAYS * 24 * 3600,
  });
  await audit(claimsFor(principal), { action: "session.sign_in", objectType: "principal", objectId: principal.handle, outcome: "allowed" });
  redirect(next);
}

/**
 * Sign out everywhere: hq.end_sessions() increments the person's session epoch, so this cookie and any
 * copy of it (or another browser's session) stop working, then the cookie is removed from this browser.
 * The device cookie stays: it identifies the browser, not a session, and authenticates nothing.
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
