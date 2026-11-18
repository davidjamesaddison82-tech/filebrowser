import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DefectForm, ProposalForm } from "@/components/gov-forms";
import { Card, IdTag, Notice, PageHead } from "@/components/ui";
import { canPropose } from "@/lib/auth/principal";
import { recordTitle } from "@/lib/domain/derive";
import { isRecordType, PROTECTED_FIELDS, RECORD_TYPE_LABEL } from "@/lib/domain/schemas";
import { loadPage, param, type SearchParams } from "@/lib/server/page";
import { recordHref } from "@/lib/ui/links";

export const metadata: Metadata = { title: "New proposal" };

export default async function NewProposalPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal, ctx, params } = await loadPage(searchParams);
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
  const data = record.data as Record<string, unknown>;
  const fields = Object.keys(data)
    .filter((k) => !(PROTECTED_FIELDS as readonly string[]).includes(k))
    .sort();

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
      ) : !allowed ? (
        <Notice tone="warn">The reader role cannot submit proposals.</Notice>
      ) : (
        <div className="split">
          <Card title="Your proposal">
            <ProposalForm target={{ type, id, title: recordTitle(type, record.data), version: record.meta.version, data }} fields={fields} headRev={ctx.head} />
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
                Protected fields: <span className="mono xsmall">{PROTECTED_FIELDS.join(", ")}</span>
              </li>
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
