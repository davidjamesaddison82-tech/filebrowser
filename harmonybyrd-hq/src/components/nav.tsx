"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { isPinnablePath, readRev, withRev } from "@/lib/ui/pin-rules";

export interface NavItem {
  href: string;
  label: string;
  count?: number;
  alert?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The `?rev=` in the address bar: a revision number, "invalid", or null when there is none. */
function useRequestedRev(): number | "invalid" | null {
  const value = useSearchParams().get("rev");
  const r = readRev(value);
  return r === "absent" ? null : r;
}

/** The revision to carry on links while the address names one (an invalid value is not carried). */
function usePin(): number | null {
  const r = useRequestedRev();
  return typeof r === "number" ? r : null;
}

/** A link in the layout that keeps the pinned revision while `?rev=` is in the address. */
export function KeepRevLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const pin = usePin();
  return (
    <Link href={withRev(href, pin)} className={className}>
      {children}
    </Link>
  );
}

/** The search box. On a pinned revision it searches that revision. */
export function SearchBox() {
  const pin = usePin();
  return (
    <form action="/search" method="get" role="search">
      <label className="sr-only" htmlFor="hq-search">
        Search HQ
      </label>
      <input id="hq-search" type="search" name="q" placeholder="Search records…" />
      {pin ? <input type="hidden" name="rev" value={pin} /> : null}
    </form>
  );
}

/** The current address without `rev`, keeping every other query parameter. */
function latestHref(pathname: string, params: URLSearchParams): string {
  const q = new URLSearchParams(params);
  q.delete("rev");
  const s = q.toString();
  return s ? `${pathname}?${s}` : pathname;
}

/**
 * Shown on every screen while the address names a revision (D14, D16). Record screens show that
 * revision; the inbox, decision centre, changes and access always show the latest and say so.
 */
export function PinBar({ headRev }: { headRev: number }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = useRequestedRev();
  if (requested === null || headRev === 0) return null;
  const back = (
    <Link href={latestHref(pathname, params)} className="pin-back">
      Return to the latest
    </Link>
  );
  if (requested === "invalid" || requested > headRev) {
    return (
      <div className="notice warn pinbar" role="status">
        {requested === "invalid" ? "That is not a dataset revision number." : `Dataset revision ${requested} does not exist.`} The latest is revision{" "}
        {headRev}. {back}.
      </div>
    );
  }
  if (!isPinnablePath(pathname)) {
    return (
      <div className="notice info pinbar" role="status">
        You asked for dataset revision {requested}, but <strong>this screen always shows the latest</strong> (revision {headRev}). Record screens you open
        from the menu keep revision {requested}. {back}.
      </div>
    );
  }
  return (
    <div className="notice info pinbar" role="status">
      You are viewing <strong>dataset revision {requested}</strong>
      {requested === headRev ? (
        <>, which is the latest. </>
      ) : (
        <>, not the latest (revision {headRev}). Records are shown exactly as they stood then; links on this page keep that revision. </>
      )}
      {back}.
    </div>
  );
}

export function Nav({ groups, footer, search }: { groups: NavGroup[]; footer: ReactNode; search: ReactNode }) {
  const pathname = usePathname();
  const pin = usePin();
  const [open, setOpen] = useState(false);
  return (
    <aside className={`nav${open ? " open" : ""}`}>
      <Link href={withRev("/", pin)} className="brand" aria-label="HarmonyByrd HQ home">
        <span className="brand-mark" aria-hidden="true">
          HQ
        </span>
        <span>
          <span className="brand-name">HarmonyByrd HQ</span>
          <br />
          <span className="brand-sub">Development command centre</span>
        </span>
      </Link>
      <div className="topbar">
        <Link href={withRev("/", pin)} className="brand" style={{ padding: 0 }}>
          <span className="brand-mark" aria-hidden="true">
            HQ
          </span>
          <span className="brand-name">HarmonyByrd HQ</span>
        </Link>
        <button type="button" className="btn small" aria-expanded={open} aria-controls="hq-nav-groups" onClick={() => setOpen((v) => !v)}>
          {open ? "Close menu" : "Menu"}
        </button>
      </div>
      <div className="nav-groups" id="hq-nav-groups" style={{ display: undefined }}>
        <div style={{ display: "grid", gap: 16 }}>
          {search}
          {groups.map((group) => (
            <nav className="nav-group" key={group.label} aria-label={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={withRev(item.href, pin)}
                  className="nav-link"
                  aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <span>{item.label}</span>
                  {/* The counts are figures of the latest revision; on a pinned revision they would mislead, so they are hidden. */}
                  {item.count !== undefined && !pin ? <span className={`nav-count${item.alert && item.count > 0 ? " alert" : ""}`}>{item.count}</span> : null}
                </Link>
              ))}
            </nav>
          ))}
          {footer}
        </div>
      </div>
    </aside>
  );
}
