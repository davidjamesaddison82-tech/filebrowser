import Link from "@/components/pin-link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AcceptanceLock, bindingAcceptance, Card, Chip, Citations, ClaimView, Empty, EpistemicChip, Fold, IdTag, InboxOriginChip, Notice, PageHead, RecordLink } from "@/components/ui";
import { stageCoverage } from "@/lib/domain/derive";
import { STAGE_LABEL, STAGES } from "@/lib/domain/schemas";
import { loadPage, routeId, type SearchParams } from "@/lib/server/page";
import { recordHref, withRev } from "@/lib/ui/links";

const listWrap = (children: ReactNode[]) => <ul className="list">{children}</ul>;

export default async function LoopPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { ctx, rev } = await loadPage(searchParams);
  const { ds } = ctx;
  const loop = ds.get("loop", routeId(id));
  if (!loop) notFound();
  const l = loop.data;
  const steps = [...l.steps].sort((a, b) => a.order - b.order);
  const byStage = new Map<string, string[]>();
  for (const step of steps) {
    if (step.shared_stage === "none") continue;
    byStage.set(step.shared_stage, [...(byStage.get(step.shared_stage) ?? []), step.source_term]);
  }
  const coverage = stageCoverage(ds);
  const others = new Map<string, string[]>();
  for (const stage of STAGES) {
    if (!byStage.has(stage)) continue;
    for (const entry of coverage[stage]) {
      if (l.module_ids.includes(entry.module_id)) continue;
      others.set(entry.module_id, [...(others.get(entry.module_id) ?? []), STAGE_LABEL[stage]]);
    }
  }
  const variants = ds.loops.filter((x) => x.data.variant_of === l.id);

  return (
    <div className="stack">
      <PageHead
        title={l.name}
        id={l.id}
        crumbs={[{ label: "Learning loop explorer", href: "/loops" }]}
        chips={
          <>
            <InboxOriginChip envelope={loop} />
            <EpistemicChip value={l.standing} />
            {l.module_ids.map((m) => (
              <Link key={m} href={withRev(recordHref("module", m), rev)}>
                <Chip tone="outline">{ds.moduleName(m)}</Chip>
              </Link>
            ))}
          </>
        }
        actions={
          <>
            {bindingAcceptance(l) ? null : (
              <Link className="btn" href={`/proposals/new?type=loop&id=${encodeURIComponent(l.id)}`}>
                Propose a change
              </Link>
            )}
            <Link className="btn" href={withRev(`/records/loop/${l.id}`, rev)}>
              History & lineage
            </Link>
          </>
        }
      />
      <AcceptanceLock data={l} />
      {l.standing !== "reported" ? (
        <Notice tone="warn">
          This loop is recorded as a {l.standing === "design_intention" ? "design" : "recommendation"}. Nothing here says it has been built or tried
          with learners.
        </Notice>
      ) : null}
      {l.variant_of ? (
        <p className="small muted">
          Variant of <RecordLink ds={ds} id={l.variant_of} />
        </p>
      ) : null}

      <Card title="Against the shared progression" hint="This loop's own step names, placed where the source supports it">
        <div className="table-wrap">
          <div className="stage-track" style={{ minWidth: 900 }}>
            {STAGES.map((stage) => (
              <div key={stage} className={`stage${byStage.has(stage) ? " on" : ""}`}>
                <div className="k">{STAGE_LABEL[stage]}</div>
                <div className="v">{byStage.get(stage)?.join("; ") ?? <span className="faint">not part of this loop</span>}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="split">
        <div className="stack">
          <Card title="The loop, step by step" hint={`${steps.length} steps`} flush>
            {steps.length === 0 ? (
              <Empty>No steps are recorded for this loop.</Empty>
            ) : (
              <ol className="steps">
                {steps.map((step, i) => (
                  <li key={i}>
                    <div className="stack-sm" style={{ gap: 4 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <strong>{step.source_term}</strong>
                        {step.shared_stage !== "none" ? (
                          <Chip tone="accent">{STAGE_LABEL[step.shared_stage]}</Chip>
                        ) : (
                          <Chip tone="ghost">Not mapped</Chip>
                        )}
                        {step.module_id ? <span className="muted small">{ds.moduleName(step.module_id)}</span> : null}
                      </div>
                      {step.description ? <div className="small">{step.description}</div> : null}
                      <Citations ds={ds} citations={step.citations} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="What the loop is for">
            <dl className="facts">
              <dt>Educational objective</dt>
              <dd>
                <ClaimView ds={ds} claim={l.objective} />
              </dd>
              <dt>Musical concepts</dt>
              <dd>{l.concepts.length ? l.concepts.join(" · ") : <span className="muted small">Not stated.</span>}</dd>
              <dt>What the student actually does</dt>
              <dd>
                <ClaimView ds={ds} claim={l.student_does} />
              </dd>
              <dt>What HarmonyByrd observes</dt>
              <dd>
                <ClaimView ds={ds} claim={l.system_observes} />
              </dd>
              <dt>Feedback and scaffolding</dt>
              <dd>
                <ClaimView ds={ds} claim={l.feedback_scaffolding} />
              </dd>
              <dt>When retrieval or transfer occurs</dt>
              <dd>
                <ClaimView ds={ds} claim={l.retrieval_transfer} />
              </dd>
              <dt>Evidence that would show success</dt>
              <dd>
                <ClaimView ds={ds} claim={l.success_evidence} />
              </dd>
              <dt>Who decides musical correctness</dt>
              <dd>
                <ClaimView ds={ds} claim={l.assessment_authority} empty="Not stated in the source. HQ does not decide it." />
              </dd>
            </dl>
          </Card>
        </div>

        <div className="stack">
          <Card title="Modules contributing to the same capability" hint={others.size ? `${others.size} modules` : undefined} flush>
            {others.size === 0 ? (
              <Empty>No other module has a recovered loop step at the same stages.</Empty>
            ) : (
              <Fold
                items={[...others.entries()]
                  .sort(([a], [b]) => ds.moduleName(a).localeCompare(ds.moduleName(b)))
                  .map(([moduleId, stages]) => (
                    <li key={moduleId}>
                      <Link className="li-title" href={withRev(`/modules/${moduleId}`, rev)}>
                        {ds.moduleName(moduleId)}
                      </Link>
                      <div className="li-note">Also covers: {[...new Set(stages)].join(", ")}</div>
                    </li>
                  ))}
                limit={8}
                noun="modules"
                wrap={listWrap}
              />
            )}
          </Card>
          {variants.length ? (
            <Card title="Variants of this loop" flush>
              <Fold
                items={variants.map((v) => (
                  <li key={v.meta.id}>
                    <span>
                      <Link className="li-title" href={withRev(recordHref("loop", v.meta.id), rev)}>
                        {v.data.name}
                      </Link>{" "}
                      <IdTag id={v.meta.id} />
                    </span>
                  </li>
                ))}
                limit={6}
                noun="variants"
                wrap={listWrap}
              />
            </Card>
          ) : null}
          <Card title="Sources">
            <Citations ds={ds} citations={l.citations} label={`${l.citations.length} general quotations`} />
            {l.citations.length === 0 ? <p className="muted small">Quotations are attached to the individual statements and steps.</p> : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
