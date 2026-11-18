/**
 * Rules for pinned revisions (`?rev=N`), shared by server pages and the client navigation.
 * No imports: this file is part of the browser bundle.
 */

/** True when the query part of an href already names a revision (an explicit link to another revision). */
function namesRevision(query: string): boolean {
  return new URLSearchParams(query).has("rev");
}

/**
 * Add `rev=N` to an internal href, keeping any #fragment at the end. An href that already names a
 * revision, an external link and a bare #fragment are returned unchanged.
 */
export function withRev(href: string, rev: number | null | undefined): string {
  if (!rev) return href;
  if (!href.startsWith("/") && !href.startsWith("?")) return href;
  if (href.startsWith("//")) return href;
  const hashAt = href.indexOf("#");
  const base = hashAt === -1 ? href : href.slice(0, hashAt);
  const fragment = hashAt === -1 ? "" : href.slice(hashAt);
  const queryAt = base.indexOf("?");
  if (queryAt !== -1 && namesRevision(base.slice(queryAt + 1))) return href;
  return `${base}${queryAt === -1 ? "?" : "&"}rev=${rev}${fragment}`;
}

/**
 * Screens that always show the latest dataset revision: the proposal inbox, the decision centre,
 * changes and access act on (or list) the present state, so pinning them would show a stale queue
 * next to live forms. A `?rev=` on these screens is ignored, and the pin bar says so.
 */
export const UNPINNABLE_PREFIXES = ["/proposals", "/decisions", "/changes", "/access"] as const;

export function isPinnablePath(pathname: string): boolean {
  return !UNPINNABLE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * The revision named by a `rev` query value: a positive whole number written in plain digits.
 * Returns "absent" for no value, and "invalid" for anything else (0, -1, 1.5, 1e9, abc).
 */
export function readRev(value: string | null | undefined): number | "absent" | "invalid" {
  if (value === null || value === undefined || value === "") return "absent";
  if (!/^[1-9][0-9]{0,15}$/.test(value)) return "invalid";
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : "invalid";
}
