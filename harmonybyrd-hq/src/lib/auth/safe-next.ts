/**
 * Where to send someone after they sign in.
 *
 * Only a path on HQ itself is accepted. A browser's URL parser drops tabs and newlines and treats
 * "\" like "/", so "/\t/evil.example" or "/\\evil.example" would leave the site even though they
 * start with a single "/". Rather than list the tricks, the value is resolved against a placeholder
 * origin, and anything that does not stay on that origin, or that contains a character a browser
 * would rewrite, falls back to "/".
 */
const BASE = "http://hq.invalid";

// Control characters, whitespace (including the Unicode spaces a URL parser may trim) and backslash.
const REWRITTEN = /[\u0000-\u0020\u007f-\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff\\]/;

export function safeNext(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  if (!raw.startsWith("/") || raw.startsWith("//") || REWRITTEN.test(raw)) return "/";
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return "/";
  }
  if (url.origin !== BASE) return "/";
  const out = `${url.pathname}${url.search}${url.hash}`;
  // "/.//evil.example" normalises to the path "//evil.example", which a router would read as a host.
  return out.startsWith("/") && !out.startsWith("//") ? out : "/";
}
