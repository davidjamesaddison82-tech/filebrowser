import type { Metadata } from "next";
import { CredentialForm, RevokeButton } from "@/components/gov-forms";
import { Card, Chip, Empty, IdTag, Notice, PageHead, StatusChip } from "@/components/ui";
import { isFounderSession } from "@/lib/auth/principal";
import { loadPage, type SearchParams } from "@/lib/server/page";
import { type AuditEntry, type CredentialView, listAudit, listCredentials } from "@/lib/server/services";
import { describeTools, FOUNDER_ONLY_OPERATIONS } from "@/lib/server/tools";
import { connectionRoutes, STATUS_LABEL } from "@/lib/ui/connection-guide";
import { isoDateTime } from "@/lib/ui/format";

export const metadata: Metadata = { title: "AI & API access" };

const STATUS_TONE = { tested_here: "ok", untested: "warn", blocked: "bad" } as const;

export default async function AccessPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal, ctx } = await loadPage(searchParams, { pinnable: false });
  const founder = isFounderSession(principal);
  const baseUrl = (process.env.HQ_BASE_URL ?? "http://localhost:3210").replace(/\/+$/, "");
  const tools = describeTools();
  const routes = connectionRoutes(baseUrl);
  let credentials: CredentialView[] = [];
  let audit: AuditEntry[] = [];
  if (founder) {
    credentials = await listCredentials(principal);
    audit = await listAudit(principal, { limit: 40 });
  }
  const clients = [...new Set(routes.map((r) => r.client))];

  return (
    <div className="stack">
      <PageHead
        title="AI and API access"
        lede="One information service for every client. Claude, ChatGPT and any script call the same functions, see the same records at the same revision, and are bound by the same rules — without relying on anyone's conversation memory."
      />

      <div className="grid-3">
        <Card title="Same answers">
          <p className="small">
            Every answer names the dataset revision it came from (currently revision {ctx.head}) and its hash. Two clients that pin the same revision receive
            identical records, later changes notwithstanding.
          </p>
        </Card>
        <Card title="Separate identities">
          <p className="small">
            Each client has its own token and its own entry in the audit log. One client cannot read another&apos;s proposals. Tokens are stored only as a
            SHA-256.
          </p>
        </Card>
        <Card title="Propose, never approve">
          <p className="small">
            Clients can read, and — with the propose scope — submit proposals, defect reports and test evidence to an isolated inbox. No token of any kind can
            review, accept or decide.
          </p>
        </Card>
      </div>

      <Card title="Connecting each client" hint="What is documented, what was actually tested, and what is blocked">
        <div className="stack">
          <Notice tone="warn">
            Neither the Claude application nor ChatGPT has been connected to HQ. What has been tested is the protocol itself, with an independent MCP client.
            The routes below marked “blocked” need a public HTTPS deployment, which this commission does not authorise; ChatGPT additionally needs OAuth, which
            HQ does not implement yet.
          </Notice>
          {clients.map((client) => (
            <div key={client} className="stack-sm">
              <h3>{client}</h3>
              {routes
                .filter((r) => r.client === client)
                .map((r) => (
                  <div key={r.route} className="card" style={{ boxShadow: "none" }}>
                    <div className="card-body stack-sm">
                      <div className="row" style={{ gap: 8 }}>
                        <strong>{r.route}</strong>
                        <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>
                      </div>
                      <p className="small">{r.statusNote}</p>
                      <ul className="plain small">
                        {r.how.map((h, i) => (
                          <li key={i} className="break">
                            {h}
                          </li>
                        ))}
                      </ul>
                      {r.example ? <pre className="json">{r.example}</pre> : null}
                      <p className="small muted">Needs: {r.requires.join(" ")}</p>
                      <p className="xsmall muted">
                        Source:{" "}
                        {r.sources.map((s, i) => (
                          <span key={s.label}>
                            {i ? " · " : ""}
                            {s.url ? (
                              <a href={s.url} target="_blank" rel="noreferrer noopener">
                                {s.label}
                              </a>
                            ) : (
                              s.label
                            )}
                          </span>
                        ))}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </Card>

      <Card title={`${tools.length} tools`} hint="Identical over MCP (/api/mcp) and REST (/api/v1/tools/<name>)" flush>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Tool</th>
                <th>What it does</th>
                <th>Kind</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.name}>
                  <td className="mono small nowrap">{t.name}</td>
                  <td className="small">{t.description}</td>
                  <td>
                    <Chip tone={t.mode === "read" ? "ok" : "info"}>{t.mode === "read" ? "Read only" : "Adds to inbox"}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-foot">
          Deliberately not available as tools: {FOUNDER_ONLY_OPERATIONS.join("; ")}. These exist only in the founder&apos;s own signed-in session.
        </div>
      </Card>

      {founder ? (
        <>
          <div className="split">
            <Card title="Issue an API token" hint="Shown once; only its SHA-256 is kept">
              <CredentialForm />
            </Card>
            <Card title="Clients and tokens" hint={`${credentials.filter((c) => !c.revoked_at).length} live`} flush>
              {credentials.length === 0 ? (
                <Empty>No API token has been issued.</Empty>
              ) : (
                <ul className="list">
                  {credentials.map((c) => (
                    <li key={c.credential_id}>
                      <div className="row-between">
                        <div className="row" style={{ gap: 8 }}>
                          <strong>{c.display_name}</strong>
                          <IdTag id={c.handle} />
                          {c.revoked_at ? <Chip tone="ghost">Revoked</Chip> : c.expires_at && c.expires_at < new Date().toISOString() ? <Chip tone="ghost">Expired</Chip> : <Chip tone="ok">Live</Chip>}
                        </div>
                        {!c.revoked_at ? <RevokeButton credentialId={c.credential_id} /> : null}
                      </div>
                      <div className="li-note">
                        {c.label} · <span className="mono xsmall">{c.token_prefix}…</span> · scopes: {c.scopes.join(", ")} · issued {isoDateTime(c.created_at)}
                        {c.expires_at ? ` · expires ${isoDateTime(c.expires_at)}` : ""} · last used {c.last_used_at ? isoDateTime(c.last_used_at) : "never"}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Audit log" hint="Most recent 40 events — every denial is recorded" flush>
            {audit.length === 0 ? (
              <Empty>Nothing has been logged yet.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Who</th>
                      <th>Action</th>
                      <th>On</th>
                      <th>Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((a) => (
                      <tr key={a.id}>
                        <td className="small nowrap">{isoDateTime(a.at)}</td>
                        <td className="small">
                          {a.principal_handle ?? <span className="muted">unauthenticated</span>}
                          {a.app_role ? <span className="muted xsmall"> ({a.app_role})</span> : null}
                        </td>
                        <td className="mono xsmall">{a.action}</td>
                        <td className="mono xsmall">{a.object_id ?? "—"}</td>
                        <td>
                          <StatusChip value={a.outcome === "allowed" ? "accepted" : a.outcome === "denied" ? "rejected" : "open"} label={a.outcome} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : (
        <Notice tone="info">Issuing and revoking tokens, and reading the audit log, are available to the founder only.</Notice>
      )}
    </div>
  );
}
