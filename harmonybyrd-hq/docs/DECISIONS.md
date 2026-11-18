# Engineering decisions

Decisions made while building HQ, with the reason for each. They are the builder's decisions and
are open to review; none of them is a founder ruling.

| # | Decision | Reason | Alternative set aside |
| --- | --- | --- | --- |
| 1 | Build HQ as an isolated, non-authoritative prototype | The commission makes HB-AI-P00 the prerequisite and says what to do if its acceptance cannot be verified. It could not be verified | Treating HQ as authoritative; stopping until P00 is found |
| 2 | Keep the commission's preferred stack | Nothing in the evidence gave a reason to change it | — |
| 3 | Run on plain PostgreSQL, following Supabase conventions | No Supabase credentials. The same migrations, roles, claims and row-level security are intended to run on Supabase unchanged; that is untested | Mocking the database; an embedded database that lacks row-level security |
| 4 | Store records as versioned JSON documents in one append-only table, validated by typed schemas | Twelve record types with nested, cited claims; history, pinning and hashing become uniform; schema changes do not rewrite history | One relational table per type with history tables |
| 5 | A dataset revision for every write, with a content hash | Gives pinned reads, stale-write detection and a tamper-evident history from one mechanism | Per-record versions only |
| 6 | Enforce governance in the database (triggers, definer functions, row-level security) | A rule that lives only in application code is bypassed by the next client. The tests go round the application to prove the database refuses | Checks in the API layer only |
| 7 | The application's database role owns nothing | Limits the damage of an application bug | Connecting as the owner |
| 8 | Every fact is a claim with an epistemic label and verbatim citations; the importer verifies each quotation | It is the only mechanical guard against manufactured records | Free-text notes with links |
| 9 | Twelve independent lifecycle dimensions; no completion percentage | The commission requires it, and a single number would hide exactly the distinctions that matter | A status enum |
| 10 | “Accepted” in HQ exists only as the effect of a founder decision; acceptance reported by a document is shown separately | So that neither a document nor an agent can make HQ call something accepted | A status field anyone with write access could set |
| 11 | No approval tool, and no token for the founder | Founder authority cannot then be exercised by a script or an assistant, even by mistake | A privileged “admin” token |
| 12 | One tool registry behind both REST and MCP | The two interfaces cannot drift apart | Separate handlers |
| 13 | Stateless MCP over Streamable HTTP with JSON responses | Simplest correct server for request/response tools; no session state to secure | Stateful sessions with server-sent events |
| 14 | Static bearer tokens now; OAuth 2.1 recommended as its own commission | Tokens are enough for a local prototype and for clients that accept a header. OAuth is a security-sensitive feature that deserves its own review and is only needed once a deployment is authorised | Implementing OAuth in this commission |
| 15 | Own passphrase sign-in rather than Supabase Auth | No Supabase project. The session token uses the same claim shape, so moving to Supabase Auth is a contained change | Blocking on Supabase |
| 16 | Read-only GitHub and Drive adapters that return failure values | The commission authorises preparation, not broader writes; an unavailable service must never break a page or be papered over | Write-capable integrations |
| 17 | Evidence packs as files, built outside the application | Reading documents and turning them into cited records needs judgement and an audit trail; the application's job is to verify and hold the result | An upload-and-parse screen |
| 18 | Keep the real evidence pack and source snapshots out of the repository | The working repository is public. The founder's documents are private and were not authorised for publication | Committing the pack |
| 19 | Three accessible artefacts of a different product inventoried but not ingested | They do not describe HarmonyByrd | Mixing them into the HarmonyByrd atlas |
| 20 | Merge records only where identity is certain; otherwise cross-reference | Two documents' mentions of one build or decision should be one record, but a wrong merge would manufacture a fact | Merging by similar name |
| 21 | When two documents disagree about a module's state, show the more cautious reading and list the other | Never upgrade a status on the strength of the more optimistic source | Taking the latest, or the owner's |
| 22 | Server-rendered pages with native disclosure elements and links; almost no client-side code | Fast, works without JavaScript for reading, nothing floating over content | A client-side single-page application |
| 23 | Paging and folding for long registers | With real volumes (hundreds of items) an unpaged list is unusable; folding hides nothing permanently and always states the count | Infinite scroll |
