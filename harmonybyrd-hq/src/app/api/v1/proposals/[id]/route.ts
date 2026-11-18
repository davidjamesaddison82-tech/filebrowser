import { withApi } from "@/lib/server/http";
import { getProposal } from "@/lib/server/services";

type Params = { params: Promise<{ id: string }> };

/** A proposal is visible to its submitter and to the founder. Anyone else gets "not found". */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withApi(request, { action: "proposal.read", scope: "read" }, async ({ principal }) => ({ proposal: await getProposal(principal, id) }));
}
