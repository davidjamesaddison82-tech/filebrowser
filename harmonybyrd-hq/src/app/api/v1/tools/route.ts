import { withApi } from "@/lib/server/http";
import { HQ_NOTICE } from "@/lib/server/services";
import { describeTools, FOUNDER_ONLY_OPERATIONS } from "@/lib/server/tools";

export async function GET(request: Request) {
  return withApi(request, { action: "tools.list", scope: "read" }, async () => ({
    notice: HQ_NOTICE,
    how_to_call: "POST /api/v1/tools/<name> with a JSON object of arguments. Read tools also accept GET with query-string arguments.",
    tools: describeTools(),
    not_available_as_tools: FOUNDER_ONLY_OPERATIONS,
  }));
}
