/** Shared loading for server-rendered pages: who is signed in, and which dataset revision they are looking at. */
import { requireSession } from "@/lib/auth/current";
import type { Principal } from "@/lib/auth/principal";
import { type DatasetContext, getDataset } from "./store";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function param(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export function parseRev(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export interface PageContext {
  principal: Principal;
  ctx: DatasetContext;
  /** The pinned revision requested in the URL, if any. */
  rev: number | null;
  params: Record<string, string | string[] | undefined>;
}

export async function loadPage(searchParams?: SearchParams): Promise<PageContext> {
  const params = searchParams ? await searchParams : {};
  const principal = await requireSession();
  const rev = parseRev(param(params, "rev"));
  const ctx = await getDataset(principal, rev);
  return { principal, ctx, rev, params };
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
