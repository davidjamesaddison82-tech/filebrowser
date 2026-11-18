import type { DbClaims } from "@/lib/server/db";

export type AppRole = "founder" | "developer" | "ai_agent" | "reader";
export type PrincipalKind = "human" | "ai_client" | "service";

/** The authenticated caller of a request. Role and kind always come from the database, never from the token. */
export interface Principal {
  id: string;
  handle: string;
  displayName: string;
  kind: PrincipalKind;
  appRole: AppRole;
  /** "session": interactive human sign-in. "api_token": programmatic client. */
  amr: "session" | "api_token";
  /** API token scopes. Sessions carry the scopes implied by their role. */
  scopes: string[];
  credentialId?: string;
}

export function claimsFor(principal: Principal): DbClaims {
  return {
    sub: principal.id,
    role: "authenticated",
    amr: principal.amr,
    client: principal.kind === "ai_client" ? principal.handle : null,
    ...(principal.amr === "api_token" ? { scopes: principal.scopes } : {}),
  };
}

export const ROLE_LABEL: Record<AppRole, string> = {
  founder: "Founder",
  developer: "Developer",
  ai_agent: "AI client",
  reader: "Reader",
};

export function canPropose(principal: Principal): boolean {
  if (principal.appRole === "reader") return false;
  if (principal.amr === "api_token") return principal.scopes.includes("propose");
  return true;
}

/** Founder authority: an interactive session of a human founder. Nothing else qualifies. */
export function isFounderSession(principal: Principal | null): boolean {
  return !!principal && principal.appRole === "founder" && principal.kind === "human" && principal.amr === "session";
}

export function publicPrincipal(principal: Principal) {
  return {
    handle: principal.handle,
    display_name: principal.displayName,
    kind: principal.kind,
    role: principal.appRole,
    authenticated_by: principal.amr,
    scopes: principal.scopes,
  };
}
