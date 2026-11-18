import Link from "@/components/pin-link";
import { notFound } from "next/navigation";
import { Card, Empty, IdTag, Pager, PageHead } from "@/components/ui";
import { developmentHealth } from "@/lib/domain/derive";
import { RECORD_TYPE_LABEL } from "@/lib/domain/schemas";
import { loadPage, paginate, type SearchParams } from "@/lib/server/page";
import { HEALTH_META } from "@/lib/ui/health-meta";
import { recordHref, withRev } from "@/lib/ui/links";

export default async function HealthList({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: SearchParams }) {
  const { key } = await params;
  if (!(key in HEALTH_META)) notFound();
  const { ctx, rev, params: query } = await loadPage(searchParams);
  const k = key as keyof typeof HEALTH_META;
  const items = developmentHealth(ctx.ds)[k];
  // Keep each record type together; a long list is paged, with a heading wherever the type changes.
  const types = [...new Set(items.map((i) => i.type))];
  const sorted = [...items].sort((a, b) => types.indexOf(a.type) - types.indexOf(b.type));
  const typeCount = (t: string) => items.filter((i) => i.type === t).length;
  const pg = paginate(sorted, query);
  const pager = <Pager {...pg} params={query} basePath={`/health/${key}`} noun="items" />;
  return (
    <div className="stack">
      <PageHead title={HEALTH_META[k].title} lede={HEALTH_META[k].description} crumbs={[{ label: "Dashboard", href: "/" }, { label: "Development health" }]} />
      <Card title={`${items.length} ${items.length === 1 ? "item" : "items"}`} flush foot={pager}>
        {items.length === 0 ? (
          <Empty>Nothing falls under this heading at this revision.</Empty>
        ) : (
          <>
            {pg.pages > 1 ? <div className="pager-top">{pager}</div> : null}
            <ul className="list">
              {pg.items.map((item, i) => (
                <li key={`${item.id}-${i}`}>
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
