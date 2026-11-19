import type { Metadata } from "next";
import Link from "@/components/pin-link";
import { notFound } from "next/navigation";
import { DefectForm, ProposalForm } from "@/components/gov-forms";
import { AcceptanceLock, bindingAcceptance, Card, IdTag, isReportedAcceptance, Notice, PageHead, ReportedAcceptanceNotice } from "@/components/ui";
import { canPropose } from "@/lib/auth/principal";
import { recordTitle } from "@/lib/domain/derive";
import { isRecordType, RECORD_FIELDS, RECORD_TYPE_LABEL, type RecordType, STRUCTURED_FIELDS } from "@/lib/domain/schemas";
import { loadPage, param, type SearchParams } from "@/lib/server/page";
import { buildOnlyFieldsFor, frozenRecordProblem, PROPOSAL_PROTECTED_FIELDS, SOURCE_INTEGRITY_FIELDS } from "@/lib/server/services";
import { recordHref } from "@/lib/ui/links";
import { SUBMITTER_CLAIM_SENTENCE } from "@/lib/ui/proposal-review";

export const metadata: Metadata = { title: "New proposal" };

/** What an existing source says about the snapshot HQ read cannot be changed by proposal (mirrors the database). */

/** Fields a proposal may not set on this type: protected everywhere, written only by HQ's build, or a source's integrity facts. */
function lockedFields(type: RecordType): Set<string> {
  return new Set([...PROPOSAL_PROTECTED_FIELDS, ...buildOnlyFieldsFor(type), ...(type === "source" ? SOURCE_INTEGRITY_FIELDS : [])]);
}

/** H3: on a requirement already implemented and tested, a proposal cannot change these links. */
const TESTED_LINKS = ["linked_evidence_ids", "linked_build_ids"];


/**
 * The fields the form offers and how each is edited. Only fields the record type declares (ROUND4 H4: a
 * proposal may set no other), taken from the record schema, not from the record's current value, so an
 * empty structured field (a missing claim, say) is still edited and submitted as JSON (ui-6). A number or
 * true/false is sent as JSON too, and so is a stored value of the wrong kind (H6c), so it is shown as it is.
 */
function proposableFields(type: RecordType, data: Record<string, unknown>): { fields: string[]; kinds: Record<string, "text" | "json"> } {
  const locked = lockedFields(type);
  if (type === "requirement" && data.implementation_state === "implemented_tested") TESTED_LINKS.forEach((f) => locked.add(f));
  const structured = new Set(STRUCTURED_FIELDS[type]);
  const fields = RECORD_FIELDS[type].filter((k) => !locked.has(k)).sort();
  const kinds: Record<string, "text" | "json"> = {};
  for (const f of fields) {
    const v = data[f];
    kinds[f] = structured.has(f) || typeof v === "number" || typeof v === "boolean" || (v !== null && typeof v === "object") ? "json" : "text";
  }
  return { fields, kinds };
}

export default async function NewProposalPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal, ctx, stored, params } = await loadPage(searchParams, { pinnable: false });
  const { ds } = ctx;
  const mode = param(params, "mode") === "defect" ? "defect" : "change";
  const allowed = canPropose(principal);

  if (mode === "defect") {
    return (
      <div className="stack">
        <PageHead
          title="Report a defect"
          crumbs={[{ label: "Proposal inbox", href: "/proposals" }]}
          lede="A defect report goes to the inbox. If the founder files it, it becomes an open defect that stays visible until someone records its resolution."
        />
        {!allowed ? (
          <Notice tone="warn">The reader role cannot submit to the inbox.</Notice>
        ) : (
          <Card title="Defect report">
            <DefectForm modules={ds.modules.map((m) => ({ id: m.meta.id, name: m.data.name }))} preselected={param(params, "module") ?? ds.modules[0]?.meta.id ?? ""} />
          </Card>
        )}
      </div>
    );
  }

  const type = param(params, "type") ?? "";
  const id = param(params, "id") ?? "";
  if (!isRecordType(type)) notFound();
  const record = ds.get(type, id);
  if (!record) notFound();
  // H6c: the form is filled from the record AS STORED, never from the conformed view, so "Not a valid
  // value" and an element the view leaves out are never written back. The rules are checked on it too.
  const data = (stored.get(type, id)?.data ?? {}) as Record<string, unknown>;
  const frozen = frozenRecordProblem(type, data as never);
  const proposable = proposableFields(type, data);
  const locked = bindingAcceptance(data) !== null;
  // A build reported as accepted: the only proposal that can go through withdraws that acceptance, so
  // the form offers its standing only (G1a). A proposal sent another way with more fields set is
  // checked by the database the same way.
  const reported = isReportedAcceptance(type, data);
  const fields = reported ? proposable.fields.filter((f) => f === "standing") : proposable.fields;
  const kinds = proposable.kinds;

  return (
    <div className="stack">
      <PageHead
        title="Propose a change"
        crumbs={[{ label: "Proposal inbox", href: "/proposals" }]}
        lede={
          <>
            To <Link href={recordHref(type, id)}>{recordTitle(type, record.data)}</Link> <IdTag id={id} /> ({RECORD_TYPE_LABEL[type].toLowerCase()}, version{" "}
            {record.meta.version}).
          </>
        }
      />
      {type === "decision" ? (
        <Notice tone="warn">Decision records cannot be changed by proposal. They are written only by a founder decision.</Notice>
      ) : frozen ? (
        <Notice tone="warn">
          <strong>Proposals cannot change this record.</strong> {frozen.message}
        </Notice>
      ) : locked ? (
        <AcceptanceLock data={data} />
      ) : !allowed ? (
        <Notice tone="warn">The reader role cannot submit proposals.</Notice>
      ) : (
        <>
          {reported ? <ReportedAcceptanceNotice /> : null}
          <Notice tone="info">
            <span data-testid="submitter-claim-sentence">{SUBMITTER_CLAIM_SENTENCE}</span>
          </Notice>
          <div className="split">
            <Card title="Your proposal">
              <ProposalForm
                target={{ type, id, title: recordTitle(type, record.data), version: record.meta.version, data }}
                fields={fields}
                fieldKinds={kinds}
                headRev={ctx.head}
              />
            </Card>
            <Card title="What cannot be proposed">
              <ul className="plain small">
                <li>
                  <strong>Original wording and provenance</strong> of a founder requirement never change. A correction is a new requirement that supersedes the
                  old one.
                </li>
                <li>
                  <strong>A requirement&apos;s standing</strong> and <strong>acceptance</strong> change only by founder decision, in the decision centre.
                </li>
                <li>
                  <strong>Stale proposals are refused.</strong> This form is tied to version {record.meta.version}; if the record changes first, you will be asked
                  to re-read it.
                </li>
                <li>
                  <strong>A source&apos;s labels</strong> (reported, design intention, source recommendation, founder statement) are set only by an import.
                  An imported statement can be left as it is, removed, or replaced by your own claim.
                </li>
                {type === "requirement" && data.implementation_state === "implemented_tested" ? (
                  <li>
                    <strong>This requirement is recorded as implemented and tested</strong>, so its linked evidence and builds cannot be changed by
                    proposal.
                  </li>
                ) : null}
                {reported ? (
                  <li>
                    <strong>A build a source reports as accepted</strong> can only have that acceptance withdrawn by proposal: this form offers its standing only.
                  </li>
                ) : null}
                <li>
                  Fields a proposal cannot set on this record: <span className="mono xsmall break">{[...lockedFields(type)].sort().join(", ")}</span>
                </li>
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
