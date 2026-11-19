import type { Metadata } from "next";
import Link from "@/components/pin-link";
import { Card, Empty, Fold, IdTag, ListedChip, ListedText, Notice, PageHead, Pager, StatusChip } from "@/components/ui";
import type { Dataset } from "@/lib/domain/dataset";
import { incomingRefs } from "@/lib/domain/derive";
import { loadPage, paginate, param, type SearchParams } from "@/lib/server/page";
import { humanise, isoDate, plural, shortHash, statusLabel } from "@/lib/ui/format";
import { recordHref, withRev } from "@/lib/ui/links";

export const metadata: Metadata = { title: "Sources" };

type SourceRec = Dataset["sources"][number];

/** Loose fields some source records carry (not in the schema; present on the named-but-not-accessible register). */
function loose(s: SourceRec): { importance?: string; other_names?: string[]; identifiers?: string[] } {
  const d = s.data as { importance?: unknown; other_names?: unknown; identifiers?: unknown };
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : undefined);
  return {
    importance: typeof d.importance === "string" ? d.importance : undefined,
    other_names: strings(d.other_names),
    identifiers: strings(d.identifiers),
  };
}

/** Most consequential first. Unknown values sort after these, then records with no importance at all. */
const IMPORTANCE_ORDER = ["governing", "controlling_record", "decision_instrument", "input", "cited"];
const importanceRank = (v: string | undefined) => {
  if (!v) return IMPORTANCE_ORDER.length + 1;
  const i = IMPORTANCE_ORDER.indexOf(v);
  return i === -1 ? IMPORTANCE_ORDER.length : i;
};
const HELD_ACCESS = ["read_full", "read_partial", "inventoried_not_ingested"] as const;

export default async function SourcesPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx, rev, params } = await loadPage(searchParams);
  const { ds } = ctx;
  const access = param(params, "access") ?? "";
  const importance = param(params, "importance") ?? "";
  const rawQ = (param(params, "q") ?? "").trim();
  const q = rawQ.toLowerCase();
  // Two registers on one page: what HQ holds (read or inventoried) and what is only named somewhere.
  const list: "held" | "named" = access === "not_accessible" || (!access && param(params, "list") === "named") ? "named" : "held";

  const read = ds.sources.filter((s) => s.data.access === "read_full" || s.data.access === "read_partial");
  const missing = ds.sources.filter((s) => s.data.access === "not_accessible");
  const held = ds.sources.filter((s) => s.data.access !== "not_accessible");
  const gateItems = ds.openItems.filter((o) => o.data.kind === "source_gap" || /P00|P02/.test(o.data.title));
  const hqChecks = ds.evidence.filter((e) => e.data.type === "hq_check");
  const governing = missing.filter((s) => /governing|controlling|commission|named in the commission/i.test(`${s.data.authority_note} ${loose(s).importance ?? ""}`));
  const countAccess = (a: string) => ds.sources.filter((s) => s.data.access === a).length;

  const text = (s: SourceRec) => {
    const l = loose(s);
    return `${s.meta.id} ${s.data.title} ${s.data.summary} ${s.data.product_scope} ${s.data.authority_note} ${(l.other_names ?? []).join(" ")} ${(l.identifiers ?? []).join(" ")}`.toLowerCase();
  };

  let heldList = held;
  if (access && access !== "not_accessible") heldList = heldList.filter((s) => s.data.access === access);
  if (q) heldList = heldList.filter((s) => text(s).includes(q));
  heldList = [...heldList].sort(
    (a, b) => (b.data.doc_date ?? b.data.updated ?? "").localeCompare(a.data.doc_date ?? a.data.updated ?? "") || a.meta.id.localeCompare(b.meta.id),
  );

  const importanceCounts = new Map<string, number>();
  for (const s of missing) {
    const v = loose(s).importance ?? "";
    importanceCounts.set(v, (importanceCounts.get(v) ?? 0) + 1);
  }
  const importanceValues = [...importanceCounts.keys()].filter(Boolean).sort((a, b) => importanceRank(a) - importanceRank(b) || a.localeCompare(b));
  let namedList = missing;
  if (importance === "none") namedList = namedList.filter((s) => !loose(s).importance);
  else if (importance) namedList = namedList.filter((s) => loose(s).importance === importance);
  if (q) namedList = namedList.filter((s) => text(s).includes(q));
  namedList = [...namedList].sort((a, b) => importanceRank(loose(a).importance) - importanceRank(loose(b).importance) || a.meta.id.localeCompare(b.meta.id));

  const heldPage = paginate(heldList, params);
  const namedPage = paginate(namedList, params);
  const listHref = (l: "held" | "named") => withRev(l === "named" ? "/sources?list=named" : "/sources", rev);
  const filtered = list === "held" ? Boolean(q || (access && access !== "not_accessible")) : Boolean(q || importance);

  return (
    <div className="stack">
      <PageHead
        title="Source-access inventory"
        lede="Every document HQ knows of: what was actually read, where it lives, its version and checksum, and how much authority it carries. Documents that are named but could not be read are listed as gaps, not passed over."
      />

      <Card id="gate" title="Governance gate: HB-AI-P00 and HB-AI-P02" hint="Why HQ calls itself a non-authoritative prototype">
        <div className="stack-sm">
          <p>
            Commission HB-HQ-P02-R1 states that HB-AI-P00 is the prerequisite authority-fixture and reproducibility foundation, and that HQ must not imply
            that building it satisfies P00, P02 or any founder acceptance gate. HQ therefore reports its own standing from evidence only:
          </p>
          <ul className="plain">
            <li>
              <strong>{plural(read.length, "source")}</strong> could be read and quoted from; <strong>{plural(missing.length, "document")}</strong> named by
              them or by the commission could not.
            </li>
            <li>
              No record in HQ carries an acceptance of P00 or P02. Acceptance can only be recorded here by a founder decision (
              <Link href="/decisions">decision centre</Link>).
            </li>
            <li>Until that changes, every screen carries the prototype notice, and nothing here should be cited as a governing record.</li>
          </ul>
          {governing.length ? (
            <Notice tone="warn">
              {plural(governing.length, "governing or controlling document")} named in the sources could not be read, including{" "}
              {governing
                .slice(0, 4)
                .map((s) => s.data.title)
                .join("; ")}
              {governing.length > 4 ? "; …" : ""}. See <Link href={withRev("/sources?access=not_accessible", rev)}>the full list</Link>.
            </Notice>
          ) : null}
          {hqChecks.length ? (
            <div>
              <h3 style={{ margin: "6px 0" }}>Checks HQ ran itself</h3>
              <ul className="plain">
                {hqChecks.map((e) => (
                  <li key={e.meta.id}>
                    <Link href={withRev(recordHref("evidence", e.meta.id), rev)}>{e.data.title}</Link> <IdTag id={e.meta.id} /> —{" "}
                    <span className="small">{e.data.result.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {gateItems.length ? (
            <div>
              <h3 style={{ margin: "6px 0" }}>Open gate items ({gateItems.length})</h3>
              <Fold
                limit={6}
                noun="gate items"
                wrap={(children) => <ul className="plain">{children}</ul>}
                items={gateItems.map((o) => (
                  <li key={o.meta.id}>
                    <Link href={withRev(recordHref("open_item", o.meta.id), rev)}>{o.data.title}</Link> <IdTag id={o.meta.id} />{" "}
                    <ListedChip field="open_item.kind" value={o.data.kind} tone="warn" />
                  </li>
                ))}
              />
            </div>
          ) : null}
        </div>
      </Card>

      <div className="grid-auto">
        <Link className="tile ok" href={withRev("/sources?access=read_full", rev)}>
          <div className="n">{countAccess("read_full")}</div>
          <div className="t">Read in full</div>
          <div className="d">Retrieved, checksummed and quoted from</div>
        </Link>
        <Link className="tile warn" href={withRev("/sources?access=read_partial", rev)}>
          <div className="n">{countAccess("read_partial")}</div>
          <div className="t">Read in part</div>
          <div className="d">Large builds: text snapshot truncated</div>
        </Link>
        <Link className="tile" href={withRev("/sources?access=inventoried_not_ingested", rev)}>
          <div className="n">{countAccess("inventoried_not_ingested")}</div>
          <div className="t">Inventoried, not ingested</div>
          <div className="d">Accessible but outside HarmonyByrd scope</div>
        </Link>
        <Link className="tile bad" href={withRev("/sources?access=not_accessible", rev)}>
          <div className="n">{missing.length}</div>
          <div className="t">Named but not accessible</div>
          <div className="d">Referred to by sources or the commission</div>
        </Link>
      </div>

      <nav className="tabs" aria-label="Source registers">
        <Link href={listHref("held")} aria-current={list === "held" ? "page" : undefined}>
          Sources HQ holds <span className="muted">{held.length}</span>
        </Link>
        <Link href={listHref("named")} aria-current={list === "named" ? "page" : undefined}>
          Named, not accessible <span className="muted">{missing.length}</span>
        </Link>
      </nav>

      <form className="filters" method="get" action="/sources">
        {rev ? <input type="hidden" name="rev" value={rev} /> : null}
        {list === "named" ? <input type="hidden" name="list" value="named" /> : null}
        <label className="field" style={{ flex: "1 1 240px" }}>
          {list === "named" ? "Search named documents" : "Search sources"}
          <input type="search" name="q" defaultValue={rawQ} placeholder={list === "named" ? "Title, other name, id, identifier…" : "Title, id, scope…"} />
        </label>
        {list === "held" ? (
          <label className="field">
            Access
            <select name="access" defaultValue={access}>
              <option value="">Any</option>
              {HELD_ACCESS.map((a) => (
                <option key={a} value={a}>
                  {statusLabel(a)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="field">
            Importance
            <select name="importance" defaultValue={importance}>
              <option value="">Any importance</option>
              {importanceValues.map((v) => (
                <option key={v} value={v}>
                  {humanise(v)} ({importanceCounts.get(v)})
                </option>
              ))}
              {importanceCounts.get("") ? <option value="none">Not stated ({importanceCounts.get("")})</option> : null}
            </select>
          </label>
        )}
        <button className="btn" type="submit">
          Apply
        </button>
        {filtered ? (
          <Link className="btn" href={listHref(list)}>
            Clear
          </Link>
        ) : null}
      </form>

      {list === "held" ? (
        <Card
          title={`${heldList.length} of ${held.length} sources HQ holds`}
          hint="Read in full, read in part, or inventoried"
          flush
          foot={<Pager {...heldPage} params={params} basePath="/sources" noun="sources" />}
        >
          {heldList.length === 0 ? (
            <Empty>No source matches.</Empty>
          ) : (
            <>
              {heldPage.pages > 1 ? (
                <div className="pager-top">
                  <Pager {...heldPage} params={params} basePath="/sources" noun="sources" />
                </div>
              ) : null}
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Date</th>
                      <th>Access</th>
                      <th>Authority</th>
                      <th>Version</th>
                      <th>SHA-256</th>
                      <th className="num">Cited by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {heldPage.items.map((s) => (
                      <tr key={s.meta.id}>
                        <td className="title-cell" style={{ minWidth: 280 }}>
                          <Link href={withRev(recordHref("source", s.meta.id), rev)}>{s.data.title}</Link> <IdTag id={s.meta.id} />
                          <div className="muted xsmall">
                            <ListedText field="source.kind" value={s.data.kind} />
                          </div>
                        </td>
                        <td className="nowrap">{isoDate(s.data.doc_date ?? s.data.updated)}</td>
                        <td>
                          <StatusChip value={s.data.access} field="source.access" />
                        </td>
                        <td className="small">
                          <ListedText field="source.authority" value={s.data.authority} />
                        </td>
                        <td className="mono xsmall">{s.data.version ?? "—"}</td>
                        <td className="mono xsmall" title={s.data.sha256 ?? undefined}>
                          {shortHash(s.data.sha256, 14)}
                        </td>
                        <td className="num">{incomingRefs(ds, s.meta.id).length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      ) : (
        <Card
          title={`${namedList.length} of ${missing.length} documents named but not accessible`}
          hint="HQ could not read these; nothing in HQ rests on them"
          flush
          foot={<Pager {...namedPage} params={params} basePath="/sources" noun="named documents" />}
        >
          {namedList.length === 0 ? (
            <Empty>{missing.length === 0 ? "Every document named in the sources could be read." : "No named document matches."}</Empty>
          ) : (
            <>
              {namedPage.pages > 1 ? (
                <div className="pager-top">
                  <Pager {...namedPage} params={params} basePath="/sources" noun="named documents" />
                </div>
              ) : null}
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Importance</th>
                      <th>Access</th>
                      <th>Authority</th>
                      <th>Identifiers given</th>
                      <th className="num">Named in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {namedPage.items.map((s) => {
                      const l = loose(s);
                      return (
                        <tr key={s.meta.id}>
                          <td className="title-cell" style={{ minWidth: 280 }}>
                            <Link href={withRev(recordHref("source", s.meta.id), rev)}>{s.data.title}</Link> <IdTag id={s.meta.id} />
                            {l.other_names?.length ? <div className="muted xsmall clamp-2">Also called: {l.other_names.join("; ")}</div> : null}
                          </td>
                          <td className="small">{l.importance ? humanise(l.importance) : <span className="muted">Not stated</span>}</td>
                          <td>
                            <StatusChip value={s.data.access} field="source.access" />
                          </td>
                          <td className="small">
                          <ListedText field="source.authority" value={s.data.authority} />
                        </td>
                          <td className="mono xsmall" style={{ maxWidth: 260 }} title={l.identifiers?.join(" · ")}>
                            {l.identifiers?.length ? <span className="clamp-3 break">{l.identifiers.join(" · ")}</span> : <span className="muted">—</span>}
                          </td>
                          <td className="num">{s.data.named_in?.length ?? 0}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
