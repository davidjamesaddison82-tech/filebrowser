import { publicPrincipal } from "@/lib/auth/principal";
import { otherMethods, withApi } from "@/lib/server/http";

export async function GET(request: Request) {
  return withApi(request, { action: "api.whoami" }, async ({ principal }) => ({
    ...publicPrincipal(principal),
    can: {
      read: principal.scopes.includes("read"),
      propose: principal.scopes.includes("propose") && principal.appRole !== "reader",
      review_or_accept: false === (principal.appRole !== "founder" || principal.amr !== "session"),
    },
    note: "Review, acceptance and founder decisions are available only in the founder's interactive session — never to an API token.",
  }));
}

/** The methods this route does not implement: 405 (OPTIONS 204) with Allow and a request id. */
export const { POST, PUT, PATCH, DELETE, OPTIONS } = otherMethods(["GET"]);
