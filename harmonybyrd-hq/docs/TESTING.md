# Testing

[TEST-RESULTS.md](TEST-RESULTS.md) is a report of one run of `npm run test:all`, generated from the
test reporters' own output. It names the commit it was made on and describes that commit, not later
code; [REPEATABILITY.md](REPEATABILITY.md) is the same for `npm run test:repeat`. This page explains
what the suites are and what they do and do not show.

## Running

```bash
npm run test:all        # type check → unit → database → build → HTTP → browser; writes docs/TEST-RESULTS.md
npm run test:repeat     # unit + database suites twice from a clean database; every outcome and both hashes must match
npm run test:repeat -- --full    # the same, including the HTTP and browser suites
npm run test:mutation   # removes one database protection at a time and checks that a test notices (about 25 s a mutation)
```

Individual suites: `npm run test:unit`, `test:db`, `test:api`, `test:e2e`.

Two commands need something `npm install` does not provide. The browser suite (`test:e2e`, and so
`test:all` and `test:repeat -- --full`) needs the Chromium that Playwright drives: install it once
with `npx playwright install chromium`. The mutation check needs `python3`: `tests/mutation/run.mjs`
generates its mutations with `tests/mutation/gen.py` and stops (exit code 2) without it.

All suites use the **synthetic fixture pack** (`data/packs/fixture`) in a separate database,
`hq_test` (or the one named by `HQ_TEST_DATABASE`), which each suite resets and reseeds. They use the
application role and password of `DATABASE_URL` in `.env.local`, on the same server; the
application role belongs to the whole server, and migration never changes the password of one that
exists (docs/INSTALL.md), so a test run cannot break another installation's role. The HTTP
suite's server listens on `HQ_TEST_PORT` (default 3211); `tests/api/server-config.test.ts` also uses that port plus 2, 3 and 4. They never touch the development database, and they
use no network: the GitHub and Drive adapters are tested with injected failures.

## The suites

| Suite | Where | What it exercises |
| --- | --- | --- |
| Unit | `tests/unit` | Derivations (standing, health, missing work, lineage, search), the conformed view of records that fail validation (`conform.test.ts`), pack validation, record schemas and their lists of allowed values, credentials and sessions, the sign-in delay, its limits and the safe redirect, the passphrase limit when one is set, HTTP helpers, adapters, pinned-link rules, the screens' type guards, and that git ignores no file the application needs. No database |
| Database | `tests/db` | The rules as PostgreSQL enforces them, called the way the application calls them — and directly, going round the application |
| HTTP | `tests/api` | REST and MCP over real HTTP against a production build. MCP is driven by the official MCP SDK client. One file starts a second server with different settings, and a stand-in Drive server, on the local machine |
| Browser | `tests/e2e` | Playwright in Chromium against a production build: sign-in, every screen, layouts at three laptop sizes and a phone, role restrictions, the full proposal → review → decision workflow, and screens holding odd stored values |

## The commission's thirteen acceptance checks

| # | Check | Where it is tested |
| --- | --- | --- |
| 1 | Module retrieval with exact provenance | `tests/db/provenance.test.ts`; `tests/api/rest.test.ts`; browser: “a module brief shows its quotations, and each quotation names its source” |
| 2 | Requirement search with stable identifiers | `tests/unit/derive.test.ts` (AC2); `tests/e2e/02-navigation.spec.ts` (search, filter) |
| 3 | Complete linked requirement and module relationships | `tests/unit/derive.test.ts` (AC3) |
| 4 | Distinction between proposal, prototype, tested and accepted | `tests/unit/derive.test.ts` (AC4); browser: “tested and accepted are never shown as the same thing”, “the founder accepts a build; only then does HQ call it accepted” |
| 5 | The same pinned revision retrieved by two independent clients | `tests/db/pinned-revision.test.ts`; `tests/api/mcp.test.ts` (“the same answers for every client”); browser: “the earlier revision can still be read exactly as it stood” |
| 6 | Rejection of stale or conflicting writes | `tests/db/stale-writes.test.ts`; `tests/db/proposal-states.test.ts` (withdraw against accept); `tests/api/mcp.test.ts`; browser: “a proposal written against an old version is refused as stale, not applied” |
| 7 | Prevention of cross-role and unauthorised access | `tests/db/access-control.test.ts`; `tests/db/write-path.test.ts`; `tests/db/audit-log.test.ts`; `tests/api/rest.test.ts`; `tests/api/sessions.test.ts`; `tests/e2e/04-roles.spec.ts` |
| 8 | Prevention of AI-generated founder acceptance | `tests/db/founder-authority.test.ts`; `tests/db/founder-gate.test.ts`; `tests/db/proposal-evidence-rules.test.ts`; `tests/db/acceptance-claims.test.ts`; `tests/db/proposal-claims.test.ts`; `tests/db/acceptance-binding.test.ts`; `tests/api/rest.test.ts`, `mcp.test.ts` (no approval tool exists); browser: token “cannot decide” |
| 9 | Source lineage and immutable historical records | `tests/db/immutability.test.ts`; `tests/db/chain-verification.test.ts`; `tests/unit/derive.test.ts` (lineage); `tests/unit/pack.test.ts` |
| 10 | Browser navigation and functional controls | `tests/e2e/01-auth`, `02-navigation`, `05-governance` |
| 11 | Responsive laptop layouts without overlays covering content | `tests/e2e/03-layout.spec.ts` — measured in the browser at 1366×768, 1280×720, 1440×900 and 390×844; the detector itself is tested in `tests/e2e/03b-layout-detector.spec.ts` (see “Layout measurement”) |
| 12 | Safe handling of unavailable external services | `tests/unit/integrations.test.ts`; `tests/db/determinism.test.ts` (database down); `tests/api/rest.test.ts` (integrations) |
| 13 | Deterministic repeatability of critical acceptance tests | `tests/db/determinism.test.ts`; `npm run test:repeat` → [REPEATABILITY.md](REPEATABILITY.md) |

## Negative tests

Most of the database and HTTP tests are attempts to do something forbidden, and pass only if the
attempt is refused *and* nothing changed. Examples:

- an AI client sets `hq_acceptance` through a proposal; inserts a record version directly; calls the founder functions; forges claims;
- a developer token reviews its own proposal; records a decision; a developer's session calls the founder functions directly in the database;
- one AI client reads another's proposal, or asks the database for its status;
- a proposal rewrites a requirement's original wording, or its standing;
- a proposal carries an invented quotation, a quotation too short to mean anything, one of HQ's own
  labels, HQ's own checks, a changed source checksum, kind or authority, a build-only field, or
  evidence of a type only the founder or HQ's build records — each tried through the application as
  an AI client and as a developer, directly in the database, and at the founder's acceptance
  (`tests/db/proposal-evidence-rules.test.ts`);
- a proposal says what only an import can say (`tests/db/proposal-claims.test.ts`, “ROUND4 — what a
  proposal may say, on every path”): a source label it attaches to its own words — on a module's
  lifecycle entry with a real but unrelated quotation, on a loop's standing, a pathway's basis, a
  created build's statement or a created open item, on a list element, in a reversed list, two
  levels down in a list, on reworded text that keeps the label, and on a withdrawal of a reported
  acceptance that rewrites the statement; a change to evidence a source reports (retitled, moved,
  relinked) or to a source HQ has read; a requirement made implemented and tested, or a tested one
  relinked (ROUND5: also retitled, moved or given other code, in `tests/db/round5-claims.test.ts`,
  with the loops and pathways a source describes, what identifies a build, and a module's evidence
  level); a field its record type does not have (`"hq_acceptance "`, `Standing`, a 1 MB key, a key
  of another type); and “Not a valid value” anywhere in it. Each is tried four ways: through the
  application as an AI client and as a developer, straight at `hq.submit_proposal`, and planted in
  the inbox and then accepted through the application (with the same `detail.rule` and `detail.field`
  as at submission) and straight at `hq.review_proposal`; each must be refused with the exact status
  or SQLSTATE, leave the records unchanged and leave the proposal *submitted*. The controls go
  through: the same change as the submitter's claim (and the module's standing does not rise), an
  imported claim left as it is, removed or labelled `no_evidence`, a source that is only named, a
  requirement marked implemented but unverified (it stays outstanding), and a record of every type a
  proposal may create, with only its declared fields. `tests/db/record-fields.test.ts` checks that the
  database's list of each type's fields equals the schemas' and that no API role can read it;
- a founder decision clears an acceptance that was never recorded (422 from the application and from
  the database, nothing written); clearing one that was recorded still works, also in the decision
  that recorded it (`tests/db/proposal-claims.test.ts`, “ROUND4 H5”);
- a proposal asserts an acceptance — a build re-marked `accepted_reported`, with and without a real
  quotation; a created build with that standing; a module whose whole lifecycle is replaced, or whose
  lifecycle gives only `founder_accepted`, or whose reported acceptance is restated with a different
  note or raised from no to yes; a created module that reports founder acceptance; a top-level
  `founder_accepted` field, also spelt as a dotted path — each tried through the application, directly
  in the database and at the founder's acceptance, and re-checked at acceptance against the record as
  it stands then (`tests/db/proposal-evidence-rules.test.ts`, “F1 — a proposal cannot introduce a
  claim of acceptance”);
- a build a source reports as accepted has its statement relabelled from a claim to a report, or
  rewritten to widen what was accepted, or swapped, or is moved to another module, renamed, given a
  checksum or pointed at another artifact; a module's reported founder acceptance is restated with an
  added key such as `scope` or `hq_confirmed`, given the state `Yes` with a real citation, or given as
  a list; a build standing `accepted`, `Accepted_Reported`, `withdrawn ` or a list; a `lifecycle`
  given as a list, or with a look-alike dimension name; a created module with the state `YES`;
  evidence typed `founder_acceptance ` with a trailing space; an `epistemic` label outside its list,
  also nested; a defect severity outside its list — each tried four ways: through the application
  (as an AI client and as a developer), straight at `hq.submit_proposal`, and planted in the inbox
  and then accepted through the application and straight at `hq.review_proposal`; each must be
  refused with the exact status or SQLSTATE, leave the records unchanged and leave the proposal
  *submitted* (`tests/db/acceptance-claims.test.ts`). Seven positive founder-acceptance states (`Yes`,
  `YES`, `yes `, none, a list, the entry as a list, the entry as null) are also refused by the
  acceptance rule called on its own, so it holds even without the allowed-values check. The controls
  go through: withdrawing a reported acceptance, an ordinary change to a build that is not reported
  as accepted, and a change to a module that leaves its reported acceptance byte for byte;
- a planted proposal that would leave an invalid record (an empty label, a statement without a label,
  a defect without a statement) is refused with 422 when the founder accepts it through the
  application, also when its target has moved on, and the founder can still reject it
  (`tests/db/acceptance-claims.test.ts`, “G1d”);
- the database's lists of allowed values equal the schemas' lists, and no API role can read them
  (`tests/db/field-enums.test.ts`; `tests/unit/schemas.test.ts`, “G1c — FIELD_ENUMS is the record
  schemas' own lists”);
- an HQ acceptance the founder later cleared, or replaced by a rejection, counted as an acceptance
  instrument (`tests/unit/derive-honesty.test.ts`);
- a proposal changes a record the founder accepted or rejected, and the refusal names a rejection as
  a rejection (`tests/db/acceptance-binding.test.ts`);
- `service_role`, with the old write-context setting forged, writes history or a founder act (`tests/db/write-path.test.ts`);
- `service_role`, with the founder's claims forged, calls the founder, proposal, audit and sign-in
  look-up functions: each is “permission denied” and nothing changes; only the read helpers are
  executable, and no function in schema `hq` is executable by PUBLIC (`tests/db/service-role.test.ts`).
  PostgreSQL grants EXECUTE to PUBLIC on every new function, so a later function whose migration
  forgets to revoke it is executable; this test reads the catalogue and then fails. It does not stop
  such a function being created;
- `UPDATE`, `DELETE` and `TRUNCATE` against the record history, the proposal history and the audit log;
- stored versions, seals and the seal chain are tampered with (`tests/db/chain-verification.test.ts`);
- an API role writes the audit log directly; a founder act, or any action outside the exact list —
  names that read like a founder act (`api.decision.record`, `mcp.record_founder_decision`,
  `tool.sign_off`), upper case, a trailing space, an empty name after the dot — is recorded through
  `hq.log_access`; a session row naming another person; an action over 80 characters through either
  wrapper or written straight into the log; an audit detail over 16,384 bytes
  (`tests/db/audit-log.test.ts`, which also checks that `hq.tool_names` equals the tool registry and
  that every action the application really logs is still accepted);
- 500 unauthenticated MCP requests write at most 120 refusal rows a minute in full, then one summary
  row with the count, while a signed-in caller's 200 refusals are all written
  (`tests/api/audit-volume.test.ts`; the counting itself in `tests/unit/audit-limit.test.ts`);
- a 1 MB argument name, 80,000 unknown arguments, an 8 KB query key, a 900 KB record id and a 1 MB
  proposal id: every answer stays under 4 KB (`tests/api/echo-bounds.test.ts`;
  `tests/db/proposal-claims.test.ts`, “ROUND4 H7”, for the services and the database's own refusals);
- every method sent to every API route found on disk: each answer carries a request id (health
  excepted), each method a route does not implement is 405 with `Allow` and the error body, and
  `OPTIONS` is 204 (`tests/api/methods.test.ts`);
- a second installation migrating with another password for the same application role, in a
  database of its own: refused before anything is applied, and the first password still works; the
  same database with a changed password; and only `HQ_ALLOW_ROLE_PASSWORD_CHANGE=1` changes the
  password (`tests/db/app-role.test.ts`, with a role and databases of its own that it removes);
- withdraw and accept race each other (`tests/db/proposal-states.test.ts`);
- a pack containing a quotation that is not in its source, or one made only of spaces; a pack carrying an HQ acceptance; a pack using an id HQ reserves; a pack build with the standing `accepted_reported` and no citation (`tests/unit/pack.test.ts`);
- a proposal written against a superseded version;
- a revoked, expired, malformed or unknown token; a forged session cookie, an expired one, one without
  HQ's issuer or epoch, and one from before a sign-out or passphrase change (`tests/api/rest.test.ts`,
  `tests/api/sessions.test.ts`); a cross-origin request;
- a founder being issued a token; an AI client being made founder;
- repeated wrong passphrases (slowed, never locked out), and a redirect to another site after sign-in;
- 20 wrong passphrases held open for the founder's name while the founder's browser, which signed in
  before, signs in; no answer waits past one maximum delay + 3 s (`tests/api/sign-in.test.ts`); wrong
  attempts from another browser while a browser that signed in before signs in without waiting
  (`tests/e2e/01-auth.spec.ts`); attempts past the limits on work in progress (`tests/unit/throttle.test.ts`);
- a 900 KB name, a 42-character name and a 2,000-character passphrase at sign-in: answered “do not
  match” at once, with no lane, no look-up, no passphrase check and no cookie read
  (`tests/unit/sign-in.test.ts`); 500 sign-ins with 900 KB names over HTTP, which create no lane, are
  audited with the length only and keep the server's memory within a stated bound, and long
  passphrases that do not count against the name (`tests/api/sign-in.test.ts`,
  `tests/e2e/01-auth.spec.ts`); names and device ids over 64 characters given to the throttle itself;
  the eviction order, and the failure count of a name under attack while 10,000 other names come and
  go (`tests/unit/throttle.test.ts`); a `next` longer than 2,048 characters;
- a device cookie used on its own for a page, a REST call and the MCP endpoint; a device cookie for
  another person, forged, expired or malformed; a device cookie offered as a session and a session
  token offered as a device cookie (`tests/api/sign-in.test.ts`, `tests/unit/session.test.ts`);
- a client's own `X-Request-Id`, replayed as another caller's: it never becomes the request id
  (`tests/api/hardening.test.ts`, `tests/unit/http.test.ts`); every MCP answer — the 401, the
  cross-origin refusal, a parse error, an unsupported version, an empty batch, the 405s — carries a
  request id, the same as its audit row where it has one (`tests/api/mcp.test.ts`);
- an oversized body, a bad MCP batch element, an argument a tool does not take, a live look-up by an
  API token (`tests/api/hardening.test.ts`).
- a token past its rate limit, over REST and MCP: 429 with `Retry-After`, another token unaffected,
  the allowance refilled with time, an MCP batch charged per message and one larger than the burst
  refused outright, refusals audited at most once a minute, a founder session exempt
  (`tests/unit/token-rate.test.ts`, `tests/api/token-rate.test.ts`). The shared test servers run with
  `HQ_TOKEN_RATE_PER_MINUTE=0` so the other suites are not limited.

## Corrections made to tests during the build

The commission says a test must never be silently changed to conceal a defect. Three test
expectations were changed while the suites were written. None concealed a defect; each is recorded here.

1. **`tests/db/founder-authority.test.ts` — promoting an AI client to founder.** The test first
   expected the “a founder must be a person” constraint to fire. For a client that already holds a
   token, a different guard fires first (a founder may not hold a token). Both refusals are correct.
   The test now accepts either for that client and adds a second case — a client with no token —
   that must hit the first constraint.
2. **`tests/api/rest.test.ts` — “no approval tools are exposed”.** The first version searched tool
   names for the words review, accept, approve or decision, and so flagged the read-only tool
   `get_review_items`. The check now looks for the founder acts by name and also asserts that every
   tool is either read-only or adds to the inbox.
3. **Test server shutdown.** The HTTP suite's server did not stop cleanly; the helper now starts
   Next.js directly and waits for it to exit. No assertion changed.

One real defect was found by the tests and fixed in the application, not in the test: a decision
recorded in HQ was stored with a label that requires a citation and had none, which made the stored
record fail its own schema. The label is now `verified` (it is first-hand for HQ). A second defect
was found while writing the browser tests and fixed: the sign-in throttle counted successful
sign-ins, so normal use could lock a person out; it then counted failures only. (After the review the
lock-out was replaced by a growing delay with no lock-out; see below.)

The browser suite then found two more, both fixed in the application:

- After the founder accepted a proposal, the page lost its confirmation, and its “before” column
  showed the already-changed value (so before and proposed looked identical). The page now states
  how the proposal ended — by whom, when, which dataset revision and record version — from the
  proposal's own history, and “before” is the version the proposal was written against. The test's
  first expectation (a transient confirmation message) was replaced by assertions on that permanent outcome.
- The token form's input pattern was not a valid regular expression in current browsers, so the
  browser silently ignored it (the server still validated). Found because every browser test fails
  if the page logs an error.

## Expectations changed while fixing the review's findings

Where behaviour changed on purpose, the existing test was changed with it and none was weakened:

- `tests/db/founder-authority.test.ts`, an invalid decision: a missing acceptance target now gives
  422 (it was 404), because every id a decision names is checked first. Nothing is written either way.
- `tests/db/access-control.test.ts`: the test of denied attempts was renamed to say the application
  writes those audit rows; refusals raised inside the database cannot record themselves.
- `tests/db/immutability.test.ts`: each refused statement now runs in its own rolled-back
  transaction, and more statements were added.
- `tests/unit/derive.test.ts` (AC4): pending founder decisions in the fixture fell from two to one,
  because an open item about the same decision is no longer counted again.
- `tests/e2e/01-auth.spec.ts`: the lock-out test was replaced by tests that the delay grows, that the
  right passphrase still signs in, and that changing `X-Forwarded-For` does not reset the delay.
- `tests/api/rest.test.ts`: live look-ups now use a developer's session (tokens get the status only),
  and the forged-session test also sends an expired session.
- `tests/unit/integrations.test.ts`: the Drive tests list their file id, as look-ups now require.
- `tests/unit/secrets.test.ts`: a verified session now returns the person's id and session epoch.

The stage that strengthened the tests themselves changed these, each to something stricter:

- `tests/e2e/support.ts`: the guard that fails a test on a browser error no longer ignores refused
  requests. Any 4xx or 5xx answer from HQ fails the test unless the test declares exactly that
  refusal; a 5xx can never be declared. `tests/e2e/00-guard.spec.ts` tests the guard itself, with
  tests that are marked as required to fail.
- `tests/e2e/03-layout.spec.ts`: the measurement moved to `tests/e2e/layout-measure.ts` and no longer
  exempts anything inside the navigation or a table, or bars below a size. It samples points over the
  text and reports whatever is drawn on top. `tests/e2e/03b-layout-detector.spec.ts` tests the
  detector on injected overlays.
- `tests/e2e/02-navigation.spec.ts`: a health figure must equal the number of entries its list shows
  (it used to be enough that the number appeared somewhere on the page), and “tested” against
  “accepted” is checked by what each list contains, not by the labels being present.
- `tests/e2e/04-roles.spec.ts`: the review refusal is tried on a proposal that exists and must be
  403 for each decision (a 404 on a made-up id used to pass), and the reader's `/access` response is
  checked not to contain credentials or audit entries.
- `tests/db/pinned-revision.test.ts`: the cache is cleared between the two clients' reads, so the
  second answer comes from the database.

## Expectations changed in the second round

After the re-verification (docs/PROGRESS-REGISTER.md), these expectations changed because the
behaviour changed on purpose:

- `tests/unit/sign-in.test.ts`: the test that one name's attempts are handled one at a time became
  “does not queue one name's attempts: parallel guesses each wait on their own, at most four at once”.
- `tests/unit/http.test.ts` and `tests/api/hardening.test.ts` (“request ids (api-8, D5, F6)”): a
  well-formed client id is no longer kept as the request id; it is echoed apart and kept as the
  client's correlation id.
- `tests/db/acceptance-binding.test.ts`: the rejection test now also asserts that the refusal says
  “rejection”.
- `tests/db/proposal-states.test.ts`: `service_role` calling `hq.proposal_status` is now “permission
  denied”, not an empty answer.
- `tests/e2e/05-governance.spec.ts`: the long-name test measures sideways scroll against the layout
  viewport (below).
- `tests/unit/secrets.test.ts`: the session lifetime is asserted as exactly 43,200 seconds, not only
  as the constant that sets it.

## Expectations changed in the third round

After the re-check of the second round, these expectations changed because the behaviour changed on
purpose:

- `tests/db/proposal-evidence-rules.test.ts`: the control “a build already reported as accepted can
  still be renamed, and restating its standing is allowed” became a refusal: such a build can no
  longer be renamed by proposal, even restating its standing (403, records unchanged). The test that
  a build is re-checked at acceptance now has an import make the target reported as accepted after
  submission, since a proposal no longer can. The review-screen test now proposes its changes to a
  build that is not reported as accepted.
- `tests/db/acceptance-binding.test.ts`: the test that a cleared HQ acceptance allows proposals again
  now uses a build that is not reported as accepted, for the same reason.
- `tests/db/stale-writes.test.ts`: the test that a proposal which would make the record invalid is
  refused before it reaches the inbox now uses an empty title. A category outside its list is still
  refused with 422, now by the allowed-values check, which answers first and names the field.
- `tests/unit/derive-honesty.test.ts`: the control that an issued HQ decision accepting the build is
  an instrument now also sets the build's HQ acceptance to name that decision.
- `tests/e2e/03-layout.spec.ts` and `tests/e2e/03b-layout-detector.spec.ts`: they read the
  coverings found at every position (`coverings`), not only those at the top and at the end.
- `tests/unit/derive-honesty.test.ts`: the datasets these tests build are handed to the derivations
  conformed, as the store hands them to every reader (`tests/helpers/fixture.ts`), so a build whose
  standing is a list, an object or a number is labelled “Build standing: Not a valid value” (the
  conformed value) rather than “Build standing: not a valid value” (the derivation's own fallback).
- `tests/db/acceptance-claims.test.ts`: the helper that reads a record back now reads it as stored,
  not as the conformed view, since its checks are about what the database stored and what the
  write-path rules compare; a planted odd severity is still “critical” as stored.

## Expectations changed in the fourth round

After the re-check of the third round, these expectations changed because the behaviour changed on
purpose. None was weakened.

- `tests/db/founder-gate.test.ts`: a top-level source label (a pathway's `basis`, a loop's
  `standing`) that the record does not already hold is now refused with HQ403 (“a proposal's claim is
  the submitter's own”); it was HQ422 (“must cite at least one source”).
- `tests/db/proposal-evidence-rules.test.ts`: the cases of a source label without a citation now
  expect 403 and the new message, since a source label is set only by an import; the developer's
  accepted update now gives its quotation as the submitter's claim; the control “source-reported
  evidence may still get a new title” became a refusal (403, records unchanged), since such evidence
  is frozen; the message for a change to such evidence is the new one; the review-screen test that
  set `decision_ids` on a build now sets it on a requirement, the type that has that field.
- `tests/db/acceptance-claims.test.ts` and `tests/db/proposal-evidence-rules.test.ts`: lifecycle
  entries that a test changes and expects to go through are labelled `submitter_claim`, not
  `reported`.
- `tests/db/founder-authority.test.ts`: the test that clears an acceptance first records one, since
  clearing needs something to clear.
- `tests/unit/derive-honesty.test.ts`: records that fail validation are now read as *not reliable*
  (a module whose founder acceptance has a basis no source can give, builds whose standing is a list,
  an object or a number, a build whose report has no citation), not by what they claim; a
  requirement's test evidence has a fourth list, `unreadable`.
- `tests/unit/conform.test.ts` and `tests/e2e/07-odd-values.spec.ts`: a build that fails validation
  now has the acceptance status *not reliable* (“Not reliable — this record cannot be read in
  full”); its stored standing is still shown as “Not a valid value”.
- `tests/api/odd-values.test.ts`: a planted record that keeps every value of the fixture record it
  copies may now show, in any tool's answer, what any single-record tool shows about that fixture
  record. A requirement HQ cannot read is now listed as outstanding, so such a requirement appears in
  the outstanding lists where its fixture record does not.
- `tests/api/sign-in.test.ts`: 500 sign-ins with over-long names no longer write 500 rows: at most
  120 a minute are written in full and a summary row counts the rest, and the test checks that every
  one of the 500 is accounted for.
- `tests/api/hardening.test.ts`, the outstanding-requirements test: proposing `implemented_tested`
  with linked evidence for FR-FX-003 was accepted (200); it is now refused (403, `detail.rule`
  `tested_claim`, `detail.field` `implementation_state`), and the test goes on with
  `implemented_unverified`, after which the requirement is still outstanding. (This entry was left out
  when the fourth round's changes were first listed.)

## Expectations changed in the fifth round

After the re-check of the fourth round, these expectations changed because the behaviour changed on
purpose (ROUND5 K1–K8). None was weakened; each case that used a field that is now protected goes on
with one that is not, and the refusal is tested in `tests/db/round5-claims.test.ts`.

- `tests/db/proposal-claims.test.ts`: “L6: an imported pathway keeps commission_example, and a change
  elsewhere in it is accepted” is now refused (403, `source_label`, field `basis`) and goes through
  only once the proposal relabels the pathway `submitter_claim` (K1); “H3: a tested requirement can
  be retitled, and its links resent unchanged” is now refused (403, `tested_claim`, field `title`)
  and goes through once the proposal moves it to `implemented_unverified` (K2); the two cases that
  change a tested requirement's links now expect the message of K2's freeze, with the same rule and
  field; the module created in “a record of every type a proposal may create” now has
  `evidence_level` `commission_list_only`, not `named_only` (K4).
- `tests/db/acceptance-claims.test.ts`: a reported build given a checksum, or pointed at another
  source as its artifact, is now refused as a protected field (K3), before the freeze of a reported
  build is reached; the two cases are listed as K3 and expect that message. The proposal that moves a
  build on before a stale acceptance now changes its label, not its file name.
- `tests/db/acceptance-binding.test.ts`: the proposals on an accepted, then cleared, build change
  its label only, not its file name or checksum (K3), so the acceptance is what is tested.
- `tests/db/proposal-evidence-rules.test.ts`: the created module whose lifecycle reports a founder
  acceptance now carries `evidence_level` `commission_list_only`, so the acceptance rule is what
  answers (K4); the review-screen test no longer submits a checksum change on a build (K3) and checks
  that a planted one is still flagged as sensitive.
- `tests/db/proposal-states.test.ts`: the withdrawal test proposes on FR-FX-004, not on the tested
  FR-FX-001 (K2).
- `tests/unit/conform.test.ts`: a recommendation stamped “Proposed through the inbox by claude”
  reads “This recommendation was proposed through the inbox by claude.” (K5).
- `tests/unit/audit-limit.test.ts`: a summary now also says what the refusals it held back named
  (`objectIds`, `clientAddresses`, empty in that case) (K7).
- `tests/e2e/07-odd-values.spec.ts`, the named cases: in the lists (a module's builds, the
  register's builds, evidence and defects, the requirement list) a record that fails validation now
  reads “Not counted — cannot be read” where it read “Not a valid value”; the module whose lifecycle
  holds a number now shows every dimension as not counted (twelve rows, no state dot), and its
  lifecycle-matrix row is marked *Not reliable* with every cell not counted, where one cell read
  “Not a valid value” (K6). The proposals opened while odd records are stored now change FR-FX-002,
  not the tested FR-FX-001 (K2).

The fifth round's own tests: `tests/db/round5-claims.test.ts` (K1–K4 four ways each, the honest
changes each rule leaves open, and a second clear straight at the database, K5);
`tests/db/app-role.test.ts` (an existing role that is a superuser, bypasses row-level security, may
create roles or databases, inherits, or cannot log in, K8); `tests/unit/round5.test.ts` (the
verifiers' counter-examples of K6, the propose form's sentence, the inbox module's notes and the
well-formed text helpers); the property in `tests/unit/conform.test.ts`, which now also compares the
module brief's lists with positive labels, the open defects beside them, the order of the
priorities, the lifecycle matrix row and the figures of a module that fails validation;
`tests/unit/audit-limit.test.ts` and `tests/unit/sign-in.test.ts` (K7); `tests/api/audit-volume.test.ts`
(125 refused sign-ins for unknown names, then 4 for a real account, all 4 written, K7);
`tests/api/echo-bounds.test.ts` (the JSON-RPC id, the search query and a lone surrogate, K8);
`tests/api/methods.test.ts` (methods outside the seven, K8); `tests/e2e/07-odd-values.spec.ts`
(“ROUND5 K6”: the lists, counts, lifecycle view, lifecycle matrix and priorities on the screens).

## Every file the application needs is in the repository

The repository HQ sits in ignores `*.mjs`. Because of that, three files were never committed:
`next.config.mjs` (the response headers, no telemetry, `pg` not bundled), `tests/mutation/run.mjs`
and `tests/mutation/vitest.mut.config.mjs`. A clone and the source archive lacked them. HQ's own
`.gitignore` now un-ignores `*.mjs`, and the three files are committed.
`tests/unit/repository-files.test.ts` lists every file git ignores under this folder and fails on
anything outside what is meant to stay local (`node_modules`, `.next`, the test reports, `private`,
the evidence packs other than the fixture, the generated mutations, `.env.local` and the other local
files). It also asks git directly whether each of the three files is ignored. It is skipped, with a
message, where git is not available or the folder is not in a git work tree (for example, the source
archive).

## Layout measurement

`tests/e2e/layout-measure.ts` measures each screen in the browser.

- **Sideways scroll** is the document's scroll width minus the width of the layout viewport
  (`document.documentElement.clientWidth`). It used to be measured against `window.innerWidth`, which
  a phone browser widens to fit content that overflows, so on the phone it always read 0. Every
  screen, laptop and phone, is also held to a scroll width no more than one pixel over the configured
  window width. `tests/e2e/03b-layout-detector.spec.ts` checks this on a phone (390×844, touch): a
  clean page passes, and a label that does not wrap and is wider than the screen is reported.
- **Coverings** are found four ways: every fixed, sticky or absolute element is tested against all
  text on the page; such an element over more than 12% of the window over the content is a covering
  even with no text under it; a grid of points over the visible content must show the content; and,
  on a 40-pixel grid over the content, the element drawn where a line of text lies must be that
  text's own element (or one inside or around it whose pseudo-element does not cover the point). The
  last check finds a block shifted over earlier text with `position: relative` or a transform, and a
  fixed overlay drawn by a pseudo-element such as `body::before` or `main::after`. What is “drawn” is
  the topmost element the browser paints: an element at opacity 0, itself or through an ancestor, is
  looked through and never reported (opacity 0.01 is reported), and text that a `clip-path` cuts away
  is not checked.
- **Where it measures.** Each screen is measured at the top, part-way down (every 0.8 window heights,
  at most ten positions, spread evenly on a longer page) and scrolled to its end, and, for each sticky
  element, where it is stuck; each covering says where it was seen (`top`, `middle at N px`, `where a
  sticky element is stuck, at N px`, `end`). Each kind has a
  test in `03b-layout-detector.spec.ts` that first shows the overlay hides text and then that the
  detector names it; a clean control with decorative pseudo-elements, a raised badge, a transform
  that moves nothing and a closed quotation must report nothing. What it still cannot see is listed
  in docs/KNOWN-GAPS.md.

## Mutation check of the database tests

The review showed that several protections could be deleted without any test failing. To make that
measurable, `npm run test:mutation` (`tests/mutation/`) takes the real database suite and, for each
of a list of mutations, re-creates one database function, drops one trigger or changes one table
row or constraint with a single guard removed, then runs the whole suite. It needs `python3`. A mutation that no test fails for has *survived*: that
protection is not tested. A mutation whose target text is not found aborts, so a mutation can never
silently do nothing; an unmutated control run must pass in full.

The list covers the founder gate, each rule of the record-sealing trigger, the append-only
triggers, the inbox rules (role, scope, stale version, protected and build-only fields, HQ-only
labels, quotation checks, evidence and source rules), acceptance binding, the write context, the
proposal state machine, the audit wrappers, chain verification and session ending. Migration 0007's
rules have mutations too: each part of the refusal of acceptance claims and each place
`submit_proposal` and `review_proposal` call it, a grant of a founder function back to
`service_role`, `hq.log_access` accepting any dotted action, and dropping the audit detail size limit
(the `mf1…`, `mf3…` and `mf4…` entries in `tests/mutation/gen.py`). Migration 0008's rules have
them as well (`mf1j…`, `mg1a…`, `mg1b…`, `mg1c…`, `mg2…`): the freeze on a build reported as
accepted removed, the whole-entry comparison put back to four keys, the positive states narrowed,
the allowed-values check removed or made to do nothing, a call to it removed, its scope changed, a
row of `hq.field_enums` deleted or widened, the bounds on audit action names loosened, and the
action-length constraint dropped. Migration 0009's rules have them too (the `mh…` entries): the
source-label rule removed, made to compare the label only, made to skip top-level fields or lists,
or to accept a claim at any list position, and each of its four calls in `submit_proposal` and
`review_proposal` removed; the source freeze removed or narrowed; the “implemented and tested” rule
and its link rule removed; the declared-fields check removed, or `hq.record_fields` given a look-alike field; clearing allowed with nothing to
clear; the “Not a valid value” check removed; `hq.log_access` accepting any tool name or any session
object, or a tool name added; the freeze's own validity test loosened; the `epistemic` check cut to
one level; and the record type in a refusal left uncut. The mutations of the rules 0009 replaced
(`ml2_label_needs_citation`, `ml5_merged_citation`, `mg2a…`, `mg2b…`) are gone, as their rules are.
Migration 0010's rules have them too (the `mk…` entries): the freeze of a loop or pathway a source
describes removed, narrowed to the source labels, or opened by any relabel; the freeze of a tested
requirement removed (and `mh3b_tested_links`, whose 0009 rule 0010 replaced, now narrows that freeze
back to the links); what identifies a build unprotected, or its artifact source left out; a module's
evidence level unprotected, the created module's level unchecked or allowed to be `named_only`; and a
second clear allowed straight at the database.

A full run (no mutation named) writes `tests/mutation/RESULTS.txt`. Its first line names the code it
ran against: the commit (`git rev-parse HEAD`, followed by “with uncommitted changes” when
`git status` was not clean), the date and the number of mutations. Then comes one line per mutation,
with how many tests then failed, and a closing count of mutations caught and survived. A run of named
mutations writes nothing there. Where the repository has no such file, no full run has been recorded. The command uses its own database
(`HQ_MUTATION_DATABASE`, default `hq_test_mutation`).

It covers the database layer only. The application-layer guards, the screens and the derivations
are not mutation-tested.

## Adversarial review

After the first delivery, seven reviewers who had not written HQ — AI agents working under the
builder's direction, each with one lens — attacked it, each in a database of its own. The engineers
who fixed the findings, and the verifiers who re-ran the attacks after each round of fixes, were AI
agents of the same build process too. A second
reviewer tried to refute each finding. **71 findings were confirmed by reproduction** (or, for
documentation and test findings, by quoting the lines that contradict each other), and they were
then fixed in stages, each fix with a regression test that fails without it. Several findings showed
tests that would have stayed green with the protection they claim to test deleted; those tests were
strengthened. Every finding, its status, what was done and the regression test that covers it are in
[REVIEW-FINDINGS.md](REVIEW-FINDINGS.md), which is generated. This was a second, sceptical pass by
the same build process, not an assessment by an independent person.

## What is not tested

- Any connection from the Claude or ChatGPT applications (docs/CONNECTING-AI-CLIENTS.md).
- Live GitHub or Google Drive content. Only the adapters' handling of missing configuration, time-outs,
  refusals and malformed answers is tested, with injected responses.
- A Supabase-hosted database, Supabase Auth, or `docker compose`.
- Browsers other than Chromium; assistive technology.
- Load, concurrency beyond the stale-write cases, and long-running operation.
- The real evidence pack's *content*. The importer verifies every quotation in it against its source;
  the automated suites do not otherwise run against it. (The screens were also checked by hand and by
  screenshot with the real pack loaded.)
- The tighter pack rules against the real evidence pack, by the automated suites (see
  docs/KNOWN-GAPS.md: no run of the second round's rule for builds reported as accepted against the
  real pack is recorded in this repository).
- The sign-in throttle across more than one server process, or after a restart (it is in memory).
- Malformed stored values beyond what the odd-values tests plant (`tests/helpers/odd-values.ts`):
  records with values of the wrong kind, put into the database as the owner — six named cases, 336
  records (each of the twelve types, with each of seven wrong values, in four patterns), and the
  fourth round's cases: the records a verifier planted (evidence that fails validation as an
  acceptance instrument, a blocker or a defect whose module list is stored as text, a recommendation
  with no maker, a check whose result is not valid) and variations of them.
  `tests/e2e/07-odd-values.spec.ts` visits every screen that shows them: each must answer with a
  heading and no error; for the named cases the page must show “Not a valid value”; and no planted
  record may appear as accepted in the health lists or the lifecycle matrix.
  `tests/api/odd-values.test.ts` calls every tool the registry lists, over REST (GET and POST) and
  MCP, with the planted ids, at the latest revision and pinned to the revision that stored them: every
  answer must be 200 or a deliberate 4xx, the server must print no error, and no answer may give a
  planted record a positive status it does not validly hold; `get_record`, `search_records` and a
  listing tool must say the record is not valid and give its stored form. `tests/unit/conform.test.ts`
  checks the conformer itself: a valid record comes back as the same object, and, over the 336, no
  conformed value is one the stored record does not hold at that place. It also checks that each
  record that fails validation, added to the fixture on its own, makes nothing read better (a
  standing, an acceptance, a count of open defects, outstanding requirements, missing work, review
  items and more), and that each module it names lists it as a record HQ cannot read. `tests/db/proposal-impact.test.ts`
  checks that the review screen's impact (the one `proposalImpact`) works with them stored and shows
  “before” values as stored. All of this runs on the fixture only.
- Independent re-execution. Every run recorded here was made by the builder.
