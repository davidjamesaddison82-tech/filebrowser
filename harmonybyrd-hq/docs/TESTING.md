# Testing

Actual results of the last run are in [TEST-RESULTS.md](TEST-RESULTS.md), which `npm run test:all`
generates from the test reporters' own output. This page explains what the suites are and what they do and do not show.

## Running

```bash
npm run test:all        # type check → unit → database → build → HTTP → browser; writes docs/TEST-RESULTS.md
npm run test:repeat     # unit + database suites twice from a clean database; every outcome and both hashes must match
npm run test:repeat -- --full    # the same, including the HTTP and browser suites
```

Individual suites: `npm run test:unit`, `test:db`, `test:api`, `test:e2e`.

All suites use the **synthetic fixture pack** (`data/packs/fixture`) in a separate database,
`hq_test`, which each suite resets and reseeds. They never touch the development database, and they
use no network: the GitHub and Drive adapters are tested with injected failures.

## The suites

| Suite | Where | What it exercises |
| --- | --- | --- |
| Unit | `tests/unit` | Derivations (standing, health, missing work, lineage, search), pack validation, credentials, adapters. No database |
| Database | `tests/db` | The rules as PostgreSQL enforces them, called the way the application calls them — and directly, going round the application |
| HTTP | `tests/api` | REST and MCP over real HTTP against a production build. MCP is driven by the official MCP SDK client |
| Browser | `tests/e2e` | Playwright in Chromium against a production build: sign-in, every screen, layouts at three laptop sizes and a phone, role restrictions, the full proposal → review → decision workflow |

## The commission's thirteen acceptance checks

| # | Check | Where it is tested |
| --- | --- | --- |
| 1 | Module retrieval with exact provenance | `tests/db/provenance.test.ts`; `tests/api/rest.test.ts`; browser: “a module brief shows its quotations, and each quotation names its source” |
| 2 | Requirement search with stable identifiers | `tests/unit/derive.test.ts` (AC2); `tests/e2e/02-navigation.spec.ts` (search, filter) |
| 3 | Complete linked requirement and module relationships | `tests/unit/derive.test.ts` (AC3) |
| 4 | Distinction between proposal, prototype, tested and accepted | `tests/unit/derive.test.ts` (AC4); browser: “tested and accepted are never shown as the same thing”, “the founder accepts a build; only then does HQ call it accepted” |
| 5 | The same pinned revision retrieved by two independent clients | `tests/db/pinned-revision.test.ts`; `tests/api/mcp.test.ts` (“the same answers for every client”); browser: “the earlier revision can still be read exactly as it stood” |
| 6 | Rejection of stale or conflicting writes | `tests/db/stale-writes.test.ts`; `tests/api/mcp.test.ts`; browser: “a proposal written against an old version is refused as stale, not applied” |
| 7 | Prevention of cross-role and unauthorised access | `tests/db/access-control.test.ts`; `tests/api/rest.test.ts`; `tests/e2e/04-roles.spec.ts` |
| 8 | Prevention of AI-generated founder acceptance | `tests/db/founder-authority.test.ts`; `tests/api/rest.test.ts`, `mcp.test.ts` (no approval tool exists); browser: token “cannot decide” |
| 9 | Source lineage and immutable historical records | `tests/db/immutability.test.ts`; `tests/unit/derive.test.ts` (lineage); `tests/unit/pack.test.ts` |
| 10 | Browser navigation and functional controls | `tests/e2e/01-auth`, `02-navigation`, `05-governance` |
| 11 | Responsive laptop layouts without overlays covering content | `tests/e2e/03-layout.spec.ts` — measured in the browser at 1366×768, 1280×720, 1440×900 and 390×844 |
| 12 | Safe handling of unavailable external services | `tests/unit/integrations.test.ts`; `tests/db/determinism.test.ts` (database down); `tests/api/rest.test.ts` (integrations) |
| 13 | Deterministic repeatability of critical acceptance tests | `tests/db/determinism.test.ts`; `npm run test:repeat` (`test-results/repeatability.json`) |

## Negative tests

Most of the database and HTTP tests are attempts to do something forbidden, and pass only if the
attempt is refused *and* nothing changed. Examples:

- an AI client sets `hq_acceptance` through a proposal; inserts a record version directly; calls the founder functions; forges claims;
- a developer token reviews its own proposal; records a decision;
- one AI client reads another's proposal;
- a proposal rewrites a requirement's original wording, or its standing;
- `UPDATE`, `DELETE` and `TRUNCATE` against the record history, the proposal history and the audit log;
- a pack containing a quotation that is not in its source; a pack carrying an HQ acceptance;
- a proposal written against a superseded version;
- a revoked, expired, malformed or unknown token; a forged or expired session cookie; a cross-origin request;
- a founder being issued a token; an AI client being made founder;
- repeated wrong passphrases.

## Corrections made to tests during the build

The commission says a test must never be silently changed to conceal a defect. Three test
expectations were changed while the suites were written. None concealed a defect; each is recorded here.

1. **`tests/db/access-control.test.ts` — promoting an AI client to founder.** The test first
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
sign-ins, so normal use could lock a person out; it now counts failures only.

The browser suite then found two more, both fixed in the application:

- After the founder accepted a proposal, the page lost its confirmation, and its “before” column
  showed the already-changed value (so before and proposed looked identical). The page now states
  how the proposal ended — by whom, when, which dataset revision and record version — from the
  proposal's own history, and “before” is the version the proposal was written against. The test's
  first expectation (a transient confirmation message) was replaced by assertions on that permanent outcome.
- The token form's input pattern was not a valid regular expression in current browsers, so the
  browser silently ignored it (the server still validated). Found because every browser test fails
  if the page logs an error.

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
- Independent re-execution. Every run recorded here was made by the builder.
