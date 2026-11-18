/** Shared plumbing for API route handlers: authentication, scope checks, error mapping, audit. */
import { randomUUID } from "node:crypto";
import { principalFromRequest } from "@/lib/auth/authenticate";
import { claimsFor, type Principal } from "@/lib/auth/principal";
import { audit } from "./db";
import { forbidden, fromDatabaseError, HqError, unauthenticated } from "./errors";

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...init.headers },
  });
}

export function errorResponse(error: unknown, requestId: string): Response {
  const e = error instanceof HqError ? error : fromDatabaseError(error);
  const headers: Record<string, string> = { "x-request-id": requestId };
  if (e.status === 401) headers["www-authenticate"] = 'Bearer realm="harmonybyrd-hq"';
  return json({ error: { code: e.code, message: e.message, ...(e.detail !== undefined ? { detail: e.detail } : {}), request_id: requestId } }, { status: e.status, headers });
}

/**
 * Cookie-authenticated requests that change something must come from HQ's own pages.
 * (Bearer-token requests are not ambient credentials, so they are exempt.)
 */
export function assertSameOrigin(request: Request): void {
  if (request.headers.get("authorization")) return;
  const origin = request.headers.get("origin");
  if (!origin) return; // non-browser client presenting a cookie explicitly
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = null;
  }
  if (!host || originHost !== host) {
    throw forbidden("Cross-site request refused.");
  }
}

export interface ApiContext {
  principal: Principal;
  requestId: string;
}

export function requireScope(principal: Principal, scope: "read" | "propose"): void {
  if (!principal.scopes.includes(scope)) {
    throw forbidden(`This credential does not carry the "${scope}" scope.`);
  }
}

/** Wrap a route handler: authenticate, run, translate errors, and never leak internals. */
export async function withApi(
  request: Request,
  options: { action: string; scope?: "read" | "propose"; mutating?: boolean },
  handler: (ctx: ApiContext) => Promise<unknown>,
): Promise<Response> {
  const requestId = request.headers.get("x-request-id")?.slice(0, 80) || randomUUID();
  let principal: Principal | null = null;
  try {
    principal = await principalFromRequest(request);
    if (!principal) throw unauthenticated("A valid API token (Authorization: Bearer …) or founder session is required.");
    if (options.mutating) assertSameOrigin(request);
    if (options.scope) requireScope(principal, options.scope);
    const result = await handler({ principal, requestId });
    await audit(claimsFor(principal), { action: options.action, outcome: "allowed", requestId });
    return json(result, { headers: { "x-request-id": requestId } });
  } catch (error) {
    const e = error instanceof HqError ? error : fromDatabaseError(error);
    if (e.status === 401 || e.status === 403) {
      await audit(principal ? claimsFor(principal) : null, {
        action: options.action,
        outcome: "denied",
        requestId,
        detail: { code: e.code, message: e.message },
      });
    }
    return errorResponse(e, requestId);
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new HqError(400, "invalid_json", "The request body must be a JSON object.");
}

/** Turn query-string parameters into tool arguments (numbers and booleans are coerced; `a,b` becomes a list for known list keys). */
export function argsFromQuery(url: URL): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams) {
    if (key === "types" || key === "module_ids") args[key] = value.split(",").filter(Boolean);
    else if (/^-?\d+$/.test(value) && ["rev", "limit", "base_rev"].includes(key)) args[key] = Number(value);
    else if (value === "true" || value === "false") args[key] = value === "true";
    else args[key] = value;
  }
  return args;
}
