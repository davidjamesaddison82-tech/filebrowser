import type { Metadata } from "next";
import Link from "@/components/pin-link";
import { Card, Chip, Empty, IdTag, Notice, PageHead, StatusChip } from "@/components/ui";
import { isFounderSession } from "@/lib/auth/principal";
import { loadPage, param, type SearchParams } from "@/lib/server/page";
import { listProposals } from "@/lib/server/services";
import { humanise, isoDateTime, statusLabel } from "@/lib/ui/format";

export const metadata: Metadata = { title: "Proposal inbox" };

const STATUSES = ["submitted", "accepted", "rejected", "needs_changes", "marked_stale", "withdrawn"];

export default async function ProposalsPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal, params } = await loadPage(searchParams, { pinnable: false });
  const status = param(params, "status") ?? "";
  const all = await listProposals(principal);
  const proposals = status ? all.filter((p) => p.status === status) : all;
  const founder = isFounderSession(principal);

  return (
    <div className="stack">
      <PageHead
        title="Proposal inbox"
        lede="Where proposed changes, defect reports and submitted test evidence wait. Nothing in the inbox is a record: a proposal changes nothing and carries no authority until the founder reviews it."
        actions={
          principal.appRole !== "reader" ? (
            <Link className="btn" href="/proposals/new?mode=defect">
              Report a defect
            </Link>
          ) : null
        }
      />
      <Notice tone="info">
        {founder
          ? "You see every proposal from every person and AI client."
          : "You see only the proposals you submitted. The inbox is isolated per submitter: one client cannot read another's proposals."}{" "}
        To propose a change to a record, open the record and choose “Propose a change”.
      </Notice>

      <nav className="tabs" aria-label="Proposal status">
        <Link href="/proposals" aria-current={!status ? "page" : undefined}>
          All <span className="muted">{all.length}</span>
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/proposals?status=${s}`} aria-current={status === s ? "page" : undefined}>
            {statusLabel(s)} <span className="muted">{all.filter((p) => p.status === s).length}</span>
          </Link>
        ))}
      </nav>

      <Card title={`${proposals.length} ${proposals.length === 1 ? "proposal" : "proposals"}`} flush>
        {proposals.length === 0 ? (
          <Empty>No proposal here.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Proposal</th>
                  <th>Kind</th>
                  <th>Target</th>
                  <th>Submitted by</th>
                  <th>When</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => (
                  <tr key={p.id}>
                    <td className="title-cell" style={{ minWidth: 260 }}>
                      <Link href={`/proposals/${p.id}`}>{p.title}</Link> <IdTag id={p.id} />
                    </td>
                    <td className="small">{humanise(p.kind)}</td>
                    <td className="small">{p.target_id ? `${p.target_id} v${p.base_version}` : <span className="muted">new record</span>}</td>
                    <td>
                      <Chip tone={p.submitted_by_kind === "ai_client" ? "warn" : "outline"}>
                        {p.submitted_by_kind === "ai_client" ? "AI client" : humanise(p.submitted_by_role)}: {p.submitted_by}
                      </Chip>
                    </td>
                    <td className="small nowrap">{isoDateTime(p.submitted_at)}</td>
                    <td>
                      <StatusChip value={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
