/**
 * Shared behaviour for outbound integrations.
 *
 * Rules that hold for every adapter:
 *   - read-only: only GET requests are ever issued;
 *   - bounded: every call has a timeout;
 *   - safe when unavailable: a failure is returned as a value, never thrown, so that HQ keeps
 *     working (and says so) when an external service is down or not configured;
 *   - HQ's own records are never sent outward: adapters only ask about identifiers.
 */
export type IntegrationFailure =
  | "not_configured"
  | "unreachable"
  | "timeout"
  | "unauthorised"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "unexpected_response";

export type IntegrationResult<T> = { ok: true; data: T } | { ok: false; reason: IntegrationFailure; detail: string };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function getJson<T>(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  timeoutMs = 8000,
): Promise<IntegrationResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: "GET", headers, signal: controller.signal, redirect: "error" });
    if (response.status === 401) return { ok: false, reason: "unauthorised", detail: "The service rejected the credential." };
    if (response.status === 403) {
      const limited = response.headers.get("x-ratelimit-remaining") === "0";
      return { ok: false, reason: limited ? "rate_limited" : "forbidden", detail: limited ? "Rate limit reached." : "Access was refused." };
    }
    if (response.status === 404) return { ok: false, reason: "not_found", detail: "No such item (or it is not visible to this credential)." };
    if (response.status === 429) return { ok: false, reason: "rate_limited", detail: "Rate limit reached." };
    if (!response.ok) return { ok: false, reason: "unexpected_response", detail: `HTTP ${response.status}` };
    try {
      return { ok: true, data: (await response.json()) as T };
    } catch {
      return { ok: false, reason: "unexpected_response", detail: "The response was not JSON." };
    }
  } catch (error) {
    const aborted = (error as Error)?.name === "AbortError";
    return { ok: false, reason: aborted ? "timeout" : "unreachable", detail: aborted ? `No answer within ${timeoutMs} ms.` : "The service could not be reached." };
  } finally {
    clearTimeout(timer);
  }
}
