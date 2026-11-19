import { type NextRequest, NextResponse } from "next/server";

/**
 * Runs before routing. Two jobs:
 *   - refuse an address whose path is not valid percent-encoding (for example "/modules/%E0%A4%A") with a
 *     plain 400. Left to the router, the production server answers such an address with a 500, which
 *     reads as "HQ is broken" rather than "that address is wrong";
 *   - (ROUND5 K8) answer a method outside the seven standard ones (GET, HEAD, POST, PUT, PATCH, DELETE,
 *     OPTIONS) on an API route with 405, its Allow header and a fresh x-request-id, as the routes' own
 *     handlers do for the standard methods they do not take (src/lib/server/http.ts otherMethods). Only
 *     methods that reach this function are answered here: Node's HTTP parser and the framework answer some
 *     before it runs (see docs/API.md, "Request ids").
 *
 * It reads nothing but the path and the method, and it never touches identity or permissions: those are
 * checked by each page and API route against the database.
 */
export function proxy(request: NextRequest): NextResponse {
  let path: string;
  try {
    path = new URL(request.url).pathname;
    decodeURIComponent(path);
  } catch {
    return new NextResponse("Bad request: that address is not valid.\n", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }
  if (!STANDARD_METHODS.includes(request.method)) {
    const allow = allowFor(path);
    if (allow) {
      const requestId = crypto.randomUUID();
      const message = `${request.method.slice(0, 20)} is not supported here. Use ${allow.replace(/, OPTIONS$/, "").replace(/, ([A-Z]+)$/, " or $1")}.`;
      const body =
        path === "/api/mcp"
          ? { jsonrpc: "2.0", id: null, error: { code: -32000, message, data: { code: "method_not_allowed", status: 405 } } }
          : { error: { code: "method_not_allowed", message, request_id: requestId } };
      return NextResponse.json(body, { status: 405, headers: { allow, "x-request-id": requestId, "cache-control": "no-store" } });
    }
  }
  return NextResponse.next();
}

const STANDARD_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/**
 * The Allow header of each API route (the methods its route.ts implements, HEAD with GET, OPTIONS always),
 * or null for an address that is not one of them. GET /api/v1/health is left out: it is the documented
 * exception that carries no request id. tests/api/methods.test.ts checks this table against the routes.
 */
export function allowFor(path: string): string | null {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/api/v1/health") return null;
  if (p === "/api/mcp") return "POST, OPTIONS";
  if (p === "/api/v1/decisions" || /^\/api\/v1\/proposals\/[^/]+\/review$/.test(p)) return "POST, OPTIONS";
  if (/^\/api\/v1\/tools\/[^/]+$/.test(p)) return "GET, HEAD, POST, OPTIONS";
  if (["/api/v1", "/api/v1/whoami", "/api/v1/integrations", "/api/v1/tools"].includes(p) || /^\/api\/v1\/proposals\/[^/]+$/.test(p)) return "GET, HEAD, OPTIONS";
  return null;
}

export const config = {
  // Everything except the framework's own static files.
  matcher: "/((?!_next/static|_next/image).*)",
};
