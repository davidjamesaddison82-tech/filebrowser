"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";

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

export function Nav({ groups, footer, search }: { groups: NavGroup[]; footer: ReactNode; search: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <aside className={`nav${open ? " open" : ""}`}>
      <Link href="/" className="brand" aria-label="HarmonyByrd HQ home">
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
        <Link href="/" className="brand" style={{ padding: 0 }}>
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
                  href={item.href}
                  className="nav-link"
                  aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <span>{item.label}</span>
                  {item.count !== undefined ? <span className={`nav-count${item.alert && item.count > 0 ? " alert" : ""}`}>{item.count}</span> : null}
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
