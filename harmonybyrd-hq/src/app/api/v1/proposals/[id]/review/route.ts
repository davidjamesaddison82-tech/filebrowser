import { invalid } from "@/lib/server/errors";
import { otherMethods, readJson, withApi } from "@/lib/server/http";
import { reviewProposal } from "@/lib/server/services";

type Params = { params: Promise<{ id: string }> };

/**
 * Founder review of a proposal. Exists as an endpoint so that the refusal is demonstrable:
 * every API token, and every non-founder session, receives 403 here.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withApi(request, { action: "proposal.review", mutating: true, allowedRecordedByDatabase: true }, async ({ principal }) => {
    const body = await readJson(request);
    const decision = String(body.decision ?? "");
    if (!["accept", "reject", "needs_changes"].includes(decision)) throw invalid('decision must be "accept", "reject" or "needs_changes".');
    return { result: await reviewProposal(principal, id, decision as "accept", typeof body.note === "string" ? body.note : undefined) };
  });
}

/** The methods this route does not implement: 405 (OPTIONS 204) with Allow and a request id. */
export const { GET, HEAD, PUT, PATCH, DELETE, OPTIONS } = otherMethods(["POST"]);
