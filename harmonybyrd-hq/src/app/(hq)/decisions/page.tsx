import type { Metadata } from "next";
import Link from "@/components/pin-link";
import { DecisionForm } from "@/components/gov-forms";
import { Card, Chip, Empty, Fold, IdTag, NotCountedChip, Notice, PageHead, Pager, StatusChip } from "@/components/ui";

import { type DatasetView, isReadable } from "@/lib/domain/conform";
import { isFounderSession } from "@/lib/auth/principal";
import { developmentHealth, recordTitle } from "@/lib/domain/derive";
import { RECORD_TYPE_LABEL } from "@/lib/domain/schemas";
import { loadPage, paginate, param, type SearchParams } from "@/lib/server/page";
import { listProposals } from "@/lib/server/services";
import { humanise, isoDateTime, plural } from "@/lib/ui/format";
import { recordHref } from "@/lib/ui/links";

export const metadata: Metadata = { title: "Decision centre" };

/** The modules a record belongs to (a module belongs to itself). */
function modulesOf(ds: DatasetView, id: string): string[] {
  const e = ds.byId(id);
  if (!e) return [];
  if (e.meta.type === "module") return [id];
  const d = e.data as { module_ids?: unknown; module_id?: unknown };
  const ids = Array.isArray(d.module_ids) ? d.module_ids.filter((x): x is string => typeof x === "string") : [];
  return typeof d.module_id === "string" ? [...ids, d.module_id] : ids;
}

export default async function DecisionsPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal, ctx, params } = await loadPage(searchParams, { pinnable: false });
  const { ds } = ctx;
  const founder = isFounderSession(principal);
  const proposals = (await listProposals(principal)).filter((p) => p.status === "submitted");
  const allPending = developmentHealth(ds).pending_founder_decisions;
  const moduleId = param(params, "module") ?? "";
  const typeFilter = param(params, "type") ?? "";
  const pendingModules = new Map(allPending.map((p) => [p.id, modulesOf(ds, p.id)]));
  const types = [...new Set(allPending.map((p) => p.type))];
  const inModule = allPending.filter((p) => !moduleId || pendingModules.get(p.id)!.includes(moduleId));
  // Grouped by record type so each page reads as a few labelled groups.
  const pending = (typeFilter ? inModule.filter((p) => p.type === typeFilter) : inModule).sort((a, b) => types.indexOf(a.type) - types.indexOf(b.type));
  const typeCount = (t: string) => inModule.filter((p) => p.type === t).length;
  const modulesInQueue = [...new Set([...pendingModules.values()].flat())].sort((a, b) => ds.moduleName(a).localeCompare(ds.moduleName(b)));
  const pg = paginate(pending, params);
  const pager = <Pager {...pg} params={params} basePath="/decisions" noun="items" />;
  const recorded = ds.decisions.filter((d) => d.data.recorded_in === "hq").sort((a, b) => (b.data.decided_at ?? "").localeCompare(a.data.decided_at ?? ""));
  const resolves = param(params, "resolves") ?? "";
  const prefillTitle = resolves
    ? `Decision on ${ds.byId(resolves) ? recordTitle(ds.byId(resolves)!.meta.type, ds.byId(resolves)!.data) : resolves}`.slice(0, 190)
    : "";
  const acceptable = [
    ...ds.builds.map((b) => ({ type: "build", id: b.meta.id, title: b.data.label })),
    ...ds.modules.map((m) => ({ type: "module", id: m.meta.id, title: m.data.name })),
    ...ds.evidence.map((e) => ({ type: "evidence", id: e.meta.id, title: e.data.title })),
    ...ds.commissions.map((c) => ({ type: "commission", id: c.meta.id, title: c.data.title })),
    ...ds.loops.map((l) => ({ type: "loop", id: l.meta.id, title: l.data.name })),
  ];

  return (
    <div className="stack">
      <PageHead
        title="Founder decision centre"
        lede="Everything waiting on the founder, in one queue: proposals from developers and AI clients, and decisions the sources record as still open. The founder alone decides scope, educational objectives, acceptance criteria, release acceptance, conflicts between instructions and any change to deterministic musical assessment."
      />
      {!founder ? (
        <Notice tone="info">
          You are signed in as <strong>{principal.displayName}</strong> ({principal.appRole}). You can read this queue. Only the founder&apos;s own session can
          review proposals or record decisions — no other role, and no API token, can.
        </Notice>
      ) : null}

      <Card title="Proposals awaiting review" hint={plural(proposals.length, "proposal")} flush>
        {proposals.length === 0 ? (
          <Empty>{founder ? "No proposal is waiting for you." : "None of your proposals is waiting for review."}</Empty>
        ) : (
          <Fold
            limit={10}
            noun="proposals"
            wrap={(children) => <ul className="list">{children}</ul>}
            items={proposals.map((p) => (
              <li key={p.id}>
                <div className="row" style={{ gap: 8 }}>
                  <Link className="li-title" href={`/proposals/${p.id}`}>
                    {p.title}
                  </Link>
                  <IdTag id={p.id} />
                  <Chip tone={p.submitted_by_kind === "ai_client" ? "warn" : "outline"}>
                    {p.submitted_by_kind === "ai_client" ? `AI client: ${p.submitted_by}` : `${p.submitted_by} (${p.submitted_by_role})`}
                  </Chip>
                </div>
                <div className="li-note">
                  {humanise(p.kind).toLowerCase()} · {p.target_id ? `on ${p.target_id} v${p.base_version}` : "new record"} · {isoDateTime(p.submitted_at)}
                </div>
              </li>
            ))}
          />
        )}
      </Card>

      <Card
        title="Decisions the sources record as still open"
        hint={moduleId || typeFilter ? `${pending.length} of ${plural(allPending.length, "item")}` : plural(allPending.length, "item")}
        flush
        foot={pager}
      >
        {allPending.length > 0 ? (
          <form className="filters card-filters" method="get" action="/decisions">
            <label className="field">
              Module
              <select name="module" defaultValue={moduleId}>
                <option value="">All modules</option>
                {modulesInQueue.map((m) => (
                  <option key={m} value={m}>
                    {ds.moduleName(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Kind
              <select name="type" defaultValue={typeFilter}>
                <option value="">All kinds</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {RECORD_TYPE_LABEL[t]} ({typeCount(t)})
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" type="submit">
              Apply
            </button>
            {moduleId || typeFilter ? (
              <Link className="btn" href="/decisions">
                Clear
              </Link>
            ) : null}
          </form>
        ) : null}
        {pending.length === 0 ? (
          <Empty>{allPending.length === 0 ? "The sources record no decision as pending." : "No pending item matches these filters."}</Empty>
        ) : (
          <>
            {pg.pages > 1 ? <div className="pager-top">{pager}</div> : null}
            <ul className="list">
              {pg.items.map((item, i) => (
                <li key={item.id}>
                  {!typeFilter && types.length > 1 && (i === 0 || pg.items[i - 1].type !== item.type) ? (
                    <div className="list-group">
                      {RECORD_TYPE_LABEL[item.type]} <span className="muted">· {plural(typeCount(item.type), "item")}</span>
                    </div>
                  ) : null}
                  <div className="row-between">
                    <div className="row" style={{ gap: 8 }}>
                      <Link className="li-title" href={recordHref(item.type, item.id)}>
                        {item.title}
                      </Link>
                      <IdTag id={item.id} />
                      <span className="muted xsmall">{RECORD_TYPE_LABEL[item.type]}</span>
                    </div>
                    {founder ? (
                      <Link className="btn small" href={`/decisions?resolves=${item.id}#record`}>
                        Decide
                      </Link>
                    ) : null}
                  </div>
                  <div className="li-note">{item.note}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <div className="split">
        <Card id="record" title="Record a founder decision" hint="The only way acceptance or a requirement's standing enters HQ">
          {founder ? (
            <DecisionForm
              key={resolves}
              resolves={resolves}
              title={prefillTitle}
              requirements={ds.requirements.map((r) => ({ id: r.meta.id, title: r.data.title }))}
              acceptable={acceptable}
            />
          ) : (
            <p className="muted">Recording a decision requires the founder&apos;s interactive session.</p>
          )}
        </Card>
        <div className="stack">
          <Card title="Decisions recorded in HQ" hint={plural(recorded.length, "decision")} flush>
            {recorded.length === 0 ? (
              <Empty>No founder decision has been recorded in HQ yet.</Empty>
            ) : (
              <Fold
                limit={10}
                noun="decisions"
                wrap={(children) => <ul className="list">{children}</ul>}
                items={recorded.map((d) => (
                  <li key={d.meta.id}>
                    <div className="row" style={{ gap: 8 }}>
                      <Link className="li-title" href={recordHref("decision", d.meta.id)}>
                        {d.data.title}
                      </Link>
                      <IdTag id={d.meta.id} />
                    </div>
                    <div className="li-note">
                      {isoDateTime(d.data.decided_at)} · by {d.data.decided_by} {isReadable(d) ? <StatusChip value={d.data.status} field="decision.status" /> : <NotCountedChip />}
                    </div>
                  </li>
                ))}
              />
            )}
          </Card>
          <Card title="What a decision can and cannot be">
            <ul className="plain small">
              <li>A decision is recorded with the founder&apos;s exact words and is never edited afterwards.</li>
              <li>
                Acceptance recorded here is the only acceptance HQ reports as its own. What sources say about earlier acceptance stays labelled as reported.
              </li>
              <li>An AI client or developer can propose, report and submit evidence. None of them can accept, including their own work.</li>
              <li>Until the P00 gate is evidenced, decisions recorded in this prototype are working records, not governing instruments.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
