import type { Metadata } from "next";
import Link from "@/components/pin-link";
import { Card, Chip, Empty, EpistemicChip, Fold, IdTag, KnownLink, Notice, PageHead, Pager } from "@/components/ui";
import { loopStageMatrix, stageCoverage } from "@/lib/domain/derive";
import { type Epistemic, EPISTEMIC_LABEL, STAGE_LABEL, STAGES } from "@/lib/domain/schemas";
import { loadPage, paginate, param, type SearchParams } from "@/lib/server/page";
import { recordHref, withRev } from "@/lib/ui/links";

export const metadata: Metadata = { title: "Learning loop explorer" };

export default async function LoopsPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, rev, params } = await loadPage(searchParams);
  const { ds } = ctx;
  const moduleFilter = param(params, "module") ?? "";
  const familyFilter = param(params, "family") ?? "";
  const standingFilter = param(params, "standing") ?? "";
  const allRows = loopStageMatrix(ds);
  const familyOf = (m: string) => ds.module(m)?.data.family ?? "";
  let rows = allRows;
  if (moduleFilter) rows = rows.filter((r) => r.module_ids.includes(moduleFilter));
  if (familyFilter) rows = rows.filter((r) => r.module_ids.some((m) => familyOf(m) === familyFilter));
  if (standingFilter) rows = rows.filter((r) => r.standing === standingFilter);
  const filtered = Boolean(moduleFilter || familyFilter || standingFilter);
  const pg = paginate(rows, params);
  const pager = <Pager {...pg} params={params} basePath="/loops" noun="loops" />;
  const coverage = stageCoverage(ds);
  const modulesWithLoops = [...new Set(allRows.flatMap((r) => r.module_ids))].sort((a, b) => ds.moduleName(a).localeCompare(ds.moduleName(b)));
  const familiesWithLoops = [...new Set(modulesWithLoops.map(familyOf).filter(Boolean))].sort();
  const standings = [...new Set(allRows.map((r) => r.standing))];
  /** Steps that share an order value are alternatives at the same point ("A or B"). */
  const stepGroups = (steps: (typeof ds.pathways)[number]["data"]["steps"]) => {
    const groups: (typeof steps)[] = [];
    for (const step of [...steps].sort((a, b) => a.order - b.order)) {
      const last = groups[groups.length - 1];
      if (last && last[0].order === step.order) last.push(step);
      else groups.push([step]);
    }
    return groups;
  };

  return (
    <div className="stack">
      <PageHead
        title="Learning loop explorer"
        lede="How each module is meant to produce learning, and how the modules hand a musical idea to one another. Each loop keeps its own steps and names; the shared progression is a lens laid over them only where the source supports it."
      />
      <Notice tone="info">
        Musical correctness — notes, timing, chords, voicings and scoring — is decided by HarmonyByrd&apos;s deterministic engines and by the founder. HQ and AI
        clients record and retrieve what the sources say; they do not redefine what is correct.
      </Notice>

      <Card title="The shared progression" hint="Which modules contribute to each stage, from recovered loop steps (number of modules shown)">
        <div className="stage-list">
          {STAGES.map((stage) => (
            <div key={stage} className={`stage stage-row${coverage[stage].length ? " on" : ""}`}>
              <div className="k">
                {STAGE_LABEL[stage]} <span className="stage-n">{coverage[stage].length}</span>
              </div>
              <div className="v">
                {coverage[stage].length === 0 ? (
                  <span className="faint">no loop step recovered</span>
                ) : (
                  coverage[stage].map((entry, i) => (
                    <span key={entry.module_id}>
                      {i > 0 ? <span className="faint"> · </span> : null}
                      <KnownLink ds={ds} type="module" id={entry.module_id} rev={rev}>
                        {ds.moduleName(entry.module_id)}
                      </KnownLink>
                    </span>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {ds.pathways.length ? (
        <Card title="Cross-module pathways" hint="How one musical idea travels between modules">
          <Fold
            limit={6}
            noun="pathways"
            wrap={(children) => <div className="stack">{children}</div>}
            items={ds.pathways.map((p) => (
              <div key={p.meta.id} className="stack-sm">
                <div className="row" style={{ gap: 8 }}>
                  <Link href={withRev(recordHref("pathway", p.meta.id), rev)}>
                    <strong>{p.data.name}</strong>
                  </Link>
                  <IdTag id={p.meta.id} />
                  {p.data.basis === "commission_example" ? (
                    <Chip tone="founder" glyph="★">
                      Example given in the commission
                    </Chip>
                  ) : (
                    <EpistemicChip value={p.data.basis as Epistemic} />
                  )}
                </div>
                <div className="path">
                  {stepGroups(p.data.steps).map((group, i) => (
                    <div key={i} style={{ display: "contents" }}>
                      {i > 0 ? (
                        <span className="path-arrow" aria-hidden="true">
                          →
                        </span>
                      ) : null}
                      <div className={`path-step${group.length > 1 ? " path-alt" : ""}`}>
                        {group.map((step, j) => (
                          <div key={j}>
                            {j > 0 ? <div className="path-or">or</div> : null}
                            <KnownLink ds={ds} type="module" id={step.module_id} rev={rev}>
                              <strong>{ds.moduleName(step.module_id)}</strong>
                            </KnownLink>
                            <div className="muted" style={{ marginTop: 3 }}>
                              {step.role}
                            </div>
                            {step.shared_stage !== "none" ? (
                              <div style={{ marginTop: 5 }}>
                                <Chip tone="accent">{STAGE_LABEL[step.shared_stage]}</Chip>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          />
        </Card>
      ) : null}

      <form className="filters" method="get" action="/loops" id="loop-list">
        {rev ? <input type="hidden" name="rev" value={rev} /> : null}
        <label className="field">
          Family
          <select name="family" defaultValue={familyFilter}>
            <option value="">All families</option>
            {familiesWithLoops.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Module
          <select id="loop-module" name="module" defaultValue={moduleFilter}>
            <option value="">All modules</option>
            {modulesWithLoops.map((m) => (
              <option key={m} value={m}>
                {ds.moduleName(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Standing
          <select name="standing" defaultValue={standingFilter}>
            <option value="">Any standing</option>
            {standings.map((v) => (
              <option key={v} value={v}>
                {EPISTEMIC_LABEL[v as Epistemic] ?? v}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" type="submit">
          Filter
        </button>
        {filtered ? (
          <Link className="btn" href={withRev("/loops", rev)}>
            Clear
          </Link>
        ) : null}
      </form>

      <Card
        title={filtered ? `${rows.length} of ${allRows.length} learning loops` : `${rows.length} learning ${rows.length === 1 ? "loop" : "loops"}`}
        hint="Cells show each loop's own name for the step"
        flush
        foot={pager}
      >
        {rows.length === 0 ? (
          <Empty>{filtered ? "No learning loop matches these filters." : "No learning loop has been recovered."}</Empty>
        ) : (
          <>
            {pg.pages > 1 ? <div className="pager-top">{pager}</div> : null}
            <div className="table-wrap">
              <table className="tbl tbl-loops">
                <thead>
                  <tr>
                    <th>Loop</th>
                    {STAGES.map((s) => (
                      <th key={s}>{STAGE_LABEL[s]}</th>
                    ))}
                    <th>Not mapped</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.items.map((row) => (
                    <tr key={row.loop_id}>
                      <td className="title-cell" style={{ minWidth: 220 }}>
                        <Link href={withRev(`/loops/${row.loop_id}`, rev)}>{row.name}</Link>
                        <div className="row" style={{ gap: 6, marginTop: 3 }}>
                          <EpistemicChip value={row.standing as Epistemic} />
                        </div>
                        <div className="muted xsmall" style={{ marginTop: 3 }}>
                          {row.module_ids.map((m) => ds.moduleName(m)).join(" · ")}
                        </div>
                      </td>
                      {STAGES.map((s) => (
                        <td key={s} className="small">
                          {row.stages[s].length ? row.stages[s].join("; ") : <span className="faint">·</span>}
                        </td>
                      ))}
                      <td className="small muted">{row.unmapped.length ? row.unmapped.join("; ") : "—"}</td>
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
