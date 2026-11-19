# Security and privacy

This describes what the build does and what was tested. It is not an external security review; none
has been done. An adversarial review by reviewers who had not written the code found 71 defects,
which were then fixed. Every original attack was re-run against the fixes, and a second round fixed
what was only partly closed. A re-check of the second round found ways round some of its rules,
mostly by calling the database functions directly, and one serious sign-in defect; a third round
(migration 0008) fixed those, and has not yet been re-checked. See docs/REVIEW-FINDINGS.md, and
docs/KNOWN-GAPS.md for what remains.

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
“permission denied”, even when it forges the founder's claims. Migration 0007 revoked EXECUTE for
every function then in schema `hq`, reading the list from the catalogue so that none was missed. It
does not change PostgreSQL's default privileges, so a function created later **is** executable by
PUBLIC (and so by `service_role`) until its own migration revokes it. Every migration must therefore
revoke EXECUTE from PUBLIC for each function it creates and grant it only to the roles that need it;
migration 0008 does so for each function it creates or replaces. `tests/db/service-role.test.ts`
reads the catalogue and fails if any function in schema `hq` is executable by PUBLIC.
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
- **Length limits.** A name longer than 41 characters (the longest handle the database allows), or a
  passphrase longer than 1,024 characters, gets that same message at once. Nothing else happens: no
  throttle lane, no database look-up, no passphrase check, no cookie read. The refusal is audited as
  `session.sign_in` *denied* with the length only (`name_too_long` with `name_length`, or
  `passphrase_too_long` with `passphrase_length`); a name over the limit is never stored. Why: a
  server action accepts a body of about 1 MB, and a lane used to be keyed by the whole name the client
  typed, so long names could fill the server's memory and stop it. The name is measured after
  trimming, and again after lower-casing, which can make it longer. A passphrase over the limit
  cannot be set either (`scripts/lib/principals.ts`): it could never be used to sign in.
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
  neither the wait nor a refusal shows which names exist. `X-Forwarded-For` is read only when
  `HQ_TRUST_PROXY=1`, and then only into the audit log.
- **Bounded memory.** Up to 10,000 lanes are tracked, in the server's memory. The throttle itself
  refuses as busy, without creating anything, a name longer than 64 characters (after lower-casing)
  or a device id longer than 64, so no caller can make a lane hold data of its choosing. When a new
  lane needs room, the one forgotten is, in this order: the least recently used lane with no attempt
  in progress and either fewer than five failures or a count that has expired; otherwise the least
  recently used lane with no attempt in progress. A lane with an attempt in progress is never
  forgotten; if every lane has one, the new attempt is refused as busy. A lane that is forgotten
  loses its failure count, so to push out a name under attack every other lane must hold five
  failures or more (docs/KNOWN-GAPS.md).
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
  in can be refused, for that name or, once the anonymous limit of 12 is full, for every name. That
  takes little: holding all 12 anonymous places was measured at about two requests a second, and the
  names need not exist. A browser that has signed in as that person before is not slowed by it,
  unless that person's device lanes are full too (see docs/KNOWN-GAPS.md).
- After sign-in, HQ redirects only to a path on HQ itself. A `next` value longer than 2,048
  characters, one with a control character, whitespace or a backslash, one that starts with `//`, or
  one that resolves to another site, sends the person to the dashboard instead.
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
  functions: `hq.log_refusal` (outcome *denied* or *error* only, a dotted lower-case action name of
  at most 80 characters, a detail of at most 8,192 bytes) and `hq.log_access` (outcome *allowed*, for
  an active principal only). A refusal is attributed to a principal only if the claims name an active
  one; otherwise the claimed identity is kept in the detail, marked as unverified. The audit log
  itself refuses any new row whose action is longer than 80 characters, whoever writes it (rows
  written before migration 0008 are not re-checked).
- **Where denials are logged.** The application logs a refusal in a transaction of its own, so the
  record survives the rollback of the request that was refused. A refusal raised inside a database
  function cannot log itself: raising the error rolls back that function's own writes. A caller that
  goes round the application (for example straight to the database) therefore leaves no record of
  being refused.
- **The request id is the server's.** Every REST request (except `GET /api/v1/health`, which has
  none) and every MCP request gets an id HQ generates, returned in `x-request-id`. Every MCP answer
  carries it, including the 401, the cross-origin refusal, a database error, an unsupported protocol
  version, a parse error, an over-long body and a bad batch; `GET` and `DELETE` get a fresh id with
  their 405. The audit rows the REST and MCP layers write store it as `request_id`: an allowed call,
  a 401 or 403 answer, the MCP 401 and the MCP cross-origin refusal. Other rows carry no request id:
  sign-in and sign-out, the rows the database functions write themselves (a submitted proposal, a
  founder review or decision), and the refusals the service records for a proposal or a review. So
  no client of the application can give its request the id of another request in the log. A caller
  that reaches the database directly, as `authenticated` or `anon`, chooses the request id it passes
  to `hq.log_access` and `hq.log_refusal`, another request's included: the database cannot know the
  server's id (docs/KNOWN-GAPS.md).
- A client's own `X-Request-Id`, if it is 1–64 characters of letters, digits, `.`, `_` and `-`, is
  echoed back by the REST endpoints in `x-client-request-id` and kept as `detail.client_request_id`
  on the audit row they write for the call (allowed, or a 401 or 403 answer), for correlation only;
  otherwise it is dropped. On allowed rows the database checks that pattern again (`hq.log_access`).
  On 401 and 403 rows the client's id travels inside the detail, which `hq.log_refusal` stores
  without checking it. The MCP endpoint does not read the header.
- `hq.log_access` records only the actions the application logs as allowed, each family bounded and
  with no dot inside a name: `api.<name>` (up to 40 of `a`–`z` and `_`), `mcp.<name>` and
  `tool.<name>` (up to 60), `tools.list`, `integrations.read`, `proposal.read`, `session.sign_in`,
  `session.sign_out` and `session.end_all`. It also refuses any name containing `review`,
  `decision`, `decide`, `credential`, `accept`, `reject`, `approve`, `revoke`, `issue`, `withdraw` or
  `register`, except the two read tools whose names contain one (`get_acceptance_status`,
  `get_review_items`, under `tool.` and `mcp.`). Anything else is refused (HQ422) and nothing is
  written. Founder acts (`proposal.review`, `decision.record`, `credential.*`) and `proposal.submit`
  and `proposal.withdraw` are recorded as allowed only by the database functions that perform them,
  so no caller can write such a row without doing the act. The two REST routes for founder acts
  therefore log nothing as allowed themselves.
- The REST tool route logs the call as `tool.<name>` with the real tool's name, or `tool.unknown` for
  a name HQ has no tool for; it never puts the address the client typed into the action. An unknown
  tool or method name is echoed in an error message only up to 80 characters.
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
own labels (refused, through the application and directly in the database); a build reported as
accepted relabelled, rewritten, moved to another module or renamed, a founder acceptance restated
with an added key or a state such as `Yes`, and values outside their lists — through the
application, directly in the database, and planted in the inbox and then accepted (refused); a
planted proposal that would leave an invalid record, accepted through the application (refused with
422); `service_role` writing
history, forging a founder act or calling any function but the read helpers (refused); a proposal
asserting an acceptance (refused, through the application and directly in the database); direct `UPDATE`/`DELETE`/`TRUNCATE` on the record history,
the proposal history and the audit log, even as the database owner (refused); tampering with stored versions and seals (reported by
`verify_chain`); API roles writing the audit log, a founder act or a name that reads like one
recorded through `hq.log_access`, and an audit action over 80 characters (refused);
many wrong sign-in attempts held open against the founder's name while the founder's browser signs
in; 500 sign-ins with 900 KB names (refused at once, no lane created); a 2,000-character passphrase
(refused without a passphrase check); the throttle's eviction order; a founder being given a token (refused);
an AI client being made founder (refused); a revoked or expired token, and a forged, expired or
ended session (refused); a cross-origin state-changing request (refused); an oversized body (413); a
read tool attempting to write (impossible: read-only transaction); every MCP answer carrying a
request id. docs/TESTING.md names the files. docs/TEST-RESULTS.md records the last full run and names
the commit it was made on; it is regenerated on the final commit, and until then it describes the
commit named inside it, not necessarily the code described here.

## Not done

- No external penetration test or code review by a person outside the build.
- No OAuth: tokens are static bearer tokens. This is adequate for a local prototype and for clients
  that accept a custom header; it is not what the ChatGPT application supports (docs/CONNECTING-AI-CLIENTS.md).
- No rate limiting on API tokens (only the sign-in delay), no IP allow-listing, no multi-factor sign-in.
- Anyone who can reach the sign-in page can, while they keep sending wrong passphrases, have sign-in
  refused for browsers that have never signed in. A browser that has signed in before keeps its own
  lane, limited per person and not shared between people (docs/KNOWN-GAPS.md).
- The sign-in delay is held in the server's memory: it resets on restart and is per process.
- A caller that reaches the database directly chooses the request id it records (docs/KNOWN-GAPS.md).
- No Content-Security-Policy header yet.
- The database owner or a superuser can bypass every rule; only a seal kept outside HQ shows it.
- If writing an audit entry fails, the request still gets its answer and the entry is lost.
- Not hardened for exposure to the internet. Do not expose it.
