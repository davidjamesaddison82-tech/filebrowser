import { describe, expect, it } from "vitest";
import { DriveAdapter } from "@/lib/integrations/drive";
import { GitHubAdapter } from "@/lib/integrations/github";
import type { FetchLike } from "@/lib/integrations/http";

/** A fake fetch that records every call so we can prove what was (and was not) sent. */
function fakeFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, method: String(init?.method ?? "GET"), headers: (init?.headers ?? {}) as Record<string, string> });
    return respond(url, init);
  };
  return { impl, calls };
}
const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const REPO = "example-org/example-repo";
const config = { repositories: [REPO], apiBase: "https://api.github.test", token: "t" };

describe("AC12 — external services that are unavailable are handled safely (GitHub)", () => {
  it("reports 'not_configured' without making any request", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse({}));
    const adapter = new GitHubAdapter({ repositories: [], apiBase: "https://api.github.test" }, impl);
    expect(adapter.status().configured).toBe(false);
    expect(await adapter.resolveRef(REPO, "main")).toMatchObject({ ok: false, reason: "not_configured" });
    expect(calls).toHaveLength(0);
  });

  it("refuses repositories that are not on the allow-list, without making any request", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse({}));
    const adapter = new GitHubAdapter(config, impl);
    expect(await adapter.resolveRef("someone/else", "main")).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await adapter.listBranches("not a repo")).toMatchObject({ ok: false, reason: "forbidden" });
    expect(calls).toHaveLength(0);
  });

  it("returns a failure value when the network is down", async () => {
    const adapter = new GitHubAdapter(config, async () => {
      throw new TypeError("fetch failed");
    });
    expect(await adapter.resolveRef(REPO, "main")).toEqual({ ok: false, reason: "unreachable", detail: "The service could not be reached." });
  });

  it("returns 'timeout' when the service does not answer", async () => {
    const adapter = new GitHubAdapter(config, (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
    );
    const started = Date.now();
    const result = await (adapter as unknown as { resolveRef: GitHubAdapter["resolveRef"] }).resolveRef(REPO, "main");
    expect(result).toMatchObject({ ok: false, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(12_000);
  }, 15_000);

  it.each([
    [401, "unauthorised", {}],
    [403, "forbidden", {}],
    [403, "rate_limited", { "x-ratelimit-remaining": "0" }],
    [404, "not_found", {}],
    [429, "rate_limited", {}],
    [500, "unexpected_response", {}],
  ] as const)("maps HTTP %i to the named failure '%s'", async (status, reason, headers) => {
    const { impl } = fakeFetch(() => jsonResponse({ message: "x" }, status, headers));
    expect(await new GitHubAdapter(config, impl).resolveRef(REPO, "main")).toMatchObject({ ok: false, reason });
  });

  it("treats a non-JSON or malformed answer as unexpected, not as success", async () => {
    const html = fakeFetch(() => new Response("<html>gateway</html>", { status: 200 }));
    expect(await new GitHubAdapter(config, html.impl).resolveRef(REPO, "main")).toMatchObject({ ok: false, reason: "unexpected_response" });
    const noSha = fakeFetch(() => jsonResponse({ commit: {} }));
    expect(await new GitHubAdapter(config, noSha.impl).resolveRef(REPO, "main")).toMatchObject({ ok: false, reason: "unexpected_response" });
  });

  it("resolves a reference to an exact commit and only ever issues GET requests", async () => {
    const sha = "a".repeat(40);
    const { impl, calls } = fakeFetch((url) =>
      url.includes("/commits/")
        ? jsonResponse({ sha, html_url: "https://example.test/c", commit: { message: "Fix tempo\n\nbody", committer: { date: "2031-01-01T00:00:00Z" }, verification: { verified: true } } })
        : url.includes("/branches")
          ? jsonResponse([{ name: "main", commit: { sha }, protected: true }])
          : jsonResponse({ path: "src/a.ts", sha: "b".repeat(40), size: 12, type: "file" }),
    );
    const adapter = new GitHubAdapter(config, impl);
    expect(await adapter.resolveRef(REPO, "main")).toEqual({
      ok: true,
      data: { repository: REPO, sha, committed_at: "2031-01-01T00:00:00Z", message: "Fix tempo", html_url: "https://example.test/c", verified_signature: true },
    });
    expect(await adapter.listBranches(REPO)).toEqual({ ok: true, data: [{ name: "main", sha, protected: true }] });
    expect(await adapter.fileAt(REPO, sha, "src/a.ts")).toMatchObject({ ok: true, data: { path: "src/a.ts" } });
    expect(await adapter.fileAt(REPO, sha, "../etc/passwd")).toMatchObject({ ok: false, reason: "not_found" });
    expect(calls.length).toBe(3);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls.every((c) => c.url.startsWith("https://api.github.test/repos/example-org/example-repo/"))).toBe(true);
  });
});

describe("AC12 — external services that are unavailable are handled safely (Google Drive)", () => {
  it("reports 'not_configured' without making any request", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse({}));
    const adapter = new DriveAdapter({ apiBase: "https://drive.test/v3" }, impl);
    expect(adapter.status().configured).toBe(false);
    expect(await adapter.fileMetadata("1AbCdEfGhIjKlMnOp")).toMatchObject({ ok: false, reason: "not_configured" });
    expect(calls).toHaveLength(0);
  });

  it("rejects malformed file ids without making any request", async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse({}));
    const adapter = new DriveAdapter({ apiBase: "https://drive.test/v3", accessToken: "t" }, impl);
    expect(await adapter.fileMetadata("../../secret")).toMatchObject({ ok: false, reason: "not_found" });
    expect(calls).toHaveLength(0);
  });

  it("reads metadata only, with GET, and maps failures", async () => {
    const ok = fakeFetch(() => jsonResponse({ id: "1AbCdEfGhIjKlMnOp", name: "Doc", mimeType: "application/pdf", modifiedTime: "2031-01-02T00:00:00Z", version: "7", sha256Checksum: "c".repeat(64), size: "1024" }));
    const adapter = new DriveAdapter({ apiBase: "https://drive.test/v3", accessToken: "t" }, ok.impl);
    expect(await adapter.fileMetadata("1AbCdEfGhIjKlMnOp")).toMatchObject({ ok: true, data: { name: "Doc", version: "7", sha256: "c".repeat(64), size_bytes: 1024 } });
    expect(ok.calls[0].method).toBe("GET");
    expect(ok.calls[0].url).toContain("/files/1AbCdEfGhIjKlMnOp?fields=");
    expect(ok.calls[0].url).not.toContain("alt=media");
    const denied = fakeFetch(() => jsonResponse({}, 401));
    expect(await new DriveAdapter({ apiBase: "https://drive.test/v3", accessToken: "t" }, denied.impl).fileMetadata("1AbCdEfGhIjKlMnOp")).toMatchObject({ ok: false, reason: "unauthorised" });
    const down = new DriveAdapter({ apiBase: "https://drive.test/v3", accessToken: "t" }, async () => {
      throw new Error("ENOTFOUND");
    });
    expect(await down.fileMetadata("1AbCdEfGhIjKlMnOp")).toMatchObject({ ok: false, reason: "unreachable" });
  });
});
