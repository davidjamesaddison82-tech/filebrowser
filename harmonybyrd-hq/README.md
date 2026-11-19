# HarmonyByrd HQ

A development command centre: one place that records what each module is for, what exists, what
has been tested, what has been accepted, what is missing — and where every statement came from.
Claude, ChatGPT and people read the same records through the same service.

Built under commission **HB-HQ-P02-R1**.

> **Standing: local, non-authoritative prototype.**
> HQ could not verify that the prerequisite commission HB-AI-P00 is completed and accepted, so it
> does not present itself as an authoritative record, and building it satisfies no acceptance gate.
> It has not been deployed and has not been connected to the Claude or ChatGPT applications.
> See [docs/KNOWN-GAPS.md](docs/KNOWN-GAPS.md).

## What it does

- **Dashboard** — ecosystem map, development health, missing and forgotten work, recent changes, priorities.
- **Module atlas** — every module with its purpose, loops, capabilities, builds, defects, evidence,
  connections and blockers, on twelve independent lifecycle dimensions (never one percentage).
- **Learning-loop explorer** — each loop in its source's own steps, mapped onto a shared progression only where the source supports it.
- **Founder requirements register** — the exact original wording, kept permanently apart from any interpretation.
- **Development and evidence register** — commissions, builds, tests, defects, decisions, in an append-only, hash-chained history.
- **Source inventory** — what was actually read (location, version, checksum, authority) and what is only named.
- **Proposal inbox and founder decision centre** — anyone permitted may propose; only the founder, signed in as a person, can accept, reject or decide.
- **One API for every client** — 18 tools, identical over REST and MCP. Every answer is stamped with the dataset revision it came from; every read tool except two can be pinned to an earlier revision (docs/API.md).

Three rules are enforced by the database, not by convention:

1. **Nothing without a source.** A record gets in only if every quotation in it is found, verbatim, in the snapshot of the document it cites. This is checked when a pack is imported and again for every proposal, when it is submitted and when the founder accepts it. A quotation must be at least twelve characters long once spacing is normalised. A verbatim quotation shows that the words are in the source, not that they are about what they are attached to, so whatever enters through the proposal inbox is the submitter's claim: only an import can label something as reported by a source, and records HQ did not write (evidence a source reports or HQ's build checked, sources HQ has read) cannot be rewritten by proposal. A loop or pathway a source describes can be changed by proposal only together with relabelling it as the submitter's claim, and what identifies a build and a module's evidence level only by an import (docs/GOVERNANCE.md).
2. **Nothing is overwritten.** Every change is a new version; any earlier revision can be read exactly as it stood.
3. **No one approves their own work.** No API token — of an AI client, a developer or anyone — can review a proposal, record an acceptance or change a requirement's standing. No proposal can even claim an acceptance, or change a build a source reports as accepted except to withdraw that report: acceptance is recorded only by a founder decision in HQ, or reported by an imported source. Nor can a proposal say a requirement is implemented and tested, or change one that is without moving it to another state. The database checks the values that drive these labels, and the fields each record type has, itself, so a proposal that goes round the application cannot store a build standing such as `accepted`, a founder-acceptance state such as `Yes`, or a look-alike field such as `"hq_acceptance "` either.

## Quick start

Requirements: Node.js 22.12 or later, PostgreSQL 16. For the browser tests, the Chromium that
Playwright drives (`npx playwright install chromium`); for the mutation check, `python3`.

From the repository's root (the folder that holds `harmonybyrd-hq`):

```bash
cd harmonybyrd-hq
npm install
docker compose up -d        # or point .env.local at any PostgreSQL 16 server (see docs/INSTALL.md)
npm run setup               # creates or completes .env.local, migrates, creates identities, imports the pack
npm run dev                 # http://localhost:3210
```

On a PostgreSQL server that already holds another HQ installation, give this one its own
application role name in `DATABASE_URL` first: setup stops rather than change the password of a
role that exists, and stops too if an existing role is a superuser or has another attribute HQ's
application role must not have (docs/INSTALL.md).

`npm run setup` prints a passphrase for each local identity (founder, developer, reader) and an
API token for each AI client (claude, chatgpt). They are also saved in `.hq-local-credentials.json`,
which git ignores.

The repository contains only a **synthetic fixture pack** (`data/packs/fixture`). The real evidence
pack is private and is delivered separately; put it at `data/packs/harmonybyrd-evidence` and set
`HQ_PACK_DIR` to that path before running `npm run setup` (see docs/INSTALL.md).

## Checks

```bash
npm run test:all       # type check, unit, database, build, HTTP (REST + MCP), browser
npm run test:repeat    # run the suites twice from a clean database and compare every outcome
npm run test:mutation  # remove one database protection at a time and check that a test notices
```

[docs/TEST-RESULTS.md](docs/TEST-RESULTS.md) is a generated report of one run. It names the commit it
was made on and describes that commit, not necessarily the code as it is now.

An adversarial review confirmed 71 defects by reproduction. The reviewers had not written the code,
but they — like the engineers who fixed the defects and the verifiers who re-checked the fixes — were
AI agents of the same build process, not independent people. The defects were fixed in rounds, and
each of the first four rounds was re-checked by re-running the attacks. The re-check of the third round (migration
0008) gave 38 results: 24 fixed, 13 only partly fixed and 1 a documented limit; it found 30 new
defects, none of high severity, 8 of medium and 22 of low. The re-check of the fourth round
(migration 0009) gave 47 results: 38 fixed and 9 only partly fixed; it found 27 new defects, none of
high severity, 9 of medium and 18 of low. A fifth and last round (migration 0010) fixed what it found
and was **not re-checked** by anyone. Each finding, and what was done about it, is in
[docs/REVIEW-FINDINGS.md](docs/REVIEW-FINDINGS.md) (generated) and
[docs/PROGRESS-REGISTER.md](docs/PROGRESS-REGISTER.md); what remains is in
[docs/KNOWN-GAPS.md](docs/KNOWN-GAPS.md). None of this satisfies an acceptance gate.

Every file the application needs is in the repository, `next.config.mjs` and the mutation runner
included, although the repository around this folder ignores `*.mjs`; `tests/unit/repository-files.test.ts`
fails if git would ignore one.

## Documents

| | |
| --- | --- |
| [docs/FOUNDER-GUIDE.md](docs/FOUNDER-GUIDE.md) | A fifteen-minute walk through the application |
| [docs/INSTALL.md](docs/INSTALL.md) | Installing, operating, backing up, importing a pack |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it is built, and why |
| [docs/GOVERNANCE.md](docs/GOVERNANCE.md) | Roles, proposals, founder authority, what cannot be done |
| [docs/SECURITY.md](docs/SECURITY.md) | Security model, privacy boundaries, what was not reviewed |
| [docs/API.md](docs/API.md) | REST and MCP reference |
| [docs/CONNECTING-AI-CLIENTS.md](docs/CONNECTING-AI-CLIENTS.md) | Connecting Claude and ChatGPT: what is tested, what is not |
| [docs/TESTING.md](docs/TESTING.md) | What each suite proves, the acceptance checks, what is not tested |
| [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md) | Generated report of one full run, on the commit it names |
| [docs/REPEATABILITY.md](docs/REPEATABILITY.md) | Generated report of one run-twice comparison, on the commit it names |
| [docs/REVIEW-FINDINGS.md](docs/REVIEW-FINDINGS.md) | Generated report of the adversarial review: every finding and what was done |
| [docs/KNOWN-GAPS.md](docs/KNOWN-GAPS.md) | Gaps, blocked integrations, limits |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Engineering decisions and their reasons |
| [docs/PROGRESS-REGISTER.md](docs/PROGRESS-REGISTER.md) | What was done, in order, with evidence |
| [docs/HANDOVER.md](docs/HANDOVER.md) | Handover: files, branch, hashes |
