/**
 * GitHub adapter (read-only).
 *
 * GitHub stays the authority for code. HQ never stores a copy of a repository: it stores a
 * reference (repository + commit SHA + path) and can ask GitHub whether that reference exists
 * and what it points at.
 */
import { type FetchLike, getJson, type IntegrationResult } from "./http";

export interface GitHubConfig {
  token?: string;
  /** Repositories HQ is allowed to ask about, as "owner/name". Empty means none. */
  repositories: string[];
  apiBase: string;
}

export function githubConfigFromEnv(env: Record<string, string | undefined> = process.env): GitHubConfig {
  return {
    token: env.HQ_GITHUB_TOKEN || undefined,
    repositories: (env.HQ_GITHUB_REPOSITORIES ?? "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean),
    apiBase: (env.HQ_GITHUB_API ?? "https://api.github.com").replace(/\/+$/, ""),
  };
}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF = /^[A-Za-z0-9_./-]{1,200}$/;

export interface CommitInfo {
  repository: string;
  sha: string;
  committed_at: string | null;
  message: string;
  html_url: string | null;
  verified_signature: boolean | null;
}

export interface BranchInfo {
  name: string;
  sha: string;
  protected: boolean;
}

export class GitHubAdapter {
  constructor(
    private readonly config: GitHubConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  status(): { configured: boolean; authenticated: boolean; repositories: string[] } {
    return { configured: this.config.repositories.length > 0, authenticated: !!this.config.token, repositories: this.config.repositories };
  }

  private headers(): Record<string, string> {
    return {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "harmonybyrd-hq",
      ...(this.config.token ? { authorization: `Bearer ${this.config.token}` } : {}),
    };
  }

  private guard<T>(repository: string): IntegrationResult<T> | null {
    if (this.config.repositories.length === 0) {
      return { ok: false, reason: "not_configured", detail: "No repository is configured (HQ_GITHUB_REPOSITORIES)." };
    }
    if (!REPO.test(repository) || !this.config.repositories.includes(repository)) {
      return { ok: false, reason: "forbidden", detail: `Repository "${repository}" is not on HQ's allow-list.` };
    }
    return null;
  }

  /** Resolve a branch, tag or SHA to the commit it points at. */
  async resolveRef(repository: string, ref: string): Promise<IntegrationResult<CommitInfo>> {
    const blocked = this.guard<CommitInfo>(repository);
    if (blocked) return blocked;
    if (!REF.test(ref)) return { ok: false, reason: "not_found", detail: "Not a valid git reference." };
    const result = await getJson<{
      sha: string;
      html_url?: string;
      commit?: { message?: string; committer?: { date?: string }; verification?: { verified?: boolean } };
    }>(this.fetchImpl, `${this.config.apiBase}/repos/${repository}/commits/${encodeURIComponent(ref)}`, this.headers());
    if (!result.ok) return result;
    if (typeof result.data?.sha !== "string") return { ok: false, reason: "unexpected_response", detail: "No commit SHA in the response." };
    return {
      ok: true,
      data: {
        repository,
        sha: result.data.sha,
        committed_at: result.data.commit?.committer?.date ?? null,
        message: (result.data.commit?.message ?? "").split("\n")[0].slice(0, 200),
        html_url: result.data.html_url ?? null,
        verified_signature: result.data.commit?.verification?.verified ?? null,
      },
    };
  }

  async listBranches(repository: string): Promise<IntegrationResult<BranchInfo[]>> {
    const blocked = this.guard<BranchInfo[]>(repository);
    if (blocked) return blocked;
    const result = await getJson<{ name: string; commit: { sha: string }; protected?: boolean }[]>(
      this.fetchImpl,
      `${this.config.apiBase}/repos/${repository}/branches?per_page=100`,
      this.headers(),
    );
    if (!result.ok) return result;
    if (!Array.isArray(result.data)) return { ok: false, reason: "unexpected_response", detail: "Expected a list of branches." };
    return { ok: true, data: result.data.map((b) => ({ name: b.name, sha: b.commit?.sha, protected: !!b.protected })) };
  }

  /** Does `path` exist at `ref`? Returns the blob SHA when it does. */
  async fileAt(repository: string, ref: string, path: string): Promise<IntegrationResult<{ path: string; blob_sha: string; size: number }>> {
    const blocked = this.guard<{ path: string; blob_sha: string; size: number }>(repository);
    if (blocked) return blocked;
    if (!REF.test(ref) || path.includes("..")) return { ok: false, reason: "not_found", detail: "Not a valid reference or path." };
    const result = await getJson<{ path: string; sha: string; size: number; type: string }>(
      this.fetchImpl,
      `${this.config.apiBase}/repos/${repository}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
      this.headers(),
    );
    if (!result.ok) return result;
    if (result.data?.type !== "file") return { ok: false, reason: "not_found", detail: "That path is not a file at this revision." };
    return { ok: true, data: { path: result.data.path, blob_sha: result.data.sha, size: result.data.size } };
  }
}
