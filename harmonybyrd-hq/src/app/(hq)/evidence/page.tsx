import type { Metadata } from "next";
import Link from "@/components/pin-link";
import { Card, Chip, Empty, IdTag, InboxOriginChip, Notice, PageHead, Pager, StatusChip } from "@/components/ui";
import type { Dataset } from "@/lib/domain/dataset";
import { resolvedByHqDecisions } from "@/lib/domain/derive";
import { type Page, loadPage, paginate, param, type SearchParams } from "@/lib/server/page";
import { humanise, isoDate, plural, shortHash } from "@/lib/ui/format";
import { hqChecks } from "@/lib/ui/guards";
import { recordHref, withRev } from "@/lib/ui/links";

export const metadata: Metadata = { title: "Development & evidence" };

const TABS = [
  ["chain", "Lifecycle"],
  ["commissions", "Commissions"],
  ["builds", "Builds"],
  ["evidence", "Evidence"],
  ["defects", "Defects"],
  ["open", "Open items"],
  ["decisions", "Decisions"],
] as const;
type Tab = (typeof TABS)[number][0];

/** The first `n` characters of a statement, or "" when a stored record has none. */
function clip(text: unknown, n: number): string {
  if (typeof text !== "string") return "";
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

function moduleNames(ds: Dataset, ids: string[]): string {
  return ids.length ? ids.map((m) => ds.moduleName(m)).join(", ") : "—";
}

export default async function EvidencePage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, rev, params } = await loadPage(searchParams);
  const { ds } = ctx;
  const tab = (TABS.find(([key]) => key === param(params, "tab"))?.[0] ?? "chain") as Tab;
  const moduleId = param(params, "module") ?? "";
  const status = param(params, "status") ?? "";
  const inModule = (ids: string[] | undefined, single?: string | null) => !moduleId || (ids ?? []).includes(moduleId) || single === moduleId;
  const href = (t: Tab, extra: Record<string, string> = {}) => {
    const sp = new URLSearchParams({
      tab: t,
      ...(moduleId ? { module: moduleId } : {}),
      ...extra,
    });
    if (rev) sp.set("rev", String(rev));
    return `/evidence?${sp}`;
  };

  const commissions = ds.commissions.filter((c) => inModule(c.data.module_ids));
  const builds = ds.builds.filter((b) => inModule(undefined, b.data.module_id) && (!status || b.data.standing === status));
  const evidence = ds.evidence.filter((e) => inModule(e.data.module_ids) && (!status || e.data.verification === status));
  const defects = ds.defects.filter((d) => inModule(d.data.module_ids) && (!status || d.data.status === status));
  const openItems = ds.openItems.filter((o) => inModule(o.data.module_ids) && (!status || o.data.kind === status));
  const decisions = ds.decisions.filter((d) => inModule(d.data.module_ids) && (!status || d.data.status === status));
  const resolved = resolvedByHqDecisions(ds);
  const counts: Record<Tab, number> = {
    chain: 0,
    commissions: commissions.length,
    builds: builds.length,
    evidence: evidence.length,
    defects: defects.length,
    open: openItems.length,
    decisions: decisions.length,
  };
  const pg = {
    commissions: paginate(commissions, params),
    builds: paginate(builds, params),
    evidence: paginate(evidence, params),
    defects: paginate(defects, params),
    open: paginate(openItems, params),
    decisions: paginate(decisions, params),
  };
  const pager = <T,>(p: Page<T>, noun: string) => <Pager {...p} params={params} basePath="/evidence" noun={noun} />;
  // Repeat the page links above a long list, so nobody has to scroll to the bottom to move on.
  const topPager = <T,>(p: Page<T>, noun: string) => (p.pages > 1 ? <div className="pager-top">{pager(p, noun)}</div> : null);
  const modulesInUse = ds.modules.map((m) => m.meta.id).sort((a, b) => ds.moduleName(a).localeCompare(ds.moduleName(b)));

  const chain = [
    {
      label: "Founder instruction",
      n: ds.requirements.length,
      href: withRev("/requirements", rev),
      note: "exact wording, permanent",
    },
    {
      label: "Scoped commission",
      n: ds.commissions.length,
      href: href("commissions"),
      note: "what was asked for",
    },
    {
      label: "Implementation",
      n: ds.builds.length,
      href: href("builds"),
      note: "builds and candidates, by hash",
    },
    {
      label: "Tests & evidence",
      n: ds.evidence.length,
      href: href("evidence"),
      note: "automated, manual, hardware, audit",
    },
    {
      label: "Defects",
      n: ds.defects.filter((d) => d.data.status === "open").length,
      href: href("defects", { status: "open" }),
      note: "open, never silently dropped",
    },
    {
      label: "Founder decision",
      n: ds.decisions.length,
      href: href("decisions"),
      note: "issued, pending or held",
    },
    {
      label: "Retained history",
      n: ds.revision.rev,
      href: "/changes",
      note: "append-only dataset revisions",
    },
  ];

  return (
    <div className="stack">
      <PageHead
        title="Development and evidence register"
        lede="The development lifecycle end to end: founder instruction → scoped commission → implementation → tests → independent assessment → defect repair → founder decision → retained history. An agent's statement that something is complete is not evidence of completion."
      />
      <form className="filters" method="get" action="/evidence">
        {rev ? <input type="hidden" name="rev" value={rev} /> : null}
        <input type="hidden" name="tab" value={tab} />
        <label className="field">
          Module
          <select name="module" defaultValue={moduleId}>
            <option value="">All modules</option>
            {modulesInUse.map((m) => (
              <option key={m} value={m}>
                {ds.moduleName(m)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" type="submit">
          Apply
        </button>
        {moduleId || status ? (
          <Link className="btn" href={withRev(`/evidence?tab=${tab}`, rev)}>
            Clear
          </Link>
        ) : null}
        {status ? <Chip tone="info">Filtered: {humanise(status)}</Chip> : null}
      </form>

      <nav className="tabs tabs-wrap" aria-label="Register sections">
        {TABS.map(([key, label]) => (
          <Link key={key} href={href(key)} aria-current={tab === key ? "page" : undefined}>
            {label}
            {key !== "chain" ? <span className="muted"> {counts[key]}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === "chain" ? (
        <>
          <Card title="From instruction to retained record" hint="Each stage opens its register">
            <div className="path">
              {chain.map((step, i) => (
                <div key={step.label} style={{ display: "contents" }}>
                  {i > 0 ? (
                    <span className="path-arrow" aria-hidden="true">
                      →
                    </span>
                  ) : null}
                  <Link href={step.href} className="path-step" style={{ color: "inherit" }}>
                    <div style={{ fontSize: "1.4rem", fontWeight: 700 }}>{step.n}</div>
                    <strong>{step.label}</strong>
                    <div className="muted">{step.note}</div>
                  </Link>
                </div>
              ))}
            </div>
          </Card>
          <div className="grid-2">
            <Card title="How evidence is graded">
              <ul className="plain small">
                <li>
                  <StatusChip value="hq_verified" /> Recorded by the build that produced this dataset (for example, a checksum recomputed from the bytes).
                  The running application re-verifies quotations at import; it does not re-run the other checks.
                </li>
                <li>
                  <StatusChip value="source_reported" /> A source document reports it. HQ quotes the source and has not re-run anything.
                </li>
                <li>
                  <StatusChip value="agent_submitted_unverified" /> An AI client submitted it through the inbox. It stays labelled as a claim.
                </li>
              </ul>
            </Card>
            <Card title="What counts as acceptance">
              <p className="small">
                Only a founder decision. A build can pass every test and remain a candidate. Where a source says the founder accepted something, HQ shows it as{" "}
                <em>reported in a source</em> until the founder records a decision in HQ — and no AI client can record one.
              </p>
            </Card>
          </div>
        </>
      ) : null}

      {tab === "commissions" ? (
        <Card title={`${commissions.length} commissions`} flush foot={pager(pg.commissions, "commissions")}>
          {commissions.length === 0 ? (
            <Empty>No commission matches.</Empty>
          ) : (
            <>
              {topPager(pg.commissions, "commissions")}
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Commission</th>
                      <th>Date</th>
                      <th>Status</th>
                      <th>Modules</th>
                      <th className="num">Outputs held</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pg.commissions.items.map((c) => (
                      <tr key={c.meta.id}>
                        <td className="title-cell">
                          <Link href={withRev(recordHref("commission", c.meta.id), rev)}>{c.data.title}</Link> <IdTag id={c.meta.id} />
                          <div className="mono xsmall muted">{c.data.code}</div>
                        </td>
                        <td className="nowrap">{isoDate(c.data.date)}</td>
                        <td>
                          <StatusChip value={c.data.status} />
                        </td>
                        <td className="small">{moduleNames(ds, c.data.module_ids)}</td>
                        <td className="num">{c.data.output_source_ids.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      ) : null}

      {tab === "builds" ? (
        <Card title={`${builds.length} builds`} hint="Identified by hash wherever the source gives one" flush foot={pager(pg.builds, "builds")}>
          {builds.length === 0 ? (
            <Empty>No build matches.</Empty>
          ) : (
            <>
              {topPager(pg.builds, "builds")}
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Build</th>
                      <th>Module</th>
                      <th>Standing</th>
                      <th>SHA-256</th>
                      <th>Checked by HQ&apos;s build</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pg.builds.items.map((b) => (
                      <tr key={b.meta.id}>
                        <td className="title-cell">
                          <Link href={withRev(recordHref("build", b.meta.id), rev)}>{b.data.label}</Link> <IdTag id={b.meta.id} />
                          {b.data.filename ? <div className="mono xsmall muted break">{b.data.filename}</div> : null}
                        </td>
                        <td className="small">{b.data.module_id ? ds.moduleName(b.data.module_id) : "—"}</td>
                        <td>
                          <StatusChip value={b.data.standing} />
                          {b.data.hq_acceptance?.state === "accepted" ? (
                            <div style={{ marginTop: 4 }}>
                              <Chip tone="ok">Accepted in HQ</Chip>
                            </div>
                          ) : b.data.hq_acceptance?.state === "rejected" ? (
                            <div style={{ marginTop: 4 }}>
                              <Chip tone="bad">Founder rejected in HQ</Chip>
                            </div>
                          ) : null}
                        </td>
                        <td className="mono xsmall" title={b.data.sha256 ?? undefined}>
                          {shortHash(b.data.sha256, 16)}
                        </td>
                        <td className="small">
                          {hqChecks(b.data.hq_checks).length ? (
                            <Chip tone="ok" glyph="✓" title="Checks made by HQ's build">
                              {plural(hqChecks(b.data.hq_checks).length, "check")} by HQ&apos;s build
                            </Chip>
                          ) : (
                            <span className="muted">none</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      ) : null}

      {tab === "evidence" ? (
        <Card title={`${evidence.length} evidence records`} flush foot={pager(pg.evidence, "evidence records")}>
          {evidence.length === 0 ? (
            <Empty>No evidence record matches.</Empty>
          ) : (
            <>
              {topPager(pg.evidence, "evidence records")}
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Evidence</th>
                      <th>Type</th>
                      <th>Verification</th>
                      <th>Modules</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pg.evidence.items.map((e) => (
                      <tr key={e.meta.id}>
                        <td className="title-cell" style={{ minWidth: 280 }}>
                          <Link href={withRev(recordHref("evidence", e.meta.id), rev)}>{e.data.title}</Link> <IdTag id={e.meta.id} /> <InboxOriginChip envelope={e} />
                          <div className="small muted">{clip(e.data.result?.text, 180)}</div>
                        </td>
                        <td className="small">{humanise(e.data.type)}</td>
                        <td>
                          <StatusChip value={e.data.verification} />
                        </td>
                        <td className="small">{moduleNames(ds, e.data.module_ids)}</td>
                        <td className="nowrap">{isoDate(e.data.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      ) : null}

      {tab === "defects" ? (
        <Card
          title={`${defects.length} defects`}
          hint={`${defects.filter((d) => d.data.status === "open").length} open`}
          flush
          foot={pager(pg.defects, "defects")}
        >
          {defects.length === 0 ? (
            <Empty>No defect matches.</Empty>
          ) : (
            <>
              {topPager(pg.defects, "defects")}
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Defect</th>
                      <th>Status</th>
                      <th>Severity</th>
                      <th>Modules</th>
                      <th>Build</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pg.defects.items.map((d) => (
                      <tr key={d.meta.id}>
                        <td className="title-cell" style={{ minWidth: 280 }}>
                          <Link href={withRev(recordHref("defect", d.meta.id), rev)}>{d.data.title}</Link> <IdTag id={d.meta.id} /> <InboxOriginChip envelope={d} />
                          <div className="small muted">
                            {clip(d.data.statement?.text, 180)}
                          </div>
                        </td>
                        <td>
                          <StatusChip value={d.data.status} />
                        </td>
                        <td className="small">{humanise(d.data.severity)}</td>
                        <td className="small">{moduleNames(ds, d.data.module_ids)}</td>
                        <td className="small">
                          {d.data.build_id ? <Link href={withRev(recordHref("build", d.data.build_id), rev)}>{d.data.build_id}</Link> : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      ) : null}

      {tab === "open" ? (
        <Card
          title={`${openItems.length} open items`}
          hint="Pending decisions, blockers, boundaries, unverified claims and risks"
          flush
          foot={pager(pg.open, "open items")}
        >
          {openItems.length === 0 ? (
            <Empty>No open item matches.</Empty>
          ) : (
            <>
              {topPager(pg.open, "open items")}
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Kind</th>
                      <th>Modules</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pg.open.items.map((o) => (
                      <tr key={o.meta.id}>
                        <td className="title-cell" style={{ minWidth: 320 }}>
                          <Link href={withRev(recordHref("open_item", o.meta.id), rev)}>{o.data.title}</Link> <IdTag id={o.meta.id} /> <InboxOriginChip envelope={o} />
                          <div className="small muted">
                            {clip(o.data.statement?.text, 220)}
                          </div>
                        </td>
                        <td>
                          <Chip tone={resolved.has(o.meta.id) ? "ok" : "warn"}>{resolved.has(o.meta.id) ? "Resolved in HQ" : humanise(o.data.kind)}</Chip>
                        </td>
                        <td className="small">{moduleNames(ds, o.data.module_ids)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      ) : null}

      {tab === "decisions" ? (
        <>
          <Notice tone="info">
            Decisions marked <em>reported in a source</em> are what documents say the founder decided. Decisions <em>recorded in HQ</em> were made here by the
            founder. To act on pending decisions, open the <Link href="/decisions">decision centre</Link>.
          </Notice>
          <Card title={`${decisions.length} decisions`} flush foot={pager(pg.decisions, "decisions")}>
            {decisions.length === 0 ? (
              <Empty>No decision matches.</Empty>
            ) : (
              <>
                {topPager(pg.decisions, "decisions")}
                <div className="table-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Decision</th>
                        <th>Status</th>
                        <th>Recorded</th>
                        <th>Date</th>
                        <th>Modules</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pg.decisions.items.map((d) => (
                        <tr key={d.meta.id}>
                          <td className="title-cell" style={{ minWidth: 300 }}>
                            <Link href={withRev(recordHref("decision", d.meta.id), rev)}>{d.data.title}</Link> <IdTag id={d.meta.id} />
                            {d.data.code ? <div className="mono xsmall muted">{d.data.code}</div> : null}
                          </td>
                          <td>
                            <StatusChip value={d.data.status} />
                          </td>
                          <td>
                            <Chip tone={d.data.recorded_in === "hq" ? "ok" : "outline"}>{d.data.recorded_in === "hq" ? "In HQ" : "In a source"}</Chip>
                          </td>
                          <td className="nowrap">{isoDate(d.data.date)}</td>
                          <td className="small">{moduleNames(ds, d.data.module_ids)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
