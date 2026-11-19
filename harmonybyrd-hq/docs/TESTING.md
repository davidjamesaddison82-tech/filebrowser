# Testing

Actual results of the last run are in [TEST-RESULTS.md](TEST-RESULTS.md), which `npm run test:all`
generates from the test reporters' own output. This page explains what the suites are and what they do and do not show.

## Running

```bash
npm run test:all        # type check → unit → database → build → HTTP → browser; writes docs/TEST-RESULTS.md
npm run test:repeat     # unit + database suites twice from a clean database; every outcome and both hashes must match
npm run test:repeat -- --full    # the same, including the HTTP and browser suites
npm run test:mutation   # removes one database protection at a time and checks that a test notices (about half an hour)
```

Individual suites: `npm run test:unit`, `test:db`, `test:api`, `test:e2e`.

All suites use the **synthetic fixture pack** (`data/packs/fixture`) in a separate database,
`hq_test` (or the one named by `HQ_TEST_DATABASE`), which each suite resets and reseeds. The HTTP
suite's server listens on `HQ_TEST_PORT` (default 3211); `tests/api/server-config.test.ts` also uses that port plus 2, 3 and 4. They never touch the development database, and they
use no network: the GitHub and Drive adapters are tested with injected failures.

## The suites

| Suite | Where | What it exercises |
| --- | --- | --- |
| Unit | `tests/unit` | Derivations (standing, health, missing work, lineage, search), pack validation, record schemas, credentials and sessions, the sign-in delay and safe redirect, HTTP helpers, adapters, pinned-link rules and the screens' type guards. No database |
| Database | `tests/db` | The rules as PostgreSQL enforces them, called the way the application calls them — and directly, going round the application |
| HTTP | `tests/api` | REST and MCP over real HTTP against a production build. MCP is driven by the official MCP SDK client. One file starts a second server with different settings, and a stand-in Drive server, on the local machine |
| Browser | `tests/e2e` | Playwright in Chromium against a production build: sign-in, every screen, layouts at three laptop sizes and a phone, role restrictions, the full proposal → review → decision workflow |

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
| 8 | Prevention of AI-generated founder acceptance | `tests/db/founder-authority.test.ts`; `tests/db/founder-gate.test.ts`; `tests/db/proposal-evidence-rules.test.ts`; `tests/db/acceptance-binding.test.ts`; `tests/api/rest.test.ts`, `mcp.test.ts` (no approval tool exists); browser: token “cannot decide” |
| 9 | Source lineage and immutable historical records | `tests/db/immutability.test.ts`; `tests/db/chain-verification.test.ts`; `tests/unit/derive.test.ts` (lineage); `tests/unit/pack.test.ts` |
| 10 | Browser navigation and functional controls | `tests/e2e/01-auth`, `02-navigation`, `05-governance` |
| 11 | Responsive laptop layouts without overlays covering content | `tests/e2e/03-layout.spec.ts` — measured in the browser at 1366×768, 1280×720, 1440×900 and 390×844 |
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
  labels, a source label without a citation, HQ's own checks, a changed source checksum, kind or
  authority, a build-only field, or evidence of a type only the founder or HQ's build records — each
  tried through the application as an AI client and as a developer, directly in the database, and at
  the founder's acceptance (`tests/db/proposal-evidence-rules.test.ts`);
- a proposal changes a record the founder accepted or rejected (`tests/db/acceptance-binding.test.ts`);
- `service_role`, with the old write-context setting forged, writes history or a founder act (`tests/db/write-path.test.ts`);
- `UPDATE`, `DELETE` and `TRUNCATE` against the record history, the proposal history and the audit log;
- stored versions, seals and the seal chain are tampered with (`tests/db/chain-verification.test.ts`);
- an API role writes the audit log directly (`tests/db/audit-log.test.ts`);
- withdraw and accept race each other (`tests/db/proposal-states.test.ts`);
- a pack containing a quotation that is not in its source, or one made only of spaces; a pack carrying an HQ acceptance; a pack using an id HQ reserves;
- a proposal written against a superseded version;
- a revoked, expired, malformed or unknown token; a forged session cookie, an expired one, one without
  HQ's issuer or epoch, and one from before a sign-out or passphrase change (`tests/api/rest.test.ts`,
  `tests/api/sessions.test.ts`); a cross-origin request;
- a founder being issued a token; an AI client being made founder;
- repeated wrong passphrases (slowed, never locked out), and a redirect to another site after sign-in;
- an oversized body, a bad MCP batch element, an argument a tool does not take, a live look-up by an
  API token (`tests/api/hardening.test.ts`).

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
lock-out was replaced by a growing per-name delay; see below.)

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

## Mutation check of the database tests

The review showed that several protections could be deleted without any test failing. To make that
measurable, `npm run test:mutation` (`tests/mutation/`) takes the real database suite and, for each
of a list of mutations, re-creates one database function or drops one trigger with a single guard
removed, then runs the whole suite. A mutation that no test fails for has *survived*: that
protection is not tested. A mutation whose target text is not found aborts, so a mutation can never
silently do nothing; an unmutated control run must pass in full.

The list covers the founder gate, each rule of the record-sealing trigger, the append-only
triggers, the inbox rules (role, scope, stale version, protected and build-only fields, HQ-only
labels, quotation checks, evidence and source rules), acceptance binding, the write context, the
proposal state machine, the audit wrappers, chain verification and session ending. The result of
the last full run is in [tests/mutation/RESULTS.txt](../tests/mutation/RESULTS.txt), which the
command writes. It uses its own database (`HQ_MUTATION_DATABASE`, default `hq_test_mutation`).

It covers the database layer only. The application-layer guards, the screens and the derivations
are not mutation-tested.

## Adversarial review

After the first delivery, seven reviewers who had not written HQ — AI agents working under the
builder's direction, each with one lens — attacked it, each in a database of its own. A second
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
- The tighter pack rules against the real evidence pack, by the automated suites (the builder checked
  it separately; see docs/KNOWN-GAPS.md).
- How a screen renders a malformed stored value, in a browser: the schemas now refuse such values on
  every write path, and the type guards the screens use are covered by unit tests only.
- Independent re-execution. Every run recorded here was made by the builder.
