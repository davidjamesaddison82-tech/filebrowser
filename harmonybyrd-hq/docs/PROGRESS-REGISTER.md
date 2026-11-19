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
| Browser suite | The sign-in throttle counted successful sign-ins and could lock out normal use | Count failures only; clear on success (later replaced by a per-name delay with no lock-out; see below) |
| Browser suite | After acceptance the proposal page lost its confirmation and showed the new value as “before” | The page shows the recorded outcome and the true earlier value |
| Browser suite | The token form's input pattern was invalid and ignored by the browser | Pattern corrected |
| Real-data check | With real volumes, registers were tens of thousands of pixels long, the module map was unreadable, and one page scrolled sideways | Paging, folding, a map that shows connections on demand, wrapping of long identifiers |
| Real-data check | The dashboard counted inspected-but-empty repositories and un-ingested artefacts as “sources read” | Count only sources with a text snapshot |

## Adversarial review and fixes

| Step | Status | Evidence |
| --- | --- | --- |
| Adversarial review: seven reviewers who had not written HQ, one lens each (database governance; sign-in, sessions and API; evidence integrity; honesty of derived figures; screens; documentation; tests), each in its own database; every finding then checked by a second reviewer trying to refute it | **done** — 71 findings confirmed by reproduction, none refuted | docs/REVIEW-FINDINGS.md (generated) |
| Fix stage 1 — database rules: what a proposal may assert (verified quotations, labels, protected and build-only fields), acceptance binding, reserved ids, decision references; the write path, seal chain, audit-log wrappers, proposal state order, session epochs; evidence-pack rules and derived figures | **done** | `supabase/migrations/0005_proposal_evidence_rules.sql`, `0006_write_path_audit_sessions.sql`; `src/lib/domain/`; `tests/db/proposal-evidence-rules.test.ts`, `acceptance-binding.test.ts`, `write-path.test.ts`, `chain-verification.test.ts`, `proposal-states.test.ts`, `audit-log.test.ts`, `sessions.test.ts`, `founder-gate.test.ts`, `setup-files.test.ts`; `tests/unit/schemas.test.ts`, `derive-honesty.test.ts`, `pack.test.ts` |
| Fix stage 2 — sign-in, sessions, HTTP and MCP, screens: delay instead of lock-out, safe redirect, ending sessions, body cap, batch handling, strict tool arguments, look-up limits, start-up check; pinned-revision bar and links, type guards, inbox-origin marking, acceptance lock, rejected standing, seal on *Review items* | **done** | `src/lib/auth/`, `src/lib/server/`, `src/app/`, `src/components/`, `src/lib/ui/`; `tests/unit/sign-in.test.ts`, `http.test.ts`, `ui-screens.test.ts`; `tests/api/hardening.test.ts`, `sessions.test.ts`, `server-config.test.ts`; new tests in `tests/e2e/01-auth`, `02-navigation`, `05-governance` |
| Fix stage 3 — tests that would have stayed green with their protection deleted; documentation | **done** for the documentation (this register, docs/GOVERNANCE.md, SECURITY.md, API.md, ARCHITECTURE.md, INSTALL.md, KNOWN-GAPS.md, DECISIONS.md 24–41, FOUNDER-GUIDE.md, TESTING.md) | docs/REVIEW-FINDINGS.md for the test changes |
| Re-verification: every one of the 71 original attacks re-run against the fixes, by reviewers working in their own databases | **done** — 59 closed, 11 only partly closed, 1 a documented limit; several new defects found (a refusal message that called a rejection an acceptance, a sign-in queue that could hold the founder out, a chip label that ran past a phone screen, a phone layout test blind to it) | docs/REVIEW-FINDINGS.md (generated) |
| Second round of fixes (F1–F12): a proposal can never assert acceptance; what counts as an acceptance instrument; `service_role` limited to the read helpers; `hq.log_access` limited to the application's action families and a size limit on audit details; sign-in without a queue, with bounded work and a device lane; the request id always the server's; “rejection” in the refusal message; the review screen for create proposals; wrapping chip labels and a phone test that sees sideways scroll; a covering detector that sees shifted and pseudo-element overlays; the session lifetime pinned by a test | **done**, with the exceptions in docs/KNOWN-GAPS.md (among them the shared limit on device lanes, and the F1 pack rule not yet run against the real pack) | `supabase/migrations/0007_review_followups.sql`; `src/lib/auth/throttle.ts`, `device.ts`; `src/lib/server/http.ts`, `services.ts`; `src/lib/domain/derive.ts`, `pack.ts`; `src/lib/ui/proposal-review.ts`; `tests/db/service-role.test.ts`; `tests/api/sign-in.test.ts`; `tests/unit/throttle.test.ts`, `session.test.ts`; `tests/e2e/06-review-labels.spec.ts`, `03b-layout-detector.spec.ts`; docs/DECISIONS.md 42–53; docs/REVIEW-FINDINGS.md for each finding |
| Re-run of every suite after the fixes | see the generated reports | docs/TEST-RESULTS.md; docs/REPEATABILITY.md |
| Limits the review showed that were not fixed | **recorded** | docs/KNOWN-GAPS.md, “Limits the adversarial review showed, not fixed” |

## Interruptions

| What | Effect | Handling |
| --- | --- | --- |
| The build container restarted (three times) | Local database and servers stopped; nothing on disk was lost | Restarted and continued each time |
| A usage limit stopped seven of the eighteen second-pass audits | Seven fragments were left un-audited | The seven audits were re-run to completion; all eighteen fragments are audited |
| OpenAI's documentation pages could not be opened | ChatGPT requirements rest on search extracts | Marked as needing confirmation wherever they are used |
