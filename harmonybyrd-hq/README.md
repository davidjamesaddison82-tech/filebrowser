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

1. **Nothing without a source.** A record gets in only if every quotation in it is found, verbatim, in the snapshot of the document it cites. This is checked when a pack is imported and again for every proposal, when it is submitted and when the founder accepts it. A quotation must be at least twelve characters long once spacing is normalised.
2. **Nothing is overwritten.** Every change is a new version; any earlier revision can be read exactly as it stood.
3. **No one approves their own work.** No API token — of an AI client, a developer or anyone — can review a proposal, record an acceptance or change a requirement's standing. No proposal can even claim an acceptance: acceptance is recorded only by a founder decision in HQ, or reported by an imported source.

## Quick start

Requirements: Node.js 22.12 or later, PostgreSQL 16.

```bash
cd harmonybyrd-hq
npm install
docker compose up -d        # or point .env.local at any PostgreSQL 16 server (see docs/INSTALL.md)
npm run setup               # creates or completes .env.local, migrates, creates identities, imports the pack
npm run dev                 # http://localhost:3210
```

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

Actual results of the last run are in [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md). An adversarial
review, by reviewers who had not written the code, confirmed 71 defects by reproduction. Every
original attack was then re-run against the fixes, and a second round fixed what was only partly
closed. Each finding, and what was done about it, is in [docs/REVIEW-FINDINGS.md](docs/REVIEW-FINDINGS.md)
(generated); what remains is in [docs/KNOWN-GAPS.md](docs/KNOWN-GAPS.md). None of this satisfies an
acceptance gate.

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
| [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md) | Generated report of the last run |
| [docs/REPEATABILITY.md](docs/REPEATABILITY.md) | Generated report of the last run-twice comparison |
| [docs/REVIEW-FINDINGS.md](docs/REVIEW-FINDINGS.md) | Generated report of the adversarial review: every finding and what was done |
| [docs/KNOWN-GAPS.md](docs/KNOWN-GAPS.md) | Gaps, blocked integrations, limits |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Engineering decisions and their reasons |
| [docs/PROGRESS-REGISTER.md](docs/PROGRESS-REGISTER.md) | What was done, in order, with evidence |
| [docs/HANDOVER.md](docs/HANDOVER.md) | Handover: files, branch, hashes |
