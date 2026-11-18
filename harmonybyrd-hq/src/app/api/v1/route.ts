import { publicPrincipal } from "@/lib/auth/principal";
import { withApi } from "@/lib/server/http";
import { HQ_NOTICE } from "@/lib/server/services";
import { getDataset } from "@/lib/server/store";
import { TOOLS } from "@/lib/server/tools";

export async function GET(request: Request) {
  return withApi(request, { action: "api.index", scope: "read" }, async ({ principal }) => {
    const ctx = await getDataset(principal);
    return {
      service: "HarmonyByrd HQ information service",
      api_version: "v1",
      notice: HQ_NOTICE,
      you_are: publicPrincipal(principal),
      head_revision: { rev: ctx.ds.revision.rev, content_hash: ctx.ds.revision.content_hash, created_at: ctx.ds.revision.created_at },
      endpoints: {
        tools: "/api/v1/tools",
        call_tool: "/api/v1/tools/{name}",
        whoami: "/api/v1/whoami",
        health: "/api/v1/health",
        integrations: "/api/v1/integrations",
        mcp: "/api/mcp",
      },
      tools: TOOLS.map((t) => ({ name: t.name, mode: t.mode })),
    };
  });
}
