"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticatePassphrase } from "@/lib/auth/authenticate";
import { claimsFor } from "@/lib/auth/principal";
import { SESSION_COOKIE, SESSION_HOURS, signSession } from "@/lib/auth/session";
import { audit } from "@/lib/server/db";

declare global {
  // eslint-disable-next-line no-var
  var __hqSignInAttempts: Map<string, { count: number; first: number }> | undefined;
}

const WINDOW_MS = 5 * 60_000;
const MAX_ATTEMPTS = 8;

/** Only failed attempts count, and a successful sign-in clears them, so normal use never locks anyone out. */
function isThrottled(key: string): boolean {
  const attempts = (globalThis.__hqSignInAttempts ??= new Map());
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string): void {
  const attempts = (globalThis.__hqSignInAttempts ??= new Map());
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) attempts.set(key, { count: 1, first: now });
  else entry.count += 1;
}

function clearFailures(key: string): void {
  globalThis.__hqSignInAttempts?.delete(key);
}

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
}

export async function signIn(_previous: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const handle = String(formData.get("handle") ?? "").trim().toLowerCase();
  const passphrase = String(formData.get("passphrase") ?? "");
  const next = safeNext(formData.get("next"));
  const forwarded = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

  if (!handle || !passphrase) return { error: "Enter your name and passphrase." };
  const throttleKey = `${handle}|${forwarded}`;
  if (isThrottled(throttleKey)) {
    await audit(null, { action: "session.sign_in", objectType: "principal", objectId: handle, outcome: "denied", detail: { reason: "throttled" } });
    return { error: "Too many attempts. Wait a few minutes and try again." };
  }

  let principal;
  try {
    principal = await authenticatePassphrase(handle, passphrase);
  } catch {
    return { error: "HQ cannot reach its database right now. Check that the database is running and try again." };
  }
  if (!principal) {
    recordFailure(throttleKey);
    await audit(null, { action: "session.sign_in", objectType: "principal", objectId: handle, outcome: "denied" });
    return { error: "That name and passphrase do not match." };
  }
  clearFailures(throttleKey);

  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession(principal.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.HQ_INSECURE_COOKIES !== "1",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  await audit(claimsFor(principal), { action: "session.sign_in", objectType: "principal", objectId: principal.handle, outcome: "allowed" });
  redirect(next);
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/sign-in");
}
