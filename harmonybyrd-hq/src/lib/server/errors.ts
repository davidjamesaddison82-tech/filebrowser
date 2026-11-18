/** Application error carrying an HTTP status and a stable machine-readable code. */
export class HqError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: unknown;

  constructor(status: number, code: string, message: string, detail?: unknown) {
    super(message);
    this.name = "HqError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const unauthenticated = (message = "Authentication is required.") => new HqError(401, "unauthenticated", message);
export const forbidden = (message: string, detail?: unknown) => new HqError(403, "forbidden", message, detail);
export const notFound = (message: string) => new HqError(404, "not_found", message);
export const conflict = (message: string, detail?: unknown) => new HqError(409, "conflict", message, detail);
export const invalid = (message: string, detail?: unknown) => new HqError(422, "invalid_request", message, detail);
export const unavailable = (message: string, detail?: unknown) => new HqError(503, "service_unavailable", message, detail);

const SQLSTATE: Record<string, { status: number; code: string }> = {
  HQ401: { status: 401, code: "unauthenticated" },
  HQ403: { status: 403, code: "forbidden" },
  HQ404: { status: 404, code: "not_found" },
  HQ405: { status: 405, code: "append_only" },
  HQ409: { status: 409, code: "conflict" },
  HQ422: { status: 422, code: "invalid_request" },
  "42501": { status: 403, code: "forbidden" }, // insufficient_privilege (RLS / missing grant)
  "25006": { status: 403, code: "read_only_transaction" }, // a read path attempted a write
};

/** Translate a database error into an HqError; anything unrecognised becomes a 500 without leaking internals. */
export function fromDatabaseError(error: unknown): HqError {
  if (error instanceof HqError) return error;
  const e = error as { code?: string; message?: string; detail?: string };
  const mapped = e?.code ? SQLSTATE[e.code] : undefined;
  if (mapped) {
    let detail: unknown;
    if (e.detail) {
      try {
        detail = JSON.parse(e.detail);
      } catch {
        detail = e.detail;
      }
    }
    return new HqError(mapped.status, mapped.code, e.message ?? "Request refused.", detail);
  }
  if (e?.code && /^(08|57P|53)/.test(e.code)) {
    return unavailable("The HQ database is not reachable right now.");
  }
  if ((e as { code?: string })?.code === "ECONNREFUSED" || /ECONNREFUSED|Connection terminated|timeout/i.test(e?.message ?? "")) {
    return unavailable("The HQ database is not reachable right now.");
  }
  return new HqError(500, "internal_error", "Unexpected error. The request was not completed.");
}
