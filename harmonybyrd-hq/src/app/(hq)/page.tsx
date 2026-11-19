import type { Metadata } from "next";
import Link from "@/components/pin-link";
import { EcosystemMap } from "@/components/ecosystem-map";
import { Card, Chip, Empty, IdTag, PageHead, RecordLink, Tile } from "@/components/ui";
import { developmentHealth, ecosystemOverview, missingWork } from "@/lib/domain/derive";
import { loadPage, type SearchParams } from "@/lib/server/page";
import { listChanges } from "@/lib/server/store";
import { humanise, isoDateTime, plural } from "@/lib/ui/format";
import { HEALTH_META, MISSING_META, type MissingKey } from "@/lib/ui/health-meta";
import { withRev } from "@/lib/ui/links";
import { layoutMap } from "@/lib/ui/map-layout";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const { principal, ctx, rev } = await loadPage(searchParams);
  const { ds } = ctx;
  const overview = ecosystemOverview(ds);
  const health = developmentHealth(ds);
  const missing = missingWork(ds);
  // On a pinned revision, list only the changes up to that revision: later ones did not exist then (D14).
  const shownRev = ds.revision.rev;
  const changes = (await listChanges(principal, ctx.pinned ? ctx.head - shownRev + 6 : 6)).filter((c) => c.rev <= shownRev).slice(0, 6);
  const layout = layoutMap(overview);
  const recommendations = [...ds.recommendations].sort((a, b) => a.data.rank - b.data.rank);
  const withBuild = new Set(ds.builds.map((b) => b.data.module_id).filter(Boolean));
  // "Read" means HQ holds a text snapshot it drew records from. Repositories that were inspected but
  // hold nothing, and artefacts inventoried but not ingested, are not counted as read.
  const readSources = ds.sources.filter((s) => s.data.text_snapshot != null).length;
  const unread = ds.sources.length - readSources;
  const unreached = ds.sources.filter((s) => s.data.text_snapshot == null && s.data.access === "not_accessible").length;

  const missingCounts: [MissingKey, number][] = [
    ["sources_not_accessible", missing.sources_not_accessible.length],
    ["modules_without_source_evidence", missing.modules_without_source_evidence.length],
    ["requirements_without_implementation_record", missing.requirements_without_implementation_record.length],
    ["requirements_without_test_evidence", missing.requirements_without_test_evidence.length],
    ["requirements_unreviewed", missing.requirements_unreviewed.length],
    ["modules_without_learning_loop", missing.modules_without_learning_loop.length],
    ["modules_without_build", missing.modules_without_build.length],
    ["not_in_recent_sources", missing.not_in_recent_sources.items.length],
  ];

  return (
    <div className="stack">
      <PageHead
        title="HarmonyByrd development"
        lede={
          <>
            {plural(ds.modules.length, "module")} in {plural(overview.families.length, "family", "families")} · {plural(withBuild.size, "module")}{" "}
            with an executable version on record · {plural(ds.loops.length, "learning loop")} ·{" "}
            {plural(ds.requirements.length, "founder requirement")} · drawn from {plural(readSources, "document")} HQ could read.
            {unread > 0 ? (
              <>
                {" "}
                <Link href={withRev("/sources", rev)}>
                  {unread} more {unread === 1 ? "source is" : "sources are"} named
                </Link>{" "}
                but HQ holds no text from {unread === 1 ? "it" : "them"}
                {unreached > 0 ? `: ${unreached} could not be reached` : ""}
                {unread - unreached > 0
                  ? `${unreached > 0 ? ", " : ": "}${unread - unreached} were opened but are not used as a source of records`
                  : ""}
                .
              </>
            ) : null}
          </>
        }
      />

      <Card
        title="Ecosystem overview"
        hint="What we are building, and where each part honestly stands"
        flush
        action={
          <Link className="btn small" href={withRev("/modules", rev)}>
            Module atlas
          </Link>
        }
      >
        <EcosystemMap layout={layout} rev={rev} />
      </Card>

      <section className="stack-sm" aria-labelledby="health-h">
        <div className="row-between">
          <h2 id="health-h">Development health</h2>
          <span className="muted small">Test passes and founder acceptance are counted separately. Every figure opens its list.</span>
        </div>
        <div className="grid-tiles">
          {(Object.keys(HEALTH_META) as (keyof typeof HEALTH_META)[]).map((key) => (
            <Tile
              key={key}
              href={withRev(`/health/${key}`, rev)}
              n={health[key].length}
              title={HEALTH_META[key].title}
              detail={HEALTH_META[key].description}
              tone={HEALTH_META[key].tone}
            />
          ))}
        </div>
      </section>

      <div className="grid-2">
        <Card title="Missing and forgotten work" hint="Nothing is dropped silently" flush>
          <ul className="list">
            {missingCounts.map(([key, count]) => (
              <li key={key}>
                <div className="row-between" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                  <Link className="li-title" href={withRev(`/missing/${key}`, rev)}>
                    {MISSING_META[key].title}
                  </Link>
                  <Chip tone={count > 0 ? "warn" : "ghost"}>{count}</Chip>
                </div>
                <div className="li-note">{MISSING_META[key].description}</div>
              </li>
            ))}
          </ul>
        </Card>

        <Card
          title="Development priorities"
          hint="Recommendations are not approved work"
          flush
          foot={
            health.accepted_in_hq.length === 0
              ? "No work has been approved or accepted by a founder decision in HQ yet."
              : `${plural(health.accepted_in_hq.length, "record")} carry a founder acceptance recorded in HQ.`
          }
        >
          {recommendations.length === 0 ? (
            <Empty>No next steps have been proposed.</Empty>
          ) : (
            <ul className="list">
              {recommendations.map((r) => (
                <li key={r.meta.id}>
                  <div className="row" style={{ gap: 8 }}>
                    <Chip tone="accent" glyph="➜">
                      Recommendation {r.data.rank}
                    </Chip>
                    <Link className="li-title" href={withRev(`/records/recommendation/${r.meta.id}`, rev)}>
                      {r.data.title}
                    </Link>
                  </div>
                  <div className="li-note">{r.data.rationale}</div>
                  {r.data.prerequisite_ids.length || r.data.blocked_by.length ? (
                    <div className="li-note">
                      {r.data.prerequisite_ids.length ? (
                        <>
                          Requires first:{" "}
                          {r.data.prerequisite_ids.map((id, i) => (
                            <span key={id}>
                              {i ? ", " : ""}
                              <RecordLink ds={ds} id={id} showId={false} />
                            </span>
                          ))}
                          .{" "}
                        </>
                      ) : null}
                      {r.data.blocked_by.length ? (
                        <>
                          Blocked by:{" "}
                          {r.data.blocked_by.map((id, i) => (
                            <span key={id}>
                              {i ? ", " : ""}
                              <RecordLink ds={ds} id={id} showId={false} />
                            </span>
                          ))}
                          .
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Recent changes"
        hint="What changed, when, why, by whom, under which commission"
        flush
        action={
          <Link className="btn small" href="/changes">
            All changes
          </Link>
        }
      >
        {changes.length === 0 ? (
          <Empty>No changes recorded.</Empty>
        ) : (
          <ul className="list">
            {changes.map((c) => (
              <li key={c.rev}>
                <div className="row" style={{ gap: 8 }}>
                  <IdTag id={`rev ${c.rev}`} />
                  <Link className="li-title" href={`/changes#rev-${c.rev}`}>
                    {c.summary}
                  </Link>
                </div>
                <div className="li-note">
                  {isoDateTime(c.created_at)} · by {c.created_by} · {humanise(c.kind).toLowerCase()}
                  {c.commission_ref ? ` · commission ${c.commission_ref}` : ""} · {plural(c.changes.length, "record version")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
