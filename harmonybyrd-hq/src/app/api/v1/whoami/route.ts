import { publicPrincipal } from "@/lib/auth/principal";
import { withApi } from "@/lib/server/http";

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
