# Security and privacy

This describes what the build does and what was tested. It is not an external security review; none has been done.

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
is `NOINHERIT`. For each request it assumes `authenticated` (or `hq_auth` for the three look-ups
needed to sign someone in) inside a transaction. The owner connection is used only by scripts.

**Server-side enforcement.** Every rule in docs/GOVERNANCE.md is enforced in PostgreSQL: row-level
security for what can be read, `SECURITY DEFINER` functions for the few permitted writes, and
triggers that refuse anything else (direct inserts, updates, deletes, truncation, protected fields,
acceptance without a founder decision). The user interface hides controls a role cannot use, but
hiding is not the protection — the tests call the endpoints directly.

**Authentication.**
- Passphrases: scrypt with a per-user salt; comparison in constant time. Failed attempts are
  throttled (eight per name and address in five minutes); a successful sign-in clears the count.
  The error message does not say whether the name exists.
- Sessions: HS256-signed cookie, `HttpOnly`, `SameSite=Lax`, `Secure` in production, twelve hours.
  The principal is re-read from the database on every request, so disabling someone takes effect at once.
- API tokens: 256 bits of randomness; only the SHA-256 is stored; shown once; optional expiry;
  revocable; scopes limited to `read` and `propose`.
- State-changing REST calls made with a cookie must come from the same origin. Server actions use the framework's own origin check.

**Audit.** Sign-ins, token use, proposals, reviews, decisions and every refusal are logged with the
caller, the action and the outcome. The log is append-only and readable only by the founder.

**Secrets.** `.env.local` and `.hq-local-credentials.json` are created with owner-only permissions
and ignored by git. No secret is in the repository. `npm run setup` generates the session secret and the database password.

**Untrusted input.** Imported documents and submitted text are data. They are rendered as text
(no HTML injection), never evaluated, and cannot influence permissions. All queries are
parameterised, and a record id must match the id pattern in its schema to be stored.

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

## What the tests show

The database and HTTP suites include, among others: an AI client reading another client's proposal
(refused); a developer token recording a decision (refused); a proposal setting each protected field
(refused); direct `UPDATE`/`DELETE`/`TRUNCATE` on the record history (refused); a founder being given
a token (refused); an AI client being made founder (refused); a revoked or expired token (refused);
a cross-origin state-changing request (refused); a read tool attempting to write (impossible:
read-only transaction). Results: docs/TEST-RESULTS.md.

## Not done

- No external penetration test or code review.
- No OAuth: tokens are static bearer tokens. This is adequate for a local prototype and for clients
  that accept a custom header; it is not what the ChatGPT application supports (docs/CONNECTING-AI-CLIENTS.md).
- No rate limiting on API tokens (only on passphrase sign-in), no IP allow-listing, no multi-factor sign-in.
- No Content-Security-Policy header yet.
- The sign-in throttle is held in the server's memory: it resets on restart and is per process.
- Not hardened for exposure to the internet. Do not expose it.
