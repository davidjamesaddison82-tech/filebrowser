import Link from "@/components/pin-link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AcceptanceLock, bindingAcceptance, Card, Chip, Citations, ClaimView, Empty, Fold, IdTag, InboxOriginChip, InvalidRecordNotice, KnownLink, ListedChip, ListedText, Notice, PageHead, RecordLink, StatusChip } from "@/components/ui";

import { type DatasetView, unreadableFields } from "@/lib/domain/conform";
import { isOutstanding, reviewItems } from "@/lib/domain/derive";
import { loadPage, routeId, type SearchParams } from "@/lib/server/page";
import { isoDate } from "@/lib/ui/format";
import { recordHref, withRev } from "@/lib/ui/links";

const plainList = (children: ReactNode[]) => <ul className="plain">{children}</ul>;

/** Record links that fold when the list is long. */
function RefList({ ds, ids, empty = "None recorded.", noun = "records" }: { ds: DatasetView; ids: string[]; empty?: string; noun?: string }) {
  if (ids.length === 0) return <span className="muted small">{empty}</span>;
  return (
    <Fold
      items={ids.map((id) => (
        <li key={id}>
          <RecordLink ds={ds} id={id} />
        </li>
      ))}
      limit={8}
      noun={noun}
      wrap={plainList}
    />
  );
}

export default async function RequirementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { ctx, rev } = await loadPage(searchParams);
  const { ds } = ctx;
  const record = ds.get("requirement", routeId(id));
  if (!record) notFound();
  const r = record.data;
  const source = ds.source(r.source_id);
  const related = reviewItems(ds).filter((item) => item.refs.some((ref) => ref.id === r.id));
  const dependents = ds.requirements.filter((x) => x.data.depends_on.includes(r.id));
  const rawTests = (r as Record<string, unknown>).linked_tests;
  const linkedTests = Array.isArray(rawTests) ? rawTests.filter((t): t is string => typeof t === "string") : [];
  const attribution: Record<string, string> = {
    commission_text: "Written by the founder in a commission",
    direct_quote: "Quoted directly by the source",
    ruling_recorded_by_source: "A founder ruling as recorded by the source",
    restated_by_source: "Restated by the source — not the founder's verbatim words",
  };

  return (
    <div className="stack">
      <PageHead
        title={r.title}
        id={r.id}
        crumbs={[{ label: "Founder requirements", href: "/requirements" }]}
        chips={
          <>
            <InboxOriginChip envelope={record} />
            <StatusChip value={r.disposition} field="requirement.disposition" />
            <StatusChip value={r.implementation_state} field="requirement.implementation_state" />
            {isOutstanding(r, ds) ? <Chip tone="warn">Outstanding</Chip> : null}
            <ListedChip field="requirement.category" value={r.category} />
          </>
        }
        actions={
          <>
            {bindingAcceptance(r) ? null : (
              <Link className="btn" href={`/proposals/new?type=requirement&id=${encodeURIComponent(r.id)}`}>
                Propose a change
              </Link>
            )}
            <Link className="btn" href={withRev(`/records/requirement/${r.id}`, rev)}>
              History & lineage
            </Link>
          </>
        }
      />
      <AcceptanceLock data={r} />
      {ctx.warnings.some((w) => w.type === "requirement" && w.id === record.meta.id) ? <InvalidRecordNotice storedAt={withRev(`/records/requirement/${encodeURIComponent(record.meta.id)}`, rev)} unreadableFields={unreadableFields(ctx.ds, record)} /> : null}

      <Card title="Original wording" hint="Permanent — a correction is a new requirement that supersedes this one">
        <div className="stack-sm">
          <blockquote className="exact">{r.exact_wording}</blockquote>
          <dl className="facts">
            <dt>Source</dt>
            <dd>
              {source ? (
                <>
                  <Link href={withRev(recordHref("source", r.source_id), rev)}>{source.data.title}</Link> <IdTag id={r.source_id} />
                </>
              ) : (
                <KnownLink ds={ds} type="source" id={r.source_id} />
              )}
              {r.locator ? <div className="muted small">{r.locator}</div> : null}
            </dd>
            <dt>Date</dt>
            <dd>{isoDate(r.source_date)}</dd>
            <dt>How we have these words</dt>
            <dd>
              {typeof r.attribution === "string" && Object.hasOwn(attribution, r.attribution) ? attribution[r.attribution] : <ListedText field="requirement.attribution" value={r.attribution} />}
              {r.attribution === "restated_by_source" ? (
                <div className="muted small">Treat with care: the source paraphrases or summarises the founder rather than quoting.</div>
              ) : null}
            </dd>
          </dl>
        </div>
      </Card>

      {related.length ? (
        <Notice tone="warn">
          <strong>Needs review:</strong>
          <Fold
            items={related.map((item) => (
              <li key={item.key}>
                {item.title} — {item.detail}
              </li>
            ))}
            limit={4}
            noun="review items"
            wrap={plainList}
          />
          <Link href={withRev("/review", rev)}>Open review items</Link>
        </Notice>
      ) : null}

      <div className="split">
        <div className="stack">
          <Card title="Interpretation" hint="HQ's reading — separate from the wording, changeable by proposal">
            {r.interpretation ? (
              <p>{r.interpretation}</p>
            ) : (
              <p className="muted small">No interpretation recorded. The wording is taken as it stands.</p>
            )}
          </Card>

          <Card title="Standing and implementation">
            <dl className="facts">
              <dt>Standing</dt>
              <dd>
                <StatusChip value={r.disposition} field="requirement.disposition" />
                <div className="muted small" style={{ marginTop: 4 }}>
                  {r.disposition === "unreviewed"
                    ? "Registered from the source. Only a founder decision in HQ can mark it active, superseded, deferred, withdrawn or satisfied."
                    : r.disposition_decision_id
                      ? "Set by founder decision "
                      : "As recorded when the requirement was registered."}
                  {r.disposition_decision_id ? <RecordLink ds={ds} id={r.disposition_decision_id} /> : null}
                </div>
              </dd>
              <dt>Implementation state</dt>
              <dd>
                <StatusChip value={r.implementation_state} field="requirement.implementation_state" />
                <div style={{ marginTop: 6 }}>
                  <ClaimView ds={ds} claim={r.implementation_note} empty="No source or evidence record says whether this was implemented." />
                </div>
              </dd>
              <dt>Linked code</dt>
              <dd>
                {r.linked_code.length === 0 ? (
                  <span className="muted small">No code revision is linked.</span>
                ) : (
                  <ul className="plain">
                    {r.linked_code.map((c, i) => (
                      <li key={i} className="small">
                        <span className="mono">{c.repository}</span> @ <span className="mono">{c.ref.slice(0, 12)}</span>
                        {c.path ? (
                          <>
                            {" "}
                            · <span className="mono">{c.path}</span>
                          </>
                        ) : null}
                        {c.note ? <span className="muted"> — {c.note}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
              {linkedTests.length ? (
                <>
                  <dt>Linked tests</dt>
                  <dd>
                    <Fold
                      items={linkedTests.map((t, i) => (
                        <li key={`${t}-${i}`} className="small break">
                          {t}
                        </li>
                      ))}
                      limit={8}
                      noun="tests"
                      wrap={plainList}
                    />
                  </dd>
                </>
              ) : null}
              <dt>Linked tests and evidence</dt>
              <dd>
                <RefList ds={ds} ids={r.linked_evidence_ids} empty="No test or acceptance evidence is linked." noun="evidence records" />
              </dd>
              <dt>Linked builds</dt>
              <dd>
                <RefList ds={ds} ids={r.linked_build_ids} empty="No build is linked." noun="builds" />
              </dd>
            </dl>
          </Card>

          <Card title="Acceptance criteria" hint={`${r.acceptance_criteria.length} recorded`}>
            {r.acceptance_criteria.length === 0 ? (
              <p className="muted small">No acceptance criteria are recorded. Setting them is a founder decision.</p>
            ) : (
              <Fold
                items={r.acceptance_criteria.map((c, i) => (
                  <ClaimView key={i} ds={ds} claim={c} />
                ))}
                limit={6}
                noun="acceptance criteria"
              />
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Related modules" hint={r.module_ids.length ? `${r.module_ids.length} linked` : undefined}>
            <RefList ds={ds} ids={r.module_ids} empty="Not linked to any module." noun="modules" />
          </Card>
          <Card title="Founder decisions">
            <RefList ds={ds} ids={r.decision_ids} empty="No founder decision is linked to this requirement." noun="decisions" />
          </Card>
          <Card title="Dependencies">
            <div className="stack-sm">
              <div>
                <div className="muted small">Depends on</div>
                <RefList ds={ds} ids={r.depends_on} empty="Nothing recorded." noun="requirements" />
              </div>
              <div>
                <div className="muted small">Depended on by</div>
                <RefList ds={ds} ids={dependents.map((d) => d.meta.id)} empty="Nothing recorded." noun="requirements" />
              </div>
            </div>
          </Card>
          <Card title="Conflicts and superseding instructions" flush>
            {r.conflicts_with.length + r.supersedes.length + r.superseded_by.length + (r.duplicate_of ? 1 : 0) === 0 ? (
              <Empty>No conflict, duplicate or superseding instruction is recorded.</Empty>
            ) : (
              <ul className="list">
                {r.conflicts_with.map((c) => (
                  <li key={c.id}>
                    <div className="row" style={{ gap: 8 }}>
                      <Chip tone="bad">Conflicts with</Chip>
                      <RecordLink ds={ds} id={c.id} />
                    </div>
                    <div className="li-note">{c.note}</div>
                  </li>
                ))}
                {r.supersedes.map((s) => (
                  <li key={`s-${s}`}>
                    <div className="row" style={{ gap: 8 }}>
                      <Chip>Supersedes</Chip>
                      <RecordLink ds={ds} id={s} />
                    </div>
                  </li>
                ))}
                {r.superseded_by.map((s) => (
                  <li key={`sb-${s}`}>
                    <div className="row" style={{ gap: 8 }}>
                      <Chip tone="ghost">Superseded by</Chip>
                      <RecordLink ds={ds} id={s} />
                    </div>
                  </li>
                ))}
                {r.duplicate_of ? (
                  <li>
                    <div className="row" style={{ gap: 8 }}>
                      <Chip tone="warn">Duplicate of</Chip>
                      <RecordLink ds={ds} id={r.duplicate_of} />
                    </div>
                  </li>
                ) : null}
              </ul>
            )}
          </Card>
          <Card title="Supporting quotations">
            {r.citations.length ? (
              <Citations ds={ds} citations={r.citations} />
            ) : (
              <p className="muted small">The original wording above is the quotation.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
