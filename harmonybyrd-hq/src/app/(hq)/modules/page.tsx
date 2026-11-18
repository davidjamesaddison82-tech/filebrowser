import type { Metadata } from "next";
import Link from "@/components/pin-link";
import { LifecycleLegend, LifecycleMatrix } from "@/components/lifecycle";
import { Card, Chip, Empty, IdTag, PageHead } from "@/components/ui";
import { ecosystemOverview, lifecycleMatrix, search } from "@/lib/domain/derive";
import { loadPage, param, type SearchParams } from "@/lib/server/page";
import { humanise } from "@/lib/ui/format";
import { withRev } from "@/lib/ui/links";

export const metadata: Metadata = { title: "Module atlas" };

const STANDING_TONE: Record<string, "ok" | "bad" | "founder" | "info" | "accent" | "design" | "plain" | "ghost"> = {
  accepted_in_hq: "ok",
  rejected_in_hq: "bad",
  acceptance_reported: "founder",
  tested_not_accepted: "info",
  prototype_untested: "accent",
  designed_only: "design",
  documented_only: "plain",
  named_only: "ghost",
};

export default async function ModulesPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, rev, params } = await loadPage(searchParams);
  const { ds } = ctx;
  const q = param(params, "q")?.trim() ?? "";
  const family = param(params, "family") ?? "";
  const standing = param(params, "standing") ?? "";
  const view = param(params, "view") === "lifecycle" ? "lifecycle" : "list";

  const overview = ecosystemOverview(ds);
  let modules = overview.modules;
  if (q) {
    const hits = new Set(search(ds, q, { types: ["module"], limit: 10_000 }).map((h) => h.id));
    modules = modules.filter((m) => hits.has(m.id));
  }
  if (family) modules = modules.filter((m) => m.family === family);
  if (standing) modules = modules.filter((m) => m.standing === standing);
  const ids = new Set(modules.map((m) => m.id));
  const rows = lifecycleMatrix(ds).filter((r) => ids.has(r.module_id));
  const families = overview.families.map((f) => f.family);
  // Group the atlas by family (families in alphabetical order, modules in register order within each).
  const groups = families.map((f) => ({ family: f, modules: modules.filter((m) => m.family === f) })).filter((g) => g.modules.length > 0);
  const query = (extra: Record<string, string>) => {
    const sp = new URLSearchParams({
      ...(q ? { q } : {}),
      ...(family ? { family } : {}),
      ...(standing ? { standing } : {}),
      ...extra,
    });
    if (rev) sp.set("rev", String(rev));
    const s = sp.toString();
    return s ? `/modules?${s}` : "/modules";
  };

  return (
    <div className="stack">
      <PageHead
        title="Module atlas"
        lede="Every known module, submodule and workstream, with what it is for and where it honestly stands. Recovered from the sources HQ could read; modules named only in the commission are listed too, marked as having no supporting source."
      />
      <form className="filters" method="get" action="/modules">
        {rev ? <input type="hidden" name="rev" value={rev} /> : null}
        {view === "lifecycle" ? <input type="hidden" name="view" value="lifecycle" /> : null}
        <label className="field" style={{ flex: "1 1 220px" }}>
          Search modules
          <input type="search" name="q" defaultValue={q} placeholder="Name, alias, capability…" />
        </label>
        <label className="field">
          Family
          <select name="family" defaultValue={family}>
            <option value="">All families</option>
            {families.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Standing
          <select name="standing" defaultValue={standing}>
            <option value="">Any standing</option>
            {Object.keys(STANDING_TONE).map((s) => (
              <option key={s} value={s}>
                {humanise(s)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" type="submit">
          Apply
        </button>
        {q || family || standing ? (
          <Link className="btn" href={withRev(view === "lifecycle" ? "/modules?view=lifecycle" : "/modules", rev)}>
            Clear
          </Link>
        ) : null}
      </form>

      <div className="tabs" role="tablist">
        <Link href={query({})} aria-current={view === "list" ? "page" : undefined}>
          Atlas
        </Link>
        <Link href={query({ view: "lifecycle" })} aria-current={view === "lifecycle" ? "page" : undefined}>
          Lifecycle matrix
        </Link>
      </div>

      {modules.length === 0 ? (
        <Card>
          <Empty>No module matches these filters.</Empty>
        </Card>
      ) : view === "lifecycle" ? (
        <Card title="Lifecycle by dimension" hint={`${modules.length} modules`} flush foot={<LifecycleLegend />}>
          <LifecycleMatrix rows={rows} />
        </Card>
      ) : (
        <Card
          title={`${modules.length} ${modules.length === 1 ? "module" : "modules"}`}
          hint={`in ${groups.length} ${groups.length === 1 ? "family" : "families"}`}
          flush
        >
          <div className="table-wrap">
            <table className="tbl tbl-atlas">
              <colgroup>
                <col className="c-main" />
                <col className="c-standing" />
                <col span={4} className="c-num" />
              </colgroup>
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Standing</th>
                  <th className="num">Loops</th>
                  <th className="num">Reqs</th>
                  <th className="num">Open defects</th>
                  <th className="num">Blockers</th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.family}>
                  <tr className="tbl-group">
                    <th colSpan={6} scope="colgroup">
                      {g.family} <span className="muted">· {g.modules.length}</span>
                    </th>
                  </tr>
                  {g.modules.map((m) => (
                    <tr key={m.id}>
                      <td className="title-cell">
                        <Link href={withRev(`/modules/${m.id}`, rev)}>{m.name}</Link> <IdTag id={m.id} />
                        <div className="muted small clamp-2" title={m.summary || undefined}>
                          {m.summary || (m.parent_id ? `Part of ${ds.moduleName(m.parent_id)}` : humanise(m.kind))}
                        </div>
                      </td>
                      <td>
                        <Chip tone={STANDING_TONE[m.standing] ?? "plain"}>{m.standing_label}</Chip>
                        {m.evidence_level !== "documented_in_sources" ? (
                          <div style={{ marginTop: 4 }}>
                            <Chip tone="ghost">No supporting source</Chip>
                          </div>
                        ) : null}
                      </td>
                      <td className="num">{m.loops}</td>
                      <td className="num">{m.requirements}</td>
                      <td className="num">{m.open_defects ? <Chip tone="bad">{m.open_defects}</Chip> : 0}</td>
                      <td className="num">{m.blockers ? <Chip tone="warn">{m.blockers}</Chip> : 0}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
