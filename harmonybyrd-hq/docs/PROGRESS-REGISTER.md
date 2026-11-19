# Progress and evidence register

A durable record of what was done under commission HB-HQ-P02-R1, in order, and what shows it.
“Evidence” names a file in the repository, a command whose output can be reproduced, or the private
findings package. Statements about the real evidence pack are summarised here and detailed in that package.

Status words: **done** (built and checked as described), **partial**, **blocked**, **not attempted**.

## Phase 0 — evidence and architecture

| Step | Status | Evidence |
| --- | --- | --- |
| Look for the governing documents the commission names | **blocked** — none could be reached | Source inventory; `hq_check` evidence records for the Drive and repository look-ups and the term search |
| Capture every accessible source, byte-exact, with SHA-256 | **done** — 43 shared documents and builds, plus the commission text | Source records (location, version, bytes, checksum); every checksum re-computed when the pack was built |
| Classify each source's authority; inventory what was only named | **done** | Source inventory, “named, not accessible” register |
| Extract records with verbatim quotations; audit each extract against its source | **done** for the 40 HarmonyByrd sources; 3 artefacts of a different product inventoried, not ingested | Private package: extracts, audit notes |
| Synthesise canonical records by module cluster; adversarially audit each cluster | **done** — 18 fragments, each audited by a second, sceptical pass that corrected overstatements | Private package: fragments, audit results |
| Determine the P00/P02 gate | **done** — P00 acceptance cannot be verified; no accessible source mentions it | Open items and `hq_check` evidence in the pack; banner; *Sources → governance gate* |
| Schema and safe implementation boundary | **done** | `supabase/migrations`, docs/ARCHITECTURE.md, docs/SECURITY.md |

## Phase 1 — working local HQ

| Step | Status | Evidence |
| --- | --- | --- |
| Database schema, migrations, local PostgreSQL, seed loader | **done** | `supabase/migrations/0001–0004`, `scripts/migrate.ts`, `scripts/seed.ts`; database suite |
| Evidence-pack format with quotation verification | **done** | `src/lib/domain/pack.ts`; `tests/unit/pack.test.ts`; `npm run pack:verify` |
| Application shell, dashboard, module atlas, loop explorer, requirements register, evidence register, source inventory, search | **done** | `src/app/(hq)`; browser suite |
| Real records imported where they could be verified; synthetic fixtures clearly marked otherwise | **done** — real pack imports with every quotation verified; the fixture pack is labelled synthetic on every screen | `npm run pack:verify`; banner |

## Phase 2 — governance and proposal workflow

| Step | Status | Evidence |
| --- | --- | --- |
| Roles, row-level security, audit log | **done** | Migration 0004; `tests/db/access-control.test.ts` |
| Revision-aware proposals, isolated inbox, stale handling | **done** | Migration 0003; `tests/db/stale-writes.test.ts`; browser suite |
| Protected fields; founder-only review and decisions | **done** | `tests/db/founder-authority.test.ts`; browser suite |
| Append-only history, hash chain, pinned revisions | **done** | Migration 0002; `tests/db/immutability.test.ts`, `pinned-revision.test.ts` |
| Founder decision centre | **done** | `src/app/(hq)/decisions`; browser suite |

## Phase 3 — external integration preparation

| Step | Status | Evidence |
| --- | --- | --- |
| REST API | **done** | `src/app/api/v1`; `tests/api/rest.test.ts`; docs/API.md |
| MCP endpoint | **done** at protocol level — tested with the official SDK client | `src/app/api/mcp`; `tests/api/mcp.test.ts` |
| Connection from the Claude application | **not attempted** — untested (Claude Code) or blocked (needs a public deployment) | docs/CONNECTING-AI-CLIENTS.md |
| Connection from ChatGPT | **blocked** — needs OAuth 2.1 and a public deployment | docs/CONNECTING-AI-CLIENTS.md |
| GitHub adapter (read-only) | **partial** — built; failure handling tested; never run against a real repository | `src/lib/integrations/github.ts`; `tests/unit/integrations.test.ts` |
| Google Drive adapter (read-only) | **partial** — built; failure handling tested; never run against a real Drive | `src/lib/integrations/drive.ts`; same tests |
| Supabase project | **not attempted** — no credentials | docs/KNOWN-GAPS.md |
| Broader writes, production integrations, deployment | **not attempted** — not authorised | — |

## Tests

| Step | Status | Evidence |
| --- | --- | --- |
| Unit, database, HTTP and browser suites covering the thirteen acceptance checks, with negative tests | **done** | docs/TESTING.md; docs/TEST-RESULTS.md (generated) |
| Repeatability | **done** | `npm run test:repeat`; `test-results/repeatability.json` |

## Defects found and fixed during the build

| Found by | Defect | Fix |
| --- | --- | --- |
| Database suite | A decision recorded in HQ failed its own schema (label needing a citation, none given) | Label corrected in migration 0003 |
| Browser suite | The sign-in throttle counted successful sign-ins and could lock out normal use | Count failures only; clear on success (later replaced by a growing delay with no lock-out; see below) |
| Browser suite | After acceptance the proposal page lost its confirmation and showed the new value as “before” | The page shows the recorded outcome and the true earlier value |
| Browser suite | The token form's input pattern was invalid and ignored by the browser | Pattern corrected |
| Real-data check | With real volumes, registers were tens of thousands of pixels long, the module map was unreadable, and one page scrolled sideways | Paging, folding, a map that shows connections on demand, wrapping of long identifiers |
| Real-data check | The dashboard counted inspected-but-empty repositories and un-ingested artefacts as “sources read” | Count only sources with a text snapshot |

## Adversarial review and fixes

| Step | Status | Evidence |
| --- | --- | --- |
| Adversarial review: seven reviewers who had not written HQ — AI agents of the same build process, not independent people — one lens each (database governance; sign-in, sessions and API; evidence integrity; honesty of derived figures; screens; documentation; tests), each in its own database; every finding then checked by a second reviewer trying to refute it | **done** — 71 findings confirmed by reproduction, none refuted | docs/REVIEW-FINDINGS.md (generated) |
| Fix stage 1 — database rules: what a proposal may assert (verified quotations, labels, protected and build-only fields), acceptance binding, reserved ids, decision references; the write path, seal chain, audit-log wrappers, proposal state order, session epochs; evidence-pack rules and derived figures | **done** | `supabase/migrations/0005_proposal_evidence_rules.sql`, `0006_write_path_audit_sessions.sql`; `src/lib/domain/`; `tests/db/proposal-evidence-rules.test.ts`, `acceptance-binding.test.ts`, `write-path.test.ts`, `chain-verification.test.ts`, `proposal-states.test.ts`, `audit-log.test.ts`, `sessions.test.ts`, `founder-gate.test.ts`, `setup-files.test.ts`; `tests/unit/schemas.test.ts`, `derive-honesty.test.ts`, `pack.test.ts` |
| Fix stage 2 — sign-in, sessions, HTTP and MCP, screens: delay instead of lock-out, safe redirect, ending sessions, body cap, batch handling, strict tool arguments, look-up limits, start-up check; pinned-revision bar and links, type guards, inbox-origin marking, acceptance lock, rejected standing, seal on *Review items* | **done** | `src/lib/auth/`, `src/lib/server/`, `src/app/`, `src/components/`, `src/lib/ui/`; `tests/unit/sign-in.test.ts`, `http.test.ts`, `ui-screens.test.ts`; `tests/api/hardening.test.ts`, `sessions.test.ts`, `server-config.test.ts`; new tests in `tests/e2e/01-auth`, `02-navigation`, `05-governance` |
| Fix stage 3 — tests that would have stayed green with their protection deleted; documentation | **done** for the documentation (this register, docs/GOVERNANCE.md, SECURITY.md, API.md, ARCHITECTURE.md, INSTALL.md, KNOWN-GAPS.md, DECISIONS.md 24–41, FOUNDER-GUIDE.md, TESTING.md) | docs/REVIEW-FINDINGS.md for the test changes |
| Re-verification: every one of the 71 original attacks re-run against the fixes, by reviewers working in their own databases (AI agents of the same build process, as were the engineers who made each round's fixes and every later verifier) | **done** — 59 closed, 11 only partly closed, 1 a documented limit; four new defects: a refusal message that called a rejection an acceptance, a sign-in queue that could hold the founder out (reported twice, through two lenses), and a chip label that ran past a phone screen. The coordinator then found that the phone layout test could not see that overflow | docs/REVIEW-FINDINGS.md (generated) |
| Second round of fixes (F1–F12): a proposal can never assert acceptance; what counts as an acceptance instrument; `service_role` limited to the read helpers; `hq.log_access` limited to the application's action families and a size limit on audit details; sign-in without a queue, with bounded work and a device lane; the request id always the server's; “rejection” in the refusal message; the review screen for create proposals; wrapping chip labels and a phone test that sees sideways scroll; a covering detector that sees shifted and pseudo-element overlays; the session lifetime pinned by a test | **done**, but see the next row: the re-check found ways round several of these rules | `supabase/migrations/0007_review_followups.sql`; `src/lib/auth/throttle.ts`, `device.ts`; `src/lib/server/http.ts`, `services.ts`; `src/lib/domain/derive.ts`, `pack.ts`; `src/lib/ui/proposal-review.ts`; `tests/db/service-role.test.ts`; `tests/api/sign-in.test.ts`; `tests/unit/throttle.test.ts`, `session.test.ts`; `tests/e2e/06-review-labels.spec.ts`, `03b-layout-detector.spec.ts`; docs/DECISIONS.md 42–53; docs/REVIEW-FINDINGS.md for each finding |
| Re-check of the second round, by five reviewers working in their own databases | **done** — of 23 results, 10 fixed, 12 only partly fixed, 1 a documented limit (one finding, docs-1, was checked by two reviewers and is counted twice, so the 23 results cover 22 findings); 16 new defects, one of them high (sign-in names of any length kept in the server's memory, so long names could stop the server). Most of the rest were ways round the acceptance rules by calling the database functions directly: a build's reported acceptance could be relabelled, widened or moved, a value outside its list (`accepted`, `Yes`, a list) could be stored, and a screen could fail on such a value. Also: unbounded audit action names, a cleared HQ acceptance still counted as an instrument, lane eviction that forgot a name under attack, MCP answers without a request id, three `.mjs` files never committed, layout detector blind spots, and false sentences in these documents | Reviewers' results, held with the builder's working files (not in the repository) |
| Third round of fixes (G1–G11): a build reported as accepted is frozen for proposals except to withdraw the report; a module's reported acceptance must stay identical as a whole, and any state but no, unknown or not applicable is positive; the database checks the values that drive labels itself; accepting a proposal re-validates the whole record; a cleared HQ acceptance is no instrument; every reader — screens, REST and MCP — computes on stored records of the wrong shape conformed to their schema, shows odd values as “Not a valid value”, and says in each answer which records are not valid, with their stored form (G11a); one proposal-impact function (G11b); a passphrase longer than sign-in accepts cannot be set (G11c); audit action names bounded, and a list of refused words meant to keep out names that read like a founder act (the re-check found some still went through; the fourth round replaced the list); the request id a direct database caller passes documented as a limit; the `.mjs` files committed and a test that git ignores nothing the application needs; the layout detector measures part-way down and ignores what is not drawn; sign-in name and passphrase length limits; an eviction order that keeps what matters; a request id on every MCP answer; these documents corrected | **done**; re-checked (next row) | `supabase/migrations/0008_review_round3.sql`; `src/lib/domain/schemas.ts`, `derive.ts`, `conform.ts`; `src/lib/server/store.ts`, `tools.ts`; `scripts/lib/principals.ts`; `src/lib/server/services.ts`, `page.ts`; `src/lib/ui/format.ts`, `proposal-review.ts`; `src/components/ui.tsx`, `lifecycle.tsx`; `src/lib/auth/sign-in-input.ts`, `throttle.ts`, `safe-next.ts`; `src/app/sign-in/actions.ts`; `src/app/api/mcp/route.ts`; `src/app/api/v1/tools/[name]/route.ts`; `tests/db/acceptance-claims.test.ts`, `field-enums.test.ts`, `audit-log.test.ts`; `tests/unit/repository-files.test.ts`, `throttle.test.ts`, `sign-in.test.ts`, `schemas.test.ts`, `derive-honesty.test.ts`; `tests/api/sign-in.test.ts`, `mcp.test.ts`, `odd-values.test.ts`; `tests/unit/conform.test.ts`, `passphrase-limit.test.ts`; `tests/db/proposal-impact.test.ts`; `tests/helpers/odd-values.ts`; `tests/e2e/03b-layout-detector.spec.ts`, `06-review-labels.spec.ts`, `07-odd-values.spec.ts`; docs/DECISIONS.md 54–69 |
| Re-check of the third round, by six verifiers working in their own databases | **done** — 38 results: 24 fixed, 13 only partly fixed, 1 a documented limit; 30 new defects, none high, 8 medium, 22 low. The rules the third round set held on every path tried, and the serious sign-in defect was closed. What remained was of three kinds: honesty of meaning (a verbatim quotation need not be about the thing a proposal attaches it to, so a module that exists only as a design could be made to read “Tested — not accepted”), the conformed view of records that fail validation (it could still make things read better than stored), and these documents | Verifiers' results, held with the builder's working files (not in the repository) |
| Fourth round of fixes (H1–H13): what enters through the inbox is the submitter's claim, and only an import labels something as reported by a source; evidence a source reports or HQ's build checked, and sources HQ has read, are frozen for proposals; “implemented and tested” is not a proposal's to say; a proposal sets only fields its record type has; clearing an acceptance needs one to clear; a record that fails validation never counts as proof, is flagged on every module it names, and its marker cannot be written back; error messages cut what the client sent, and refusal rows of callers without an identity are bounded; every API answer carries a request id, whatever the method; a second installation on one server cannot change the application role's password; the layout detector also measures where each sticky element is stuck, and no longer reports a box clipped away entirely; `hq.log_access` takes an exact list of actions; refusals at acceptance carry the same detail as at submission; these documents corrected | **done**, **not yet re-checked** by anyone other than the engineers who made the fixes | `supabase/migrations/0009_review_round4.sql`; `scripts/migrate.ts`; `src/lib/server/services.ts`, `tools.ts`, `http.ts`, `db.ts`, `audit-limit.ts`; `src/lib/domain/schemas.ts`, `conform.ts`, `derive.ts`; `src/app/api/` (every route), `src/app/sign-in/actions.ts`; `src/app/(hq)/` and `src/components/` (the propose form, the record, module, register and dashboard pages); `tests/db/proposal-claims.test.ts`, `record-fields.test.ts`, `app-role.test.ts`, `audit-log.test.ts`; `tests/api/methods.test.ts`, `echo-bounds.test.ts`, `audit-volume.test.ts`, `odd-values.test.ts`; `tests/unit/audit-limit.test.ts`, `conform.test.ts`, `http.test.ts`; `tests/e2e/layout-measure.ts`, `03b-layout-detector.spec.ts`, `07-odd-values.spec.ts`; `tests/mutation/gen.py`; docs/DECISIONS.md 70–82 |
| Test reports | See each report: docs/TEST-RESULTS.md and docs/REPEATABILITY.md are generated, and each names the commit it was made on (“Source revision”) and describes that commit only; compare it with the commit you hold. The mutation check's result, where one is recorded, is `tests/mutation/RESULTS.txt` (docs/TESTING.md) | docs/TEST-RESULTS.md; docs/REPEATABILITY.md (generated) |
| Limits the review showed that were not fixed | **recorded** | docs/KNOWN-GAPS.md, “Limits the adversarial review showed, not fixed” |

## Interruptions

| What | Effect | Handling |
| --- | --- | --- |
| The build container restarted, more than once | Local database and servers stopped; the files on disk were kept | Restarted and continued each time |
| A usage limit stopped seven of the eighteen second-pass audits | Seven fragments were left un-audited | The seven audits were re-run to completion; all eighteen fragments are audited |
| OpenAI's documentation pages could not be opened | ChatGPT requirements rest on search extracts | Marked as needing confirmation wherever they are used |
