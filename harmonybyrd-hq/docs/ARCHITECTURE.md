# Architecture

## The shape of it

```
 Browser (founder, developer, reader)        Claude · ChatGPT · scripts
            │  session cookie                          │  bearer token (one per client)
            ▼                                          ▼
 ┌──────────────────────────── Next.js 16 application server ────────────────────────────┐
 │  Pages (server components)      REST  /api/v1/tools/<name>        MCP  /api/mcp          │
 │            └────────────── one tool registry (src/lib/server/tools.ts) ───────────────┘ │
 │  services.ts  — every read and write, for every interface                                │
 │  derive.ts    — pure functions over an immutable Dataset snapshot                        │
 │  db.ts        — per-request transaction:  SET LOCAL ROLE … ; request.jwt.claims = {…}    │
 └───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                             ▼
 ┌──────────────────────────────── PostgreSQL 16, schema hq ──────────────────────────────┐
 │  record_versions (append-only, hash-chained)     dataset_revisions (sealed, hashed)     │
 │  proposals + proposal_events (isolated inbox)    audit_log (append-only)                │
 │  principals · login_secrets · api_credentials                                           │
 │  row-level security · SECURITY DEFINER functions · triggers that refuse forbidden writes│
 └─────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ import (owner connection, scripts only)
 Evidence pack: records/*.json + source-text/*.md  — verified quotation by quotation before import
```

Stack, as the commission prefers: Next.js and TypeScript; PostgreSQL with Supabase-style roles,
row-level security and audit history; an authenticated API with an MCP endpoint; Playwright and
Vitest. GitHub and Google Drive are reached through read-only adapters; HQ stores references, never copies of code.

## Records

Twelve record types: `source`, `module`, `loop`, `pathway`, `requirement`, `decision`, `commission`,
`build`, `evidence`, `defect`, `open_item`, `recommendation`. Their shapes are defined once, in
`src/lib/domain/schemas.ts`, and used to validate imports, to validate proposals and to type every read.

**A statement always says what kind of statement it is.** A factual field is a *claim*: text, an
epistemic label and citations.

| Label | Meaning |
| --- | --- |
| `verified` | HQ checked it directly in this build (for example, a checksum recomputed from bytes) |
| `reported` | A source states it as fact; HQ has not verified it |
| `design_intention` | A source states it as a plan, design or specification |
| `source_recommendation` | The opinion of a document's author |
| `founder_statement` | Words or a ruling a source attributes to the founder |
| `hq_recommendation` | A recommendation by HQ's builder; never an approval |
| `submitter_claim` | Stated by whoever submitted it through the inbox; unverified |
| `no_evidence` | Nothing accessible supports a statement either way |

A claim labelled `reported`, `design_intention`, `source_recommendation` or `founder_statement` must
carry at least one citation, and a citation is a verbatim quotation of at least twelve characters
with the id of the source it comes from.

**A module is never one percentage.** It has twelve independent lifecycle dimensions — documented,
designed, prototyped, implemented, automated tests, browser tested, hardware tested, independently
assessed, founder accepted, integrated, released, validated with learners — each `yes`, `partial`,
`no`, `unknown` or `not applicable`, each with its own basis and quotation. The headline standing
shown on the map is derived from them and can never read “accepted” because tests pass.

**A requirement has two halves.** The original (`exact_wording`, `source_id`, `locator`,
`source_date`, `attribution`) cannot be changed by anyone after import — the database refuses. The
working half (title, interpretation, links to code, tests, builds and decisions) can be changed by
accepted proposal. Its *standing* (`disposition`) can be changed only by a founder decision.

## Storage: append-only, revisioned, hash-chained

`hq.record_versions` holds every version of every record. Rows are never updated or deleted
(triggers refuse both, and `TRUNCATE`). Each row stores the SHA-256 of its content, the hash of the
previous version of the same record, and a row hash over both — a chain that `hq.verify_chain()` re-checks.

Every write belongs to a **dataset revision** (`hq.dataset_revisions`): a gapless number, a kind
(import, accepted proposal, founder decision), a summary, the commission it belongs to, who made it,
and — once sealed — a hash of the whole dataset at that revision. `hq.records_at(rev)` returns the
dataset exactly as it stood at any revision.

This gives the three things the commission asks for at once: immutable history (nothing is
overwritten), **pinned reads** (two clients that ask for revision 7 get byte-identical records,
whatever has happened since), and explicit **stale-write handling** (a proposal names the version it
was written against; if the record has moved on, the proposal is marked stale, not applied).

The application reads a revision once into an immutable in-memory `Dataset` and caches it by
revision number and content hash. Everything shown — standings, health figures, missing work,
lineage, search — is a pure function of that snapshot (`src/lib/domain/derive.ts`), which is why the
web pages, the REST API and the MCP tools cannot disagree: they call the same functions on the same snapshot.

## Evidence packs: how records get in

A pack is a folder: `manifest.json`, `records/<type>.json`, `source-text/<SOURCE-ID>.md`. Before
anything is imported (`src/lib/domain/pack.ts`):

1. every record must match its schema;
2. **every quotation must be found verbatim in the text snapshot of the source it cites**
   (only differences in spacing and line breaks are forgiven), and so must every requirement's exact wording;
3. every cited source must have a source record;
4. a pack may not carry an HQ acceptance or a decision “recorded in HQ” — those exist only through the founder's own action.

If one quotation fails, nothing is imported. This is the mechanism behind “never manufacture a
record”: a statement with no matching source text does not get in.

## Identity and access

`src/lib/server/db.ts` opens one transaction per request, switches to the PostgreSQL role
`authenticated` with `SET LOCAL ROLE`, and puts the caller's identity in `request.jwt.claims` — the
same model Supabase's API layer uses. The application's own login role (`hq_app`) owns nothing and
has no privileges except to assume the API roles, so a bug in the web application cannot bypass the database's rules.

- **People** sign in with a passphrase (scrypt). The session is a signed, HTTP-only cookie.
- **AI clients and scripts** present a bearer token of the form `hbq_<id>_<secret>`; only its SHA-256 is stored.
- Reads run in `READ ONLY` transactions. A read cannot write, by construction.
- Every denial is written to the audit log in its own transaction, so it survives the rollback of the request that caused it.

## One tool registry, two transports

`src/lib/server/tools.ts` defines 18 tools (15 read, 3 that add to the inbox). The REST route
`/api/v1/tools/<name>` and the MCP endpoint `/api/mcp` both dispatch into that registry; neither has
logic of its own. The MCP endpoint is stateless Streamable HTTP with JSON responses and implements
`initialize`, `ping`, `tools/list` and `tools/call`.

Every answer is an envelope:

```json
{ "hq":           { "authority": "prototype_non_authoritative", "notice": "…" },
  "revision":     { "rev": 7, "content_hash": "…", "created_at": "…", "kind": "…", "summary": "…",
                    "pinned": false, "head_rev": 7, "is_head": true },
  "requested_by": { "handle": "claude", "…": "…" },
  "data":         { "…": "…" },
  "provenance":   { "sources": [ { "id": "…", "title": "…", "sha256": "…" } ] } }
```

## Code map

| Path | Contents |
| --- | --- |
| `supabase/migrations/0001…0004` | Roles and identities; records and revisions; governance; row-level security and grants |
| `src/lib/domain/` | Schemas, the `Dataset` snapshot, derivations, pack validation — no database, no network |
| `src/lib/server/` | Database access, the store, services, tools, HTTP helpers, server actions |
| `src/lib/auth/` | Passphrases, tokens, sessions |
| `src/lib/integrations/` | Read-only GitHub and Google Drive adapters that return failure values instead of throwing |
| `src/app/(hq)/` | The screens |
| `src/app/api/` | REST and MCP routes |
| `scripts/` | Migrate, seed, setup, credentials, pack verification, test runners |
| `tests/` | `unit`, `db`, `api`, `e2e` |
| `data/packs/fixture` | Synthetic records used by every test |
