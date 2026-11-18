import type { Metadata } from "next";
import Link from "@/components/pin-link";
import { Card, Chip, Empty, IdTag, PageHead } from "@/components/ui";
import { isRecordType, RECORD_TYPE_LABEL } from "@/lib/domain/schemas";
import { loadPage, type SearchParams } from "@/lib/server/page";
import { listChanges } from "@/lib/server/store";
import { isoDateTime, plural, statusLabel } from "@/lib/ui/format";
import { recordHref, refHref } from "@/lib/ui/links";

export const metadata: Metadata = { title: "Changes" };

export default async function ChangesPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal, ctx } = await loadPage(searchParams, { pinnable: false });
  const changes = await listChanges(principal, 100);
  return (
    <div className="stack">
      <PageHead
        title="Changes"
        lede="Every change to HQ's records, newest first: what changed, when, why, by whom and under which commission. Each change is a dataset revision; any revision can be reopened exactly as it stood."
      />
      {changes.length === 0 ? (
        <Card>
          <Empty>No changes recorded.</Empty>
        </Card>
      ) : (
        changes.map((c) => {
          const byType = new Map<string, typeof c.changes>();
          for (const change of c.changes) byType.set(change.type, [...(byType.get(change.type) ?? []), change]);
          return (
            <Card
              key={c.rev}
              id={`rev-${c.rev}`}
              title={
                <span className="row" style={{ gap: 8 }}>
                  <IdTag id={`rev ${c.rev}`} /> {c.summary}
                </span>
              }
              action={
                c.rev === ctx.head ? (
                  <Chip tone="accent">Current</Chip>
                ) : (
                  <Link className="btn small" href={`/?rev=${c.rev}`}>
                    View HQ at this revision
                  </Link>
                )
              }
              foot={
                <span className="mono xsmall break">
                  dataset sha256 {c.content_hash} · {plural(c.record_count, "live record")}
                  {c.seal_hash ? <> · seal {c.seal_hash}</> : null}
                </span>
              }
            >
              <div className="stack-sm">
                <div className="row small" style={{ gap: 10 }}>
                  <span>{isoDateTime(c.created_at)}</span>
                  <span>
                    by <strong>{c.created_by}</strong>
                  </span>
                  <Chip tone={c.kind === "founder_decision" ? "founder" : c.kind === "proposal_acceptance" ? "ok" : "plain"}>{statusLabel(c.kind)}</Chip>
                  {c.commission_ref ? <span>commission {c.commission_ref}</span> : null}
                </div>
                {c.changes.length > 40 ? (
                  <p className="small muted">
                    {plural(c.changes.length, "record version")} written:{" "}
                    {[...byType.entries()].map(([type, list]) => `${list.length} ${isRecordType(type) ? RECORD_TYPE_LABEL[type].toLowerCase() : type}`).join(", ")}.
                  </p>
                ) : (
                  <ul className="plain small">
                    {c.changes.map((change) => (
                      <li key={`${change.type}-${change.id}-${change.version}`}>
                        {isRecordType(change.type) ? RECORD_TYPE_LABEL[change.type] : change.type}{" "}
                        <Link href={`${recordHref(change.type, change.id)}?rev=${c.rev}`}>{change.id}</Link> → version {change.version}
                        {change.deleted ? " (retired)" : ""}
                        {change.proposal_id ? (
                          <>
                            {" "}
                            via <Link href={refHref(change.proposal_id)}>{change.proposal_id}</Link>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
