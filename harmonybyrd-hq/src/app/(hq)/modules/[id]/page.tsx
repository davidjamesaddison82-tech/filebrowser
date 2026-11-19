import Link from "@/components/pin-link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { LifecycleDetail } from "@/components/lifecycle";
import {
  AcceptanceLock,
  bindingAcceptance,
  BuildStandingChip,
  Card,
  Chip,
  Citations,
  ClaimView,
  Empty,
  EpistemicChip,
  Fold,
  IdTag,
  InboxMark,
  InboxOriginChip,
  Notice,
  PageHead,
  RecordLink,
  StatusChip,
} from "@/components/ui";
import { moduleBrief } from "@/lib/domain/derive";
import type { Claim, ModuleRecord } from "@/lib/domain/schemas";

type Capability = ModuleRecord["capabilities"][number];
import { loadPage, routeId, type SearchParams } from "@/lib/server/page";
import { humanise, isoDate, plural, shortHash } from "@/lib/ui/format";
import { recordHref, withRev } from "@/lib/ui/links";

/** Sort by a fixed order of values; anything not listed goes last, keeping its original order. */
function byOrder<T>(items: T[], key: (item: T) => string, order: string[]): T[] {
  const rank = (v: string) => {
    const i = order.indexOf(v);
    return i === -1 ? order.length : i;
  };
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(key(a.item)) - rank(key(b.item)) || a.i - b.i)
    .map((x) => x.item);
}

const list = (children: ReactNode[]) => <ul className="list">{children}</ul>;
const plainList = (children: ReactNode[]) => <ul className="plain">{children}</ul>;
const claims = (children: ReactNode[]) => <div className="stack-sm">{children}</div>;

function ClaimFold({
  ds,
  items,
  noun,
  empty,
  limit = 5,
}: {
  ds: Parameters<typeof ClaimView>[0]["ds"];
  items: Claim[];
  noun: string;
  empty: string;
  limit?: number;
}) {
  if (items.length === 0) return <p className="muted small">{empty}</p>;
  return (
    <Fold
      items={items.map((c, i) => (
        <ClaimView key={i} ds={ds} claim={c} />
      ))}
      limit={limit}
      noun={noun}
      wrap={claims}
    />
  );
}

function CapabilityItem({ ds, c }: { ds: Parameters<typeof ClaimView>[0]["ds"]; c: Capability }) {
  return (
    <li>
      <div className="row" style={{ gap: 8 }}>
        <span className="li-title">{c.title}</span>
        {c.state === "partial" ? <Chip tone="warn">Partly</Chip> : null}
        {c.state === "intended_absent" ? <Chip tone="design">Not built</Chip> : null}
        {c.state === "unknown" ? <Chip tone="ghost">State unknown</Chip> : null}
        <EpistemicChip value={c.epistemic} />
      </div>
      {c.detail ? <div className="li-note">{c.detail}</div> : null}
      <Citations ds={ds} citations={c.citations} />
    </li>
  );
}

export default async function ModulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { ctx, rev } = await loadPage(searchParams);
  const { ds } = ctx;
  const brief = moduleBrief(ds, routeId(id));
  if (!brief) notFound();
  const m = brief.module.data;
  const commissionEntry =
    typeof (m as Record<string, unknown>).commission_entry === "string" ? ((m as Record<string, unknown>).commission_entry as string) : null;
  // Existing (fully, then partly) apart from intended-but-absent (absent, then state unknown).
  const existing = byOrder(
    m.capabilities.filter((c) => c.state === "existing" || c.state === "partial"),
    (c) => c.state,
    ["existing", "partial"],
  );
  const absent = byOrder(
    m.capabilities.filter((c) => c.state === "intended_absent" || c.state === "unknown"),
    (c) => c.state,
    ["intended_absent", "unknown"],
  );
  const defects = byOrder(brief.defects, (d) => d.status, ["open", "unknown", "deferred", "resolved"]);
  const openDefects = brief.defects.filter((d) => d.status === "open");
  const builds = byOrder(brief.builds, (b) => b.standing, ["accepted_reported", "candidate_not_accepted", "development", "unknown"]);
  const openItems = byOrder(brief.open_items, (o) => o.kind, [
    "blocker",
    "not_authorised",
    "unresolved_dependency",
    "pending_founder_decision",
    "missing_evidence",
    "unverified_claim",
    "risk",
    "source_gap",
  ]);
  const requirements = [...brief.requirements].sort((a, b) => Number(b.outstanding) - Number(a.outstanding));
  const decisions = byOrder(brief.decisions, (d) => d.status, ["pending", "held", "unissued", "unknown", "issued"]);
  const evidence = byOrder(brief.evidence, (e) => e.verification, ["hq_verified"]);
  const sources = [...brief.sources].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
  const connectionCount = brief.connections_out.length + brief.connections_in.length + brief.children.length;

  const index: [string, string, number | null][] = [
    ["purpose", "Purpose", null],
    ["loops", "Loops", brief.loops.length],
    ["capabilities", "Capabilities", m.capabilities.length],
    ["lifecycle", "Tests & acceptance", null],
    ["builds", "Builds", brief.builds.length],
    ["defects", "Defects", brief.defects.length],
    ["blockers", "Blockers", m.blockers.length + brief.open_items.length],
    ["connections", "Connections", connectionCount],
    ["requirements", "Requirements", brief.requirements.length],
    ["decisions", "Decisions", brief.decisions.length + brief.commissions.length],
    ["evidence", "Evidence", brief.evidence.length],
    ["sources", "Sources", brief.sources.length],
  ];

  const connectionItems: ReactNode[] = [
    ...brief.children.map((c) => (
      <li key={`child-${c.id}`}>
        <span>
          <Link className="li-title" href={withRev(recordHref("module", c.id), rev)}>
            {c.title}
          </Link>{" "}
          <span className="muted small">is part of this module</span>
        </span>
      </li>
    )),
    ...brief.connections_out.map((c, i) => (
      <li key={`out-${i}`}>
        <span>
          <span className="muted small">This module →</span>{" "}
          <Link className="li-title" href={withRev(recordHref("module", c.ref.id), rev)}>
            {c.ref.title}
          </Link>
        </span>
        <div className="li-note">{c.nature}</div>
        <div>
          <EpistemicChip value={c.basis as never} />
        </div>
      </li>
    )),
    ...brief.connections_in.map((c, i) => (
      <li key={`in-${i}`}>
        <span>
          <Link className="li-title" href={withRev(recordHref("module", c.ref.id), rev)}>
            {c.ref.title}
          </Link>{" "}
          <span className="muted small">→ this module</span>
        </span>
        <div className="li-note">{c.nature}</div>
        <div>
          <EpistemicChip value={c.basis as never} />
        </div>
      </li>
    )),
  ];

  return (
    <div className="stack">
      <PageHead
        title={m.name}
        id={m.id}
        crumbs={[{ label: "Module atlas", href: "/modules" }, { label: m.family }]}
        chips={
          <>
            <Chip
              tone={
                brief.standing.headline === "accepted_in_hq"
                  ? "ok"
                  : brief.standing.headline === "rejected_in_hq"
                    ? "bad"
                    : brief.standing.headline === "acceptance_reported"
                      ? "founder"
                      : "info"
              }
            >
              {brief.standing.label}
            </Chip>
            <InboxOriginChip envelope={brief.module} />
            <Chip tone="outline">{humanise(m.kind)}</Chip>
            {m.evidence_level !== "documented_in_sources" ? <Chip tone="ghost">No supporting source</Chip> : null}
            {m.commission_listed ? <Chip tone="outline">Listed in commission HB-HQ-P02-R1</Chip> : null}
          </>
        }
        lede={m.summary || undefined}
        actions={
          <>
            {bindingAcceptance(m) ? null : (
              <Link className="btn" href={`/proposals/new?type=module&id=${encodeURIComponent(m.id)}`}>
                Propose a change
              </Link>
            )}
            <Link className="btn" href={withRev(`/records/module/${m.id}`, rev)}>
              History & lineage
            </Link>
          </>
        }
      />

      <nav className="toc" aria-label="On this page">
        <span className="muted small">On this page:</span>
        {index.map(([anchor, label, n]) => (
          <a key={anchor} href={`#${anchor}`}>
            {label}
            {n != null ? <span className="toc-n">{n}</span> : null}
          </a>
        ))}
      </nav>

      <AcceptanceLock data={m} />
      {brief.standing.caution ? <Notice tone="warn">{brief.standing.caution}</Notice> : null}
      {m.evidence_level === "commission_list_only" ? (
        <Notice tone="warn">
          This module is named in the illustrative list of commission HB-HQ-P02-R1. No source HQ could read describes it, so every field below is
          empty rather than guessed. It is listed so that it is not forgotten.
        </Notice>
      ) : null}
      {m.aliases.length || brief.parent || commissionEntry ? (
        <div className="small muted stack-sm" style={{ gap: 2 }}>
          {m.aliases.length || brief.parent ? (
            <p style={{ margin: 0 }}>
              {m.aliases.length ? <>Also called: {m.aliases.join(" · ")}</> : null}
              {m.aliases.length && brief.parent ? " · " : null}
              {brief.parent ? (
                <>
                  Part of <RecordLink ds={ds} id={brief.parent.id} showId={false} />
                </>
              ) : null}
            </p>
          ) : null}
          {commissionEntry ? (
            <p style={{ margin: 0 }}>
              The commission&apos;s module list names it as: <q>{commissionEntry}</q>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="split">
        <div className="stack">
          <Card title="Purpose" id="purpose">
            <dl className="facts">
              <dt>Original objective</dt>
              <dd>
                <ClaimView ds={ds} claim={m.objective} />
              </dd>
              <dt>Intended user</dt>
              <dd>
                <ClaimView ds={ds} claim={m.intended_user} />
              </dd>
              <dt>Why it exists</dt>
              <dd>
                <ClaimView ds={ds} claim={m.why_exists} />
              </dd>
              <dt>What the learner should eventually be able to do</dt>
              <dd>
                <ClaimView ds={ds} claim={m.learner_outcome} />
              </dd>
            </dl>
          </Card>

          <Card title="Core learning loop" id="loops" hint={brief.loops.length ? `${plural(brief.loops.length, "loop")} recovered` : undefined}>
            <div className="stack-sm">
              {m.core_loop ? (
                <ClaimView ds={ds} claim={m.core_loop} />
              ) : brief.loops.length ? (
                <p className="small muted" style={{ margin: 0 }}>
                  No source sums up this module&apos;s core loop in one statement.{" "}
                  {brief.loops.length === 1 ? "One loop was" : `${brief.loops.length} loops were`} recovered from the sources:
                </p>
              ) : (
                <p className="small muted" style={{ margin: 0 }}>
                  No source describes this module&apos;s learning loop, and no loop was recovered for it.
                </p>
              )}
              {brief.loops.length ? (
                <Fold
                  items={brief.loops.map((l) => (
                    <li key={l.id}>
                      <Link href={withRev(recordHref("loop", l.id), rev)}>{l.title}</Link> <IdTag id={l.id} />
                    </li>
                  ))}
                  limit={6}
                  noun="loops"
                  wrap={plainList}
                />
              ) : null}
              {brief.pathways.length ? (
                <div className="small">
                  <div className="muted">Appears in {plural(brief.pathways.length, "cross-module pathway")}:</div>
                  <Fold
                    items={brief.pathways.map((p) => (
                      <li key={p.id}>
                        <Link href={withRev(recordHref("pathway", p.id), rev)}>{p.title}</Link>
                      </li>
                    ))}
                    limit={3}
                    noun="pathways"
                    wrap={plainList}
                  />
                </div>
              ) : null}
            </div>
          </Card>

          <div id="capabilities" className="stack">
            <Card
              title="Existing capabilities"
              hint={`${existing.length} recorded${existing.some((c) => c.state === "partial") ? `, ${existing.filter((c) => c.state === "partial").length} only partly` : ""}`}
              flush
            >
              {existing.length === 0 ? (
                <Empty>No existing capability is recorded in any accessible source.</Empty>
              ) : (
                <Fold
                  items={existing.map((c, i) => (
                    <CapabilityItem key={i} ds={ds} c={c} />
                  ))}
                  limit={8}
                  noun="existing capabilities"
                  wrap={list}
                />
              )}
            </Card>

            <Card
              title="Intended but absent capabilities"
              hint={`${absent.length} recorded${absent.some((c) => c.state === "unknown") ? `, ${absent.filter((c) => c.state === "unknown").length} of unknown state` : ""}`}
              flush
            >
              {absent.length === 0 ? (
                <Empty>No intended-but-absent capability is recorded.</Empty>
              ) : (
                <Fold
                  items={absent.map((c, i) => (
                    <CapabilityItem key={i} ds={ds} c={c} />
                  ))}
                  limit={6}
                  noun="absent capabilities"
                  wrap={list}
                />
              )}
            </Card>
          </div>

          <Card title="UI and user-experience requirements" hint={`${m.ui_requirements.length} recorded`}>
            <ClaimFold
              ds={ds}
              items={m.ui_requirements}
              noun="UI requirements"
              empty="No UI or user-experience requirement is recorded for this module."
            />
          </Card>

          <Card title="Tests, evidence and acceptance" id="lifecycle" hint="Independent dimensions — not a completion percentage" flush>
            <LifecycleDetail ds={ds} module={m} />
          </Card>
        </div>

        <div className="stack">
          <Card title="Executable versions" id="builds" hint={`${brief.builds.length} on record`} flush>
            {builds.length === 0 ? (
              <Empty>No executable version is on record.</Empty>
            ) : (
              <Fold
                items={builds.map((b) => (
                  <li key={b.ref.id}>
                    <Link className="li-title" href={withRev(recordHref("build", b.ref.id), rev)}>
                      {b.ref.title}
                    </Link>
                    <div className="row" style={{ gap: 6 }}>
                      <BuildStandingChip build={ds.get("build", b.ref.id)?.data ?? { standing: b.standing }} />
                      {b.sha256 ? (
                        <span className="mono xsmall muted break">sha256 {shortHash(b.sha256, 16)}</span>
                      ) : (
                        <span className="xsmall muted">no hash on record</span>
                      )}
                    </div>
                  </li>
                ))}
                limit={6}
                noun="builds"
                wrap={list}
              />
            )}
          </Card>

          <Card title="Outstanding defects" id="defects" hint={`${openDefects.length} open of ${brief.defects.length}`} flush>
            {defects.length === 0 ? (
              <Empty>No defect is recorded.</Empty>
            ) : (
              <Fold
                items={defects.map((d) => (
                  <li key={d.ref.id}>
                    <div className="row" style={{ gap: 8 }}>
                      <Link className="li-title" href={withRev(recordHref("defect", d.ref.id), rev)}>
                        {d.ref.title}
                      </Link>
                      <StatusChip value={d.status} />
                      <InboxMark ds={ds} id={d.ref.id} />
                    </div>
                  </li>
                ))}
                limit={6}
                noun="defects"
                wrap={list}
              />
            )}
          </Card>

          <Card title="Blockers and next action" id="blockers">
            <div className="stack-sm">
              <h3>Current blockers</h3>
              <ClaimFold ds={ds} items={m.blockers} noun="blockers" empty="No blocker is recorded on the module itself." />
              {openItems.length ? (
                <>
                  <h3 style={{ marginTop: 6 }}>Open items ({openItems.length})</h3>
                  <Fold
                    items={openItems.map((o) => (
                      <li key={o.ref.id}>
                        <Link href={withRev(recordHref("open_item", o.ref.id), rev)}>{o.ref.title}</Link> <Chip tone="warn">{humanise(o.kind)}</Chip>{" "}
                        <InboxMark ds={ds} id={o.ref.id} />
                      </li>
                    ))}
                    limit={6}
                    noun="open items"
                    wrap={plainList}
                  />
                </>
              ) : null}
              <h3 style={{ marginTop: 6 }}>Proposed next action</h3>
              <ClaimFold ds={ds} items={m.next_actions} noun="next actions" empty="No next action is proposed in the sources." limit={3} />
              {brief.recommendations.length ? (
                <ul className="plain">
                  {brief.recommendations.map((r) => (
                    <li key={r.id}>
                      <Chip tone="accent" glyph="➜">
                        HQ recommendation
                      </Chip>{" "}
                      <Link href={withRev(recordHref("recommendation", r.id), rev)}>{r.title}</Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Card>

          <Card title="Connections to other modules" id="connections" hint={connectionCount ? `${connectionCount} recorded` : undefined} flush>
            {connectionItems.length === 0 ? (
              <Empty>No connection to another module is recorded.</Empty>
            ) : (
              <Fold items={connectionItems} limit={6} noun="connections" wrap={list} />
            )}
          </Card>

          <Card
            title="Founder requirements"
            id="requirements"
            hint={`${brief.requirements.filter((r) => r.outstanding).length} outstanding of ${brief.requirements.length}`}
            flush
          >
            {requirements.length === 0 ? (
              <Empty>No founder requirement is linked to this module.</Empty>
            ) : (
              <Fold
                items={requirements.map((r) => (
                  <li key={r.ref.id}>
                    <Link className="li-title" href={withRev(recordHref("requirement", r.ref.id), rev)}>
                      {r.ref.title}
                    </Link>
                    <div className="row" style={{ gap: 6 }}>
                      <IdTag id={r.ref.id} />
                      <StatusChip value={r.implementation_state} />
                      {r.outstanding ? <Chip tone="warn">Outstanding</Chip> : null}
                    </div>
                  </li>
                ))}
                limit={6}
                noun="requirements"
                wrap={list}
              />
            )}
          </Card>

          <Card
            title="Decisions and commissions"
            id="decisions"
            hint={
              brief.decisions.length
                ? `${plural(brief.decisions.length, "decision")}, ${brief.decisions.filter((d) => d.status === "issued").length} recorded as issued`
                : undefined
            }
            flush
          >
            {decisions.length + brief.commissions.length === 0 ? (
              <Empty>No decision or commission record is linked to this module.</Empty>
            ) : (
              <Fold
                items={[
                  ...brief.commissions.map((c) => (
                    <li key={c.id}>
                      <span>
                        <span className="muted small">Commission</span>{" "}
                        <Link className="li-title" href={withRev(recordHref("commission", c.id), rev)}>
                          {c.title}
                        </Link>
                      </span>
                    </li>
                  )),
                  ...decisions.map((d) => (
                    <li key={d.ref.id}>
                      <div className="row" style={{ gap: 8 }}>
                        <Link className="li-title" href={withRev(recordHref("decision", d.ref.id), rev)}>
                          {d.ref.title}
                        </Link>
                        <StatusChip value={d.status} label={`Decision ${humanise(d.status).toLowerCase()}`} />
                      </div>
                    </li>
                  )),
                ]}
                limit={6}
                noun="decisions"
                wrap={list}
              />
            )}
          </Card>

          <Card
            title="Evidence"
            id="evidence"
            hint={
              brief.evidence.length
                ? `${brief.evidence.filter((e) => e.verification === "hq_verified").length} of ${brief.evidence.length} checked by HQ's build`
                : undefined
            }
            flush
          >
            {evidence.length === 0 ? (
              <Empty>No evidence record is linked to this module.</Empty>
            ) : (
              <Fold
                items={evidence.map((e) => (
                  <li key={e.ref.id}>
                    <div className="row" style={{ gap: 8 }}>
                      <Link className="li-title" href={withRev(recordHref("evidence", e.ref.id), rev)}>
                        {e.ref.title}
                      </Link>
                      <StatusChip value={e.verification} />
                      <InboxMark ds={ds} id={e.ref.id} />
                    </div>
                    <div className="li-note">{humanise(e.type)}</div>
                  </li>
                ))}
                limit={6}
                noun="evidence records"
                wrap={list}
              />
            )}
          </Card>
        </div>
      </div>

      <Card
        title="Source references"
        id="sources"
        hint={
          brief.last_seen ? `Newest first. Most recent source referring to this module: ${brief.last_seen}` : "No dated source refers to this module"
        }
        flush
      >
        {sources.length === 0 ? (
          <Empty>No source supports this module record.</Empty>
        ) : (
          <Fold
            items={sources.map((s) => (
              <tr key={s.id}>
                <td className="title-cell">
                  <Link href={withRev(recordHref("source", s.id), rev)}>{s.title}</Link> <IdTag id={s.id} />
                </td>
                <td className="nowrap">{isoDate(s.date)}</td>
                <td className="small">{humanise(s.authority)}</td>
                <td className="mono xsmall break">{s.version ?? "—"}</td>
                <td className="mono xsmall" title={s.sha256 ?? undefined}>
                  {shortHash(s.sha256, 12)}
                </td>
              </tr>
            ))}
            limit={10}
            noun="sources"
            wrap={(rows) => (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Date</th>
                      <th>Authority</th>
                      <th>Version</th>
                      <th>SHA-256</th>
                    </tr>
                  </thead>
                  <tbody>{rows}</tbody>
                </table>
              </div>
            )}
          />
        )}
      </Card>
    </div>
  );
}
