import type { Metadata } from "next";
import Link from "next/link";
import { RevisionBar } from "@/components/revision-bar";
import { Card, Empty, IdTag, PageHead, Pager } from "@/components/ui";
import { search } from "@/lib/domain/derive";
import { loadPage, paginate, param, type SearchParams } from "@/lib/server/page";
import { recordHref, withRev } from "@/lib/ui/links";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, rev, params } = await loadPage(searchParams);
  const q = (param(params, "q") ?? "").trim();
  const typeFilter = param(params, "type") ?? "";
  // Results are paged, so there is no need to cut the list short.
  const allHits = q ? search(ctx.ds, q, { limit: 5000 }) : [];
  const typeCounts = new Map<string, { label: string; n: number }>();
  for (const h of allHits) typeCounts.set(h.type, { label: h.type_label, n: (typeCounts.get(h.type)?.n ?? 0) + 1 });
  const hits = typeFilter ? allHits.filter((h) => h.type === typeFilter) : allHits;
  const pg = paginate(hits, params);
  const pager = <Pager {...pg} params={params} basePath="/search" noun="results" />;
  const typeHref = (t: string) => {
    const sp = new URLSearchParams({ q, ...(t ? { type: t } : {}) });
    if (rev) sp.set("rev", String(rev));
    return `/search?${sp}`;
  };
  return (
    <div className="stack">
      <RevisionBar ctx={ctx} />
      <PageHead
        title="Search"
        lede="Searches every record: modules, loops, requirements, decisions, builds, evidence, defects and sources. Every word must match."
      />
      <form className="filters" method="get" action="/search" role="search">
        {rev ? <input type="hidden" name="rev" value={rev} /> : null}
        <label className="field" style={{ flex: "1 1 320px" }}>
          Search HQ
          <input type="search" name="q" defaultValue={q} autoFocus placeholder="A word, a name, an id or a hash" />
        </label>
        <button className="btn primary" type="submit">
          Search
        </button>
      </form>
      {q ? (
        <>
          {typeCounts.size > 1 ? (
            <nav className="tabs tabs-wrap" aria-label="Result types">
              <Link href={typeHref("")} aria-current={!typeFilter ? "page" : undefined}>
                All <span className="muted">{allHits.length}</span>
              </Link>
              {[...typeCounts.entries()].map(([t, c]) => (
                <Link key={t} href={typeHref(t)} aria-current={typeFilter === t ? "page" : undefined}>
                  {c.label} <span className="muted">{c.n}</span>
                </Link>
              ))}
            </nav>
          ) : null}
          <Card title={`${hits.length} ${hits.length === 1 ? "result" : "results"} for “${q}”`} flush foot={pager}>
            {hits.length === 0 ? (
              <Empty>Nothing in the register matches. Absence here means HQ holds no record — not that the thing does not exist.</Empty>
            ) : (
              <>
                {pg.pages > 1 ? <div className="pager-top">{pager}</div> : null}
                <ul className="list">
                  {pg.items.map((h) => (
                    <li key={`${h.type}-${h.id}`}>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="muted xsmall">{h.type_label}</span>
                        <Link className="li-title" href={withRev(recordHref(h.type, h.id), rev)}>
                          {h.title}
                        </Link>
                        <IdTag id={h.id} />
                      </div>
                      <div className="li-note">{h.snippet}</div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
