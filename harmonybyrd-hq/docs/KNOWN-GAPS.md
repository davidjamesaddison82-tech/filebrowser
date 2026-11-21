# Known gaps, blocked integrations and limits

Nothing here is hidden elsewhere. docs/TEST-RESULTS.md is a generated report of one run, made on the
commit it names; it is not a report on later code. Assume nothing is proven that a test named in
docs/TESTING.md does not show.

## Standing

| | |
| --- | --- |
| HQ is not authoritative | The prerequisite HB-AI-P00 could not be shown to be completed or accepted. HQ says so on every screen and in every API answer |
| HQ is not accepted | No founder acceptance of HQ exists. Building it satisfies no gate |
| HQ is not deployed | It runs on a local machine only. A deployment package (deploy/, docs/HOSTING.md) is prepared and rehearsed locally, but nothing is installed on a server; its installer and release script have not been run on a real Ubuntu server yet |

## Sources HQ could not read

- The governing documents the commission names (the blueprint, the prerequisite and HQ commission
  specifications, the module atlas, the recent founder directions, the migration register and the
  acceptance documents) were not found in the material available to the build: the shared documents,
  the connected Drive and the reachable repositories. They are listed one by one in the application
  under *Sources* and in the private findings report.
- The connected Google Drive returned no files; listing shared drives was refused.
- No HarmonyByrd code repository was reachable, so no build in HQ is tied to a code revision.
- The real evidence pack therefore rests on working documents (reports, briefs, test sheets, design
  packages and a few runnable candidates). The module atlas and learning loops in it are a
  reconstruction and may differ from the governing Atlas in number, names and scope.
- Several hundred further documents are named by those sources but were not accessible. HQ lists each one as “named, not accessible”.
- Three large runnable builds were read only in part (the first 400,000 characters of their embedded script). None was executed.

The precise inventory — every source, what was read, checksums, and every document that is only
named — is in the application under *Sources*, and in the private findings report delivered with the evidence pack.

## Integrations

| Integration | State | What is missing |
| --- | --- | --- |
| Claude (any application) | **Not connected** | Claude Code route untested; claude.ai/Desktop and the API need a public HTTPS deployment |
| ChatGPT application | **Blocked** | OAuth 2.1 in HQ, and a public HTTPS deployment |
| OpenAI Agents SDK / Responses API | Untested / blocked | See docs/CONNECTING-AI-CLIENTS.md |
| GitHub | Adapter built; **not configured** | A token and the names of the real repositories. Tested only with injected responses; no network was used in tests |
| Google Drive | Adapter built; **not configured** | An access token with read access to the governing documents, and their file ids in `HQ_GOOGLE_DRIVE_FILE_IDS`. Tested only with injected responses and a stand-in server on the local machine |
| Supabase | **Not created** | The schema follows Supabase conventions and runs on plain PostgreSQL 16. No Supabase project exists; Supabase Auth is not wired in (HQ has its own sign-in, and accepts only session tokens it issued itself). `service_role` can only read the schema, so imports must use the owner connection |
| Docker Compose | **Untested** | `docker-compose.yml` is provided; Docker was not available in the build environment |

## Functional limits

- **No OAuth.** Clients use static bearer tokens.
- **The per-token rate limit is in memory.** It resets when HQ restarts and is per process; one process is all the deployment design runs.
- **No editing in place, by design.** Records change only through proposals the founder accepts, founder decisions, or a new import.
- **Search** is a simple all-words match over record text. No ranking, stemming or fuzzy matching.
- **Importing new documents is a build step,** not a screen. Turning a document into cited records
  was done by an extraction-and-audit process during this commission, outside the application. HQ
  verifies and imports the result; it does not read documents itself.
- **The ecosystem map** is laid out automatically by family. It is not a hand-drawn architecture diagram.
- **“Not mentioned in recent sources”** uses the dates of the documents HQ read. It can only be as recent as those documents.
- **One founder.** The model assumes a single founder identity. Delegated or shared founder authority is not modelled.
- **Runnable builds are not executed.** HQ records what documents report about builds, and the checksums of the few builds it holds. It did not run or test any HarmonyByrd module.
- **Requirement dispositions are all “unreviewed”** until the founder reviews them in HQ.
- **Accessibility** was considered (semantic headings, labels, keyboard reachability, contrast) but not audited with assistive technology.
- **Browsers:** automated tests use Chromium only.
- **Scale:** exercised with about 1,600 records. No load test.

## Limits the adversarial review showed, not fixed

The review's 71 findings and what was done about each are in docs/REVIEW-FINDINGS.md. These limits
remain, by design or because fixing them was out of scope:

- **The database owner or a superuser can bypass every rule** — disable triggers, rewrite rows, seals
  and the seal chain together. `verify_chain` then still reports nothing. Only a copy of the latest
  seal kept outside HQ shows the rewrite, and HQ has no screen that shows the stored seal of an
  earlier revision (it takes SQL to compare an older copy). The seals of revisions that existed before
  migration 0006 were computed when it ran, so they vouch for history only from then on.
- **Refusals inside the database leave no audit record.** The application records refusals itself;
  a caller that goes round it (for example straight to the database) is refused without a trace. If
  writing an audit entry fails, the entry is lost and the request is answered anyway.
- **A direct caller can still write some audit rows that did not happen.** The audit wrappers are
  granted to the API roles, because the application writes through them. `hq.log_access` now accepts
  only the exact actions the application logs as allowed (docs/SECURITY.md), so no one can record as
  allowed a founder act, a proposal, or any name outside that list, however it is spelt. But someone who reaches
  the database directly with a valid identity can still record, under their own name, that they used
  one of those exact actions when they did not: `api.index`, `api.whoami`, `tools.list`,
  `integrations.read`, `proposal.read`, `tool.<name>` or `mcp.<name>` for any of the 18 tools — a tool
  their role or token may not call included, such as `tool.submit_change_proposal` by a reader — with
  any object; and `session.sign_in`, `session.sign_out` or `session.end_all` naming no one or
  themselves. `hq.log_refusal` stays open, because a refusal names what was attempted: anyone who
  reaches the database, anonymous included, can record a refusal (outcome *denied* or *error*) that
  did not happen, under any lower-case dotted action of at most 80 characters, with a detail of up to
  8,192 bytes, as many times as they like. No new row can have an action longer than 80 characters.
  Such a row can copy the shape of the application's own rows: a direct caller can write a row that
  looks exactly like a summary of the refusal limiter (`detail.summary` true, any `not_written`), which
  cannot be told apart from a real one when its request id is empty; and through the application's
  login role, which the database trusts to state who the caller is, a refusal row can be put under any
  principal's name, the founder's included.
- **The bound on refusal rows is the application's, and per process.** Refusals of callers without a
  valid identity are written in full up to 120 a minute for each action and reason, then counted in
  one summary row a minute (docs/SECURITY.md). A refused sign-in whose name is an existing
  principal's is never held back, so a flood of refusals for names that do not exist cannot hide
  guesses at a real account; a summary lists the first 10 distinct names (object ids) and client
  addresses it held back, and how many there were. What is still lost after a flood: the time and
  request id of each refusal held back, and anything about a refused token. A refused MCP or REST
  call records neither the token it carried nor a client address, so a summary of those says only how
  many there were: an attempt with a stolen or guessed token can still be hidden among 120 refusals of
  requests with no token. After 120 refused sign-ins in a minute, a refusal for an existing name is
  still written while one for an unknown name is only counted, so the time an answer takes may then
  differ by one database write. A sign-in refused for an over-long passphrase is not looked up and can
  be held back for a real name too; it checked no passphrase. Several server processes each keep
  their own count, and counts are lost if the process stops before the minute ends. Refusals of
  signed-in callers are not bounded, and nor is a caller that writes through `hq.log_refusal`
  directly.
- **`TRACE` reaches the framework, not HQ.** A `TRACE` request to any address is answered 500 by
  Next.js before HQ's code runs, with no request id, and each one writes a short stack trace to the
  server log, so a client can grow the log at will by sending them. A method name Node's HTTP parser
  does not know (or one not in capitals) is answered 400, and `CONNECT` is closed, both with no id.
  HQ's own 405 with a request id covers every other method (docs/SECURITY.md).
- **A caller that reaches the database directly chooses the request id it records.** The request id
  is the application server's; the database cannot know it. A caller who reaches the database as
  `authenticated` or `anon` (the application's login role, or an API layer such as Supabase's) passes
  whatever id it likes to `hq.log_access` and `hq.log_refusal`, another request's id included. Only
  the rows the application writes are sure to carry the server's own id.
- **One proposal rule is in the application only:** linked evidence, build and decision ids must
  exist. A caller that goes straight to the database can still submit a dangling id; the founder sees
  it when reviewing.
- **A defect created through `submit_change_proposal`** can still set its own `reported_by` and
  `reported_via`; `submit_defect_report` sets them from the caller.
- **A proposal can remove what an import said.** An update may leave an imported claim exactly as it
  is, remove it, or replace it with the submitter's own claim. Removing or replacing a claim a source
  reports is allowed (withdrawing a claim is not asserting one), so the founder has to notice it when
  reviewing the proposal; the review screen shows the stored value beside the proposed one.
- **An imported claim kept identical can have the fields around it changed.** Apart from the records
  that are frozen (docs/GOVERNANCE.md), a proposal that leaves an imported claim exactly as it was can
  change the fields beside it: a defect's title, modules and build around a statement a source
  reports, an open item's title, a commission's status and modules. The claim keeps its source's label
  while what it is attached to changes. The review screen shows each change, and the record is then
  marked as changed through the inbox, but nothing marks which fields beside the claim changed.
- **The attribution of a requirement created through the inbox is the submitter's.** A created
  requirement's `exact_wording` is checked to occur verbatim in its source, but its `attribution`
  (for example “A founder ruling as recorded by the source” or “Quoted directly by the source”) is
  whatever the submitter gave. Its page also says it entered through the inbox and is unreviewed by
  the founder; it does not say that the attribution is the submitter's.
- **A submitter's quotations prove only that the words are in the source.** A submitter's claim may
  quote any sentence of a source HQ holds, related or not. HQ verifies the words, labels the claim
  as the submitter's, says on the screen that it checked the words and not that they support the
  claim, and never counts it towards a module's standing or as an acceptance.
- **A pack** (not a proposal) can give a lifecycle dimension other than founder acceptance the basis
  `verified` with no citation, and it counts towards the module's standing. Packs are built outside
  the application and checked by the builder.
- **Quotation length is counted differently** for characters outside the Basic Multilingual Plane
  (for example emoji): the database counts each as one character, the application as two. A
  quotation near the twelve-character minimum that contains them can pass one check and fail the other.
- **Wrong passphrases sent steadily can hold out a browser that has never signed in.** Sign-in
  attempts do not queue, and the work is bounded: at most 4 attempts in progress per name and 12 in
  all from browsers without a device cookie; extras are refused at once. So while someone keeps
  sending wrong passphrases, a browser that has never signed in can be refused, for that name or, once
  the 12 are taken, for any name. It takes little: holding all 12 places was measured at about two
  requests a second, with names that need not exist. A browser that has signed in as that person
  before has its own lane and is not slowed by it. The device lanes are limited per person (2
  attempts in progress per browser, 4 over all of one person's browsers) and have no limit shared
  between people, so another account holder cannot fill them. What remains: someone who has copied the device cookies of two of a
  person's own browsers (they are `HttpOnly`, so that takes access to those browsers) could keep that
  person's four places taken. The throttle is held in the server's memory: it resets on restart and is
  per process.
- **A name under attack can still be pushed out of the throttle, at a cost.** At most 10,000 lanes are
  tracked. When room is needed, a lane with fewer than five failures (or an expired count) goes
  first, and a lane with an attempt in progress never goes. Someone who brings every one of the
  10,000 lanes to five failures or more within the 15-minute window (about 50,000 wrong attempts,
  some 55 a second) can still push the lane of a name under attack out, oldest first, and so reset its
  count.
- **Sign-out with the database unreachable.** Only that browser's cookie is removed; copies stay valid
  until they expire (twelve hours).
- **Anyone who may propose can test whether a phrase occurs in a source** (that is what the
  quotation check answers). Readers cannot.
- **A client's own request id is kept only on the rows the REST layer writes.** The request id the
  application records is always the server's (a caller that goes straight to the database chooses
  its own; see above). A client's well-formed `X-Request-Id` is echoed in
  `x-client-request-id` and kept as `detail.client_request_id` on the row the REST endpoints write for
  an allowed call or for a 401 or 403 answer. The rows the database functions write themselves (a
  submitted proposal, a founder review or decision) and a proposal refusal the service records do not
  carry it, and those rows have no request id at all. The MCP endpoint ignores the header.
- **Packs and “checked by HQ's build”.** A pack's `hq_verified` evidence and `verified` claims are
  taken as whoever built the pack recorded them. The import re-verifies quotations against the source
  snapshots; it does not re-run those checks.
- **The layout detector's remaining blind spots.** All four covering checks in
  `tests/e2e/layout-measure.ts` see only what is on screen when they measure. `coveringsTopAndEnd`
  measures at the top of the page, every 0.8 window heights part-way down it, and at its end; on a
  page that would need more than ten positions in between, it takes ten, evenly spread, so parts of a
  very long page are never on screen during a measure, and a covering seen only there is missed. For
  each sticky element it also measures where the element is stuck (the middle of that scroll range,
  its last stuck position, and one more), so a sticky element that covers text only over a short
  range is seen. That range is worked out from the element's parent, taken as its containing block,
  and from the window's scroll only; a sticky element inside another scroll container, or one whose
  containing block is not its parent, can still be missed, and at most 24 such positions are taken on
  a page. A covering that appears over only part of the scroll range for any other reason — shown by a
  script while the page is scrolled, or by a scroll-driven animation — is missed when it falls between
  two positions. Text inside an `iframe` or a shadow root is not checked at all: the detector does not
  look inside them (an overlay drawn over the page from inside one is still found). Check 4, which
  looks at what is drawn at each point over text, samples a 40-pixel grid, so a covering smaller than
  the grid and away from any fixed, sticky or absolute element (checks 1–3) can be missed. It skips
  points within 1.5 pixels of a line's edge (the browser's hit test rounds there; this rule has no
  self-test), text the browser does not draw (an element at opacity 0, itself or through an ancestor,
  is looked through) or clips, text in form controls, a sticky table cell over its own table, and an
  element shifted over text of an element that contains it. Text under an ancestor with a `clip-path`
  counts as clipped wherever the browser's hit test does not return that ancestor or something inside
  it at that point. Checks 1 and 2 leave out a fixed, sticky or absolute box under a `clip-path` or the
  legacy `clip` (its own or an ancestor's) when the hit test returns it at none of 7 × 7 points spread
  over it; a box clipped down to a sliver that falls between those points is left out too, and is
  then found only if check 4 sees it over text.
- **`verify_chain` called with no identity** sees no rows and so reports nothing. The application
  always calls it as a signed-in principal.
- **The automated suites exercise the tighter pack rules on the synthetic fixture only** (minimum
  quotation length, ISO dates, typed build-only fields, reserved ids, the reported founder-acceptance
  basis). Whether the real pack passes them is recorded only in the private findings report. This
  repository holds no record of a run of the second round's pack rule (a build reported as accepted
  must quote its source) against the real pack. A stored record that fails the schema still loads,
  with an integrity warning.
- **What an owner-level import can still store, and what HQ does with it.** An import made with the
  owner connection that skips the pack validator (`hq.admin_put_records` called directly) can store
  a record of any shape: a list where a status should be, a number as a lifecycle state. It cannot
  store an HQ acceptance, a decision recorded in HQ or an id HQ issues (the database refuses those).
  A proposal can no longer leave such a record: the database checks the values that drive labels and
  the fields a record type has, and accepting through the application checks the whole record.
  - What HQ does with a record that fails validation. Every reader — screens, REST and MCP —
    computes on it conformed to its schema, so none fails on it, and every answer that names it says
    it is not valid and gives it as stored. It **never counts as proof** of anything: not as an
    acceptance instrument, an acceptance or rejection recorded in HQ (only a rejection is kept), a
    lifecycle entry towards a standing, test evidence for a requirement, an HQ check, a decision that
    resolves something, or a link that settles missing work (`src/lib/domain/derive.ts`, the list at
    its top). A defect HQ cannot read counts as open, and a requirement HQ cannot read as live and
    outstanding. A link to it counts as a link to nothing: a module's loop that HQ cannot read gives
    the module no loop, and a quotation from a source HQ cannot read backs no standing and no reported
    acceptance (the statement is then listed as an unverified claim). In every list on the screens that
    shows records with their status, such a record is shown as *Not counted — cannot be read*, without
    its status chip or tick; in the API every reference to a record says whether HQ can read it
    (`readable`, in the module brief's lists among others); and the positive counts beside a list (builds on record,
    loops recovered, evidence checked by HQ's build) count only records HQ can read; the open-defect
    and outstanding-requirement counts include it, as above. A recommendation HQ cannot read, or whose
    rank is not a number, is listed last among the priorities. It is **flagged on every module it
    names**: on each module whose id occurs anywhere in its stored data, in any letter case, standing on
    its own rather than as part of a longer id, the register, overview, brief, module page and API carry
    `unreadable_records` and the words “1 record that names this module cannot be read in full; its
    figures may be incomplete.” (or “N records that name …”), and development health lists every such
    record under *Records HQ cannot read*. On the screens a module whose own record fails validation
    reads *Not reliable* instead of figures, its lifecycle states are shown as not counted, and its row
    of the lifecycle matrix is marked *Not reliable*. In the API (`get_ecosystem_overview`,
    `list_modules`) such a module still carries numbers in `open_defects`, `blockers`, `loops` and
    `requirements` beside `reliable: false`: they are not to be read as counts.
    Search still finds such a record by its stored words. A missing field takes its default only
    when the default says nothing (an empty list or object, null, false, or a value such as `unknown`
    or `none`); any other default, a recommendation's `made_by` among them, reads “Not a valid
    value”. A check whose stored result is not valid is shown without a tick. **The marker cannot be
    stored:** the *Propose a change* form fills its fields from the record as stored, and a proposal
    containing “Not a valid value” is refused.
  - What it does not do. A record that names a module only by its name or an alias, not its id, or
    by a mistyped id (`MOD-FX-GAMA`), is not flagged on that module; and only modules are flagged, not
    the other records it names. A field the record does not declare at its top level is passed on as
    stored (an import keeps keys it does not know, so an older application can read a newer pack): the
    screens do not show it, but `get_record` returns it. A key that an object inside the record does
    not declare (inside a claim or a lifecycle entry, say) is stored, but no screen shows it
    (`get_record` gives it only in the record as stored). The text “Not a
    valid value” is refused in a proposal only when it is exactly that text: a look-alike (“Not a valid
    value.”, other letter case, a non-breaking space, a Cyrillic letter, a zero-width character) is
    stored, so a valid record can carry text that reads like the marker; and an owner-level import can
    store the marker text itself in a valid record, where it is shown as the record's text. A rule across the fields of an object (a lifecycle “yes” with no
    quotation, a claim labelled `reported` that quotes nothing) is not undone, but the derivations
    never count such a statement, and list a lifecycle one as an unverified claim. A record that
    passes its schema is taken as it is, whatever an import that skipped the quotation check put in
    it. A list conforming emptied is marked as not readable (“Not readable — see the stored record”,
    `unreadable_fields`) only where it is a field of the record or of an object in it, not inside
    a list element, and only when it is left wholly empty: a list that lost some of its elements is
    shown with those that remain. The record's own page marks each such list where it shows it as a
    list of records; the module, loop and requirement pages, and every other list on a record's page,
    name the lists HQ cannot read in the notice at the top of the page rather than beside each list.
- **The whole-record check at acceptance is the application's.** Accepting a proposal through HQ
  checks the record as it would then stand against its full schema. The database checks its own rules
  at acceptance (protected fields, labels, quotations, frozen records, allowed values, acceptance
  claims, declared fields, “implemented and tested”, source labels), but not the full schema, so a founder act made straight in the database with the founder's identity is not
  checked against it.
- **Allowed values are checked on the proposal path only.** `hq.field_enums` is applied to proposals,
  at submission and at acceptance. A pack import is checked by the application's schemas instead, and
  the database owner can store anything. For an update, a field that does not drive acceptance is
  checked only where the proposal sets it, so an odd value already stored elsewhere in the record
  stays until someone changes it.
- **The database's check of allowed values does not reach into lists**, apart from `epistemic`
  labels, which it checks at any depth. A module capability's `state` and a loop or pathway step's
  `shared_stage` are not checked by the database. A proposal accepted through the application is
  still refused if such a value is not on its list, because the whole record is checked against its
  schema then; a proposal submitted straight to the database and accepted by a founder act made
  straight in the database could store one.
- **The application cannot see which sources the database holds a text for.** A source frozen only
  because the database stores its text (it has no text snapshot and is marked `not_accessible`) is
  refused by the database alone, with the database's message and no `detail.rule`.

## Quality of the evidence pack

- Every quotation is machine-verified against its source snapshot. That proves the words are in the
  source; it does not prove that HQ's one-line summary of them is the best reading. Each cluster of
  records was reviewed by a second, sceptical pass that corrected overstatements, but nobody other
  than the builder's own process has reviewed them.
- Many “founder requirements” drawn from documents are a document author's restatement of what the
  founder asked, not the founder's own words. HQ labels how it has each wording and marks all of them unreviewed.
- Where two documents described the same decision or build, HQ merged them and kept each document's
  own statement. Where two documents disagreed about a module's state, HQ shows the more cautious
  reading and lists the other. These are editorial judgements and are flagged as such.

## Environment notes

- The build container restarted more than once during the work; each time the local database and servers were started again and the work continued from the files on disk.
- Dependencies are pinned in `package-lock.json`. The build used Node 22.23, PostgreSQL 16.15, Chromium via Playwright 1.63.
