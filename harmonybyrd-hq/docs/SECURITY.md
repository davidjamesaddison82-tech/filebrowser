# Security and privacy

This describes what the build does and what was tested. It is not an external security review; none
has been done. An adversarial review by reviewers who had not written the code found 71 defects,
which were then fixed. Every original attack was re-run against the fixes, and a second round fixed
what was only partly closed; see docs/REVIEW-FINDINGS.md, and docs/KNOWN-GAPS.md for what remains.

## Boundaries the commission set, and how the build kept them

| Instruction | What was done |
| --- | --- |
| Do not connect to production databases | Only a local PostgreSQL instance created for this build was used |
| Do not modify original repositories | No HarmonyByrd repository was reachable. The application was added in its own folder on the commission branch of the working repository; nothing else there was changed |
| Do not publish a deployment | Nothing was deployed. The application has only ever listened on localhost |
| Do not import private learner data | None was available and none was imported. The schema has no learner tables |
| Do not change existing accepted software | No HarmonyByrd software was touched |
| Do not send private or commercial material to external AI services | The application makes no outbound calls unless the optional read-only adapters are configured. The real evidence pack is kept out of the repository |

## Model

**Least privilege.** The web application connects as `hq_app`, a login role that owns nothing and
is `NOINHERIT`. For each request it assumes `authenticated` (or `hq_auth` for the look-ups needed to
sign someone in, or `anon` to record a refusal by an unknown caller) inside a transaction, and puts
the caller's identity in `request.jwt.claims`. The database trusts those claims: `hq_app` is the one
place that asserts identity, so its password is a secret on a par with the session secret. The owner
connection is used only by scripts.

**Server-side enforcement.** The rules in docs/GOVERNANCE.md are enforced in PostgreSQL (the one
exception is marked there): row-level security for what can be read, `SECURITY DEFINER` functions
for the few permitted writes, and triggers that refuse anything else (direct inserts, updates,
deletes, truncation, protected fields, acceptance without a founder decision). The user interface
hides controls a role cannot use, but hiding is not the protection — the tests call the endpoints
and the database directly.

**The write path.** A record version can be written only into the dataset revision that the current
transaction opened, that is still unsealed and is the latest, and only by that revision's author.
Which write path opened the revision (import, accepted proposal, founder decision) is held in an
owner-only table keyed by the transaction, not in a setting a session can change. A transaction that
opens a revision and does not seal it cannot commit. A sealed revision never gains a version, so a
pinned read of an earlier revision cannot change.

**`service_role`** can read the schema and nothing more: it cannot write any table or run an import.
It can execute only the read helpers (`records_at`, `dataset_hash`, `head_rev`, `head_seal`,
`verify_chain`, `principal_directory`, `jwt_claims`, `current_principal_id`, `current_principal`,
`current_app_role`, `current_principal_kind`). Every other function in schema `hq` — the founder
functions, the proposal functions, the audit wrappers and the sign-in look-ups — refuses it with
“permission denied”, even when it forges the founder's claims. Migration 0007 revokes this from the
catalogue, so no function is missed, and turns off PostgreSQL's default grant of EXECUTE to PUBLIC
for functions created later: a later migration must grant each new function to the roles that need it.
Imports run on the owner connection.

**What the owner can still do.** The database owner, or a PostgreSQL superuser, can bypass every
rule: disable triggers, edit or delete rows, and rewrite seals. HQ cannot prevent that; it can only
make it visible (next section).

**Tamper evidence: the seal chain.** Every sealed dataset revision stores a content hash of the whole
dataset at that revision, a record count, and a seal hash: SHA-256 of the previous revision's seal,
the revision number, the content hash and the record count. `hq.verify_chain()` re-checks every record
version's hashes and links, every revision's content hash and count, the revision numbering and the
seal chain. It shows the database agrees with itself. Someone with full control could still rewrite
history, seals and chain together; that is detected only by comparing the latest seal
(`hq.head_seal()`, shown on *Review items*) with a copy kept outside HQ. Keep such a copy.

**Authentication.**
- Passphrases: scrypt with a per-user salt; comparison in constant time. A wrong passphrase gets the
  same message whether or not the name exists: “That name and passphrase do not match.”
- **Sign-in delay, not lock-out.** Attempts are counted per *lane*, never per address: without a
  proxy HQ trusts, the `X-Forwarded-For` header is whatever the client sends, so keying on it would
  let a guesser rotate it freely. There are two kinds of lane:
  - the **anonymous lane** of a name (lower-cased), for a browser that has not signed in as that
    person before;
  - a **device lane** (name and device id), for a browser that carries a valid device cookie for the
    person of that name (below). Wrong attempts from elsewhere never touch it.
- **No queue.** Attempts are not handled one behind another. Each attempt waits on its own, then is
  checked: no wait for the first five consecutive failures of its lane, then 0.5 s, doubling up to
  8 s. The wait is set by the lane's failure count when the attempt starts. A failure is counted when
  it is known; a success clears the lane; a count expires after 15 minutes without attempts.
- **Bounded work.** At most 4 attempts are in progress per name in the anonymous lanes, and 12 in all
  anonymous lanes together; at most 2 per device lane, and 4 over all the device lanes of one name.
  The device lanes have no limit shared between names: a device lane exists only for a valid device
  cookie of that person, so the work is bounded by the number of people times four, and one account
  holder cannot use up another's places. An attempt over a limit is refused at once, without checking
  the passphrase: “Too many sign-in attempts are in progress. Try again in a moment.” The refusal is
  logged. Unknown names take the anonymous lane
  exactly like known ones (the name is looked up only when a valid device cookie is present), so
  neither the wait nor a refusal shows which names exist. Up to 10,000 lanes are tracked, in the
  server's memory. `X-Forwarded-For` is read only when `HQ_TRUST_PROXY=1`, and then only into the
  audit log.
- **The device cookie** (`hq_device`) means “this browser has signed in as this person before”. It is
  set only after a successful sign-in: HS256-signed with `HQ_JWT_SECRET`, holding HQ's issuer, the
  type `device`, the person's id and a random 128-bit device id; 180 days; `HttpOnly`,
  `SameSite=Lax`, and `Secure` exactly when the session cookie is. A browser that already holds one
  for the same person keeps its device id. It is **not** a session and grants nothing: only the sign-in
  action reads it, to choose the lane. A request that carries only a device cookie is unauthenticated,
  for a page, a REST call and the MCP endpoint. A session token is never accepted as a device cookie,
  and a device cookie never as a session. A device cookie for another person, or a forged, expired or
  malformed one, gets the anonymous lane. Signing out leaves it in place; changing `HQ_JWT_SECRET`
  ends it. Someone who copies it gets that browser's lane, with that lane's waits, and nothing more.
- **The honest limit.** While someone keeps sending wrong passphrases, a browser that has never signed
  in can be refused, for that name or, once the anonymous limit of 12 is full, for every name. A
  browser that has signed in as that person before is not slowed by the flood, unless the device
  lanes are full too (see docs/KNOWN-GAPS.md).
- After sign-in, HQ redirects only to a path on HQ itself. A `next` value with a control character,
  whitespace or a backslash, one that starts with `//`, or one that resolves to another site, sends
  the person to the dashboard instead.
- Sessions: HS256-signed cookie, `HttpOnly`, `SameSite=Lax`, `Secure` in production, twelve hours. A
  session token carries HQ's issuer, the session marker, its issue and expiry times, and the person's
  **session epoch**; a token missing any of them is refused, even if correctly signed. The person is
  re-read from the database on every request, so disabling someone takes effect at once.
- **Ending sessions.** Signing out increments the person's session epoch, which ends every session
  of that person, in every browser, including any copied cookie. Setting a new passphrase
  (`npm run credentials -- passphrase <handle>`) does the same. If the database cannot be reached at
  sign-out, only this browser's cookie is removed, and the failure is logged. Changing
  `HQ_JWT_SECRET` ends everyone's sessions. API tokens are not affected by any of this; revoke them separately.
- API tokens: 256 bits of randomness; only the SHA-256 is stored; shown once; optional expiry;
  revocable; scopes limited to `read` and `propose`.
- State-changing REST calls made with a cookie must come from the same origin. Server actions use the framework's own origin check.

**Requests.** Every JSON body on the REST and MCP endpoints is limited to `HQ_MAX_BODY_BYTES`
(default 1,048,576 bytes): a larger one is refused with 413, by its declared length or while it is
read. An MCP batch holds at most 50 messages. Live GitHub and Google Drive look-ups are made only for
a founder or developer signed in to HQ (see Privacy).

**Audit.** Sign-ins, sign-outs, token use, proposals, reviews, decisions and refusals are logged with
the caller, the action and the outcome. The log is append-only and readable only by the founder.
- API roles cannot write to the log directly. The application writes through two narrow database
  functions: `hq.log_refusal` (outcome *denied* or *error* only, a dotted action name, a detail of at
  most 8,192 bytes) and `hq.log_access` (outcome *allowed*, for an active principal only). A refusal
  is attributed to a principal only if the claims name an active one; otherwise the claimed identity
  is kept in the detail, marked as unverified.
- **Where denials are logged.** The application logs a refusal in a transaction of its own, so the
  record survives the rollback of the request that was refused. A refusal raised inside a database
  function cannot log itself: raising the error rolls back that function's own writes. A caller that
  goes round the application (for example straight to the database) therefore leaves no record of
  being refused.
- **The request id is always the server's.** Every REST request (except `GET /api/v1/health`, which has none) and every MCP request gets an id HQ generates; it
  is returned in `x-request-id` and stored as the audit row's `request_id`, so no client can give its
  request the id of another request in the log. A client's own `X-Request-Id`, if it is 1–64
  characters of letters, digits, `.`, `_` and `-`, is echoed back by the REST endpoints in
  `x-client-request-id` and kept as `detail.client_request_id` on the audit row they write for the
  call (allowed, or a 401 or 403 answer), for correlation only; otherwise it is dropped. The database
  checks the same pattern again before storing it. The MCP endpoint does not read it.
- `hq.log_access` records only the actions the application logs as allowed: `api.*`, `mcp.*`,
  `tool.*`, `tools.list`, `integrations.read`, `proposal.read`, `session.sign_in`,
  `session.sign_out` and `session.end_all`. Anything else is refused (HQ422) and nothing is written.
  A founder act (`proposal.review`, `decision.record`, issuing or revoking a token) is recorded as
  allowed only by the database function that performs it, so no caller can write such a row without
  doing the act. The two REST routes for founder acts therefore log nothing as allowed themselves.
  Founder acts (`proposal.review`, `decision.record`, `credential.*`) and `proposal.submit` and
  `proposal.withdraw` are recorded as allowed only by the database functions that perform them.
- A detail larger than 6,000 bytes is shortened to a preview by the application. The database also
  refuses any new audit row whose detail is over 16,384 bytes (rows written before migration 0007 are
  not re-checked).

**Secrets.** `npm run setup` creates `.env.local`, or fills in the generated values if an existing
one still has the placeholders, and makes both `.env.local` and `.hq-local-credentials.json`
owner-only (0600) on every run. It warns if either was readable by others. Both files are ignored by
git; no secret is in the repository. Setup and the application itself refuse to run while
`HQ_JWT_SECRET` is a placeholder or shorter than 32 characters, or `DATABASE_URL` still holds the
placeholder password; the migration runner refuses to give the application role the placeholder password.

**Untrusted input.** Imported documents and submitted text are data. They are rendered as text
(no HTML injection), never evaluated, and cannot influence permissions. All queries are
parameterised, and a record id must match the id pattern in its schema to be stored. Ids of the form
`XX-HQ-n` are issued by HQ only; an import that uses one is refused.

**Source texts.** The normalised text of every imported source is stored in `hq.source_texts`, which
no API role can read. Quotations in proposals are checked through `hq.quotes_ok`, which says only
whether each quotation was found. Anyone who may propose can use it to test whether a phrase occurs
in a source — the same thing a submitted proposal already reveals. Readers cannot call it.

**Response headers.** `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, a
`Permissions-Policy` that turns off camera, microphone and location, and `Cache-Control: no-store` on every response.

## Privacy

- HQ holds development records only. It has no learner, student or teacher data and no place to put any.
  Future teacher/student workflows would need explicit opt-in and their own access controls; that is out of scope here.
- The source snapshots in the real evidence pack are the founder's working documents. They are
  private: git ignores the pack, and it is delivered separately from the repository.
- An AI client that calls HQ receives the records it asks for, including quotations from those
  documents. Issuing a token to a client is therefore a decision to share that material with that
  client's provider. Tokens are issued only by the founder.
- A live look-up sends a request to GitHub or Google Drive with HQ's own credentials. Only a founder
  or developer signed in to HQ can trigger one; an API token, an AI client's included, sees only
  whether the adapters are configured. GitHub look-ups are limited to `HQ_GITHUB_REPOSITORIES`, and
  Drive look-ups to the file ids in `HQ_GOOGLE_DRIVE_FILE_IDS`.

## What the tests show

The database and HTTP suites include, among others: an AI client reading another client's proposal
(refused); a developer token recording a decision (refused); a developer's session attempting
founder acts directly in the database (refused); proposals setting protected fields — a requirement's
original fields, an HQ acceptance, an evidence record's verification, HQ's own checks, attribution,
source integrity fields and build-only fields — and proposals carrying invented quotations or HQ's
own labels (refused, through the application and directly in the database); `service_role` writing
history, forging a founder act or calling any function but the read helpers (refused); a proposal
asserting an acceptance (refused, through the application and directly in the database); direct `UPDATE`/`DELETE`/`TRUNCATE` on the record history,
the proposal history and the audit log, even as the database owner (refused); tampering with stored versions and seals (reported by
`verify_chain`); API roles writing the audit log, and a founder act recorded through `hq.log_access` (refused);
a flood of wrong sign-in attempts against the founder's name while the founder's browser signs in; a founder being given a token (refused);
an AI client being made founder (refused); a revoked or expired token, and a forged, expired or
ended session (refused); a cross-origin state-changing request (refused); an oversized body (413); a
read tool attempting to write (impossible: read-only transaction). docs/TESTING.md names the files.
Results: docs/TEST-RESULTS.md.

## Not done

- No external penetration test or code review by a person outside the build.
- No OAuth: tokens are static bearer tokens. This is adequate for a local prototype and for clients
  that accept a custom header; it is not what the ChatGPT application supports (docs/CONNECTING-AI-CLIENTS.md).
- No rate limiting on API tokens (only the sign-in delay), no IP allow-listing, no multi-factor sign-in.
- Anyone who can reach the sign-in page can, while they keep sending wrong passphrases, have sign-in
  refused for browsers that have never signed in. A browser that has signed in before keeps its own
  lane, limited per person and not shared between people (docs/KNOWN-GAPS.md).
- The sign-in delay is held in the server's memory: it resets on restart and is per process.
- No Content-Security-Policy header yet.
- The database owner or a superuser can bypass every rule; only a seal kept outside HQ shows it.
- If writing an audit entry fails, the request still gets its answer and the entry is lost.
- Not hardened for exposure to the internet. Do not expose it.
