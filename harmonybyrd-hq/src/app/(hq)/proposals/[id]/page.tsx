import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewForm, WithdrawForm } from "@/components/gov-forms";
import { Card, Chip, Empty, IdTag, Notice, PageHead, RecordLink, StatusChip } from "@/components/ui";
import { isFounderSession } from "@/lib/auth/principal";
import { HqError } from "@/lib/server/errors";
import { loadPage, type SearchParams } from "@/lib/server/page";
import { getProposal, proposalImpact } from "@/lib/server/services";
import { humanise, isoDate, isoDateTime, statusLabel } from "@/lib/ui/format";
import { recordHref } from "@/lib/ui/links";

function show(value: unknown): string {
  if (value === null || value === undefined) return "(empty)";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { principal, ctx } = await loadPage(searchParams);
  let proposal;
  try {
    proposal = await getProposal(principal, decodeURIComponent(id));
  } catch (error) {
    if (error instanceof HqError && error.status === 404) notFound();
    throw error;
  }
  const impact = await proposalImpact(principal, proposal);
  const founder = isFounderSession(principal);
  const open = proposal.status === "submitted";
  const mine = proposal.submitted_by === principal.handle;
  const fromAi = proposal.submitted_by_kind === "ai_client";
  const evidence = proposal.evidence as { description?: string; reference?: string; sha256?: string }[];
  // How the proposal ended, taken from its own append-only history.
  const outcome = [...proposal.events].reverse().find((e) => e.event !== "submitted") ?? null;
  const outcomeDetail = (outcome?.detail ?? null) as { record_type?: string; record_id?: string; version?: number } | null;

  return (
    <div className="stack">
      <PageHead
        title={proposal.title}
        id={proposal.id}
        crumbs={[{ label: "Proposal inbox", href: "/proposals" }]}
        chips={
          <>
            <StatusChip value={proposal.status} />
            <Chip tone="outline">{humanise(proposal.kind)}</Chip>
            <Chip tone={fromAi ? "warn" : "outline"}>
              {fromAi ? "Submitted by AI client" : `Submitted by ${humanise(proposal.submitted_by_role).toLowerCase()}`}: {proposal.submitted_by}
            </Chip>
          </>
        }
        lede={`Submitted ${isoDateTime(proposal.submitted_at)}, written against dataset revision ${proposal.base_rev}.`}
      />

      {open ? (
        <Notice tone="info">
          <strong>This is a proposal, not a record.</strong> It has changed nothing. It takes effect only if the founder accepts it.
        </Notice>
      ) : null}
      {proposal.status === "marked_stale" ? (
        <Notice tone="bad">
          This proposal was not applied: the record it targets changed after the proposal was written. It must be re-read and resubmitted against the
          current version.
        </Notice>
      ) : null}

      <div className="split">
        <div className="stack">
          <Card title="What is proposed">
            {impact.op === "update" ? (
              <div className="stack-sm">
                <p>
                  Change{" "}
                  {impact.target ? (
                    <>
                      <Link href={recordHref(impact.target.type, impact.target.id)}>{impact.target.title}</Link> <IdTag id={impact.target.id} />
                    </>
                  ) : (
                    <IdTag id={proposal.target_id ?? "?"} />
                  )}{" "}
                  — written against version {proposal.base_version}
                  {impact.current_version !== null ? `; the record is now at version ${impact.current_version}` : ""}.
                </p>
                {open && impact.stale ? (
                  <Notice tone="warn">The target has moved on since this was written. This proposal is stale and cannot be applied as it stands.</Notice>
                ) : null}
                {impact.sensitive_fields.length ? (
                  <Notice tone="warn">
                    This proposal changes a status field ({impact.sensitive_fields.join(", ")}). Check the supporting evidence before accepting: a status is a
                    claim about the world, not a label.
                  </Notice>
                ) : null}
                {impact.changes.map((c) => (
                  <div key={c.field} className="stack-sm" style={{ gap: 6 }}>
                    <h3>
                      Field <code>{c.field}</code>
                    </h3>
                    <div className="diff">
                      <div className="before">
                        <h4>{open ? "Current" : `Before (version ${proposal.base_version})`}</h4>
                        {show(c.before)}
                      </div>
                      <div className="after">
                        <h4>{proposal.status === "accepted" ? "Applied" : "Proposed"}</h4>
                        {show(c.after)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="stack-sm">
                <p>
                  Create a new <strong>{humanise(String(impact.record_type)).toLowerCase()}</strong> record.
                  {impact.record_type === "evidence"
                    ? " If filed, it stays labelled as an unverified submission: it is a claim, not verified evidence, and never implies acceptance."
                    : ""}
                </p>
                <pre className="json">{JSON.stringify(impact.record, null, 2)}</pre>
              </div>
            )}
          </Card>

          <Card title="Rationale">
            <p style={{ whiteSpace: "pre-wrap" }}>{proposal.rationale}</p>
          </Card>

          <Card title="Supporting evidence offered" hint={`${evidence.length} item${evidence.length === 1 ? "" : "s"}`} flush>
            {evidence.length === 0 ? (
              <Empty>No supporting evidence was attached. The rationale stands alone.</Empty>
            ) : (
              <ul className="list">
                {evidence.map((e, i) => (
                  <li key={i}>
                    <span className="li-title">{e.description}</span>
                    <div className="li-note mono xsmall break">
                      {e.reference ?? ""} {e.sha256 ? `sha256 ${e.sha256}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Founder review">
            {!open ? (
              <div className="stack-sm" role="status">
                <p>
                  <strong>{statusLabel(proposal.status)}</strong>
                  {outcome ? (
                    <>
                      {" "}
                      by {outcome.actor} on {isoDateTime(String(outcome.at))}.
                    </>
                  ) : (
                    "."
                  )}
                </p>
                {outcome?.resulting_rev ? (
                  <p className="small">
                    Applied as <Link href={`/changes#rev-${outcome.resulting_rev}`}>dataset revision {outcome.resulting_rev}</Link>
                    {outcomeDetail?.record_id && outcomeDetail.record_type ? (
                      <>
                        : <Link href={recordHref(outcomeDetail.record_type, outcomeDetail.record_id)}>{outcomeDetail.record_id}</Link> is at version{" "}
                        {outcomeDetail.version}
                      </>
                    ) : null}
                    . The earlier version is kept in the history.
                  </p>
                ) : (
                  <p className="small">No record was changed.</p>
                )}
                {outcome?.note ? <p className="small">Note: {outcome.note}</p> : null}
                <p className="muted small">This proposal is closed to further review.</p>
              </div>
            ) : founder ? (
              <ReviewForm proposalId={proposal.id} stale={impact.stale} />
            ) : (
              <div className="stack-sm">
                <p className="muted small">
                  Only the founder&apos;s own session can accept or reject a proposal. You are signed in as {principal.displayName} ({principal.appRole}).
                </p>
                {mine ? <WithdrawForm proposalId={proposal.id} /> : null}
              </div>
            )}
          </Card>

          <Card title="Impact on other records" hint={`${impact.affected.length} affected`} flush>
            {impact.affected.length === 0 ? (
              <Empty>No other record refers to the target.</Empty>
            ) : (
              <ul className="list">
                {impact.affected.slice(0, 40).map((r) => (
                  <li key={r.id}>
                    <span>
                      <span className="muted xsmall">{r.type_label}</span> <RecordLink ds={ctx.ds} id={r.id} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Original context" hint="Sources the target rests on" flush>
            {impact.sources.length === 0 ? (
              <Empty>No source is recorded for the target.</Empty>
            ) : (
              <ul className="list">
                {impact.sources.map((s) => (
                  <li key={s.id}>
                    <span>
                      <Link className="li-title" href={recordHref("source", s.id)}>
                        {s.title}
                      </Link>{" "}
                      <IdTag id={s.id} />
                    </span>
                    <div className="li-note">
                      {isoDate(s.date)} · {humanise(s.authority)} · {s.citations.length} quotation{s.citations.length === 1 ? "" : "s"} used by the record
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Known risks to weigh">
            <ul className="plain small">
              {fromAi ? <li>The proposer is an AI client. Treat its rationale as a claim to check, not as evidence.</li> : null}
              {impact.op === "update" && impact.stale ? <li>The target changed since the proposal was written.</li> : null}
              {evidence.length === 0 ? <li>No supporting evidence was attached.</li> : null}
              {impact.affected.length > 0 ? <li>{impact.affected.length} other record(s) refer to the target and may read differently after the change.</li> : null}
              <li>Accepting creates a new dataset revision. The previous version stays in the history and can always be reopened.</li>
            </ul>
          </Card>

          <Card title="History" flush>
            <ul className="list">
              {proposal.events.map((e, i) => (
                <li key={i}>
                  <div className="row" style={{ gap: 8 }}>
                    <StatusChip value={e.event} />
                    <span className="small">
                      by {e.actor} · {isoDateTime(String(e.at))}
                    </span>
                  </div>
                  {e.note ? <div className="li-note">{e.note}</div> : null}
                  {e.resulting_rev ? (
                    <div className="li-note">
                      Created <Link href={`/changes#rev-${e.resulting_rev}`}>dataset revision {e.resulting_rev}</Link>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
