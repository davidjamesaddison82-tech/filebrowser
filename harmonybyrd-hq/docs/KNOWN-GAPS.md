# Known gaps, blocked integrations and limits

Nothing here is hidden elsewhere. If something is not listed as working in docs/TEST-RESULTS.md, assume it is not proven.

## Standing

| | |
| --- | --- |
| HQ is not authoritative | The prerequisite HB-AI-P00 could not be shown to be completed or accepted. HQ says so on every screen and in every API answer |
| HQ is not accepted | No founder acceptance of HQ exists. Building it satisfies no gate |
| HQ is not deployed | It runs on a local machine only |

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
  granted to the API roles, because the application writes through them. Someone who reaches the
  database directly with a valid identity can therefore record, under their own name, that they used
  a read or propose tool they did not use (`tool.…`, `mcp.…`, `api.…` within the allowed families).
  Anyone who reaches it, anonymous included, can record a refusal (outcome *denied* or *error*) that
  did not happen. No one can record as allowed a founder act or a proposal without doing it, nor
  any other name that reads like one; and no new row can have an action longer than 80 characters.
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
  very long page are never on screen during a measure, and a covering seen only there is missed.
  Check 4, which looks at what is drawn at each point over text, samples a 40-pixel grid, so a
  covering smaller than the grid and away from any fixed, sticky or absolute element (checks 1–3) can
  be missed. It skips points within 1.5 pixels of a line's edge (the browser's hit test rounds there;
  this rule has no self-test), text the browser does not draw (an element at opacity 0, itself or
  through an ancestor, is looked through) or clips, text in form controls, a sticky table cell over
  its own table, and an element shifted over text of an element that contains it. Text under an
  ancestor with a `clip-path` counts as clipped wherever the browser's hit test does not return that
  ancestor or something inside it at that point.
- **`verify_chain` called with no identity** sees no rows and so reports nothing. The application
  always calls it as a signed-in principal.
- **The automated suites exercise the tighter pack rules on the synthetic fixture only** (minimum
  quotation length, ISO dates, typed build-only fields, reserved ids, the reported founder-acceptance
  basis). Whether the real pack passes them is recorded only in the private findings report. This
  repository holds no record of a run of the second round's pack rule (a build reported as accepted
  must quote its source) against the real pack. A stored record that fails the schema still loads,
  with an integrity warning.
- **What an owner-level import can still store.** An import made with the owner connection that
  skips the pack validator (`hq.admin_put_records` called directly) can store a record of any shape:
  a list where a status should be, a number as a lifecycle state. It cannot store an HQ acceptance, a
  decision recorded in HQ or an id HQ issues (the database refuses those). Every reader — screens,
  REST and MCP — computes on such a record conformed to its schema, so none fails on it and none of
  it reads as accepted, tested, checked or linked because of a value that is not valid; every answer
  that names it says it is not valid and gives it as stored. What conforming does not do: a field the
  record does not declare at its top level is passed on as stored (records keep keys they do not
  know, so an older application can read a newer pack), and the screens do not show it but `get_record`
  returns it; a rule across the fields of an object (a lifecycle “yes” with no quotation, a claim
  labelled `reported` that quotes nothing) is not undone, but the derivations never count such a
  statement, and list a lifecycle one as an unverified claim; and a record that passes its schema is
  taken as it is, whatever an import that skipped the quotation check put in it.
- **The whole-record check at acceptance is the application's.** Accepting a proposal through HQ
  checks the record as it would then stand against its full schema. The database checks its own rules
  at acceptance (labels, quotations, protected fields, allowed values, acceptance claims), but not the
  full schema, so a founder act made straight in the database with the founder's identity is not
  checked against it.
- **Allowed values are checked on the proposal path only.** `hq.field_enums` is applied to proposals,
  at submission and at acceptance. A pack import is checked by the application's schemas instead, and
  the database owner can store anything. For an update, a field that does not drive acceptance is
  checked only where the proposal sets it, so an odd value already stored elsewhere in the record
  stays until someone changes it.

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
