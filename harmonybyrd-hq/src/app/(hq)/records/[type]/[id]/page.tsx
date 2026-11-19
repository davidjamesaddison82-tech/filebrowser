import Link from "@/components/pin-link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  AcceptanceLock,
  bindingAcceptance,
  Card,
  Chip,
  Citations,
  ClaimView,
  Empty,
  EpistemicChip,
  Fold,
  IdTag,
  InboxOriginChip,
  InvalidRecordNotice,
  isReportedAcceptance,
  KnownLink,
  NotValidChip,
  Notice,
  PageHead,
  PathwayBasisChip,
  RecordLink,
  ReportedAcceptanceNotice,
  BuildStandingChip,
  ListedChip,
  ListedText,
  StatusChip,
} from "@/components/ui";
import { type DatasetView, isReadable, NOT_VALID, UNREADABLE_LIST, unreadableFields } from "@/lib/domain/conform";
import type { Dataset, Envelope } from "@/lib/domain/dataset";
import { acceptanceStatus, dependencies, lineage, recordTitle } from "@/lib/domain/derive";
import {
  type AnyRecord,
  type BuildRecord,
  type CommissionRecord,
  type DecisionRecord,
  type DefectRecord,
  type Epistemic,
  type EvidenceRecord,
  isRecordType,
  type OpenItemRecord,
  type PathwayRecord,
  RECORD_TYPE_LABEL,
  type RecommendationRecord,
  type SourceRecord,
  STAGE_LABEL,
} from "@/lib/domain/schemas";
import { loadPage, routeId, type SearchParams } from "@/lib/server/page";
import { recordHistory } from "@/lib/server/store";
import { humanise, isoDate, isoDateTime, plural, recommendationMaker, shortHash, statusLabel } from "@/lib/ui/format";
import { codeRef, hqChecks, isObject, otherMentions, searchResults, str, strings, type SafeSearchResult } from "@/lib/ui/guards";
import { recordHref, refHref, withRev } from "@/lib/ui/links";

const LIST_PAGE: Record<string, { label: string; href: string }> = {
  source: { label: "Sources", href: "/sources" },
  module: { label: "Module atlas", href: "/modules" },
  loop: { label: "Learning loops", href: "/loops" },
  pathway: { label: "Learning loops", href: "/loops" },
  requirement: { label: "Founder requirements", href: "/requirements" },
  decision: { label: "Decision centre", href: "/decisions" },
  commission: {
    label: "Development & evidence",
    href: "/evidence?tab=commissions",
  },
  build: { label: "Development & evidence", href: "/evidence?tab=builds" },
  evidence: { label: "Development & evidence", href: "/evidence?tab=evidence" },
  defect: { label: "Development & evidence", href: "/evidence?tab=defects" },
  open_item: { label: "Development & evidence", href: "/evidence?tab=open" },
  recommendation: { label: "Dashboard", href: "/" },
};

const plainList = (children: ReactNode[]) => <ul className="plain">{children}</ul>;
const listWrap = (children: ReactNode[]) => <ul className="list">{children}</ul>;

/**
 * A list of record links that folds when long. Same output as the shared RefList for short lists.
 * `unreadable`: the list is empty only because HQ cannot read what is stored there (L8), so it says so
 * instead of "None recorded".
 */
function RefList({ ds, ids, empty = "None recorded.", noun = "records", unreadable = false }: { ds: DatasetView; ids: string[]; empty?: string; noun?: string; unreadable?: boolean }) {
  if (ids.length === 0) return <UnreadableOr unreadable={unreadable} empty={empty} />;
  return (
    <Fold
      items={ids.map((id) => (
        <li key={id}>
          <RecordLink ds={ds} id={id} />
        </li>
      ))}
      limit={6}
      noun={noun}
      wrap={plainList}
    />
  );
}

/** The fields of a record that dependencies() reads its own dependencies and blockers from. */
const DEPENDENCY_FIELDS: readonly string[] = ["depends_on", "prerequisite_ids", "blocked_by", "connections", "blockers"];

/** L8: what an empty list says. One HQ cannot read says so, and points at the stored record; never "nothing". */
function UnreadableOr({ unreadable, empty }: { unreadable: boolean; empty: string }) {
  if (unreadable) {
    return (
      <span className="small unreadable-list" data-testid="unreadable-list">
        {UNREADABLE_LIST}
      </span>
    );
  }
  return <span className="muted small">{empty}</span>;
}

/** Group references by record type, largest group first, keeping each group's id order. */
function groupByType<T extends { type_label: string }>(refs: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const r of refs) groups.set(r.type_label, [...(groups.get(r.type_label) ?? []), r]);
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

function pluralLabel(label: string): string {
  return label === "Evidence" ? "Evidence records" : `${label}s`;
}

function loose(data: unknown): Record<string, unknown> {
  return (data ?? {}) as Record<string, unknown>;
}

/** Records of the same decision or build in other documents, kept word for word after HQ merged them. */
function OtherMentions({ ds, data }: { ds: DatasetView; data: unknown }) {
  const mentions = otherMentions(loose(data).other_mentions);
  if (mentions.length === 0) return null;
  return (
    <Card title="Other mentions" hint={plural(mentions.length, "mention")} flush>
      <p className="small muted" style={{ margin: "0 16px 6px" }}>
        HQ merged several documents&apos; records of the same thing into this one. Each document&apos;s own statement is kept here, unchanged.
      </p>
      <Fold
        items={mentions.map((m, i) => {
          const status = m.status_in_that_source ?? m.standing_in_that_source;
          const sameCites = JSON.stringify(m.citations ?? []) === JSON.stringify(m.statement?.citations ?? []);
          return (
            <li key={`${m.merged_id ?? ""}-${i}`}>
              <div className="row" style={{ gap: 8 }}>
                <span className="li-title">{m.title ?? m.label ?? m.merged_id ?? "Untitled mention"}</span>
                {m.merged_id ? <IdTag id={m.merged_id} /> : null}
              </div>
              <div className="row small muted" style={{ gap: 8 }}>
                {status ? (
                  <span>
                    {m.status_in_that_source !== null ? "Status" : "Standing"} in that source: <StatusChip value={status} />
                  </span>
                ) : null}
                {m.recorded_from_cluster ? <span>Recorded from source group {m.recorded_from_cluster}</span> : null}
              </div>
              {m.why_merged ? <div className="li-note">Why merged: {m.why_merged}</div> : null}
              <ClaimView ds={ds} claim={m.statement} />
              {!sameCites && m.citations.length ? (
                <Citations ds={ds} citations={m.citations} label={`${plural(m.citations.length, "quotation")} naming it`} />
              ) : null}
            </li>
          );
        })}
        limit={4}
        noun="mentions"
        wrap={listWrap}
      />
    </Card>
  );
}

/** What a search of the readable sources found, term by term. A term with no hits is shown, not dropped. */
function SearchResults({ ds, results }: { ds: DatasetView; results: SafeSearchResult[] }) {
  const rows = results.map((r, i) => (
    <tr key={`${r.term}-${i}`}>
      <td className="small">{r.term}</td>
      <td className="small">
        {r.hits.length ? (
          r.hits.map((h, j) => (
            <span key={`${h.source_id}-${j}`}>
              {j ? ", " : ""}
              {ds.source(h.source_id) ? (
                <Link href={refHref(h.source_id)} title={ds.source(h.source_id)?.data.title ?? h.source_id}>
                  {h.source_id}
                </Link>
              ) : (
                <KnownLink ds={ds} type="source" id={h.source_id} />
              )}{" "}
              <span className="muted">×{h.count}</span>
            </span>
          ))
        ) : (
          <span className="muted">No hits</span>
        )}
      </td>
    </tr>
  ));
  return (
    <Fold
      items={rows}
      limit={10}
      noun="search terms"
      wrap={(children) => (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Term searched</th>
                <th>Sources where it was found (times)</th>
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      )}
    />
  );
}

/**
 * "Checked by HQ's build" (H6e): a tick only for a check whose result HQ can read, on a record that passes
 * validation. A result that is not valid shows the not-valid chip; a check on a record HQ cannot read in
 * full is shown as not counted.
 */
function HqChecks({ checks, readable }: { checks: { check: string; result: string }[]; readable: boolean }) {
  return (
    <ul className="plain small">
      {checks.map((c, i) => (
        <li key={i}>
          {c.result === NOT_VALID ? (
            <NotValidChip value={c.result} />
          ) : readable ? (
            <Chip tone="ok" glyph="✓">
              Checked
            </Chip>
          ) : (
            <Chip tone="ghost" title="This record cannot be read in full, so HQ counts none of its checks">
              Not counted
            </Chip>
          )}{" "}
          {c.check}: <span className="break">{c.result}</span>
        </li>
      ))}
    </ul>
  );
}

/** The heading over a build's statement: a source's words only when a source label says so (ROUND4 H1). */
function statementHeading(statement: unknown): string {
  const label = isObject(statement) ? statement.epistemic : undefined;
  if (label === "submitter_claim") return "What the submitter says";
  return typeof label === "string" && ["reported", "design_intention", "source_recommendation", "founder_statement"].includes(label) ? "What the source says" : "Statement";
}

function Summary({ ds, envelope, rev }: { ds: DatasetView; envelope: Envelope<AnyRecord>; rev: number | null }) {
  const readable = isReadable(envelope);
  // L8: the lists conforming emptied on a record that fails validation; shown as not readable, never as nothing.
  const emptied = new Set(unreadableFields(ds, envelope));
  const gone = (field: string) => emptied.has(field);
  const type = envelope.meta.type;
  if (type === "source") {
    const s = envelope.data as SourceRecord;
    return (
      <Card title="Source">
        <dl className="facts">
          <dt>Location</dt>
          <dd className="break">
            {s.location ? (
              s.location.startsWith("http") ? (
                <a href={s.location} rel="noreferrer noopener" target="_blank">
                  {s.location}
                </a>
              ) : (
                s.location
              )
            ) : (
              <span className="muted">No location on record</span>
            )}
          </dd>
          <dt>Access</dt>
          <dd>
            <StatusChip value={s.access} field="source.access" />
          </dd>
          <dt>Authority (HQ classification)</dt>
          <dd>
            <ListedChip field="source.authority" value={s.authority} />
            {s.authority_note ? (
              <div className="small" style={{ marginTop: 4 }}>
                {s.authority_note}
              </div>
            ) : null}
          </dd>
          <dt>Document date</dt>
          <dd>{isoDate(s.doc_date ?? s.updated)}</dd>
          <dt>Version</dt>
          <dd className="mono small">{s.version ?? "—"}</dd>
          <dt>SHA-256</dt>
          <dd className="mono small break">{s.sha256 ?? "—"}</dd>
          <dt>Size</dt>
          <dd>{s.bytes != null ? `${s.bytes.toLocaleString("en-AU")} bytes` : "—"}</dd>
          <dt>Retrieved</dt>
          <dd>{isoDateTime(s.retrieved_at)}</dd>
          <dt>Prepared by (per the document)</dt>
          <dd>{s.prepared_by ?? "—"}</dd>
          <dt>Scope (the document's own words)</dt>
          <dd>{s.product_scope || "—"}</dd>
          <dt>Commission codes</dt>
          <dd>{s.commission_codes.length ? s.commission_codes.join(" · ") : gone("commission_codes") ? <UnreadableOr unreadable empty="" /> : "—"}</dd>
          <dt>Summary</dt>
          <dd>{s.summary || <span className="muted">—</span>}</dd>
          {strings(s.other_names).length ? (
            <>
              <dt>Also named as</dt>
              <dd className="break">{strings(s.other_names).join(" · ")}</dd>
            </>
          ) : null}
          {str(s.importance) ? (
            <>
              <dt>Importance (HQ classification)</dt>
              <dd>{humanise(s.importance)}</dd>
            </>
          ) : null}
          {str(s.identifiers) ? (
            <>
              <dt>Identifiers given where it is named</dt>
              <dd className="small break">{str(s.identifiers)}</dd>
            </>
          ) : null}
          {str(s.doc_kind) ? (
            <>
              <dt>Kind of document</dt>
              <dd>{humanise(s.doc_kind)}</dd>
            </>
          ) : null}
          {str(s.content_kind) ? (
            <>
              <dt>Kind of content</dt>
              <dd>{humanise(s.content_kind)}</dd>
            </>
          ) : null}
          {Array.isArray(s.parts) && s.parts.length ? (
            <>
              <dt>Parts</dt>
              <dd>
                <div className="small">
                  <Fold
                    items={s.parts.filter(isObject).map((p) => (
                      <li key={p.name} className="break">
                        {p.name} <span className="mono xsmall muted">{shortHash(p.sha256, 16)}</span>
                      </li>
                    ))}
                    limit={8}
                    noun="parts"
                    wrap={plainList}
                  />
                </div>
              </dd>
            </>
          ) : null}
          {hqChecks(s.hq_checks).length ? (
            <>
              <dt>Checked by HQ&apos;s build</dt>
              <dd>
                <HqChecks checks={hqChecks(s.hq_checks)} readable={readable} />
              </dd>
            </>
          ) : null}
          {gone("named_in") ? (
            <>
              <dt>Named in</dt>
              <dd>
                <UnreadableOr unreadable empty="" />
              </dd>
            </>
          ) : null}
          {s.named_in.length ? (
            <>
              <dt>Named in</dt>
              <dd>
                <Citations
                  ds={ds}
                  citations={s.named_in}
                  label={`${s.named_in.length} place${s.named_in.length === 1 ? "" : "s"} where this document is named`}
                />
              </dd>
            </>
          ) : null}
        </dl>
      </Card>
    );
  }
  if (type === "decision") {
    const d = envelope.data as DecisionRecord;
    return (
      <Card title="Decision">
        <div className="stack-sm">
          {d.recorded_in === "hq" ? (
            <Notice tone="ok">
              Recorded in HQ by {d.decided_by ?? "the founder"} on {isoDateTime(d.decided_at)} through the founder decision function.
            </Notice>
          ) : (
            <Notice tone="info">
              This is the decision as a source document reports it. HQ did not witness it and has not recorded a founder decision confirming it.
            </Notice>
          )}
          {d.exact_text ? <blockquote className="exact">{d.exact_text}</blockquote> : null}
          <dl className="facts">
            <dt>Status</dt>
            <dd>
              <StatusChip value={d.status} field="decision.status" />
            </dd>
            <dt>Code in the source</dt>
            <dd className="mono small">{d.code ?? "—"}</dd>
            <dt>Date</dt>
            <dd>{isoDate(d.date)}</dd>
            <dt>What it says</dt>
            <dd>
              <ClaimView ds={ds} claim={d.statement} />
            </dd>
            {d.rationale ? (
              <>
                <dt>Rationale</dt>
                <dd>{d.rationale}</dd>
              </>
            ) : null}
            <dt>Modules</dt>
            <dd>
              <RefList ds={ds} ids={d.module_ids} unreadable={gone("module_ids")} />
            </dd>
            <dt>Requirements</dt>
            <dd>
              <RefList ds={ds} ids={d.requirement_ids} unreadable={gone("requirement_ids")} />
            </dd>
            {d.resolves.length || gone("resolves") ? (
              <>
                <dt>Resolves</dt>
                <dd>
                  <RefList ds={ds} ids={d.resolves} unreadable={gone("resolves")} />
                </dd>
              </>
            ) : null}
            {d.effects.length || gone("effects") ? (
              <>
                <dt>Effects applied</dt>
                <dd>{d.effects.length ? <pre className="json">{JSON.stringify(d.effects, null, 2)}</pre> : <UnreadableOr unreadable empty="" />}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </Card>
    );
  }
  if (type === "commission") {
    const c = envelope.data as CommissionRecord;
    return (
      <Card title="Commission">
        <dl className="facts">
          <dt>Code</dt>
          <dd className="mono small">{c.code}</dd>
          <dt>Status</dt>
          <dd>
            <StatusChip value={c.status} field="commission.status" />
          </dd>
          <dt>Date</dt>
          <dd>{isoDate(c.date)}</dd>
          <dt>Scope</dt>
          <dd>
            <ClaimView ds={ds} claim={c.scope} />
          </dd>
          <dt>Modules</dt>
          <dd>
            <RefList ds={ds} ids={c.module_ids} unreadable={gone("module_ids")} />
          </dd>
          <dt>Outputs HQ holds</dt>
          <dd>
            <RefList ds={ds} ids={c.output_source_ids} empty="No output document is held." unreadable={gone("output_source_ids")} />
          </dd>
        </dl>
      </Card>
    );
  }
  if (type === "build") {
    const b = envelope.data as BuildRecord;
    return (
      <Card title="Build">
        <dl className="facts">
          <dt>Standing</dt>
          <dd>
            <BuildStandingChip build={b} />
          </dd>
          <dt>Module</dt>
          <dd>{b.module_id ? <RecordLink ds={ds} id={b.module_id} /> : <span className="muted">—</span>}</dd>
          <dt>File name</dt>
          <dd className="mono small break">{b.filename ?? "—"}</dd>
          <dt>SHA-256 (as written in the source)</dt>
          <dd className="mono small break">{b.sha256 ?? "No hash on record"}</dd>
          <dt>Size</dt>
          <dd>{b.bytes ?? "—"}</dd>
          <dt>{statementHeading(b.statement)}</dt>
          <dd>
            <ClaimView ds={ds} claim={b.statement} />
          </dd>
          {(() => {
            const ref = codeRef(b.code_ref);
            return ref ? (
              <>
                <dt>Code revision</dt>
                <dd className="mono small break">
                  {ref.repository} @ {ref.ref ?? "—"} · {ref.commit ? `commit ${ref.commit}` : "no commit on record"}
                </dd>
              </>
            ) : null;
          })()}
          {strings(b.possibly_same_as).length || gone("possibly_same_as") ? (
            <>
              <dt>May be the same build as</dt>
              <dd>
                <RefList ds={ds} ids={strings(b.possibly_same_as)} noun="builds" unreadable={gone("possibly_same_as")} />
              </dd>
            </>
          ) : null}
          {b.artifact_source_id ? (
            <>
              <dt>The build itself</dt>
              <dd>
                HQ holds a snapshot of this build as <RecordLink ds={ds} id={b.artifact_source_id} />
              </dd>
            </>
          ) : null}
          {hqChecks(b.hq_checks).length ? (
            <>
              <dt>Checked by HQ&apos;s build</dt>
              <dd>
                <HqChecks checks={hqChecks(b.hq_checks)} readable={readable} />
              </dd>
            </>
          ) : null}
        </dl>
      </Card>
    );
  }
  if (type === "evidence") {
    const e = envelope.data as EvidenceRecord;
    const counts = isObject(loose(e).counts) ? (loose(e).counts as Record<string, unknown>) : null;
    const ref = codeRef(loose(e).code_ref);
    const results = searchResults(e.search_results);
    return (
      <Card title="Evidence">
        <div className="stack-sm">
          {e.verification === "agent_submitted_unverified" || e.verification === "submitted_unverified" ? (
            <Notice tone="warn">
              Submitted through the proposal inbox by {e.submitted_by ?? "a client"} and filed by the founder. It has not been independently verified:
              a statement that something passed is a claim, not evidence of completion, and it is not founder acceptance.
            </Notice>
          ) : null}
          <dl className="facts">
            <dt>Type</dt>
            <dd>
              <ListedText field="evidence.type" value={e.type} />
            </dd>
            <dt>Verification</dt>
            <dd>
              <StatusChip value={e.verification} field="evidence.verification" />
            </dd>
            <dt>Result</dt>
            <dd>
              <ClaimView ds={ds} claim={e.result} />
            </dd>
            {counts ? (
              <>
                <dt>Counts as submitted</dt>
                <dd>
                  {String(counts.passed ?? "—")} passed · {String(counts.failed ?? "—")} failed · {String(counts.skipped ?? "—")} skipped
                </dd>
              </>
            ) : null}
            {ref ? (
              <>
                <dt>Code revision</dt>
                <dd className="mono small break">
                  {ref.repository} @ {ref.ref ?? "—"}
                  {ref.path ? ` · ${ref.path}` : ""}
                </dd>
              </>
            ) : null}
            {results.length ? (
              <>
                <dt>Search results</dt>
                <dd>
                  <SearchResults ds={ds} results={results} />
                </dd>
              </>
            ) : null}
            <dt>Date</dt>
            <dd>{isoDate(e.date)}</dd>
            <dt>Artefact SHA-256</dt>
            <dd className="mono small break">{e.sha256 ?? "—"}</dd>
            <dt>Build</dt>
            <dd>{e.build_id ? <RecordLink ds={ds} id={e.build_id} /> : <span className="muted">—</span>}</dd>
            <dt>Modules</dt>
            <dd>
              <RefList ds={ds} ids={e.module_ids} unreadable={gone("module_ids")} />
            </dd>
          </dl>
        </div>
      </Card>
    );
  }
  if (type === "defect") {
    const d = envelope.data as DefectRecord;
    return (
      <Card title="Defect">
        <dl className="facts">
          <dt>Status</dt>
          <dd>
            <StatusChip value={d.status} field="defect.status" />
          </dd>
          <dt>Severity</dt>
          <dd>
            <ListedText field="defect.severity" value={d.severity ?? "unknown"} />
          </dd>
          <dt>Description</dt>
          <dd>
            <ClaimView ds={ds} claim={d.statement} />
          </dd>
          <dt>Modules</dt>
          <dd>
            <RefList ds={ds} ids={d.module_ids} unreadable={gone("module_ids")} />
          </dd>
          <dt>Build</dt>
          <dd>{d.build_id ? <RecordLink ds={ds} id={d.build_id} /> : <span className="muted">—</span>}</dd>
        </dl>
      </Card>
    );
  }
  if (type === "open_item") {
    const o = envelope.data as OpenItemRecord;
    return (
      <Card title="Open item">
        <dl className="facts">
          <dt>Kind</dt>
          <dd>
            <ListedChip field="open_item.kind" value={o.kind} tone="warn" />
          </dd>
          <dt>Statement</dt>
          <dd>
            <ClaimView ds={ds} claim={o.statement} />
          </dd>
          <dt>Modules</dt>
          <dd>
            <RefList ds={ds} ids={o.module_ids} unreadable={gone("module_ids")} />
          </dd>
          <dt>Decision</dt>
          <dd>{o.decision_id ? <RecordLink ds={ds} id={o.decision_id} /> : <span className="muted">—</span>}</dd>
        </dl>
      </Card>
    );
  }
  if (type === "recommendation") {
    const r = envelope.data as RecommendationRecord;
    return (
      <Card title="Recommendation">
        <div className="stack-sm">
          <Notice tone="info">
            {recommendationMaker(r.made_by)}{" "}
            It is not approved work. Approval is a founder decision.
          </Notice>
          <dl className="facts">
            <dt>Rank</dt>
            <dd>{r.rank}</dd>
            <dt>Why</dt>
            <dd>{r.rationale}</dd>
            <dt>Modules</dt>
            <dd>
              <RefList ds={ds} ids={r.module_ids} unreadable={gone("module_ids")} />
            </dd>
            <dt>Requires first</dt>
            <dd>
              <RefList ds={ds} ids={r.prerequisite_ids} empty="No prerequisite." unreadable={gone("prerequisite_ids")} />
            </dd>
            <dt>Blocked by</dt>
            <dd>
              <RefList ds={ds} ids={r.blocked_by} empty="Nothing recorded as blocking." unreadable={gone("blocked_by")} />
            </dd>
          </dl>
        </div>
      </Card>
    );
  }
  if (type === "pathway") {
    const p = envelope.data as PathwayRecord;
    return (
      <Card title="Cross-module pathway">
        <div className="stack-sm">
          <div className="row" style={{ gap: 8 }}>
            <PathwayBasisChip value={p.basis} />
          </div>
          {p.description ? <p>{p.description}</p> : null}
          <ol className="steps">
            {[...p.steps]
              .sort((a, b) => a.order - b.order)
              .map((step, i) => (
                <li key={i}>
                  <div className="stack-sm" style={{ gap: 4 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <KnownLink ds={ds} type="module" id={step.module_id} rev={rev}>
                        <strong>{ds.moduleName(step.module_id)}</strong>
                      </KnownLink>
                      {step.shared_stage !== "none" ? <Chip tone="accent">{STAGE_LABEL[step.shared_stage]}</Chip> : null}
                    </div>
                    <div className="small">{step.role}</div>
                    <Citations ds={ds} citations={step.citations} by={p.basis} />
                  </div>
                </li>
              ))}
          </ol>
        </div>
      </Card>
    );
  }
  // module, loop, requirement: their own pages carry the detail; this page is their history and lineage.
  return (
    <Card title={RECORD_TYPE_LABEL[type]}>
      <p>
        The full record is on its own page: <Link href={withRev(recordHref(type, envelope.meta.id), rev)}>{recordTitle(type, envelope.data)}</Link>.
        This page shows where it came from and how it has changed.
      </p>
    </Card>
  );
}

export default async function RecordPage({ params, searchParams }: { params: Promise<{ type: string; id: string }>; searchParams: SearchParams }) {
  const { type, id: rawId } = await params;
  if (!isRecordType(type)) notFound();
  const id = routeId(rawId);
  const { principal, ctx, stored, rev } = await loadPage(searchParams);
  const { ds } = ctx;
  const envelope = ds.get(type, id) as Envelope<AnyRecord> | undefined;
  if (!envelope) notFound();
  const lin = lineage(ds, type, id)!;
  const deps = dependencies(ds, type, id)!;
  const acceptance = acceptanceStatus(ds, type, id);
  const history = await recordHistory(principal, type, id, ds.revision.rev);
  const list = LIST_PAGE[type];
  const canPropose = type !== "decision";
  const lockedByAcceptance = bindingAcceptance(envelope.data) !== null;
  const invalid = ctx.warnings.some((w) => w.type === type && w.id === id);

  return (
    <div className="stack">
      <PageHead
        title={recordTitle(type, envelope.data)}
        id={id}
        crumbs={[{ label: list.label, href: list.href }, { label: RECORD_TYPE_LABEL[type] }]}
        chips={envelope.meta.origin === "proposal_acceptance" ? <InboxOriginChip envelope={envelope} /> : undefined}
        actions={
          canPropose && !lockedByAcceptance ? (
            <Link className="btn" href={`/proposals/new?type=${type}&id=${encodeURIComponent(id)}`}>
              Propose a change
            </Link>
          ) : null
        }
      />
      {canPropose ? <AcceptanceLock data={envelope.data} /> : null}
      {canPropose && !lockedByAcceptance && isReportedAcceptance(type, envelope.data) ? <ReportedAcceptanceNotice /> : null}
      {invalid ? <InvalidRecordNotice unreadableFields={unreadableFields(ds, envelope)} /> : null}

      <div className="split">
        <div className="stack">
          <Summary ds={ds} envelope={envelope} rev={rev} />
          {type === "decision" || type === "build" ? <OtherMentions ds={ds} data={envelope.data} /> : null}

          <Card title="Source lineage" hint="Exactly which documents this record rests on" flush>
            {lin.sources.length === 0 ? (
              <Empty>
                {envelope.meta.origin === "seed_import"
                  ? "This record cites no source document."
                  : envelope.meta.origin === "proposal_acceptance"
                    ? "This record cites no source document. It came in through the proposal inbox: what it says is the submitter's account, filed by the founder. Its version history below shows the proposal."
                    : "This record was created inside HQ by a founder decision; its provenance is the version history below."}
              </Empty>
            ) : (
              <Fold
                items={lin.sources.map((s) => (
                  <li key={s.id}>
                    <div className="row" style={{ gap: 8 }}>
                      {ds.source(s.id) ? (
                        <>
                          <Link className="li-title" href={withRev(recordHref("source", s.id), rev)}>
                            {s.title}
                          </Link>
                          <IdTag id={s.id} />
                        </>
                      ) : (
                        <KnownLink ds={ds} type="source" id={s.id} />
                      )}
                      <StatusChip value={s.access} />
                    </div>
                    <div className="li-note mono xsmall break">
                      {isoDate(s.date)} · version {s.version ?? "—"} · sha256 {s.sha256 ?? "—"}
                    </div>
                    {s.citations.length ? (
                      <details className="cites">
                        <summary>
                          {s.citations.length} quotation
                          {s.citations.length === 1 ? "" : "s"} used
                        </summary>
                        {s.citations.map((c, i) => (
                          <div className="cite" key={i}>
                            <q>{c.quote}</q>
                            {typeof c.locator === "string" && c.locator ? <span className="src">{c.locator}</span> : null}
                          </div>
                        ))}
                      </details>
                    ) : null}
                  </li>
                ))}
                limit={6}
                noun="sources"
                wrap={listWrap}
              />
            )}
          </Card>

          <Card title="Version history" hint="Append-only and hash-chained; nothing is edited or deleted" flush>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Dataset revision</th>
                    <th>How it changed</th>
                    <th>By</th>
                    <th>When</th>
                    <th>Content hash</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().map((h) => (
                    <tr key={h.version}>
                      <td>
                        v{h.version}
                        {h.version === envelope.meta.version ? <span className="muted xsmall"> (shown)</span> : null}
                        {h.deleted ? <Chip tone="ghost">retired</Chip> : null}
                      </td>
                      <td>
                        <Link href={`${recordHref(type, id)}?rev=${h.rev}`}>rev {h.rev}</Link>
                      </td>
                      <td className="small">
                        {statusLabel(h.origin)}
                        {h.proposal_id ? (
                          <>
                            {" "}
                            via <Link href={refHref(h.proposal_id)}>{h.proposal_id}</Link>
                          </>
                        ) : null}
                        <div className="muted xsmall">{h.revision_summary}</div>
                      </td>
                      <td className="small">{h.created_by}</td>
                      <td className="small nowrap">{isoDateTime(h.created_at)}</td>
                      <td className="mono xsmall" title={h.content_hash}>
                        {shortHash(h.content_hash, 14)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="stack">
          {acceptance ? (
            <Card title="Acceptance status">
              <div className="stack-sm">
                <Chip
                  tone={
                    acceptance.recorded_in_hq?.state === "accepted"
                      ? "ok"
                      : acceptance.recorded_in_hq?.state === "rejected"
                        ? "bad"
                        : acceptance.headline === "not_reliable"
                          ? "bad"
                          : acceptance.headline === "build_acceptance_claimed"
                            ? "warn"
                            : "outline"
                  }
                >
                  {acceptance.label}
                </Chip>
                {acceptance.recorded_in_hq ? (
                  <p className="small">
                    Recorded in HQ: <strong>{acceptance.recorded_in_hq.state}</strong> by {acceptance.recorded_in_hq.decided_by}, decision{" "}
                    <RecordLink ds={ds} id={acceptance.recorded_in_hq.decision_id} />
                    {acceptance.recorded_in_hq.scope_note ? ` — ${acceptance.recorded_in_hq.scope_note}` : ""}
                  </p>
                ) : acceptance.headline === "not_reliable" ? null : (
                  <p className="small muted">No founder acceptance has been recorded in HQ for this record.</p>
                )}
                {acceptance.caution ? <p className="small">{acceptance.caution}</p> : null}
              </div>
            </Card>
          ) : null}

          <Card
            title="Depends on"
            hint={
              deps.depends_on.length + deps.blockers.length
                ? `${deps.blockers.length ? `${plural(deps.blockers.length, "blocker")}, ` : ""}${plural(deps.depends_on.length, "dependency", "dependencies")}`
                : undefined
            }
            flush
          >
            {deps.depends_on.length + deps.blockers.length === 0 ? (
              Object.keys(deps.unreadable_fields ?? {}).some((f) => DEPENDENCY_FIELDS.includes(f)) ? (
                <Empty>
                  <span data-testid="unreadable-list">{UNREADABLE_LIST}</span>
                </Empty>
              ) : (
                <Empty>No dependency or blocker is recorded.</Empty>
              )
            ) : (
              <Fold
                items={[
                  ...deps.blockers.map((b, i) => (
                    <li key={`b-${i}`}>
                      <div className="row" style={{ gap: 8 }}>
                        <Chip tone="warn">Blocker</Chip>
                        {b.ref ? <RecordLink ds={ds} id={b.ref.id} /> : null}
                      </div>
                      <div className="li-note">{b.text}</div>
                    </li>
                  )),
                  ...deps.depends_on.map((d, i) => (
                    <li key={`d-${i}`}>
                      <RecordLink ds={ds} id={d.ref.id} />
                      <div className="li-note">{d.relation}</div>
                    </li>
                  )),
                ]}
                limit={6}
                noun="dependencies and blockers"
                wrap={listWrap}
              />
            )}
          </Card>

          <Card title="Referred to by" hint={plural(lin.downstream.length, "record")} flush>
            {lin.downstream.length === 0 ? (
              <Empty>No other record refers to this one.</Empty>
            ) : (
              <div className="refgroups">
                {groupByType(lin.downstream).map(([label, refs]) => (
                  <section key={label} className="refgroup">
                    <h3>
                      {pluralLabel(label)} <span className="muted small">{refs.length}</span>
                    </h3>
                    <Fold
                      items={refs.map((r) => (
                        <li key={r.id}>
                          <Link className="li-title" href={withRev(recordHref(r.type, r.id), rev)}>
                            {r.title}
                          </Link>{" "}
                          <IdTag id={r.id} />
                        </li>
                      ))}
                      limit={lin.downstream.length > 12 ? 4 : 12}
                      noun={pluralLabel(label).toLowerCase()}
                      wrap={plainList}
                    />
                  </section>
                ))}
              </div>
            )}
          </Card>

          <Card title="Record as stored">
            <details className="cites">
              <summary>
                Version {envelope.meta.version} · introduced at dataset revision {envelope.meta.rev} · {statusLabel(envelope.meta.origin)}
              </summary>
              <pre className="json" style={{ marginTop: 8 }}>
                {JSON.stringify(stored.get(type, id)?.data ?? envelope.data, null, 2)}
              </pre>
            </details>
          </Card>
        </div>
      </div>
    </div>
  );
}
