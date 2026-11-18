import Link from "next/link";
import { notFound } from "next/navigation";
import { RevisionBar } from "@/components/revision-bar";
import { Card, Empty, IdTag, Pager, Notice, PageHead } from "@/components/ui";
import { type HealthItem, missingWork } from "@/lib/domain/derive";
import { RECORD_TYPE_LABEL } from "@/lib/domain/schemas";
import { loadPage, paginate, type SearchParams } from "@/lib/server/page";
import { MISSING_META, type MissingKey } from "@/lib/ui/health-meta";
import { recordHref, withRev } from "@/lib/ui/links";

export default async function MissingList({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: SearchParams }) {
  const { key } = await params;
  if (!(key in MISSING_META)) notFound();
  const { ctx, rev, params: query } = await loadPage(searchParams);
  const k = key as MissingKey;
  const missing = missingWork(ctx.ds);
  const items: HealthItem[] = k === "not_in_recent_sources" ? missing.not_in_recent_sources.items : missing[k];
  const recency = missing.not_in_recent_sources;
  // Keep each record type together; a long list is paged, with a heading wherever the type changes.
  const types = [...new Set(items.map((i) => i.type))];
  const sorted = [...items].sort((a, b) => types.indexOf(a.type) - types.indexOf(b.type));
  const typeCount = (t: string) => items.filter((i) => i.type === t).length;
  const pg = paginate(sorted, query);
  const pager = <Pager {...pg} params={query} basePath={`/missing/${key}`} noun="items" />;
  return (
    <div className="stack">
      <RevisionBar ctx={ctx} />
      <PageHead
        title={MISSING_META[k].title}
        lede={MISSING_META[k].description}
        crumbs={[{ label: "Dashboard", href: "/" }, { label: "Missing and forgotten work" }]}
      />
      {k === "not_in_recent_sources" && recency.newest ? (
        <Notice tone="info">
          The newest source HQ could read is dated {recency.newest}. A module is listed here when no record about it cites a source dated on or after{" "}
          {recency.cutoff} ({recency.window_days} days earlier). Absence from recent documents is a prompt to check, not a finding.
        </Notice>
      ) : null}
      <Card title={`${items.length} ${items.length === 1 ? "item" : "items"}`} flush foot={pager}>
        {items.length === 0 ? (
          <Empty>Nothing is missing under this heading at this revision.</Empty>
        ) : (
          <>
            {pg.pages > 1 ? <div className="pager-top">{pager}</div> : null}
            <ul className="list">
              {pg.items.map((item, i) => (
                <li key={item.id}>
                  {types.length > 1 && (i === 0 || pg.items[i - 1].type !== item.type) ? (
                    <div className="list-group">
                      {RECORD_TYPE_LABEL[item.type]}{" "}
                      <span className="muted">
                        · {typeCount(item.type)} {typeCount(item.type) === 1 ? "item" : "items"}
                      </span>
                    </div>
                  ) : null}
                  <div className="row" style={{ gap: 8 }}>
                    <Link className="li-title" href={withRev(recordHref(item.type, item.id), rev)}>
                      {item.title}
                    </Link>
                    <IdTag id={item.id} />
                    <span className="muted xsmall">{RECORD_TYPE_LABEL[item.type]}</span>
                  </div>
                  <div className="li-note">{item.note}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
