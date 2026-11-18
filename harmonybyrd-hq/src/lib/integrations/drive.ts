/**
 * Google Drive adapter (read-only, metadata only).
 *
 * Drive holds the governing human-readable documents. HQ records a reference to a document
 * (file id, version, checksum, modified time) so that a record can say exactly which version
 * of a document it was drawn from. This adapter never downloads content, never lists a
 * user's drive and never writes.
 */
import { type FetchLike, getJson, type IntegrationResult } from "./http";

export interface DriveConfig {
  accessToken?: string;
  /**
   * The only file ids HQ may ask Drive about (HQ_GOOGLE_DRIVE_FILE_IDS, comma-separated). The access
   * token can usually see far more than HQ's governing documents; without this list anyone allowed
   * to trigger a look-up could read the metadata of any file the founder's credential can see.
   */
  allowedFileIds: string[];
  apiBase: string;
}

export function driveConfigFromEnv(env: Record<string, string | undefined> = process.env): DriveConfig {
  return {
    accessToken: env.HQ_GOOGLE_DRIVE_ACCESS_TOKEN || undefined,
    allowedFileIds: (env.HQ_GOOGLE_DRIVE_FILE_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    apiBase: (env.HQ_GOOGLE_DRIVE_API ?? "https://www.googleapis.com/drive/v3").replace(/\/+$/, ""),
  };
}

export interface DriveFileInfo {
  id: string;
  name: string;
  mime_type: string;
  modified_at: string | null;
  version: string | null;
  sha256: string | null;
  md5: string | null;
  size_bytes: number | null;
  web_link: string | null;
  head_revision_id: string | null;
}

const FILE_ID = /^[A-Za-z0-9_-]{10,120}$/;
const FIELDS = "id,name,mimeType,modifiedTime,version,sha256Checksum,md5Checksum,size,webViewLink,headRevisionId";

export class DriveAdapter {
  constructor(
    private readonly config: DriveConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  status(): { configured: boolean; allowed_file_ids: number } {
    return { configured: !!this.config.accessToken && this.config.allowedFileIds.length > 0, allowed_file_ids: this.config.allowedFileIds.length };
  }

  async fileMetadata(fileId: string): Promise<IntegrationResult<DriveFileInfo>> {
    if (!this.config.accessToken) {
      return { ok: false, reason: "not_configured", detail: "No Google Drive credential is configured (HQ_GOOGLE_DRIVE_ACCESS_TOKEN)." };
    }
    if (!FILE_ID.test(fileId)) return { ok: false, reason: "not_found", detail: "Not a valid Drive file id." };
    if (!this.config.allowedFileIds.includes(fileId)) {
      return { ok: false, reason: "not_configured", detail: "This file id is not listed in HQ_GOOGLE_DRIVE_FILE_IDS, so HQ does not ask Drive about it." };
    }
    const result = await getJson<Record<string, string | undefined>>(
      this.fetchImpl,
      `${this.config.apiBase}/files/${fileId}?fields=${encodeURIComponent(FIELDS)}&supportsAllDrives=true`,
      { authorization: `Bearer ${this.config.accessToken}`, accept: "application/json" },
    );
    if (!result.ok) return result;
    const d = result.data;
    if (!d?.id) return { ok: false, reason: "unexpected_response", detail: "No file id in the response." };
    return {
      ok: true,
      data: {
        id: d.id,
        name: d.name ?? "",
        mime_type: d.mimeType ?? "",
        modified_at: d.modifiedTime ?? null,
        version: d.version ?? null,
        sha256: d.sha256Checksum ?? null,
        md5: d.md5Checksum ?? null,
        size_bytes: d.size ? Number(d.size) : null,
        web_link: d.webViewLink ?? null,
        head_revision_id: d.headRevisionId ?? null,
      },
    };
  }
}
