import { notFound as notFoundError } from "@/lib/server/errors";
import { argsFromQuery, readJson, withApi } from "@/lib/server/http";
import { findTool } from "@/lib/server/tools";

type Params = { params: Promise<{ name: string }> };

/** Read tools may be called with GET and query-string arguments. */
export async function GET(request: Request, { params }: Params) {
  const { name } = await params;
  const tool = findTool(name);
  return withApi(request, { action: `tool.${name}`, scope: "read" }, async ({ principal }) => {
    if (!tool) throw notFoundError(`Unknown tool "${name}". See GET /api/v1/tools.`);
    if (tool.mode !== "read") throw notFoundError(`Tool "${name}" changes the proposal inbox and must be called with POST.`);
    return tool.run(principal, argsFromQuery(new URL(request.url)));
  });
}

/** Any tool may be called with POST and a JSON object of arguments. */
export async function POST(request: Request, { params }: Params) {
  const { name } = await params;
  const tool = findTool(name);
  return withApi(request, { action: `tool.${name}`, scope: tool?.mode === "propose" ? "propose" : "read", mutating: tool?.mode === "propose" }, async ({ principal }) => {
    if (!tool) throw notFoundError(`Unknown tool "${name}". See GET /api/v1/tools.`);
    return tool.run(principal, await readJson(request));
  });
}
