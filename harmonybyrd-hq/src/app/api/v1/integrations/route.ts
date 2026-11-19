import { DriveAdapter, driveConfigFromEnv } from "@/lib/integrations/drive";
import { GitHubAdapter, githubConfigFromEnv } from "@/lib/integrations/github";
import type { Principal } from "@/lib/auth/principal";
import type { IntegrationResult } from "@/lib/integrations/http";
import { otherMethods, withApi } from "@/lib/server/http";

/**
 * A live look-up makes HQ send a request to GitHub or Drive with HQ's own credentials, so only a person
 * signed in to HQ (founder or developer) may trigger one. API tokens, AI clients included, see the
 * configuration status only.
 */
function mayLookUp(principal: Principal): boolean {
  return principal.amr === "session" && principal.kind === "human" && (principal.appRole === "founder" || principal.appRole === "developer");
}

const LOOKUP_REFUSED: IntegrationResult<never> = {
  ok: false,
  reason: "forbidden",
  detail: "Live look-ups are made only for a founder or developer signed in to HQ. API tokens see the configuration status only.",
};

/**
 * Status of the external integrations, and (with query parameters) a read-only lookup.
 *   GET /api/v1/integrations
 *   GET /api/v1/integrations?github=owner/name&ref=<branch|tag|sha>[&path=…]
 *   GET /api/v1/integrations?drive_file=<file id>
 * An unavailable or unconfigured service is reported as such; it is never an error for HQ itself.
 * Look-ups need a signed-in founder or developer (see mayLookUp); Drive look-ups also need the file id
 * to be listed in HQ_GOOGLE_DRIVE_FILE_IDS.
 */
export async function GET(request: Request) {
  return withApi(request, { action: "integrations.read", scope: "read" }, async ({ principal }) => {
    const url = new URL(request.url);
    const github = new GitHubAdapter(githubConfigFromEnv());
    const drive = new DriveAdapter(driveConfigFromEnv());
    const out: Record<string, unknown> = {
      policy: "Read-only. HQ stores references to code and documents, never copies. No HQ record is sent to an external service.",
      github: { ...github.status(), authority: "GitHub is authoritative for code; HQ records repository + commit SHA + path." },
      google_drive: { ...drive.status(), authority: "Drive holds governing documents; HQ records file id, version and checksum." },
    };
    const repository = url.searchParams.get("github");
    const driveFile = url.searchParams.get("drive_file");
    if ((repository || driveFile) && !mayLookUp(principal)) {
      out.lookup = LOOKUP_REFUSED;
      return out;
    }
    if (repository) {
      const ref = url.searchParams.get("ref") ?? "HEAD";
      const path = url.searchParams.get("path");
      out.lookup = path ? await github.fileAt(repository, ref, path) : await github.resolveRef(repository, ref);
    }
    if (driveFile) out.lookup = await drive.fileMetadata(driveFile);
    return out;
  });
}

/** The methods this route does not implement: 405 (OPTIONS 204) with Allow and a request id. */
export const { POST, PUT, PATCH, DELETE, OPTIONS } = otherMethods(["GET"]);
