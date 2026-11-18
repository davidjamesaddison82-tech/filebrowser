import Link from "next/link";
import type { ReactNode } from "react";
import { Nav, type NavGroup } from "@/components/nav";
import { requireSession } from "@/lib/auth/current";
import { ROLE_LABEL } from "@/lib/auth/principal";
import { developmentHealth, reviewItems } from "@/lib/domain/derive";
import { HqError } from "@/lib/server/errors";
import { listProposals } from "@/lib/server/services";
import { getDataset } from "@/lib/server/store";
import { signOut } from "../sign-in/actions";

export const dynamic = "force-dynamic";

export default async function HqLayout({ children }: { children: ReactNode }) {
  const principal = await requireSession();

  let problem: { title: string; detail: string } | null = null;
  let groups: NavGroup[] = [];
  let fixture = false;
  let headRev = 0;
  try {
    const ctx = await getDataset(principal);
    const health = developmentHealth(ctx.ds);
    const waiting = (await listProposals(principal)).filter((p) => p.status === "submitted").length;
    fixture = ctx.ds.sources.some((s) => s.data.kind === "fixture");
    headRev = ctx.head;
    groups = [
      { label: "Overview", items: [{ href: "/", label: "Dashboard" }] },
      {
        label: "Atlas",
        items: [
          { href: "/modules", label: "Modules", count: ctx.ds.modules.length },
          { href: "/loops", label: "Learning loops", count: ctx.ds.loops.length },
        ],
      },
      {
        label: "Registers",
        items: [
          { href: "/requirements", label: "Founder requirements", count: ctx.ds.requirements.length },
          { href: "/evidence", label: "Development & evidence" },
          { href: "/sources", label: "Sources", count: ctx.ds.sources.length },
        ],
      },
      {
        label: "Governance",
        items: [
          { href: "/decisions", label: "Decision centre", count: health.pending_founder_decisions.length + waiting, alert: true },
          { href: "/proposals", label: "Proposal inbox", count: waiting, alert: true },
          { href: "/review", label: "Review items", count: reviewItems(ctx.ds).length },
          { href: "/changes", label: "Changes" },
        ],
      },
      { label: "Access", items: [{ href: "/access", label: "AI & API access" }] },
    ];
  } catch (error) {
    const e = error instanceof HqError ? error : null;
    problem =
      e?.code === "no_dataset"
        ? { title: "No evidence pack has been imported yet", detail: "Run `npm run db:seed` (or `npm run setup`) in the harmonybyrd-hq folder, then reload this page." }
        : e?.status === 503
          ? { title: "HQ cannot reach its database", detail: `${e.message} Records are safe; start the database and reload. Nothing is shown from memory while it is unavailable.` }
          : { title: "HQ could not load its records", detail: e?.message ?? "Unexpected error. See the server log." };
  }

  const footer = (
    <div className="nav-foot">
      <div>
        <strong>{principal.displayName}</strong>
        <div className="muted xsmall">
          {ROLE_LABEL[principal.appRole]} · signed in
        </div>
      </div>
      {headRev ? <div className="muted xsmall">Dataset revision {headRev}</div> : null}
      <form action={signOut}>
        <button className="btn small" type="submit">
          Sign out
        </button>
      </form>
    </div>
  );

  const search = (
    <form action="/search" method="get" role="search">
      <label className="sr-only" htmlFor="hq-search">
        Search HQ
      </label>
      <input id="hq-search" type="search" name="q" placeholder="Search records…" />
    </form>
  );

  return (
    <div className="shell">
      <Nav groups={groups} footer={footer} search={search} />
      <div className="main">
        <div className="authority" role="note">
          <strong>PROTOTYPE — NOT AN AUTHORITATIVE RECORD</strong>
          <span>
            Acceptance of the HB-AI-P00 prerequisite could not be verified from accessible evidence.{" "}
            <Link href="/sources#gate">See the governance gate</Link>.
          </span>
          {fixture ? <strong>· SYNTHETIC FIXTURE DATA LOADED — these are not HarmonyByrd records</strong> : null}
        </div>
        <main className="content" id="main">
          {problem ? (
            <section className="card" role="alert">
              <div className="card-body stack-sm">
                <h1>{problem.title}</h1>
                <p className="muted">{problem.detail}</p>
              </div>
            </section>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
