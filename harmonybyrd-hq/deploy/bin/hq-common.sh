# Shared settings for the HarmonyByrd HQ operations scripts. Sourced, not run.
# Every path can be overridden from the environment (the local test run does this).
set -euo pipefail

HQ_ROOT="${HQ_ROOT:-/opt/hq}"                 # releases/ and the current -> release symlink
HQ_ETC="${HQ_ETC:-/etc/hq}"                   # hq.env (secrets, 0640 root:hq), backup-recipients.txt
HQ_VAR="${HQ_VAR:-/var/lib/hq}"               # backups/, health/
HQ_DB="${HQ_DB:-hq}"                          # the production database
HQ_PORT="${HQ_PORT:-3210}"                    # the application listens on 127.0.0.1 only
HQ_DEPLOY="${HQ_DEPLOY:-$HQ_ROOT/current/deploy}"
# How to run PostgreSQL client tools as the database superuser. On the server: the postgres OS user,
# through its local socket (peer authentication, so no superuser password exists anywhere).
HQ_PG_RUNAS="${HQ_PG_RUNAS-runuser -u postgres --}"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
pg() { $HQ_PG_RUNAS "$@"; }                    # pg psql -d hq -c '...'
psql_db() { local db="$1"; shift; pg psql -X -v ON_ERROR_STOP=1 -q -d "$db" "$@"; }

# The owner connection the maintenance scripts (migrate, credentials) use: the local socket as postgres.
admin_url() { echo "${HQ_ADMIN_URL_OVERRIDE:-postgresql:///$1?host=/var/run/postgresql&user=postgres}"; }

# Load hq.env (DATABASE_URL, HQ_JWT_SECRET, ...) without echoing it.
load_hq_env() {
  [ -r "$HQ_ETC/hq.env" ] || die "$HQ_ETC/hq.env is missing or unreadable (run install.sh first)"
  set -a; # shellcheck disable=SC1091
  . "$HQ_ETC/hq.env"; set +a
}

# Run an npm script of the current release as postgres-owner maintenance (migrate, credentials).
hq_node() {
  local script="$1"; shift
  [ -d "$HQ_ROOT/current" ] || die "no release installed at $HQ_ROOT/current (run hq-release first)"
  # As the postgres OS user (peer authentication on the local socket), passing only what it needs.
  ( cd "$HQ_ROOT/current" && pg env HOME=/tmp HQ_ADMIN_DATABASE_URL="$(admin_url "$HQ_DB")" DATABASE_URL="${DATABASE_URL:-}" \
      NODE_ENV=production ./node_modules/.bin/tsx "$script" "$@" )
}

# Structural integrity of a database: prints the checks and fails if any says FAIL.
integrity_check() {
  local db="$1" out
  out="$(psql_db "$db" -At -f "$HQ_DEPLOY/sql/integrity.sql")"
  printf '%s\n' "$out"
  if printf '%s\n' "$out" | grep -q '|FAIL$'; then return 1; fi
}
