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

/** The hidden fields of the sign-in form (the server action's id), read once from the page. */
let signInFields: [string, string][] | null = null;
async function signInFormFields(): Promise<[string, string][]> {
  if (signInFields) return signInFields;
  const html = await (await fetch(`${TEST_BASE_URL}/sign-in`)).text();
  const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
  const unescape = (v: string) => v.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  signInFields = [...form.matchAll(/<input[^>]*>/g)]
    .map((m) => [/name="([^"]*)"/.exec(m[0])?.[1], /value="([^"]*)"/.exec(m[0])?.[1] ?? ""] as const)
    .filter((f): f is readonly [string, string] => !!f[0] && !["handle", "passphrase", "next"].includes(f[0]))
    .map(([n, v]) => [unescape(n), unescape(v)]);
  return signInFields;
}

export interface SignInReply {
  status: number;
  /** Set-Cookie headers of the answer, by cookie name (the full header). */
  setCookies: Record<string, string>;
  /** The message the form shows, if any. */
  message: string | null;
  ms: number;
}

/** Post the sign-in form as a browser without JavaScript would, with the cookies given. */
export async function postSignIn(handle: string, passphrase: string, options: { cookie?: string; next?: string } = {}): Promise<SignInReply> {
  const fd = new FormData();
  for (const [n, v] of await signInFormFields()) fd.append(n, v);
  fd.append("handle", handle);
  fd.append("passphrase", passphrase);
  fd.append("next", options.next ?? "/");
  const headers: Record<string, string> = { origin: TEST_BASE_URL };
  if (options.cookie) headers.cookie = options.cookie;
  const started = Date.now();
  const res = await fetch(`${TEST_BASE_URL}/sign-in`, { method: "POST", body: fd, headers, redirect: "manual" });
  const text = await res.text();
  const ms = Date.now() - started;
  const setCookies = Object.fromEntries(res.headers.getSetCookie().map((c) => [c.split("=")[0], c]));
  const message = /(That name and passphrase do not match\.|Too many sign-in attempts are in progress\. Try again in a moment\.|Enter your name and passphrase\.)/.exec(text)?.[1] ?? null;
  return { status: res.status, setCookies, message, ms };
}

/** "name=value" from a Set-Cookie header. */
export function cookiePair(setCookie: string | undefined): string {
  if (!setCookie) throw new Error("no such cookie was set");
  return setCookie.split(";")[0];
}
