import type { Metadata } from "next";
import Link from "@/components/pin-link";
import { Card, Chip, Empty, IdTag, Notice, PageHead, Pager } from "@/components/ui";

import type { DatasetView } from "@/lib/domain/conform";
import { REVIEW_KIND_LABEL, type ReviewKind, reviewItems } from "@/lib/domain/derive";
import { loadPage, paginate, param, type SearchParams } from "@/lib/server/page";
import { chainProblems, headSeal } from "@/lib/server/store";
import { plural } from "@/lib/ui/format";
import { recordHref, withRev } from "@/lib/ui/links";

export const metadata: Metadata = { title: "Review items" };

/** The modules a record belongs to (a module belongs to itself). */
function modulesOf(ds: DatasetView, id: string): string[] {
  const e = ds.byId(id);
  if (!e) return [];
  if (e.meta.type === "module") return [id];
  const d = e.data as { module_ids?: unknown; module_id?: unknown };
  const ids = Array.isArray(d.module_ids) ? d.module_ids.filter((x): x is string => typeof x === "string") : [];
  return typeof d.module_id === "string" ? [...ids, d.module_id] : ids;
}

export default async function ReviewPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal, ctx, rev, params } = await loadPage(searchParams);
  const { ds } = ctx;
  const kind = param(params, "kind") ?? "";
  const moduleId = param(params, "module") ?? "";
  const all = reviewItems(ds);
  const itemModules = new Map(all.map((i) => [i.key, [...new Set(i.refs.flatMap((r) => modulesOf(ds, r.id)))]]));
  const inModule = all.filter((i) => !moduleId || itemModules.get(i.key)!.includes(moduleId));
  const kinds = [...new Set(all.map((i) => i.kind))] as ReviewKind[];
  // Keep each kind together so a page reads as a few labelled groups rather than a mixed stream.
  const items = (kind ? inModule.filter((i) => i.kind === kind) : inModule).sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
  const kindCount = (k: ReviewKind) => inModule.filter((i) => i.kind === k).length;
  const modulesInUse = [...new Set([...itemModules.values()].flat())].sort((a, b) => ds.moduleName(a).localeCompare(ds.moduleName(b)));
  const pg = paginate(items, params);
  const pager = <Pager {...pg} params={params} basePath="/review" noun="items" />;
  const kindHref = (k: string) => {
    const sp = new URLSearchParams({ ...(k ? { kind: k } : {}), ...(moduleId ? { module: moduleId } : {}) });
    const q = sp.toString();
    return withRev(q ? `/review?${q}` : "/review", rev);
  };
  // The history check covers the whole stored history up to the latest revision, so it is made only
  // when the page shows the latest: a pinned page shows nothing computed from the latest (D14).
  const chain = ctx.pinned ? null : await chainProblems(principal);
  const seal = ctx.pinned ? null : await headSeal(principal);

  return (
    <div className="stack">
      <PageHead
        title="Review items"
        lede="Omissions, duplicates, conflicting instructions and missing acceptance evidence, raised explicitly so that none of them is resolved by silence. HQ does not resolve them: it shows them to the founder."
      />

      {chain === null ? (
        <Notice tone="info">The history check is made on the latest revision only. Return to the latest to see it.</Notice>
      ) : chain.length === 0 ? (
        <Notice tone="ok">
          <div className="stack-sm" style={{ gap: 6 }}>
            <div>
              <strong>The stored history is internally consistent</strong> (checked just now): every version links to the one before it, every revision
              seal matches its records, and the seals chain back to revision 1. This shows the database agrees with itself. It cannot show that someone with
              full control of the database did not rewrite history and seals together.
            </div>
            {seal ? (
              <div>
                Seal of the latest revision ({seal.rev}): <code className="break">{seal.seal_hash ?? seal.content_hash}</code>
                <div className="small">
                  Keep a copy of this value and its revision number outside HQ (for example in an email to yourself). A revision&apos;s seal never changes:
                  if the seal stored for revision {seal.rev} ever differs from your copy, the history up to it was rewritten.
                </div>
              </div>
            ) : null}
          </div>
        </Notice>
      ) : (
        <Notice tone="bad">
          <strong>The stored history is not internally consistent: {plural(chain.length, "problem")} found.</strong> Something changed stored records
          or revision seals outside HQ&apos;s write path:{" "}
          {chain
            .slice(0, 5)
            .map((c) => (c.record_type === "dataset_revision" ? `revision ${c.record_id} (${c.problem})` : `${c.record_id} v${c.version} (${c.problem})`))
            .join("; ")}
          .
        </Notice>
      )}
      {ctx.warnings.length ? (
        <Notice tone="warn">
          {plural(ctx.warnings.length, "stored record")} did not pass validation. Each is shown with every value of the wrong kind marked “Not a valid
          value”, and its page shows it as stored:{" "}
          {ctx.warnings
            .slice(0, 6)
            .map((w) => w.id)
            .join(", ")}
          .
        </Notice>
      ) : null}

      <form className="filters" method="get" action="/review">
        {rev ? <input type="hidden" name="rev" value={rev} /> : null}
        {kind ? <input type="hidden" name="kind" value={kind} /> : null}
        <label className="field">
          Module
          <select name="module" defaultValue={moduleId}>
            <option value="">All modules</option>
            {modulesInUse.map((m) => (
              <option key={m} value={m}>
                {ds.moduleName(m)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" type="submit">
          Apply
        </button>
        {moduleId ? (
          <Link className="btn" href={kindHref(kind)}>
            Clear
          </Link>
        ) : null}
      </form>

      <nav className="tabs tabs-wrap" aria-label="Review kinds">
        <Link href={kindHref("")} aria-current={!kind ? "page" : undefined}>
          All <span className="muted">{inModule.length}</span>
        </Link>
        {kinds
          .filter((k) => kindCount(k) > 0 || kind === k)
          .map((k) => (
            <Link key={k} href={kindHref(k)} aria-current={kind === k ? "page" : undefined}>
              {REVIEW_KIND_LABEL[k]} <span className="muted">{kindCount(k)}</span>
            </Link>
          ))}
      </nav>

      <Card
        title={`${items.length} ${items.length === 1 ? "item" : "items"}`}
        hint={moduleId ? `touching ${ds.moduleName(moduleId)}` : undefined}
        flush
        foot={pager}
      >
        {items.length === 0 ? (
          <Empty>Nothing to review under this heading.</Empty>
        ) : (
          <>
            {pg.pages > 1 ? <div className="pager-top">{pager}</div> : null}
            <ul className="list">
              {pg.items.map((item, i) => (
                <li key={item.key}>
                  {!kind && (i === 0 || pg.items[i - 1].kind !== item.kind) ? (
                    <div className="list-group">
                      {REVIEW_KIND_LABEL[item.kind]}{" "}
                      <span className="muted">
                        · {kindCount(item.kind)} {kindCount(item.kind) === 1 ? "item" : "items"}
                      </span>
                    </div>
                  ) : null}
                  <div className="row" style={{ gap: 8 }}>
                    <Chip tone={item.kind === "conflict" || item.kind === "dangling_reference" ? "bad" : "warn"}>{REVIEW_KIND_LABEL[item.kind]}</Chip>
                    <span className="li-title">{item.title}</span>
                  </div>
                  <div className="li-note">{item.detail}</div>
                  <div className="row small" style={{ gap: 10 }}>
                    {item.refs.map((r) =>
                      r.exists ? (
                        <span key={r.id}>
                          <Link href={withRev(recordHref(r.type, r.id), rev)}>{r.title}</Link> <IdTag id={r.id} />
                        </span>
                      ) : (
                        <IdTag key={r.id} id={r.id} />
                      ),
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
