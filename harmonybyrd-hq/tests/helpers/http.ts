import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { admin } from "./db";
import { TEST_BASE_URL } from "./env";

export interface Reply<T = Record<string, unknown>> {
  status: number;
  headers: Headers;
  body: T;
}

export async function api<T = Record<string, unknown>>(
  path: string,
  options: { token?: string; cookie?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Reply<T>> {
  const headers: Record<string, string> = { accept: "application/json", ...(options.headers ?? {}) };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.cookie) headers.cookie = options.cookie;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${TEST_BASE_URL}${path}`, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body === undefined ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body),
    redirect: "manual",
  });
  const text = await res.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: res.status, headers: res.headers, body: body as T };
}

/** The principal's current session epoch, read from the test database. */
export async function sessionEpoch(principalId: string): Promise<number> {
  const client = await admin();
  try {
    const row = await client.query<{ session_epoch: number }>("select session_epoch from hq.principals where id = $1", [principalId]);
    return row.rows[0].session_epoch;
  } finally {
    await client.end();
  }
}

/**
 * A session cookie for a human principal, as the sign-in page would set it: signed with the
 * principal's current session epoch unless `epoch` is given (an older epoch makes an ended session).
 */
export async function sessionCookie(principalId: string, epoch?: number): Promise<string> {
  return `${SESSION_COOKIE}=${await signSession(principalId, epoch ?? (await sessionEpoch(principalId)))}`;
}
