# Installing and operating HQ

## What you need

- Node.js 22.12 or later (the build used 22.23).
- PostgreSQL 16 (the build used 16.15). The owner connection must be able to create roles; the
  test suites also need permission to create a database.
- About 600 MB of disk for dependencies and the build.

No external account is needed. Nothing in a default installation talks to the internet.

## 1. Database

Any PostgreSQL 16 server will do. Two ways:

**Docker** (not exercised in the build environment — Docker was not available there):

```bash
docker compose up -d
```

**An existing server.** Create an empty database and note an owner connection string:

```bash
createdb hq_dev
```

## 2. Install and set up

```bash
npm install
npm run setup
```

`npm run setup`:

1. creates `.env.local` from `.env.example` with a generated session secret and database password.
   If `.env.local` already exists, setup keeps your values and fills in any of the two
   `__GENERATED_…__` placeholders still left in it. Either way it makes `.env.local` readable by its
   owner only (0600), and warns if it was readable by others. It then stops if `HQ_JWT_SECRET` is
   still a placeholder or shorter than 32 characters, or `DATABASE_URL` still holds the placeholder password;
2. applies the migrations in `supabase/migrations` and creates the application login role;
3. creates the local identities — `founder`, `developer`, `reader` (people) and `claude`, `chatgpt`
   (AI clients) — and prints a passphrase or API token for each, once, saving them in
   `.hq-local-credentials.json` (also made owner-only, 0600, on every run);
4. imports the evidence pack at `HQ_PACK_DIR`.

If your database is not at the default address, create `.env.local` first:

```bash
cp .env.example .env.local && chmod 600 .env.local
# edit HQ_ADMIN_DATABASE_URL and DATABASE_URL (same host, port and database).
# Leave the two __GENERATED_…__ placeholders: npm run setup replaces them with generated values.
# (To set them yourself instead, use long random strings, for example: openssl rand -base64 48)
```

**The application will not start** (the server exits with “HarmonyByrd HQ will not start: …”) while
`HQ_JWT_SECRET` is a placeholder or shorter than 32 characters, or `DATABASE_URL` still contains the
placeholder password. Setup applies the same check.

## 3. Run

```bash
npm run dev            # development server on http://localhost:3210
# or
npm run build && npm start
```

Sign in as `founder` with the passphrase that setup printed (also in `.hq-local-credentials.json`).

## Using the real evidence pack

The repository ships only synthetic fixture records. The real pack is delivered separately as a folder:

```
harmonybyrd-evidence/
  manifest.json
  records/<type>.json
  source-text/<SOURCE-ID>.md
```

Put it at `data/packs/harmonybyrd-evidence` (git ignores it), then:

```bash
# in .env.local
HQ_PACK_DIR=data/packs/harmonybyrd-evidence

npm run pack:verify -- data/packs/harmonybyrd-evidence   # schemas, quotations, references; imports nothing
npm run db:seed                                          # imports it as a new dataset revision
```

The import also stores the normalised text of each source snapshot, which HQ uses to check the
quotations in proposals; the seed output reports it (“source texts for quotation checks: N stored,
M new or changed”). The new revision's summary reads `Import of <fixture|evidence> pack "<id>"
<version> (content sha256 <hash>)`. A pack is refused if a quotation is shorter than twelve
characters, if a requirement's wording has fewer than eight non-space characters, or if a record uses
an id of the form `XX-HQ-<number>` (HQ issues those itself).

Importing is safe to repeat. A record that has not changed is left alone; a record that was changed
through HQ's own governance after an earlier import is **not** overwritten — it is reported as
“diverged” so you can decide.

To start again from nothing in a development database: `npm run setup -- --reset`. The reset
refuses to run unless the database is named exactly `hq_dev` or `hq_test`, or one of those followed
by `_` and lower-case letters, digits or underscores (for example `hq_test_ci`), or
`HQ_ALLOW_RESET=1` is set. A name such as `hq_dev2` or `hq_testing` is refused.

## Commands

| Command | What it does |
| --- | --- |
| `npm run setup` | Everything above, in one step |
| `npm run dev` / `npm run build` / `npm start` | Run the application (port 3210) |
| `npm run db:migrate` | Apply pending migrations. Refuses if an applied migration file has been edited |
| `npm run db:seed [-- <dir>] [-- --retire]` | Import a pack. `--retire` also retires imported records the pack no longer contains |
| `npm run pack:verify -- <dir>` | Check a pack without importing it |
| `npm run credentials -- list` | List local identities. Also: `add-human`, `add-client`, `token <handle> "<label>"`, `passphrase <handle>` (a new passphrase ends that person's sessions) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run test` | Unit and database suites |
| `npm run test:api` | REST and MCP over HTTP against a production build |
| `npm run test:e2e` | Browser suite (Playwright, Chromium) |
| `npm run test:all` | All of the above; writes docs/TEST-RESULTS.md |
| `npm run test:repeat` | Runs the suites twice and compares every outcome |

## Environment

| Variable | Used by | Meaning |
| --- | --- | --- |
| `HQ_ADMIN_DATABASE_URL` | setup, migrations, seeding, tests | Owner connection. **Never used by the web application** |
| `DATABASE_URL` | web application | The application's login role: it owns nothing and can only assume the API roles |
| `HQ_JWT_SECRET` | web application | Signs session cookies (HS256, at least 32 characters; the application refuses to start with a placeholder or a shorter value) |
| `HQ_PACK_DIR` | seeding | Which pack `npm run db:seed` imports |
| `HQ_BASE_URL` | web application | Address shown in the connection guide |
| `HQ_GITHUB_TOKEN`, `HQ_GITHUB_REPOSITORIES` | optional | Read-only GitHub adapter; look-ups only for the listed repositories (`owner/name`, comma-separated). Empty = “not configured” |
| `HQ_GOOGLE_DRIVE_ACCESS_TOKEN` | optional | Read-only Drive adapter. Empty = “not configured” |
| `HQ_GOOGLE_DRIVE_FILE_IDS` | optional | Comma-separated Drive file ids that look-ups may read. Any other id is “not configured”; with an empty list the adapter reports itself not configured |
| `HQ_TRUST_PROXY=1` | optional | Set only behind a reverse proxy you control that sets `X-Forwarded-For`. The address is then recorded in the audit log for failed sign-ins. It never changes the sign-in delay, which is per name |
| `HQ_MAX_BODY_BYTES` | optional | Largest JSON request body on the REST and MCP endpoints, in bytes. Default 1,048,576 |
| `HQ_GITHUB_API`, `HQ_GOOGLE_DRIVE_API` | tests only | Replace the GitHub and Drive API addresses (the tests point them at a local fake) |
| `HQ_SIGNIN_BASE_DELAY_MS` | tests only | Shorter first sign-in delay than the default 500 ms. Ignored in a production build unless `HQ_INSECURE_COOKIES=1` |
| `HQ_INSECURE_COOKIES=1` | tests only | Allows the session cookie over plain HTTP in a production build |

## Operating notes

**Backups.** Everything is in PostgreSQL, in the schema `hq`. A standard `pg_dump` of the database
is a complete backup. The history is append-only, so a restore loses nothing but what came after the dump.

**Integrity.** `select * from hq.verify_chain();` returns a row for every problem in the stored
history: a record version whose hashes or links do not match, a version gap, a version in an unsealed
or missing revision or moved back to an earlier one, and (as rows with `record_type`
`dataset_revision`) a revision whose seal or record count does not match its records, a gap in the
revision numbers, or a break in the seal chain. It should return nothing. *Review items* shows the
same check and the latest revision's seal. Because the database owner can rewrite history and seals
together, keep a copy of that seal and its revision number outside HQ
(`select * from hq.head_seal();`); if the stored seal for that revision ever differs, the history was
rewritten. Migration 0006 computed the seals of revisions that already existed, as they stood then.

**Credentials.** People sign in with a passphrase (stored as a scrypt hash). AI clients and scripts
use a bearer token (only its SHA-256 is stored; the token is shown once). The founder issues and
revokes tokens on the *AI & API access* screen. A founder cannot be given a token: founder authority
exists only in a signed-in session.

**Sessions** last twelve hours. Signing out ends every session of that person, in every browser;
so does setting a new passphrase. Changing `HQ_JWT_SECRET` signs everyone out. API tokens are not
affected: revoke them on *AI & API access*.

**Supabase.** The schema follows Supabase conventions (roles `anon`, `authenticated`, `service_role`;
claims in `request.jwt.claims`; row-level security), and the migrations sit in `supabase/migrations`.
It has only been run on plain PostgreSQL. Running it on a Supabase project is untested — see
docs/KNOWN-GAPS.md. Note that `service_role` can only read the `hq` schema: imports must use the owner connection.

**Do not** expose a local installation to the internet. It has had no external security review,
and no deployment is authorised by the commission.
