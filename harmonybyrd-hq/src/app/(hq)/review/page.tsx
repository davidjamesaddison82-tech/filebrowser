import type { Metadata } from "next";
import Link from "next/link";
import { RevisionBar } from "@/components/revision-bar";
import { Card, Chip, Empty, IdTag, Notice, PageHead, Pager } from "@/components/ui";
import type { Dataset } from "@/lib/domain/dataset";
import { REVIEW_KIND_LABEL, type ReviewKind, reviewItems } from "@/lib/domain/derive";
import { loadPage, paginate, param, type SearchParams } from "@/lib/server/page";
import { chainProblems } from "@/lib/server/store";
import { plural } from "@/lib/ui/format";
import { recordHref, withRev } from "@/lib/ui/links";

export const metadata: Metadata = { title: "Review items" };

/** The modules a record belongs to (a module belongs to itself). */
function modulesOf(ds: Dataset, id: string): string[] {
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
  const chain = await chainProblems(principal);

  return (
    <div className="stack">
      <RevisionBar ctx={ctx} />
      <PageHead
        title="Review items"
        lede="Omissions, duplicates, conflicting instructions and missing acceptance evidence, raised explicitly so that none of them is resolved by silence. HQ does not resolve them: it shows them to the founder."
      />

      {chain.length === 0 ? (
        <Notice tone="ok">Record history is intact: every version of every record links correctly to the one before it (hash chain verified just now).</Notice>
      ) : (
        <Notice tone="bad">
          <strong>Record history check failed for {plural(chain.length, "version")}.</strong> Something changed stored records outside HQ&apos;s write path:{" "}
          {chain
            .slice(0, 5)
            .map((c) => `${c.record_id} v${c.version} (${c.problem})`)
            .join("; ")}
          .
        </Notice>
      )}
      {ctx.warnings.length ? (
        <Notice tone="warn">
          {plural(ctx.warnings.length, "stored record")} did not pass validation and are shown as stored:{" "}
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
