/**
 * H8 (Y12, F6 remainder): every answer of an API route carries the request id, whatever the method.
 *
 * Next answers a method a route does not export on its own (405, or 204 for OPTIONS), with no
 * x-request-id and an empty body. Every route under src/app/api now exports those methods through the
 * shared handlers (http.ts otherMethods). The routes are found on disk, so a new route cannot be left out.
 * GET /api/v1/health stays the documented exception: it carries no request id.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { freshWorld, type TestWorld } from "../helpers/db";
import { TEST_BASE_URL } from "../helpers/env";

const API_DIR = path.resolve(import.meta.dirname, "..", "..", "src", "app", "api");
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Every route.ts under src/app/api, as a URL path with its dynamic segments filled in. */
function discoverRoutes(dir = API_DIR, prefix = "/api"): { file: string; url: string }[] {
  const found: { file: string; url: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const segment = entry.name === "[id]" ? "00000000-0000-0000-0000-000000000000" : entry.name === "[name]" ? "list_sources" : entry.name;
      expect(segment, `a dynamic segment this test does not know: ${full}`).not.toMatch(/^\[/);
      found.push(...discoverRoutes(full, `${prefix}/${segment}`));
    } else if (entry.name === "route.ts") {
      found.push({ file: path.relative(API_DIR, full), url: prefix });
    }
  }
  return found;
}

const ROUTES = discoverRoutes();
const HEALTH = "/api/v1/health";

let w: TestWorld;
beforeAll(async () => {
  w = await freshWorld();
});

async function send(method: (typeof METHODS)[number], url: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${w.tokens.claudeReadOnly}` };
  let body: string | undefined;
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers["content-type"] = "application/json";
    body = url === "/api/mcp" ? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) : "{}";
  }
  const res = await fetch(`${TEST_BASE_URL}${url}`, { method, headers, body, redirect: "manual" });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

describe("every API route answers every method with a request id (H8)", () => {
  it("finds the routes on disk", () => {
    expect(ROUTES.map((r) => r.url).sort()).toEqual(
      expect.arrayContaining(["/api/mcp", "/api/v1", "/api/v1/decisions", "/api/v1/tools/list_sources", "/api/v1/whoami", HEALTH]),
    );
    expect(ROUTES.length).toBeGreaterThanOrEqual(10);
  });

  it.each(ROUTES.filter((r) => r.url !== HEALTH).map((r) => [r.file, r.url]))("%s", async (_file, url) => {
    const answers = new Map<string, Awaited<ReturnType<typeof send>>>();
    for (const method of METHODS) answers.set(method, await send(method, url));
    const notAllowed = METHODS.filter((m) => answers.get(m)!.status === 405);
    // The route implements at least one method, and does not implement at least one.
    expect(notAllowed.length, url).toBeGreaterThan(0);
    expect(notAllowed.length, url).toBeLessThan(METHODS.length - 1);
    const options = answers.get("OPTIONS")!;
    const allow = (options.headers.get("allow") ?? "").split(/,\s*/).filter(Boolean).sort();

    for (const method of METHODS) {
      const a = answers.get(method)!;
      expect(a.status, `${method} ${url}`).not.toBe(500);
      expect(a.headers.get("x-request-id") ?? "", `${method} ${url} carries x-request-id`).toMatch(UUID);
      if (method === "OPTIONS") {
        expect(a.status, `OPTIONS ${url}`).toBe(204);
        continue;
      }
      if (a.status === 405) {
        // Allow names what does work, the same on every answer of the route.
        expect((a.headers.get("allow") ?? "").split(/,\s*/).sort(), `${method} ${url}`).toEqual(allow);
        expect(allow, `${method} ${url}`).not.toContain(method);
        if (method !== "HEAD") {
          const body = JSON.parse(a.text);
          if (url === "/api/mcp") {
            expect(body).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32000 } });
          } else {
            expect(body.error.code).toBe("method_not_allowed");
            expect(body.error.request_id).toBe(a.headers.get("x-request-id"));
          }
        }
      } else {
        expect(allow, `${method} ${url} works, so Allow lists it`).toContain(method);
      }
    }
    // Every method not in Allow is refused with 405.
    for (const method of METHODS.filter((m) => !allow.includes(m))) expect(answers.get(method)!.status, `${method} ${url}`).toBe(405);
  });

  it("two answers never share a request id", async () => {
    const a = await send("PUT", "/api/v1/whoami");
    const b = await send("PUT", "/api/v1/whoami");
    expect(a.headers.get("x-request-id")).not.toBe(b.headers.get("x-request-id"));
  });

  it("GET /api/v1/health stays the documented exception: no request id, and other methods are still refused", async () => {
    const res = await fetch(`${TEST_BASE_URL}${HEALTH}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBeNull();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) expect((await send(method, HEALTH)).status).toBe(405);
  });

  it("each route file exports its other methods through the shared handlers", () => {
    for (const route of ROUTES.filter((r) => r.url !== HEALTH)) {
      expect(readFileSync(path.join(API_DIR, route.file), "utf8"), route.file).toMatch(/export const \{[^}]*OPTIONS[^}]*\} = otherMethods\(/);
    }
  });
});

describe("ROUND5 K8 (Z11): methods outside the seven standard ones", () => {
  const OTHER = ["PROPFIND", "QUERY", "SEARCH", "LINK", "PURGE", "M-SEARCH", "MKCOL"];
  const { port } = new URL(TEST_BASE_URL);

  /** One request over a raw socket: fetch cannot send these methods. */
  async function raw(method: string, url: string): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    const net = await import("node:net");
    const text = await new Promise<string>((resolve) => {
      const socket = net.connect(Number(port), "127.0.0.1");
      let got = "";
      socket.on("connect", () => socket.write(`${method} ${url} HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\nconnection: close\r\n\r\n`));
      socket.on("data", (d) => (got += d));
      socket.on("close", () => resolve(got));
      socket.on("error", () => resolve(got));
      socket.setTimeout(15_000, () => socket.destroy());
    });
    const [head, ...rest] = text.split("\r\n\r\n");
    const lines = head.split("\r\n");
    const headers = Object.fromEntries(lines.slice(1).map((l) => [l.slice(0, l.indexOf(":")).toLowerCase(), l.slice(l.indexOf(":") + 1).trim()]));
    return { status: Number(lines[0].split(" ")[1]), headers, body: rest.join("\r\n\r\n") };
  }

  it.each(ROUTES.filter((r) => r.url !== HEALTH).map((r) => [r.file, r.url]))("%s: 405 with the route's Allow and a fresh request id", async (_file, url) => {
    const allow = (await send("OPTIONS", url)).headers.get("allow");
    const ids = new Set<string>();
    for (const method of OTHER) {
      const res = await raw(method, url);
      expect(res.status, `${method} ${url}`).toBe(405);
      expect(res.headers.allow, `${method} ${url}`).toBe(allow);
      expect(res.headers["x-request-id"] ?? "", `${method} ${url}`).toMatch(UUID);
      ids.add(res.headers["x-request-id"]);
      if (url !== "/api/mcp") expect(res.body).toContain(res.headers["x-request-id"]);
    }
    expect(ids.size).toBe(OTHER.length);
  });

  it("the proxy's table of Allow headers is the routes' own", async () => {
    const { allowFor } = await import("@/proxy");
    for (const route of ROUTES) {
      if (route.url === HEALTH) expect(allowFor(route.url)).toBeNull();
      else expect(allowFor(route.url), route.url).toBe((await send("OPTIONS", route.url)).headers.get("allow"));
    }
  });
});
