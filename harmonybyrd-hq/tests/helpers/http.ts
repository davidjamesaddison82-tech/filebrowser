import { signSession } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/session";
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

/** A session cookie for a human principal, as the sign-in page would set it. */
export async function sessionCookie(principalId: string): Promise<string> {
  return `${SESSION_COOKIE}=${await signSession(principalId)}`;
}
