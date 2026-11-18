import { DriveAdapter, driveConfigFromEnv } from "@/lib/integrations/drive";
import { GitHubAdapter, githubConfigFromEnv } from "@/lib/integrations/github";
import { withApi } from "@/lib/server/http";

/**
 * Status of the external integrations, and (with query parameters) a read-only lookup.
 *   GET /api/v1/integrations
 *   GET /api/v1/integrations?github=owner/name&ref=<branch|tag|sha>[&path=…]
 *   GET /api/v1/integrations?drive_file=<file id>
 * An unavailable or unconfigured service is reported as such; it is never an error for HQ itself.
 */
export async function GET(request: Request) {
  return withApi(request, { action: "integrations.read", scope: "read" }, async () => {
    const url = new URL(request.url);
    const github = new GitHubAdapter(githubConfigFromEnv());
    const drive = new DriveAdapter(driveConfigFromEnv());
    const out: Record<string, unknown> = {
      policy: "Read-only. HQ stores references to code and documents, never copies. No HQ record is sent to an external service.",
      github: { ...github.status(), authority: "GitHub is authoritative for code; HQ records repository + commit SHA + path." },
      google_drive: { ...drive.status(), authority: "Drive holds governing documents; HQ records file id, version and checksum." },
    };
    const repository = url.searchParams.get("github");
    if (repository) {
      const ref = url.searchParams.get("ref") ?? "HEAD";
      const path = url.searchParams.get("path");
      out.lookup = path ? await github.fileAt(repository, ref, path) : await github.resolveRef(repository, ref);
    }
    const driveFile = url.searchParams.get("drive_file");
    if (driveFile) out.lookup = await drive.fileMetadata(driveFile);
    return out;
  });
}
