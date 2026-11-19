/** Shared plumbing for API route handlers: authentication, scope checks, error mapping, audit. */
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { principalFromRequest } from "@/lib/auth/authenticate";
import { claimsFor, type Principal } from "@/lib/auth/principal";
import { audit } from "./db";
import { forbidden, fromDatabaseError, HqError, payloadTooLarge, unauthenticated } from "./errors";

/** A client's X-Request-Id is kept, as a correlation id only, in this form (the rule hq.log_refusal applies). */
const CLIENT_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The request id for a request: always one the server generates, so no client can give its request
 * the id of another request in the audit log (api-8, F6). A client's own id is kept apart, see below.
 */
export function requestIdFor(_request: Request): string {
  return randomUUID();
}

/**
 * A client's X-Request-Id, if well formed, or null. It is never the request id: it is echoed back in
 * X-Client-Request-Id and kept in audit rows as detail.client_request_id, for correlation only.
 */
export function clientRequestIdFor(request: Request): string | null {
  const offered = request.headers.get("x-request-id");
  return offered && CLIENT_REQUEST_ID.test(offered) ? offered : null;
}

/** The response headers that carry a request's ids. */
function idHeaders(requestId: string, clientRequestId: string | null = null): Record<string, string> {
  return { "x-request-id": requestId, ...(clientRequestId ? { "x-client-request-id": clientRequestId } : {}) };
}

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...init.headers },
  });
}

export function errorResponse(error: unknown, requestId: string, clientRequestId: string | null = null): Response {
  const e = error instanceof HqError ? error : fromDatabaseError(error);
  const headers: Record<string, string> = idHeaders(requestId, clientRequestId);
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

/**
 * Wrap a route handler: authenticate, run, translate errors, and never leak internals.
 *
 * A successful call is written to the audit log as allowed, under `action`, with the server's request
 * id. The two founder routes set `allowedRecordedByDatabase`: a founder act is recorded as allowed only
 * by the database function that performs it (hq.review_proposal, hq.record_founder_decision), and
 * hq.log_access refuses those action names from anyone, so nothing is logged for them here. A refusal
 * (401 or 403) is logged under `action` for every route.
 */
export async function withApi(
  request: Request,
  options: { action: string; scope?: "read" | "propose"; mutating?: boolean; allowedRecordedByDatabase?: boolean },
  handler: (ctx: ApiContext) => Promise<unknown>,
): Promise<Response> {
  const requestId = requestIdFor(request);
  const clientRequestId = clientRequestIdFor(request);
  let principal: Principal | null = null;
  try {
    principal = await principalFromRequest(request);
    if (!principal) throw unauthenticated("A valid API token (Authorization: Bearer …) or founder session is required.");
    if (options.mutating) assertSameOrigin(request);
    if (options.scope) requireScope(principal, options.scope);
    const result = await handler({ principal, requestId });
    if (!options.allowedRecordedByDatabase) {
      await audit(claimsFor(principal), { action: options.action, outcome: "allowed", requestId, clientRequestId });
    }
    return json(result, { headers: idHeaders(requestId, clientRequestId) });
  } catch (error) {
    const e = error instanceof HqError ? error : fromDatabaseError(error);
    if (e.status === 401 || e.status === 403) {
      await audit(principal ? claimsFor(principal) : null, {
        action: options.action,
        outcome: "denied",
        requestId,
        detail: { code: e.code, message: e.message, ...(clientRequestId ? { client_request_id: clientRequestId } : {}) },
      });
    }
    return errorResponse(e, requestId, clientRequestId);
  }
}

export const DEFAULT_MAX_BODY_BYTES = 1_048_576;

/** The body size limit for every JSON body (REST and MCP): HQ_MAX_BODY_BYTES, default 1 MiB. */
export function maxBodyBytes(env: Record<string, string | undefined> = process.env): number {
  const configured = Number(env.HQ_MAX_BODY_BYTES);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_BODY_BYTES;
}

/** How much of an oversized body is read and thrown away so the client still receives the 413. */
const DRAIN_LIMIT_BYTES = 16 * 1_048_576;

/**
 * Read the rest of a body without keeping it, so the server can answer before closing the connection
 * (a client still sending would otherwise see a reset instead of the 413). Past DRAIN_LIMIT_BYTES the
 * stream is cancelled instead.
 */
async function discardRest(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  let drained = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      drained += value.byteLength;
      if (drained > DRAIN_LIMIT_BYTES) break;
    }
  } catch {
    return;
  }
  await reader.cancel().catch(() => undefined);
}

/**
 * Read a request body as text, refusing (413) one larger than `limit` bytes: by Content-Length when
 * the client sends one, and while reading otherwise, so a chunked body is never held in memory past
 * the limit.
 */
export async function readBodyText(request: Request, limit = maxBodyBytes()): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > limit) {
    if (request.body) await discardRest(request.body.getReader());
    throw payloadTooLarge(limit);
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await discardRest(reader);
      throw payloadTooLarge(limit);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await readBodyText(request);
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new HqError(400, "invalid_json", "The request body must be a JSON object.");
}

type QueryKind = "boolean" | "number" | "string_list" | "string";

/** What a tool argument is declared as, looking through optional / default / nullable wrappers. */
function queryKind(schema: z.ZodType | undefined): QueryKind {
  let current = schema as { _zod?: { def: { type: string; innerType?: unknown; element?: unknown } } } | undefined;
  while (current?._zod && ["optional", "default", "nullable", "prefault", "readonly"].includes(current._zod.def.type)) {
    current = current._zod.def.innerType as typeof current;
  }
  const type = current?._zod?.def.type;
  if (type === "boolean") return "boolean";
  if (type === "number" || type === "int") return "number";
  if (type === "array") return "string_list";
  return "string";
}

/**
 * Turn query-string parameters into tool arguments, coercing a value only as the tool's input schema
 * declares that key: "true"/"false" for a boolean, a decimal number for a number, "a,b" for a list.
 * Every other value stays the string it was, so ?query=false searches for the word "false"; a value
 * that does not fit its declared type is left as text for the schema to refuse.
 */
export function argsFromQuery(url: URL, input?: z.ZodObject): Record<string, unknown> {
  const shape = (input?.shape ?? {}) as Record<string, z.ZodType>;
  const args: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams) {
    const kind = Object.hasOwn(shape, key) ? queryKind(shape[key]) : "string";
    if (kind === "boolean" && (value === "true" || value === "false")) args[key] = value === "true";
    else if (kind === "number" && /^-?\d+(\.\d+)?$/.test(value)) args[key] = Number(value);
    else if (kind === "string_list") args[key] = value.split(",").filter(Boolean);
    else args[key] = value;
  }
  return args;
}

/** Every HTTP method a route can export. */
export const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];
type MethodHandler = (request: Request) => Response;

/** The Allow header for a route that implements `methods` (HEAD comes with GET, OPTIONS always). */
function allowHeader(methods: readonly HttpMethod[]): string {
  const allowed = new Set<HttpMethod>([...methods, "OPTIONS"]);
  if (allowed.has("GET")) allowed.add("HEAD");
  return HTTP_METHODS.filter((m) => allowed.has(m)).join(", ");
}

/**
 * Handlers for the methods a route does NOT implement (H8, F6): 405 with `allow`, a fresh
 * `x-request-id` and the usual error body; OPTIONS answers 204 with `allow` and the id. Without them
 * Next answers on its own, with no request id. A route exports them beside its own handlers:
 *
 *   export const { PUT, PATCH, DELETE, OPTIONS } = otherMethods(["GET", "POST"]);
 *
 * `format: "jsonrpc"` gives the error body as a JSON-RPC error (the MCP endpoint).
 */
export function otherMethods(implemented: readonly HttpMethod[], format: "rest" | "jsonrpc" = "rest"): Record<HttpMethod, MethodHandler> {
  const allow = allowHeader(implemented);
  const notAllowed: MethodHandler = (request) => {
    const requestId = randomUUID();
    const message = `${request.method.slice(0, 20)} is not supported here. Use ${allow.replace(/, OPTIONS$/, "").replace(/, ([A-Z]+)$/, " or $1")}.`;
    const body =
      format === "jsonrpc"
        ? { jsonrpc: "2.0", id: null, error: { code: -32000, message, data: { code: "method_not_allowed", status: 405 } } }
        : { error: { code: "method_not_allowed", message, request_id: requestId } };
    return json(body, { status: 405, headers: { allow, "x-request-id": requestId } });
  };
  const options: MethodHandler = () =>
    new Response(null, { status: 204, headers: { allow, "x-request-id": randomUUID(), "cache-control": "no-store" } });
  const handlers = {} as Record<HttpMethod, MethodHandler>;
  for (const method of HTTP_METHODS) handlers[method] = method === "OPTIONS" ? options : notAllowed;
  return handlers;
}
