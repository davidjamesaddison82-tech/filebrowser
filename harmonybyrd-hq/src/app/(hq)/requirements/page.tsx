import type { Metadata } from "next";
import Link from "@/components/pin-link";
import { Card, Chip, Empty, IdTag, KnownLink, PageHead, Pager, StatusChip } from "@/components/ui";
import { filterRequirements, isOutstanding } from "@/lib/domain/derive";
import { IMPLEMENTATION_STATES, REQUIREMENT_CATEGORIES, REQUIREMENT_DISPOSITIONS } from "@/lib/domain/schemas";
import { loadPage, paginate, param, type SearchParams } from "@/lib/server/page";
import { humanise, isoDate, statusLabel } from "@/lib/ui/format";
import { withRev } from "@/lib/ui/links";

export const metadata: Metadata = { title: "Founder requirements" };

export default async function RequirementsPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, rev, params } = await loadPage(searchParams);
  const { ds } = ctx;
  const filter = {
    q: param(params, "q")?.trim() || undefined,
    module_id: param(params, "module") || undefined,
    category: param(params, "category") || undefined,
    disposition: param(params, "disposition") || undefined,
    implementation_state: param(params, "state") || undefined,
    source_id: param(params, "source") || undefined,
    outstanding: param(params, "outstanding") === "1",
  };
  const list = filterRequirements(ds, filter);
  const active = Object.values(filter).some(Boolean);
  const pg = paginate(list, params);
  const pager = <Pager {...pg} params={params} basePath="/requirements" noun="requirements" />;
  const sourcesUsed = [...new Set(ds.requirements.map((r) => r.data.source_id))].sort();
  const modulesUsed = [...new Set(ds.requirements.flatMap((r) => r.data.module_ids))].sort((a, b) => ds.moduleName(a).localeCompare(ds.moduleName(b)));

  return (
    <div className="stack">
      <PageHead
        title="Founder requirements register"
        lede="Every founder instruction HQ could recover, in its exact original wording, with where it came from and what has happened to it. The wording never changes; interpretations and status are kept visibly separate."
        actions={
          <Link className="btn" href={withRev("/review", rev)}>
            Conflicts & duplicates
          </Link>
        }
      />
      <form className="filters" method="get" action="/requirements">
        {rev ? <input type="hidden" name="rev" value={rev} /> : null}
        <label className="field" style={{ flex: "1 1 240px" }}>
          Search wording, title or id
          <input type="search" name="q" defaultValue={filter.q ?? ""} placeholder="e.g. acceptance, FR-…" />
        </label>
        <label className="field">
          Module
          <select name="module" defaultValue={filter.module_id ?? ""}>
            <option value="">Any module</option>
            {modulesUsed.map((m) => (
              <option key={m} value={m}>
                {ds.moduleName(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Category
          <select name="category" defaultValue={filter.category ?? ""}>
            <option value="">Any category</option>
            {REQUIREMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {humanise(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Standing
          <select name="disposition" defaultValue={filter.disposition ?? ""}>
            <option value="">Any standing</option>
            {REQUIREMENT_DISPOSITIONS.map((d) => (
              <option key={d} value={d}>
                {statusLabel(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Implementation
          <select name="state" defaultValue={filter.implementation_state ?? ""}>
            <option value="">Any state</option>
            {IMPLEMENTATION_STATES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Source
          <select name="source" defaultValue={filter.source_id ?? ""}>
            <option value="">Any source</option>
            {sourcesUsed.map((s) => (
              <option key={s} value={s}>
                {s} — {(ds.source(s)?.data.title ?? "").slice(0, 44)}
              </option>
            ))}
          </select>
        </label>
        <label className="row small" style={{ gap: 6, paddingBottom: 8 }}>
          <input type="checkbox" name="outstanding" value="1" defaultChecked={filter.outstanding} /> Outstanding only
        </label>
        <button className="btn" type="submit">
          Apply
        </button>
        {active ? (
          <Link className="btn" href={withRev("/requirements", rev)}>
            Clear
          </Link>
        ) : null}
      </form>

      <Card title={`${list.length} of ${ds.requirements.length} requirements`} flush foot={pager}>
        {list.length === 0 ? (
          <Empty>No requirement matches these filters.</Empty>
        ) : (
          <>
            {pg.pages > 1 ? <div className="pager-top">{pager}</div> : null}
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Requirement</th>
                    <th>Source</th>
                    <th>Modules</th>
                    <th>Standing</th>
                    <th>Implementation</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.items.map((r) => (
                    <tr key={r.meta.id}>
                      <td className="title-cell" style={{ minWidth: 300 }}>
                        <Link href={withRev(`/requirements/${r.meta.id}`, rev)}>{r.data.title}</Link> <IdTag id={r.meta.id} />
                        <div className="small" style={{ marginTop: 3, color: "var(--ink-2)" }}>
                          “{r.data.exact_wording.length > 220 ? `${r.data.exact_wording.slice(0, 220)}…` : r.data.exact_wording}”
                        </div>
                      </td>
                      <td className="small">
                        <KnownLink ds={ds} type="source" id={r.data.source_id} rev={rev} />
                        <div className="muted xsmall">{isoDate(r.data.source_date)}</div>
                      </td>
                      <td className="small">
                        {r.data.module_ids.length ? r.data.module_ids.map((m) => ds.moduleName(m)).join(", ") : <span className="muted">none</span>}
                      </td>
                      <td>
                        <StatusChip value={r.data.disposition} field="requirement.disposition" />
                      </td>
                      <td>
                        <StatusChip value={r.data.implementation_state} field="requirement.implementation_state" />
                        {isOutstanding(r.data, ds) ? (
                          <div style={{ marginTop: 4 }}>
                            <Chip tone="warn">Outstanding</Chip>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
