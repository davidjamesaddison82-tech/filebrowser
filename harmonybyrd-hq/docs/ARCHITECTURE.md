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
 │  derive.ts    — pure functions over the conformed view of an immutable Dataset snapshot  │
 │  db.ts        — per-request transaction:  SET LOCAL ROLE … ; request.jwt.claims = {…}    │
 └───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                             ▼
 ┌──────────────────────────────── PostgreSQL 16, schema hq ──────────────────────────────┐
 │  record_versions (append-only, hash-chained)     dataset_revisions (sealed, seal chain) │
 │  proposals + proposal_events (isolated inbox)    audit_log (append-only)                │
 │  source_texts (owner-only)                       _write_context (owner-only)            │
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
The fields whose value comes from a fixed list are also held in the database (`hq.field_enums`, the
same rows as `FIELD_ENUMS` in `schemas.ts`; a test compares them), so the database refuses a value
outside its list in a proposal even when a caller goes round the application.

**A statement always says what kind of statement it is.** A factual field is a *claim*: text, an
epistemic label and citations.

| Label | Meaning |
| --- | --- |
| `verified` | Shown as “Checked by HQ's build”: the build that produced this dataset checked it directly (for example, a checksum recomputed from bytes). The running application does not re-run that check |
| `reported` | A source states it as fact; HQ has not verified it |
| `design_intention` | A source states it as a plan, design or specification |
| `source_recommendation` | The opinion of a document's author |
| `founder_statement` | Words or a ruling a source attributes to the founder |
| `hq_recommendation` | A recommendation by HQ's builder; never an approval |
| `submitter_claim` | Stated by whoever submitted it through the inbox; unverified |
| `no_evidence` | Nothing accessible supports a statement either way |

A claim labelled `reported`, `design_intention`, `source_recommendation` or `founder_statement` must
carry at least one citation, and a citation is a verbatim quotation, with the id of the source it
comes from, of at least twelve characters once spacing is normalised (every run of whitespace counts
as one space, and leading and trailing spaces do not count). A proposal may never use `verified` or
`hq_recommendation` (docs/GOVERNANCE.md).

**A module is never one percentage.** It has twelve independent lifecycle dimensions — documented,
designed, prototyped, implemented, automated tests, browser tested, hardware tested, independently
assessed, founder accepted, integrated, released, validated with learners — each `yes`, `partial`,
`no`, `unknown` or `not applicable`, each with its own basis and quotation. The headline standing
shown on the map is derived from them and can never read “accepted” because tests pass. A `yes` or
`partial` counts towards the standing only if a source supports it (basis `reported`,
`design_intention`, `source_recommendation` or `founder_statement`, with a citation) or its basis is
`verified`; a reported founder acceptance must have the basis `reported` or `founder_statement`. A
build's standing `accepted_reported` counts as a reported acceptance only when its statement is
labelled `reported` or `founder_statement` and quotes a source; otherwise it is shown as “Acceptance
claimed — no source quoted”. Neither kind of acceptance can be introduced by a proposal, and a build a
source reports as accepted can be changed by proposal only to withdraw the report (docs/GOVERNANCE.md). A
submitter's claim never raises a standing; it is listed under *Unverified claims*. A founder
rejection recorded in HQ gives the standing “Founder rejected in HQ”, which outranks everything else.

**A requirement has two halves.** The original (`exact_wording`, `source_id`, `locator`,
`source_date`, `attribution`) cannot be changed by anyone once the requirement exists — the database
refuses. A proposal that creates a requirement gives them, and its wording must occur verbatim in its
source (at least eight non-space characters). The working half (title, interpretation, links to code,
tests, builds and decisions) can be changed by accepted proposal. Its *standing* (`disposition`) can
be changed only by a founder decision. A requirement is outstanding until it is recorded as
implemented and tested **and** has linked evidence that a source reports or HQ's build checked.

**Dates** (`doc_date`, `updated`, `source_date`, `date`) are `YYYY-MM-DD…` or null.

**Fields only HQ's build writes** are declared in the schemas with exact types, so a pack with a
wrongly typed one is refused at import, and no proposal can set them:

| Type | Field | Shape |
| --- | --- | --- |
| every type | `recorded_from_cluster` | text |
| module | `addenda_from_clusters` | list of text |
| module | `commission_entry` | text |
| module | `lifecycle_other_reports` | per lifecycle dimension, a list of entries with the same rules as a lifecycle entry |
| decision, build | `other_mentions` | a list of the other documents' mentions merged into this record, each with its own statement and citations |
| build | `possibly_same_as` | list of build ids |
| build | `code_ref` | repository, ref, commit (or null) |
| evidence | `search_results` | list of search terms, each with the sources and hit counts |
| requirement | `linked_tests` | list of text |
| source | `doc_kind`, `content_kind`, `importance`, `identifiers` | text or null |
| source | `other_names` | list of text |

An HQ acceptance (`hq_acceptance`) also stores `accepted_version`, the record version the founder's
decision wrote. Record schemas still keep keys they do not know (so an older application can read a
newer pack), but the screens show only declared fields.

**A stored record that fails its schema** is still loaded, with an integrity warning. It can no longer
arrive through a proposal (the database checks the values that drive labels, and accepting a proposal
re-validates the record), but an owner-level import that skips the pack validator can store one.
Every reader — the screens, the REST API and the MCP tools — computes on it conformed to its schema
(`src/lib/domain/conform.ts`): a value of the wrong kind, or outside its list, reads “Not a valid
value”; a reference of the wrong kind is null; a list of the wrong kind is empty, and an element of
the wrong kind is left out; a value of the right kind that breaks its field's rule (an id that is not
an id, a quotation too short to be one) is null or left out. Conforming only takes a meaning away:
nothing reads as accepted, tested, checked or linked because of a value that is not valid. A rule
across the fields of an object (a lifecycle “yes” with no quotation) is left to the derivations,
which never count such a statement and list it as an unverified claim. The record's page says it
does not pass validation and shows, or links to, the record exactly as stored; an API answer that
names such a record says so too, with the problems and the stored form (docs/API.md).

## Storage: append-only, revisioned, hash-chained

`hq.record_versions` holds every version of every record. Rows are never updated or deleted
(triggers refuse both, and `TRUNCATE`). Each row stores the SHA-256 of its content, the hash of the
previous version of the same record, and a row hash over both — a chain that `hq.verify_chain()` re-checks.

Every write belongs to a **dataset revision** (`hq.dataset_revisions`): a gapless number, a kind
(import, accepted proposal, founder decision), a summary, the commission it belongs to, who made it,
and — once sealed — a hash of the whole dataset at that revision, its record count, and a **seal
hash**: SHA-256 of the previous revision's seal hash, the revision number, the content hash and the
record count, so the seals form a chain. `hq.records_at(rev)` returns the dataset exactly as it stood
at any revision. An import's summary names the pack's kind, id, version and content hash.

**The write path.** Only three database functions open a revision: the import, the founder's
acceptance of a proposal and a founder decision. Opening one records, in the owner-only table
`hq._write_context` keyed by the transaction id, which path opened it; sealing removes the row. The
trigger that guards `record_versions` reads that table — never a session setting — and accepts a
version only into the revision this transaction opened, which must be unsealed and the latest, by
that revision's author. A transaction that opens a revision and does not seal it cannot commit.

**Checking the history.** `hq.verify_chain()` reports, for record versions: a content hash, row hash
or link that does not match, a version gap, and a version that moves back to an earlier revision or
sits in an unsealed or missing revision; and, as rows with `record_type` `dataset_revision`, for
revisions: a gap in the numbering, a seal or record count that does not match the records, and a break
in the seal chain. It returns nothing when the stored history agrees with itself. `hq.head_seal()`
returns the latest revision's seal, the value to keep outside the database: the database owner can
bypass every trigger, and only an outside copy shows a rewrite of history and seals together.
Migration 0006 computed the seal chain for revisions that existed before it, as they stood then.

This gives the three things the commission asks for at once: immutable history (nothing is
overwritten), **pinned reads** (two clients that ask for revision 7 get byte-identical records,
whatever has happened since), and explicit **stale-write handling** (a proposal names the version it
was written against; if the record has moved on, the proposal is marked stale, not applied).

The application reads a revision once into an immutable in-memory `Dataset` and caches it by
revision number and content hash, in two forms worked out together (`src/lib/server/store.ts`): the
records **as stored**, and the **conformed view**, in which each record that fails validation is
conformed to its schema (above; the two are the same object when every record is valid). Everything
shown — standings, health figures, missing work, lineage, search — is a pure function of the view
(`src/lib/domain/derive.ts`, whose functions take only the view's type, `DatasetView`, so they cannot
be given the stored form by accident), which is why the web pages, the REST API and the MCP tools
cannot disagree: they call the same functions on the same view. The write paths use the stored form:
a proposal is compared with the record as stored, its base version is the stored version, the
acceptance rules and the whole-record check at acceptance work on the stored record, and the review
screen's “before” values are the stored values.

## Evidence packs: how records get in

A pack is a folder: `manifest.json`, `records/<type>.json`, `source-text/<SOURCE-ID>.md`. Before
anything is imported (`src/lib/domain/pack.ts`):

1. every record must match its schema;
2. **every quotation must be found verbatim in the text snapshot of the source it cites**
   (only differences in spacing and line breaks are forgiven), and so must every requirement's exact
   wording. A quotation must be at least twelve characters long and an exact wording must have at
   least eight non-space characters, after spacing is normalised; an empty quotation never matches;
3. every cited source must have a source record;
4. a pack may not carry an HQ acceptance or a decision “recorded in HQ” — those exist only through the
   founder's own action — and may not use ids of the form `XX-HQ-<number>`, which HQ issues itself
   (the database refuses them too);
5. a build with the standing `accepted_reported` must have a statement that quotes a source (a
   warning if that statement is not labelled `reported` or `founder_statement`).

If one quotation fails, nothing is imported. The import also stores the normalised text of every
source snapshot in `hq.source_texts`, a table no API role can read. The database checks every
quotation in a proposal against that table, with the same normalisation, when the proposal is
submitted and again when the founder accepts it; the application asks through `hq.quotes_ok`, which
answers only pass or fail, and never reads pack files while serving a request. This is the mechanism
behind “never manufacture a record”: a statement with no matching source text does not get in, by
import or by proposal.

## Identity and access

`src/lib/server/db.ts` opens one transaction per request, switches to the PostgreSQL role
`authenticated` with `SET LOCAL ROLE`, and puts the caller's identity in `request.jwt.claims` — the
same model Supabase's API layer uses. The application's own login role (`hq_app`) owns nothing and
has no privileges except to assume the API roles, so a bug in the web application cannot bypass the database's rules.

- **People** sign in with a passphrase (scrypt). The session is a signed, HTTP-only cookie. After a
  successful sign-in the browser also gets a device cookie, which only the sign-in action reads, to
  give a browser that has signed in before a throttle lane of its own (docs/SECURITY.md). It authenticates nothing.
- **AI clients and scripts** present a bearer token of the form `hbq_<id>_<secret>`; only its SHA-256 is stored.
- Reads run in `READ ONLY` transactions. A read cannot write, by construction.
- The application writes every refusal to the audit log in its own transaction, through
  `hq.log_refusal`, so it survives the rollback of the request that caused it. A refusal raised
  inside a database function cannot record itself (the refusal rolls back its own writes), so a
  caller that goes round the application leaves no record of being refused. API roles cannot write
  to the audit log any other way.
- A session is valid only while the session epoch it carries equals the person's current
  `session_epoch`. Signing out, or a new passphrase, increments it.

## One tool registry, two transports

`src/lib/server/tools.ts` defines 18 tools (15 read, 3 that add to the inbox). The REST route
`/api/v1/tools/<name>` and the MCP endpoint `/api/mcp` both dispatch into that registry; neither has
logic of its own. The MCP endpoint is stateless Streamable HTTP with JSON responses and implements
`initialize`, `ping`, `tools/list` and `tools/call`.

Every answer from every tool is an envelope:

```json
{ "hq":           { "authority": "prototype_non_authoritative", "notice": "…" },
  "revision":     { "rev": 7, "content_hash": "…", "created_at": "…", "kind": "…", "summary": "…",
                    "pinned": false, "head_rev": 7, "is_head": true },
  "requested_by": { "handle": "claude", "…": "…" },
  "data":         { "…": "…" },
  "provenance":   { "sources": [ { "id": "…", "title": "…", "sha256": "…" } ] },
  "integrity":    { "notice": "…", "records": [ { "type": "…", "id": "…", "valid": false, "problems": ["…"], "stored": { } } ] } }
```

`integrity` is present only when the answer names a stored record that fails validation (docs/API.md).

## Code map

| Path | Contents |
| --- | --- |
| `supabase/migrations/0001…0008` | Roles and identities; records and revisions; governance; row-level security and grants; 0005: what a proposal may assert (stored source texts, quotation and label checks, protected and build-only fields), acceptance binding, reserved ids, decision references; 0006: the write context table, seal chain and head seal, audit-log wrappers, the proposal state order, session epochs, read-only `service_role`; 0007: no proposal can assert an acceptance (`hq._refuse_acceptance_claims`, called by `submit_proposal` and again by `review_proposal`), `service_role` may execute only the read helpers (revoked from the catalogue; a test reads the catalogue so a later function cannot slip through), `hq.log_access` accepts only the application's allowed action families and keeps a client's own request id apart from the server's, a 16,384-byte limit on new audit details, and “rejection” in the message for a rejected target; 0008: a build reported as accepted frozen for proposals except to withdraw the report, a module's reported acceptance compared as a whole entry, the database's own check of allowed values (`hq.field_enums`, `hq._check_field_enums`), and bounded audit action names |
| `src/lib/domain/` | Schemas, the `Dataset` snapshot and its conformed view (`conform.ts`), derivations, pack validation — no database, no network |
| `src/lib/server/` | Database access, the store, services, tools, HTTP helpers, server actions |
| `src/lib/auth/` | Passphrases, tokens, sessions, the device cookie (`device.ts`), the sign-in throttle and its lanes (`throttle.ts`), the length limits on sign-in input (`sign-in-input.ts`), the safe redirect after sign-in, the start-up environment check |
| `src/lib/ui/` | Labels, formatting (including the field-aware text for listed values), pinned-revision link rules (`pin-rules.ts`, `pin.ts`, used by `src/components/pin-link.tsx`), and type guards through which screens read stored fields (`guards.ts`) |
| `src/lib/integrations/` | Read-only GitHub and Google Drive adapters that return failure values instead of throwing |
| `src/app/(hq)/` | The screens; `error.tsx` keeps a failed screen inside the shell |
| `src/instrumentation.ts`, `src/proxy.ts` | Refuse to start with a placeholder secret; answer a malformed address with 400 |
| `src/app/api/` | REST and MCP routes |
| `next.config.mjs` | Response headers, no telemetry, `pg` kept out of the bundle. Part of the repository (HQ's `.gitignore` un-ignores `*.mjs`, which the repository around it ignores) |
| `scripts/` | Migrate, seed, setup, credentials, pack verification, test runners |
| `tests/` | `unit`, `db`, `api`, `e2e` |
| `data/packs/fixture` | Synthetic records used by every test |
