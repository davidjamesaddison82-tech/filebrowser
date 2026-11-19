import { notFound as notFoundError } from "@/lib/server/errors";
import { argsFromQuery, otherMethods, readJson, withApi } from "@/lib/server/http";
import { findTool } from "@/lib/server/tools";
import { cutText } from "@/lib/text";

type Params = { params: Promise<{ name: string }> };

/**
 * The audit action for a call: the tool's own name, or "tool.unknown" for a name HQ has no tool for,
 * so the action never carries text the client chose (it was written to the audit log on a 401 or 403).
 */
const actionFor = (tool: ReturnType<typeof findTool>) => `tool.${tool?.name ?? "unknown"}`;

/** The name as echoed in a "not found" message: only its start, since it is whatever the client sent. */
const shown = (name: string) => cutText(name, 80);

/** Read tools may be called with GET and query-string arguments. */
export async function GET(request: Request, { params }: Params) {
  const { name } = await params;
  const tool = findTool(name);
  return withApi(request, { action: actionFor(tool), scope: "read" }, async ({ principal }) => {
    if (!tool) throw notFoundError(`Unknown tool "${shown(name)}". See GET /api/v1/tools.`);
    if (tool.mode !== "read") throw notFoundError(`Tool "${name}" changes the proposal inbox and must be called with POST.`);
    return tool.run(principal, argsFromQuery(new URL(request.url), tool.input));
  });
}

/** Any tool may be called with POST and a JSON object of arguments. */
export async function POST(request: Request, { params }: Params) {
  const { name } = await params;
  const tool = findTool(name);
  return withApi(request, { action: actionFor(tool), scope: tool?.mode === "propose" ? "propose" : "read", mutating: tool?.mode === "propose" }, async ({ principal }) => {
    if (!tool) throw notFoundError(`Unknown tool "${shown(name)}". See GET /api/v1/tools.`);
    return tool.run(principal, await readJson(request));
  });
}

/** The methods this route does not implement: 405 (OPTIONS 204) with Allow and a request id. */
export const { PUT, PATCH, DELETE, OPTIONS } = otherMethods(["GET", "POST"]);
