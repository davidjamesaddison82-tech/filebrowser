import { beforeAll, describe, expect, it } from "vitest";
import { asAppRole, freshWorld, type TestWorld } from "../helpers/db";
import { claimsFor } from "@/lib/auth/principal";
import { api, sessionCookie } from "../helpers/http";

let w: TestWorld;
let founderCookie: string;
let developerCookie: string;
beforeAll(async () => {
  w = await freshWorld();
  founderCookie = await sessionCookie(w.founder.id);
  developerCookie = await sessionCookie(w.developer.id);
});

type ErrorBody = { error: { code: string; message: string; detail?: unknown; request_id: string } };

describe("REST API — identity and permission on every request", () => {
  it("answers a liveness check without revealing anything", async () => {
    const res = await api("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, database: "reachable" });
  });

  it("refuses unauthenticated requests with 401 and a Bearer challenge", async () => {
    for (const path of ["/api/v1", "/api/v1/tools", "/api/v1/tools/get_ecosystem_overview", "/api/v1/whoami", "/api/v1/integrations"]) {
      const res = await api<ErrorBody>(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error.code).toBe("unauthenticated");
      expect(res.headers.get("www-authenticate")).toMatch(/^Bearer/);
    }
    expect((await api("/api/v1/tools/get_ecosystem_overview", { token: "hbq_deadbeef_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })).status).toBe(401);
    expect((await api("/api/v1/whoami", { headers: { authorization: "Basic Zm9vOmJhcg==" } })).status).toBe(401);
  });

  it("identifies each client separately", async () => {
    const claude = await api<{ handle: string; kind: string; role: string; can: Record<string, boolean> }>("/api/v1/whoami", { token: w.tokens.claude });
    const chatgpt = await api<{ handle: string }>("/api/v1/whoami", { token: w.tokens.chatgpt });
    expect(claude.body).toMatchObject({ handle: "claude", kind: "ai_client", role: "ai_agent", can: { read: true, propose: true, review_or_accept: false } });
    expect(chatgpt.body.handle).toBe("chatgpt");
  });

  it("lists the tools and states which operations are not available as tools", async () => {
    const res = await api<{ tools: { name: string; mode: string; input_schema: { type: string } }[]; not_available_as_tools: string[] }>("/api/v1/tools", { token: w.tokens.claude });
    const names = res.body.tools.map((t) => t.name);
    for (const required of [
      "get_ecosystem_overview", "get_module_brief", "get_learning_loop", "search_founder_requirements", "find_outstanding_requirements",
      "get_acceptance_status", "get_source_lineage", "get_development_dependencies", "submit_change_proposal", "submit_defect_report", "record_test_evidence",
    ]) {
      expect(names, required).toContain(required);
    }
    // No tool performs a founder act. (Read-only tools that *report* on review items or acceptance status are fine;
    // an earlier version of this check matched the word "review" anywhere and wrongly flagged get_review_items.)
    const founderActs = /^(review_proposal|accept_|approve_|record_founder_decision|record_decision|set_acceptance|issue_credential|revoke_credential)/;
    expect(names.filter((n) => founderActs.test(n))).toEqual([]);
    expect(res.body.tools.every((t) => t.mode === "read" || t.mode === "propose")).toBe(true);
    expect(res.body.tools.filter((t) => t.mode === "propose").map((t) => t.name).sort()).toEqual(["record_test_evidence", "submit_change_proposal", "submit_defect_report"]);
    expect(res.body.tools.every((t) => t.input_schema.type === "object")).toBe(true);
    expect(res.body.not_available_as_tools.join(" ")).toMatch(/review_proposal/);
  });

  it("returns a module with provenance over GET and POST alike", async () => {
    const viaGet = await api<{ data: { id: string }; provenance: { sources: { id: string; sha256: string }[] }; revision: { rev: number } }>(
      "/api/v1/tools/get_module_brief?module=MOD-FX-ALPHA", { token: w.tokens.claude });
    const viaPost = await api<typeof viaGet.body>("/api/v1/tools/get_module_brief", { token: w.tokens.claude, body: { module: "MOD-FX-ALPHA" } });
    expect(viaGet.status).toBe(200);
    expect(viaGet.body.data.id).toBe("MOD-FX-ALPHA");
    expect(viaGet.body.provenance.sources.map((s) => s.id)).toEqual(["SRC-F01", "SRC-F02"]);
    expect(viaGet.body.provenance.sources[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(viaPost.body.data)).toBe(JSON.stringify(viaGet.body.data));
    expect(viaGet.headers.get("cache-control")).toBe("no-store");
  });

  it("AC5 over HTTP — two clients pinning the same revision receive byte-identical data", async () => {
    const path = "/api/v1/tools/get_ecosystem_overview?rev=1";
    const a = await api<{ data: unknown; revision: unknown }>(path, { token: w.tokens.claude });
    const b = await api<{ data: unknown; revision: unknown }>(path, { token: w.tokens.chatgpt });
    expect(JSON.stringify(a.body.data)).toBe(JSON.stringify(b.body.data));
    expect(a.body.revision).toEqual(b.body.revision);
  });

  it("rejects bad input with a clear error and never a stack trace", async () => {
    const unknownTool = await api<ErrorBody>("/api/v1/tools/drop_everything", { token: w.tokens.claude });
    expect(unknownTool.status).toBe(404);
    const badArgs = await api<ErrorBody>("/api/v1/tools/get_module_brief", { token: w.tokens.claude, body: {} });
    expect(badArgs.status).toBe(422);
    expect(JSON.stringify(badArgs.body.error.detail)).toMatch(/module/);
    const badJson = await api<ErrorBody>("/api/v1/tools/get_module_brief", { token: w.tokens.claude, body: "{not json" });
    expect(badJson.status).toBe(400);
    const missing = await api<ErrorBody>("/api/v1/tools/get_module_brief?module=MOD-NOPE", { token: w.tokens.claude });
    expect(missing.status).toBe(404);
    for (const res of [unknownTool, badArgs, badJson, missing]) {
      expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(ts|js):\d+|node_modules|select .* from/i);
      expect(res.body.error.request_id).toBeTruthy();
    }
  });

  it("a tool that writes to the inbox cannot be called with GET", async () => {
    const res = await api<ErrorBody>("/api/v1/tools/submit_defect_report?title=x", { token: w.tokens.claude });
    expect(res.status).toBe(404);
  });
});

describe("REST API — the proposal inbox and founder authority", () => {
  let proposalId: string;

  it("lets an AI client submit a proposal, which changes nothing", async () => {
    const res = await api<{ proposal: { id: string; status: string }; status: string; note: string }>("/api/v1/tools/submit_change_proposal", {
      token: w.tokens.claude,
      body: { title: "Interpretation via API", rationale: "Recorded for review.", base_rev: 1, target: { type: "requirement", id: "FR-FX-004", base_version: 1 }, set: { interpretation: "No overlays." } },
    });
    expect(res.status).toBe(200);
    proposalId = res.body.proposal.id;
    expect(res.body.proposal.status).toBe("submitted");
    expect(res.body.note).toMatch(/changed no record/);
    const record = await api<{ data: { record: { interpretation: null }; meta: { version: number } }; revision: { rev: number } }>(
      "/api/v1/tools/get_record?type=requirement&id=FR-FX-004", { token: w.tokens.claude });
    expect(record.body.data.record.interpretation).toBeNull();
    expect(record.body.revision.rev).toBe(1);
  });

  it("refuses a read-only token that tries to propose", async () => {
    const res = await api<ErrorBody>("/api/v1/tools/submit_defect_report", {
      token: w.tokens.claudeReadOnly,
      body: { title: "Defect", description: "x x x", module_ids: ["MOD-FX-ALPHA"], base_rev: 1 },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/"propose" scope/);
  });

  it("refuses a stale write with 409 and says which version is current", async () => {
    const res = await api<ErrorBody>("/api/v1/tools/submit_change_proposal", {
      token: w.tokens.chatgpt,
      body: { title: "Stale", rationale: "x x x", base_rev: 1, target: { type: "requirement", id: "FR-FX-004", base_version: 9 }, set: { interpretation: "y" } },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("conflict");
    expect(res.body.error.detail).toMatchObject({ current_version: 1, base_version: 9 });
  });

  it("hides one client's proposal from another client", async () => {
    expect((await api(`/api/v1/proposals/${proposalId}`, { token: w.tokens.claude })).status).toBe(200);
    expect((await api(`/api/v1/proposals/${proposalId}`, { token: w.tokens.chatgpt })).status).toBe(404);
    const mine = await api<{ data?: unknown; proposals: unknown[] }>("/api/v1/tools/list_my_proposals", { token: w.tokens.chatgpt });
    expect(mine.body.proposals).toEqual([]);
  });

  it("AC8 over HTTP — no API token can review a proposal or record a decision", async () => {
    for (const token of [w.tokens.claude, w.tokens.chatgpt, w.tokens.developer]) {
      const review = await api<ErrorBody>(`/api/v1/proposals/${proposalId}/review`, { token, body: { decision: "accept" } });
      expect(review.status).toBe(403);
      expect(review.body.error.message).toMatch(/Founder authority is required/);
      const decision = await api<ErrorBody>("/api/v1/decisions", {
        token,
        body: { title: "Accept my own work", exact_text: "Accepted.", effects: [{ type: "set_acceptance", record_type: "build", record_id: "BLD-FX-01", state: "accepted" }] },
      });
      expect(decision.status).toBe(403);
    }
    const status = await api<{ data: { recorded_in_hq: unknown; headline: string } }>("/api/v1/tools/get_acceptance_status?type=build&id=BLD-FX-01", { token: w.tokens.claude });
    expect(status.body.data.recorded_in_hq).toBeNull();
    expect(status.body.data.headline).toBe("build_candidate");
  });

  it("a signed-in developer cannot review either", async () => {
    const res = await api<ErrorBody>(`/api/v1/proposals/${proposalId}/review`, { cookie: developerCookie, body: { decision: "accept" } });
    expect(res.status).toBe(403);
  });

  it("refuses a cross-site request that rides on the founder's session cookie", async () => {
    const res = await api<ErrorBody>(`/api/v1/proposals/${proposalId}/review`, {
      cookie: founderCookie,
      body: { decision: "accept" },
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/Cross-site/);
    const still = await api<{ proposal: { status: string } }>(`/api/v1/proposals/${proposalId}`, { token: w.tokens.claude });
    expect(still.body.proposal.status).toBe("submitted");
  });

  it("a forged or expired session cookie is not a session", async () => {
    const res = await api(`/api/v1/proposals/${proposalId}/review`, { cookie: "hq_session=eyJhbGciOiJIUzI1NiJ9.e30.forged", body: { decision: "accept" } });
    expect(res.status).toBe(401);
  });

  it("the founder's own session can accept, creating a new revision and a new record version", async () => {
    const res = await api<{ result: { resulting_rev: number; record_id: string; version: number } }>(`/api/v1/proposals/${proposalId}/review`, {
      cookie: founderCookie,
      body: { decision: "accept", note: "Agreed." },
    });
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ resulting_rev: 2, record_id: "FR-FX-004", version: 2 });
    const head = await api<{ data: { record: { interpretation: string } }; revision: { rev: number } }>("/api/v1/tools/get_record?type=requirement&id=FR-FX-004", { token: w.tokens.chatgpt });
    expect(head.body.revision.rev).toBe(2);
    expect(head.body.data.record.interpretation).toBe("No overlays.");
    const pinned = await api<{ data: { record: { interpretation: null } } }>("/api/v1/tools/get_record?type=requirement&id=FR-FX-004&rev=1", { token: w.tokens.chatgpt });
    expect(pinned.body.data.record.interpretation).toBeNull();
  });

  it("every denial above is in the audit log, attributed to the client that tried", async () => {
    const rows = await asAppRole("authenticated", claimsFor(w.founder), async (c) =>
      (await c.query<{ principal_handle: string | null; action: string }>("select principal_handle, action from hq.audit_log where outcome = 'denied'")).rows,
    );
    const denied = (handle: string, action: string) => rows.some((r) => r.principal_handle === handle && r.action === action);
    expect(denied("claude", "proposal.review")).toBe(true);
    expect(denied("chatgpt", "proposal.review")).toBe(true);
    expect(denied("developer", "proposal.review")).toBe(true);
    expect(denied("claude", "decision.record")).toBe(true);
  });
});

describe("REST API — external integrations fail safely", () => {
  it("reports unconfigured integrations as such, without error", async () => {
    const res = await api<{ github: { configured: boolean }; google_drive: { configured: boolean }; lookup?: { ok: boolean; reason: string } }>(
      "/api/v1/integrations?github=example-org/example-repo&ref=main", { token: w.tokens.claude });
    expect(res.status).toBe(200);
    expect(res.body.github.configured).toBe(false);
    expect(res.body.google_drive.configured).toBe(false);
    expect(res.body.lookup).toMatchObject({ ok: false, reason: "not_configured" });
    const drive = await api<{ lookup: { ok: boolean; reason: string } }>("/api/v1/integrations?drive_file=1AbCdEfGhIjKlMnOp", { token: w.tokens.claude });
    expect(drive.body.lookup).toMatchObject({ ok: false, reason: "not_configured" });
  });
});
