import { otherMethods, readJson, withApi } from "@/lib/server/http";
import { recordFounderDecision } from "@/lib/server/services";

/**
 * Record a founder decision (acceptance, requirement standing). Founder interactive session only:
 * an API token — including one belonging to a developer or an AI client — is refused with 403.
 */
export async function POST(request: Request) {
  return withApi(request, { action: "decision.record", mutating: true, allowedRecordedByDatabase: true }, async ({ principal }) => ({
    result: await recordFounderDecision(principal, await readJson(request)),
  }));
}

/** The methods this route does not implement: 405 (OPTIONS 204) with Allow and a request id. */
export const { GET, HEAD, PUT, PATCH, DELETE, OPTIONS } = otherMethods(["POST"]);
