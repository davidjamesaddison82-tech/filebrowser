import Link from "@/components/pin-link";
import type { ReactNode } from "react";
import type { Dataset, Envelope } from "@/lib/domain/dataset";
import { BUILD_ACCEPTANCE_LABEL, buildAcceptanceIsSourced, describeRef } from "@/lib/domain/derive";
import { type BuildRecord, type Citation, type Claim, type Epistemic, EPISTEMIC_LABEL } from "@/lib/domain/schemas";
import { EPISTEMIC_TONE, statusLabel, statusTone, type Tone } from "@/lib/ui/format";
import { claim as asClaim, citations as asCitations, isEpistemic, isObject } from "@/lib/ui/guards";
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

export function EpistemicChip({ value }: { value: Epistemic | unknown }) {
  // A label HQ does not know (a stored record that failed validation) is shown as what it is, not guessed.
  if (!isEpistemic(value)) {
    return (
      <Chip tone="ghost" glyph="?" title="This statement carries a label HQ does not recognise">
        Unrecognised label
      </Chip>
    );
  }
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

/**
 * A build's standing (F1). "accepted_reported" reads as a reported acceptance only when the build's
 * statement quotes a source that reports it; otherwise it is a bare claim and says so, wherever a
 * build's standing is shown.
 */
export function BuildStandingChip({ build }: { build: { standing?: unknown; statement?: unknown } }) {
  if (build.standing === "accepted_reported" && !buildAcceptanceIsSourced(build as BuildRecord)) {
    return (
      <Chip tone="warn" title="This build is marked as accepted, but its statement quotes no source that reports it">
        {BUILD_ACCEPTANCE_LABEL.build_acceptance_claimed}
      </Chip>
    );
  }
  return <StatusChip value={typeof build.standing === "string" ? build.standing : ""} />;
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
  if (typeof id !== "string") return <span className="muted small">(not an id)</span>;
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

export function RefList({ ds, ids: raw, empty = "None recorded." }: { ds: Dataset; ids: string[]; empty?: string }) {
  const ids = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
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

export function Citations({ ds, citations: raw, label }: { ds: Dataset; citations: Citation[] | unknown; label?: string }) {
  const citations = asCitations(raw);
  if (!citations.length) return null;
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

export function ClaimView({ ds, claim: raw, empty }: { ds: Dataset; claim: Claim | null | undefined | unknown; empty?: string }) {
  const claim = asClaim(raw);
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

/**
 * Marks a record whose current version came in through the proposal inbox (D1e): what it says is the
 * submitter's account, filed by the founder, not something a source or HQ's build established.
 */
export function InboxOriginChip({ envelope }: { envelope: Envelope<unknown> }) {
  if (envelope.meta.origin !== "proposal_acceptance") return null;
  const via = envelope.meta.proposal_id ? ` (${envelope.meta.proposal_id})` : "";
  return (
    <Chip tone="warn" glyph="⇣" title="The submitter's account, filed by the founder. Not established by a source or by HQ's build.">
      {envelope.meta.version === 1 ? "Entered through the proposal inbox" : "Last changed through the proposal inbox"}
      {via}
    </Chip>
  );
}

/** The inbox-origin chip for a record given by id, in lists of defects, evidence and open items. */
export function InboxMark({ ds, id }: { ds: Dataset; id: string }) {
  const envelope = typeof id === "string" ? ds.byId(id) : undefined;
  return envelope ? <InboxOriginChip envelope={envelope} /> : null;
}

/** The founder acceptance (accepted or rejected) a record carries, if any. A cleared one ("none") does not count. */
export function bindingAcceptance(data: unknown): { state: string; decision_id: string } | null {
  if (!isObject(data) || !isObject(data.hq_acceptance)) return null;
  const { state, decision_id } = data.hq_acceptance;
  if (state !== "accepted" && state !== "rejected") return null;
  return { state, decision_id: typeof decision_id === "string" ? decision_id : "(decision unknown)" };
}

/**
 * Said wherever a change to the record can be proposed (D2): a record carrying a founder acceptance
 * or rejection recorded in HQ cannot be changed by proposal, and the proposal would be refused.
 */
export function AcceptanceLock({ data }: { data: unknown }) {
  const acc = bindingAcceptance(data);
  if (!acc) return null;
  return (
    <Notice tone="warn">
      <strong>Proposals cannot change this record.</strong> It carries a founder {acc.state === "accepted" ? "acceptance" : "rejection"} recorded in HQ (
      {acc.decision_id}), and a proposal to change it would be refused. To change it, the founder first records a decision that clears the{" "}
      {acc.state === "accepted" ? "acceptance" : "rejection"}. Or propose a new record instead.
    </Notice>
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
