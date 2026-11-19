# Handover

Commission **HB-HQ-P02-R1** — HarmonyByrd HQ, central development command centre.

## What is handed over

A working local application and its evidence. Its standing: **local, non-authoritative prototype;
not accepted; not deployed; not connected to the Claude or ChatGPT applications.** The reasons are
in [KNOWN-GAPS.md](KNOWN-GAPS.md).

## Where it is

| | |
| --- | --- |
| Repository | the working repository this commission was given |
| Branch | `claude/harmonybyrd-hq-command-centre-76pgaq` |
| Folder | `harmonybyrd-hq/` (nothing outside this folder was changed) |
| Commit the recorded test runs were made on | named in [TEST-RESULTS.md](TEST-RESULTS.md) and [REPEATABILITY.md](REPEATABILITY.md) (“Source revision”). Both are regenerated on the final commit; until then each describes the commit named inside it |
| History | `git log -- harmonybyrd-hq`: the first delivery, then the fixes for the adversarial review ([REVIEW-FINDINGS.md](REVIEW-FINDINGS.md)) in three rounds ([PROGRESS-REGISTER.md](PROGRESS-REGISTER.md)) |
| File checksums | [FILE-MANIFEST.sha256](FILE-MANIFEST.sha256) — SHA-256 of every file in the folder at hand-over |

To produce a source package of exactly what is on the branch:

```bash
git archive --format=zip --prefix=harmonybyrd-hq/ -o harmonybyrd-hq-source.zip HEAD:harmonybyrd-hq
```

The repository around this folder ignores `*.mjs`; HQ's own `.gitignore` un-ignores them, so
`next.config.mjs` and the mutation runner (`tests/mutation/run.mjs`, `vitest.mut.config.mjs`) are on
the branch and in the archive. `tests/unit/repository-files.test.ts` fails if git would ignore a file
the application needs.

## Two packages

**1. This repository (public).** Application source, migrations, tests, a synthetic fixture pack and
the documents listed below. It contains no founder document, no real record and no secret.

**2. The private package (delivered separately, not in the repository).** The working repository is
public, and the founder's documents were not authorised for publication, so everything derived from them is kept apart:

| In the private package | What it is |
| --- | --- |
| `harmonybyrd-evidence/` | The real evidence pack: records with verbatim quotations, and the source text snapshots they are verified against. Put it at `data/packs/harmonybyrd-evidence` to use it |
| `FINDINGS.md` | What HQ found: standing, the P00/P02 determination, the answers to the commission's eight questions, gaps, how far to trust the records |
| `SOURCE-INVENTORY.md` | Every source: what was read, location, version, size, checksum, authority class; and every document that is only named |
| `NEXT-COMMISSION.md` | Recommendation for the next commission |
| `screenshots/` | The running application with the real records loaded |
| `corpus/` | The working material behind the pack: captured originals, extracts, audit notes, cluster fragments, audit results |
| `build/` | The scripts that assemble the pack and the findings from that material |
| `PACKAGE-HASHES.txt` | SHA-256 of the package's files |

## The commission's fourteen deliverables

| # | Deliverable | Where |
| --- | --- | --- |
| 1 | Runnable local application | this folder; `npm run setup && npm run dev` ([INSTALL.md](INSTALL.md)) |
| 2 | Source code | `src/`, `scripts/`, `tests/` |
| 3 | Database schema and migrations | `supabase/migrations/0001_foundation.sql` … `0008_review_round3.sql` |
| 4 | Installation and operating documentation | [INSTALL.md](INSTALL.md), [../README.md](../README.md) |
| 5 | Source inventory | In the application under *Sources*; `SOURCE-INVENTORY.md` in the private package |
| 6 | Module and learning-loop explorers | In the application: *Modules*, *Learning loops* |
| 7 | Requirements and evidence registers | In the application: *Founder requirements*, *Development & evidence* |
| 8 | Shared API and MCP interface documentation | [API.md](API.md), [CONNECTING-AI-CLIENTS.md](CONNECTING-AI-CLIENTS.md) |
| 9 | Automated test suites and actual results | `tests/`; [TESTING.md](TESTING.md); [TEST-RESULTS.md](TEST-RESULTS.md) and [REPEATABILITY.md](REPEATABILITY.md) (both generated) |
| 10 | Screenshots of real running screens | `screenshots/` in the private package (they show real records) |
| 11 | Known gaps and blocked integrations | [KNOWN-GAPS.md](KNOWN-GAPS.md) |
| 12 | Source package and handover report | this document; `git archive` command above; the private package |
| 13 | Founder demonstration guide | [FOUNDER-GUIDE.md](FOUNDER-GUIDE.md) |
| 14 | Recommendation for the next commission | `NEXT-COMMISSION.md` in the private package |

Also: [ARCHITECTURE.md](ARCHITECTURE.md), [GOVERNANCE.md](GOVERNANCE.md), [SECURITY.md](SECURITY.md),
[DECISIONS.md](DECISIONS.md), [PROGRESS-REGISTER.md](PROGRESS-REGISTER.md),
[REVIEW-FINDINGS.md](REVIEW-FINDINGS.md) (the adversarial review and its fixes, generated).

## Verifying it yourself

```bash
npm install
npm run setup                 # needs PostgreSQL 16; see INSTALL.md
npm run test:all              # regenerates TEST-RESULTS.md
npm run test:repeat -- --full # runs every suite twice and compares each outcome
sha256sum -c docs/FILE-MANIFEST.sha256   # from the harmonybyrd-hq folder
```

With the private package:

```bash
npm run pack:verify -- data/packs/harmonybyrd-evidence   # every record, every quotation
```

## Recorded test run

See [TEST-RESULTS.md](TEST-RESULTS.md) and [REPEATABILITY.md](REPEATABILITY.md). Both were made by the
builder, on the commit each names. Nobody else has re-run them, and a passing run is not an acceptance of HQ.

## What the next person needs to know first

1. HQ's records come from an **evidence pack**. To change what HQ knows wholesale, build a new pack
   and import it; to change one record, use a proposal. Never edit the database by hand. The
   database refuses every write outside HQ's own write paths, but its owner or a superuser can
   bypass that: `hq.verify_chain()` then shows deleted or rewritten versions through the revision
   seals and the seal chain, and only a copy of the latest seal kept outside the database
   (`hq.head_seal()`, shown on *Review items*) shows a rewrite of history and seals together.
2. The rules that matter are in **`supabase/migrations/0002`–`0008`**, not in the screens. Read
   [GOVERNANCE.md](GOVERNANCE.md) and the database tests before changing them. Each function a later
   migration replaced carries a header listing its rules and the migration that added each. A new
   function must have EXECUTE revoked from PUBLIC in its own migration: PostgreSQL grants it by
   default, and `tests/db/service-role.test.ts` fails if any function in `hq` is left executable.
3. `src/lib/domain/derive.ts` is where every figure on every screen comes from. The screens, the
   REST API and the MCP tools all call it; change it once and all three change together.
4. A migration that has been applied must not be edited: add a new one. The migration runner checks.
5. The real pack and anything derived from the founder's documents must stay out of this repository unless the founder decides otherwise.
