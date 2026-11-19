/** Shared loading for server-rendered pages: who is signed in, and which dataset revision they are looking at. */
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/current";
import type { Principal } from "@/lib/auth/principal";
import type { Dataset } from "@/lib/domain/dataset";
import { setPagePin } from "@/lib/ui/pin";
import { readRev } from "@/lib/ui/pin-rules";
import { HqError } from "./errors";
import { type DatasetContext, getDataset } from "./store";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function param(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/** The revision named by `?rev=`: a positive whole number, or null when absent or not a valid revision number. */
export function parseRev(value: string | undefined): number | null {
  const r = readRev(value);
  return typeof r === "number" ? r : null;
}

export interface PageContext {
  principal: Principal;
  /**
   * The dataset as every reader reads it: `ctx.ds` is the conformed view, in which a stored record that
   * fails validation is conformed to its schema field by field (src/lib/domain/conform.ts), so no screen
   * fails on an odd stored value (G1f).
   */
  ctx: DatasetContext;
  /** The dataset exactly as stored, for the screens that show a record as stored. */
  stored: Dataset;
  /** The pinned revision requested in the URL, if any (always null on a screen that cannot be pinned). */
  rev: number | null;
  params: Record<string, string | string[] | undefined>;
}

export interface LoadOptions {
  /**
   * False for screens that always show the latest revision (proposals, decision centre, changes,
   * access): `?rev=` is ignored there, and the pin bar in the layout says so.
   */
  pinnable?: boolean;
}

/**
 * Who is signed in and which dataset revision the page shows. A `?rev=` that is not a revision
 * number (abc, 0, -1, 1.5) or names a revision that does not exist gives the 404 page, never a 500
 * and never a silent fall-back to the latest.
 */
export async function loadPage(searchParams?: SearchParams, options: LoadOptions = {}): Promise<PageContext> {
  const params = searchParams ? await searchParams : {};
  const principal = await requireSession();
  let rev: number | null = null;
  if (options.pinnable !== false) {
    const requested = readRev(param(params, "rev"));
    if (requested === "invalid") notFound();
    rev = requested === "absent" ? null : requested;
  }
  let loaded: DatasetContext;
  try {
    loaded = await getDataset(principal, rev);
  } catch (error) {
    if (error instanceof HqError && error.status === 404) notFound();
    throw error;
  }
  setPagePin(loaded.pinned ? loaded.ds.revision.rev : null);
  return { principal, ctx: loaded, stored: loaded.stored, rev, params };
}

/** A dynamic route segment, decoded. Malformed percent-encoding (e.g. %E0%A4%A) is a 404, not a 500. */
export function routeId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    notFound();
  }
}

export interface Page<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
  /** 1-based position of the first and last item shown. */
  from: number;
  to: number;
}

/** Slice a list for the `page` query parameter. Out-of-range pages clamp to the nearest real page. */
export function paginate<T>(all: T[], params: Record<string, string | string[] | undefined>, size = 40): Page<T> {
  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const requested = Number(param(params, "page") ?? "1");
  const page = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), pages) : 1;
  const start = (page - 1) * size;
  const items = all.slice(start, start + size);
  return { items, page, pages, total, from: total === 0 ? 0 : start + 1, to: start + items.length };
}
