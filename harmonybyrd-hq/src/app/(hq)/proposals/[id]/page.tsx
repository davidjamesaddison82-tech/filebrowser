import Link from "@/components/pin-link";
import { notFound } from "next/navigation";
import { ReviewForm, WithdrawForm } from "@/components/gov-forms";
import { bindingAcceptance, Card, Chip, Empty, IdTag, Notice, PageHead, RecordLink, StatusChip } from "@/components/ui";
import { isFounderSession } from "@/lib/auth/principal";
import { HqError } from "@/lib/server/errors";
import { loadPage, param, routeId, type SearchParams } from "@/lib/server/page";
import { getProposal, proposalImpact } from "@/lib/server/services";
import { humanise, isoDate, isoDateTime, statusLabel } from "@/lib/ui/format";
import { recordHref } from "@/lib/ui/links";
import { citedSources, standingFieldsSet } from "@/lib/ui/proposal-review";

/** What the founder's (or submitter's) action was, as a noun: "Your rejection was not applied". */
const ACTION_NOUN: Record<string, string> = {
  accept: "acceptance",
  reject: "rejection",
  needs_changes: "request for changes",
  withdraw: "withdrawal",
};

/** The proposal event each action records. Accepting a stale proposal records "marked_stale". */
const ACTION_EVENTS: Record<string, string[]> = {
  accept: ["accepted", "marked_stale"],
  reject: ["rejected"],
  needs_changes: ["needs_changes"],
  withdraw: ["withdrawn"],
};

/** How a closed proposal ended, in a sentence: "already accepted by founder". */
const CLOSED_AS: Record<string, string> = {
  accepted: "accepted",
  rejected: "rejected",
  needs_changes: "sent back for changes",
  withdrawn: "withdrawn",
  marked_stale: "marked stale",
};

function show(value: unknown): string {
  if (value === null || value === undefined) return "(empty)";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { principal, ctx, params: query } = await loadPage(searchParams, { pinnable: false });
  let proposal;
  try {
    proposal = await getProposal(principal, routeId(id));
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
  // The result of the viewer's own review or withdrawal, carried in the address by the server action (ui-5).
  // Shown only when the proposal's history agrees: a refusal only if the proposal is closed, a success
  // only if the closing event is the one this viewer's action records.
  const done = param(query, "done") ?? "";
  const refused = param(query, "refused") ?? "";
  const doneNotice =
    !open && outcome && ACTION_NOUN[done] && ACTION_EVENTS[done]?.includes(outcome.event) && outcome.actor === principal.handle
      ? outcome.event === "marked_stale"
        ? "Your acceptance was not applied: the record had changed since the proposal was written, so the proposal was marked stale instead."
        : `Your ${ACTION_NOUN[done]} was recorded.`
      : null;
  const refusedNotice =
    !open && outcome && ACTION_NOUN[refused]
      ? `Your ${ACTION_NOUN[refused]} was not applied: this proposal was already ${CLOSED_AS[outcome.event] ?? statusLabel(outcome.event).toLowerCase()} by ${outcome.actor} at ${isoDateTime(String(outcome.at))}.`
      : null;
  const acceptance = impact.op === "update" ? bindingAcceptance({ hq_acceptance: impact.target_acceptance }) : null;
  // F9: for a new record, the context is what it cites; and a proposal that sets where a record stands says so.
  const cited = impact.op === "create" ? citedSources(ctx.ds, impact.record) : [];
  const standingFields = standingFieldsSet(proposal.payload);
  const madeByPreview = impact.op === "create" && impact.record_type === "recommendation" ? `Proposed through the inbox by ${proposal.submitted_by}` : null;

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

      {refusedNotice ? (
        <div className="notice bad" role="alert">
          {refusedNotice} Nothing else was changed.
        </div>
      ) : null}
      {open && acceptance ? (
        <Notice tone="bad">
          <strong>This proposal cannot be accepted as it stands.</strong> Its target carries a founder {acceptance.state === "accepted" ? "acceptance" : "rejection"}{" "}
          recorded in HQ ({acceptance.decision_id}), and a record carrying one cannot be changed by proposal. To change the record, first record a founder
          decision that clears the {acceptance.state === "accepted" ? "acceptance" : "rejection"}; otherwise reject this proposal or ask for a new record
          instead.
        </Notice>
      ) : null}
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
                  {madeByPreview ? ` If filed, it is attributed to “${madeByPreview}”, whatever the proposal says.` : ""}
                  {" "}If filed, the record is marked “Entered through the proposal inbox” wherever it is shown.
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
                {doneNotice ? <p className="notice ok">{doneNotice}</p> : null}
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

          {impact.op === "create" ? (
            <Card title="Original context" hint="Sources the proposed record cites" flush>
              {cited.length === 0 ? (
                <Empty>The proposed record cites no source.</Empty>
              ) : (
                <ul className="list">
                  {cited.map((s) => (
                    <li key={s.id}>
                      <span>
                        {s.title ? (
                          <Link className="li-title" href={recordHref("source", s.id)}>
                            {s.title}
                          </Link>
                        ) : (
                          <span className="li-title">No source with this id is on record</span>
                        )}{" "}
                        <IdTag id={s.id} />
                      </span>
                      <div className="li-note">
                        {s.textHeld
                          ? "HQ holds this source's text. Quotations from it are checked against that text."
                          : "HQ holds no text for this source, so nothing quoted from it can be checked."}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : (
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
          )}

          <Card title="Known risks to weigh">
            <ul className="plain small">
              {fromAi ? <li>The proposer is an AI client. Treat its rationale as a claim to check, not as evidence.</li> : null}
              {impact.op === "update" && impact.stale ? <li>The target changed since the proposal was written.</li> : null}
              {standingFields.length ? (
                <li>
                  It sets where the record stands ({standingFields.join(", ")}). That changes what HQ shows as tested, accepted or decided: check the
                  sources for it before accepting.
                </li>
              ) : null}
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
