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
| 15 | Own passphrase sign-in rather than Supabase Auth | No Supabase project. The session token uses the same core claims (`sub`, `role`), so moving to Supabase Auth is a contained change; since the review it also carries HQ's issuer and a session epoch, which Supabase tokens do not | Blocking on Supabase |
| 16 | Read-only GitHub and Drive adapters that return failure values | The commission authorises preparation, not broader writes; an unavailable service must never break a page or be papered over | Write-capable integrations |
| 17 | Evidence packs as files, built outside the application | Reading documents and turning them into cited records needs judgement and an audit trail; the application's job is to verify and hold the result | An upload-and-parse screen |
| 18 | Keep the real evidence pack and source snapshots out of the repository | The working repository is public. The founder's documents are private and were not authorised for publication | Committing the pack |
| 19 | Three accessible artefacts of a different product inventoried but not ingested | They do not describe HarmonyByrd | Mixing them into the HarmonyByrd atlas |
| 20 | Merge records only where identity is certain; otherwise cross-reference | Two documents' mentions of one build or decision should be one record, but a wrong merge would manufacture a fact | Merging by similar name |
| 21 | When two documents disagree about a module's state, show the more cautious reading and list the other | Never upgrade a status on the strength of the more optimistic source | Taking the latest, or the owner's |
| 22 | Server-rendered pages with native disclosure elements and links; almost no client-side code | Fast, works without JavaScript for reading, nothing floating over content | A client-side single-page application |
| 23 | Paging and folding for long registers | With real volumes (hundreds of items) an unpaged list is unusable; folding hides nothing permanently and always states the count | Infinite scroll |

## Decisions made when fixing the adversarial review's findings

Numbers 24 to 41 correspond to design decisions D1 to D18 of the fix stages; docs/REVIEW-FINDINGS.md
lists the findings each one answers.

| # | Decision | Reason | Alternative set aside |
| --- | --- | --- | --- |
| 24 | A proposal cannot assert what HQ did not check: its quotations are verified against source texts stored at import, HQ's own labels are refused, source labels need citations, and HQ-written fields are protected — at submission and again at acceptance (D1) | The inbox is where claims enter; a founder accepting in good faith must not turn a submitter's words into "verified" text | Trusting the founder's review to catch it |
| 25 | A record carrying a founder acceptance or rejection cannot be changed by proposal; the decision stores the version it accepted (D2) | An acceptance binds to what was accepted, not to whatever the record later becomes | Carrying the acceptance over; marking it stale |
| 26 | The write context is an owner-only table keyed by transaction, not a session setting, and versions go only into the open, latest revision (D3) | Any role that could set the setting could forge a founder act | Checking the setting more carefully |
| 27 | Revision seals form a chain, and the latest seal is shown so the founder can keep a copy outside HQ (D4) | The database owner can rewrite history and seals together; only an outside copy shows it | Claiming the history is "verified" |
| 28 | API roles cannot write the audit log directly; the application writes refusals through narrow wrappers, in their own transaction (D5) | A free-form writer let any token forge audit rows, and refusals inside the database roll their own record back | Auditing inside each refusing function (it cannot persist); a loopback connection (adds an extension and a credential) |
| 29 | Proposal events follow a fixed order enforced by a trigger, and withdraw takes the same lock as review (D6) | Withdraw and accept could both succeed | Relying on the application to serialise them |
| 30 | Sessions carry an epoch; signing out or a new passphrase increments it (D7) | Sign-out only deleted the cookie, so a copied cookie stayed valid for twelve hours | A list of revoked tokens |
| 31 | Sign-in is delayed per name, never locked, and `X-Forwarded-For` is ignored unless a trusted proxy is declared (D8) | Keying on a client-supplied header let a guesser bypass the limit and let anyone lock the founder out | A hard lock-out per name and address (the queue this kept was replaced by 46) |
| 32 | Every JSON body is capped; each MCP batch message is answered on its own; query values are converted only as each tool declares (D9) | An unbounded body, one bad batch element or guessed types should not break other requests | Per-route limits |
| 33 | Setup makes the secret-bearing files owner-only on every run (D10) | A file copied by hand was readable by everyone on the machine | Only setting permissions when setup creates the file |
| 34 | Quotations need at least twelve characters and exact wording at least eight non-space characters after normalising; ids of the form `XX-HQ-n` are reserved; the import records which pack it was (D11) | A quotation of spaces matched any source; a pack could take ids HQ issues | Changing the normalisation itself |
| 35 | Derived figures count only what a source supports or HQ's build checked; a rejection in HQ has its own standing; dates never break a page; inbox-origin records count as unverified (D12) | Several figures could be raised by an uncited claim or hide a rejection | Leaving the figures and adding warnings |
| 36 | A founder decision may name only records that exist (D13) | A decision resolving a misspelt id would look complete and resolve nothing | Accepting free text |
| 37 | A pinned screen keeps the pin on every link and shows a bar; screens that act on the present always show the latest and say so (D14) | Pinned pages mixed in the latest data and links silently left the pin | Pinning every screen, including the decision forms |
| 38 | Fields only HQ's build writes are declared with exact types and cannot be proposed (D15) | Loose values crashed screens and could be set by proposal | Leaving them undeclared |
| 39 | Screens render declared fields through type guards; a refused review in a second tab says why; bad addresses give 404 or 400, not 500 (D16) | A robust screen must not crash or stay silent on odd input | Error pages only |
| 40 | Every tool returns the envelope and refuses arguments it does not take; live look-ups need a signed-in person, and Drive look-ups a listed file id (D17) | A silently ignored `rev` gave head data to a client that asked for a pinned revision; any token could make HQ query the founder's Drive | Documenting the exceptions only |
| 41 | Setup fills placeholders in an existing `.env.local`, and the application refuses to start with a placeholder or short secret (D18) | The published placeholder could become the database password, and a short secret broke every sign-in | Telling people to replace them by hand |

## Decisions made after the re-verification

Every original attack was re-run against the fixes. Numbers 42 to 53 correspond to the follow-up
decisions F1 to F12; docs/REVIEW-FINDINGS.md lists the findings each one answers.

| # | Decision | Reason | Alternative set aside |
| --- | --- | --- | --- |
| 42 | A proposal can never introduce a claim of acceptance: a build standing `accepted_reported`, a module `founder_accepted` of `yes` or `partial`, or a `founder_accepted` field is refused (HQ403), at submission and again at acceptance; a build marked as accepted without a quoted report is shown as “Acceptance claimed — no source quoted” (F1) | A verbatim quotation proves the words are in a source, not that they report an acceptance | Requiring a citation for the claim |
| 43 | Only founder-acceptance evidence for that build, or an issued HQ decision whose `set_acceptance` accepts it, counts as an acceptance instrument (F2) | A decision about the module, a decision a source reports, or a link the build carries could silence the review item, and a proposal can set links | Counting any decision linked to the build or its module (the cautious rule lists more builds for review) |
| 44 | `service_role` may execute only the read helpers; EXECUTE is revoked from the catalogue, and a test reads the catalogue so that a later function cannot be left open (F3) | It could call the founder functions with forged claims | Revoking function by function; changing the database's default privileges, which would reach beyond HQ's schema |
| 45 | `hq.log_access` accepts only the action families the application logs as allowed; founder acts are logged only by the functions that perform them; new audit details are capped at 16,384 bytes (F4) | Any signed-in caller could write an allowed row for a founder act it never performed | Checking the caller's role in the wrapper |
| 46 | Sign-in attempts no longer queue: each waits on its own, work in progress is bounded, and a browser that has signed in before gets its own lane through a device cookie that authenticates nothing; device lanes are limited per person, never across people (F5) | The queue let open wrong attempts hold the right passphrase back for minutes | A lock-out; keying on the client's address; one limit shared by all device lanes, which any account holder could fill |
| 47 | The request id is always the server's; a client's well-formed id is kept apart as `x-client-request-id` and `detail.client_request_id` (F6) | A client could give its request the id of another request in the audit log | Keeping the client's id when well formed |
| 48 | A record carrying a founder rejection is called a rejection in the refusal message (F7) | The message said “acceptance” for a rejected record | Leaving the wording |
| 49 | A pack's `hq_verified` evidence and `verified` claims are taken as recorded; this is documented, not re-checked (F8) | The import can re-verify quotations, not the checks a builder ran | Re-running checks at import (out of scope) |
| 50 | The founder's review screen lists the sources a proposed record cites, with whether HQ holds their text, and calls out any change to a record's standing fields (F9) | A create proposal showed “No source is recorded for the target” | Showing only the target's sources |
| 51 | Chip labels wrap inside their box, and sideways scroll is measured against the layout viewport (F10) | A long label ran past a phone screen, and the phone test could not see it | Shortening the label only |
| 52 | The covering detector also checks what is drawn at points over text, so shifted blocks and pseudo-element overlays are found (F11) | It checked only positioned elements and what lies over the main content | Screenshot comparison |
| 53 | A unit test pins the session lifetime at exactly twelve hours (F12) | The old test compared the lifetime with the constant that sets it | Trusting the constant |
