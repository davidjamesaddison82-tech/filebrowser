import { type NextRequest, NextResponse } from "next/server";

/**
 * Runs before routing. One job: refuse an address whose path is not valid percent-encoding
 * (for example "/modules/%E0%A4%A") with a plain 400. Left to the router, the production
 * server answers such an address with a 500, which reads as "HQ is broken" rather than
 * "that address is wrong".
 *
 * It reads nothing but the path, and it never touches identity or permissions: those are
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
  return NextResponse.next();
}

export const config = {
  // Everything except the framework's own static files.
  matcher: "/((?!_next/static|_next/image).*)",
};
