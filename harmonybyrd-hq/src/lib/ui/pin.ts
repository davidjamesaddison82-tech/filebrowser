/**
 * The revision the current page is pinned to, for this request only.
 *
 * Server components cannot use React context, so the pin is kept in a per-request cell
 * (React's `cache` is scoped to one server render). `loadPage` sets it before the page renders
 * its children; `PinLink` reads it, so every internal link on a pinned page keeps `?rev=N`
 * without each page having to remember to pass it.
 */
import { cache } from "react";

const cell = cache((): { rev: number | null } => ({ rev: null }));

export function setPagePin(rev: number | null): void {
  cell().rev = rev;
}

/** The pinned revision of the page being rendered, or null when it shows the latest. */
export function pagePin(): number | null {
  return cell().rev;
}
