import Link from "next/link";
import type { ReactNode } from "react";
import type { Dataset } from "@/lib/domain/dataset";
import { describeRef } from "@/lib/domain/derive";
import { type Citation, type Claim, type Epistemic, EPISTEMIC_LABEL } from "@/lib/domain/schemas";
import { EPISTEMIC_TONE, statusLabel, statusTone, type Tone } from "@/lib/ui/format";
import { recordHref, refHref } from "@/lib/ui/links";

export function Chip({ tone = "plain", glyph, children, title }: { tone?: Tone; glyph?: string; children: ReactNode; title?: string }) {
  return (
    <span className={`chip ${tone === "plain" ? "" : tone}`} title={title}>
      {glyph ? (
        <span className="g" aria-hidden="true">
          {glyph}
        </span>
      ) : null}
      {children}
    </span>
  );
}

export function EpistemicChip({ value }: { value: Epistemic }) {
  const t = EPISTEMIC_TONE[value];
  return (
    <Chip tone={t.tone} glyph={t.glyph} title={EPISTEMIC_LABEL[value]}>
      {t.short}
    </Chip>
  );
}

export function StatusChip({ value, label }: { value: string; label?: string }) {
  return <Chip tone={statusTone(value)}>{label ?? statusLabel(value)}</Chip>;
}

export function IdTag({ id }: { id: string }) {
  return <span className="id-tag">{id}</span>;
}

export function PageHead({
  title,
  lede,
  crumbs,
  id,
  actions,
  chips,
}: {
  title: string;
  lede?: ReactNode;
  crumbs?: { label: string; href?: string }[];
  id?: string;
  actions?: ReactNode;
  chips?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div style={{ minWidth: 0 }}>
        {crumbs?.length ? (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`}>
                {c.href ? <Link href={c.href}>{c.label}</Link> : c.label}
                {i < crumbs.length - 1 ? <span aria-hidden="true"> / </span> : null}
              </span>
            ))}
          </nav>
        ) : null}
        <div className="row" style={{ gap: 10 }}>
          <h1>{title}</h1>
          {id ? <IdTag id={id} /> : null}
        </div>
        {chips ? (
          <div className="row" style={{ marginTop: 8 }}>
            {chips}
          </div>
        ) : null}
        {lede ? <p className="lede">{lede}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  hint,
  children,
  flush,
  foot,
  id,
  action,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  foot?: ReactNode;
  id?: string;
  action?: ReactNode;
}) {
  return (
    <section className="card" id={id}>
      {title ? (
        <div className="card-head">
          <h2>{title}</h2>
          <div className="row">
            {hint ? <span className="hint">{hint}</span> : null}
            {action}
          </div>
        </div>
      ) : null}
      <div className={`card-body${flush ? " flush" : ""}`}>{children}</div>
      {foot ? <div className="card-foot">{foot}</div> : null}
    </section>
  );
}

export function Tile({
  href,
  n,
  title,
  detail,
  tone,
}: {
  href: string;
  n: number;
  title: string;
  detail?: string;
  tone?: "ok" | "warn" | "bad" | "info";
}) {
  return (
    <Link href={href} className={`tile ${tone ?? ""} ${n === 0 ? "zero" : ""}`}>
      <div className="n">{n}</div>
      <div className="t">{title}</div>
      {detail ? <div className="d">{detail}</div> : null}
    </Link>
  );
}

/** A link to a record by id, labelled with its title. Marks references to records that are not in the register. */
export function RecordLink({ ds, id, showId = true }: { ds: Dataset; id: string; showId?: boolean }) {
  const ref = describeRef(ds, id);
  if (!ref.exists) {
    return (
      <span title="This id is referred to but is not in the register">
        <IdTag id={id} /> <span className="muted small">(not in register)</span>
      </span>
    );
  }
  return (
    <span>
      <Link href={recordHref(ref.type, id)}>{ref.title}</Link>
      {showId ? (
        <>
          {" "}
          <IdTag id={id} />
        </>
      ) : null}
    </span>
  );
}

export function RefList({ ds, ids, empty = "None recorded." }: { ds: Dataset; ids: string[]; empty?: string }) {
  if (ids.length === 0) return <span className="muted small">{empty}</span>;
  return (
    <ul className="plain">
      {ids.map((id) => (
        <li key={id}>
          <RecordLink ds={ds} id={id} />
        </li>
      ))}
    </ul>
  );
}

export function Citations({ ds, citations, label }: { ds: Dataset; citations: Citation[]; label?: string }) {
  if (!citations?.length) return null;
  return (
    <details className="cites">
      <summary>{label ?? `${citations.length} source ${citations.length === 1 ? "quotation" : "quotations"}`}</summary>
      {citations.map((c, i) => (
        <div className="cite" key={`${c.source_id}-${i}`}>
          <q>{c.quote}</q>
          <span className="src">
            <Link href={refHref(c.source_id)}>{ds.source(c.source_id)?.data.title ?? c.source_id}</Link> <IdTag id={c.source_id} />
            {c.locator ? <> · {c.locator}</> : null}
          </span>
        </div>
      ))}
    </details>
  );
}

export function ClaimView({ ds, claim, empty }: { ds: Dataset; claim: Claim | null | undefined; empty?: string }) {
  if (!claim) return <span className="muted small">{empty ?? "Not stated in any accessible source."}</span>;
  return (
    <div className="claim">
      <div className="claim-text">{claim.text}</div>
      <div className="row" style={{ gap: 8 }}>
        <EpistemicChip value={claim.epistemic} />
        <Citations ds={ds} citations={claim.citations} />
      </div>
    </div>
  );
}

export function ClaimList({ ds, claims, empty }: { ds: Dataset; claims: Claim[]; empty: string }) {
  if (!claims.length) return <p className="muted small">{empty}</p>;
  return (
    <div className="stack-sm">
      {claims.map((c, i) => (
        <ClaimView key={i} ds={ds} claim={c} />
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Notice({ tone, children }: { tone: "info" | "warn" | "bad" | "ok"; children: ReactNode }) {
  return <div className={`notice ${tone}`}>{children}</div>;
}

/**
 * Shows the first `limit` items and folds the rest behind a native disclosure, so a record with
 * forty capabilities stays readable while nothing is hidden for good. Works without JavaScript.
 */
export function Fold({
  items,
  limit = 8,
  noun = "more",
  wrap,
}: {
  items: ReactNode[];
  limit?: number;
  /** What the hidden things are called, e.g. "capabilities". */
  noun?: string;
  /** Wraps each group of items (the visible group and the folded group) in its list element. */
  wrap?: (children: ReactNode[]) => ReactNode;
}) {
  const group = wrap ?? ((children: ReactNode[]) => <div className="stack-sm">{children}</div>);
  // Folding two or three items away is more annoying than showing them.
  if (items.length <= limit + 3) return <>{group(items)}</>;
  return (
    <>
      {group(items.slice(0, limit))}
      <details className="fold">
        <summary>
          Show {items.length - limit} more {noun}
        </summary>
        {group(items.slice(limit))}
      </details>
    </>
  );
}

/** Page links for a long register. Every other query parameter (filters, tab, pinned revision) is kept. */
export function Pager({
  page,
  pages,
  total,
  from,
  to,
  params,
  basePath,
  noun = "records",
}: {
  page: number;
  pages: number;
  total: number;
  from: number;
  to: number;
  params: Record<string, string | string[] | undefined>;
  basePath: string;
  noun?: string;
}) {
  if (total === 0) return null;
  const href = (n: number) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const v = Array.isArray(value) ? value[0] : value;
      if (v && key !== "page") q.set(key, v);
    }
    if (n > 1) q.set("page", String(n));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const numbers = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  return (
    <nav className="pager" aria-label="Pages">
      <span className="small muted">
        {from}–{to} of {total} {noun}
      </span>
      {pages > 1 ? (
        <span className="pager-links">
          {page > 1 ? (
            <Link href={href(page - 1)} rel="prev">
              ← Previous
            </Link>
          ) : null}
          {numbers.map((n, i) => (
            <span key={n}>
              {i > 0 && n - numbers[i - 1] > 1 ? <span className="muted"> … </span> : null}
              {n === page ? (
                <span className="pager-current" aria-current="page">
                  {n}
                </span>
              ) : (
                <Link href={href(n)} aria-label={`Page ${n}`}>
                  {n}
                </Link>
              )}
            </span>
          ))}
          {page < pages ? (
            <Link href={href(page + 1)} rel="next">
              Next →
            </Link>
          ) : null}
        </span>
      ) : null}
    </nav>
  );
}
