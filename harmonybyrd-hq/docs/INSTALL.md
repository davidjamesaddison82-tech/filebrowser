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

1. creates `.env.local` from `.env.example` with a generated session secret and database password
   (if `.env.local` already exists it is left alone);
2. applies the migrations in `supabase/migrations` and creates the application login role;
3. creates the local identities — `founder`, `developer`, `reader` (people) and `claude`, `chatgpt`
   (AI clients) — and prints a passphrase or API token for each, once;
4. imports the evidence pack at `HQ_PACK_DIR`.

If your database is not at the default address, create `.env.local` first:

```bash
cp .env.example .env.local
# edit HQ_ADMIN_DATABASE_URL and DATABASE_URL (same host, port and database);
# leave the two __GENERATED_…__ placeholders — setup does not fill them in an existing file,
# so replace them yourself with long random strings.
```

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

Importing is safe to repeat. A record that has not changed is left alone; a record that was changed
through HQ's own governance after an earlier import is **not** overwritten — it is reported as
“diverged” so you can decide.

To start again from nothing in a development database: `npm run setup -- --reset`. The reset
refuses to run on a database whose name does not start with `hq_dev` or `hq_test` unless
`HQ_ALLOW_RESET=1` is set.

## Commands

| Command | What it does |
| --- | --- |
| `npm run setup` | Everything above, in one step |
| `npm run dev` / `npm run build` / `npm start` | Run the application (port 3210) |
| `npm run db:migrate` | Apply pending migrations. Refuses if an applied migration file has been edited |
| `npm run db:seed [-- <dir>] [-- --retire]` | Import a pack. `--retire` also retires imported records the pack no longer contains |
| `npm run pack:verify -- <dir>` | Check a pack without importing it |
| `npm run credentials -- list` | List local identities. Also: `add-human`, `add-client`, `token <handle> "<label>"`, `passphrase <handle>` |
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
| `HQ_JWT_SECRET` | web application | Signs session cookies (HS256, at least 32 characters) |
| `HQ_PACK_DIR` | seeding | Which pack `npm run db:seed` imports |
| `HQ_BASE_URL` | web application | Address shown in the connection guide |
| `HQ_GITHUB_TOKEN`, `HQ_GITHUB_REPOSITORIES` | optional | Read-only GitHub adapter. Empty = “not configured” |
| `HQ_GOOGLE_DRIVE_ACCESS_TOKEN` | optional | Read-only Drive adapter. Empty = “not configured” |
| `HQ_INSECURE_COOKIES=1` | tests only | Allows the session cookie over plain HTTP in a production build |

## Operating notes

**Backups.** Everything is in PostgreSQL, in the schema `hq`. A standard `pg_dump` of the database
is a complete backup. The history is append-only, so a restore loses nothing but what came after the dump.

**Integrity.** `select * from hq.verify_chain();` returns a row for every record version whose hash
no longer matches its content or its predecessor. It should return nothing. The evidence register's
first tab shows the same check.

**Credentials.** People sign in with a passphrase (stored as a scrypt hash). AI clients and scripts
use a bearer token (only its SHA-256 is stored; the token is shown once). The founder issues and
revokes tokens on the *AI & API access* screen. A founder cannot be given a token: founder authority
exists only in a signed-in session.

**Sessions** last twelve hours. Changing `HQ_JWT_SECRET` signs everyone out.

**Supabase.** The schema follows Supabase conventions (roles `anon`, `authenticated`, `service_role`;
claims in `request.jwt.claims`; row-level security), and the migrations sit in `supabase/migrations`.
It has only been run on plain PostgreSQL. Running it on a Supabase project is untested — see docs/KNOWN-GAPS.md.

**Do not** expose a local installation to the internet. It has had no external security review,
and no deployment is authorised by the commission.
