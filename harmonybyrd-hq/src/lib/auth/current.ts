/** Session lookup for server-rendered pages and server actions (the only auth module that touches next/headers). */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticateSessionToken } from "./authenticate";
import type { Principal } from "./principal";
import { SESSION_COOKIE } from "./session";

/** The signed-in human for the current request, or null. */
export async function sessionPrincipal(): Promise<Principal | null> {
  const store = await cookies();
  return authenticateSessionToken(store.get(SESSION_COOKIE)?.value);
}

/** The signed-in human, or a redirect to the sign-in page. */
export async function requireSession(returnTo?: string): Promise<Principal> {
  const principal = await sessionPrincipal();
  if (!principal) {
    redirect(returnTo ? `/sign-in?next=${encodeURIComponent(returnTo)}` : "/sign-in");
  }
  return principal;
}
