# Shared settings for the HarmonyByrd HQ operations scripts. Sourced, not run.
# Every path can be overridden from the environment (the local test run does this).
set -euo pipefail

HQ_ROOT="${HQ_ROOT:-/opt/hq}"                 # releases/ and the current -> release symlink
HQ_ETC="${HQ_ETC:-/etc/hq}"                   # hq.env (secrets, 0640 root:hq), backup-recipients.txt
HQ_VAR="${HQ_VAR:-/var/lib/hq}"               # backups/, health/
HQ_DB="${HQ_DB:-hq}"                          # the production database
HQ_PORT="${HQ_PORT:-3210}"                    # the application listens on 127.0.0.1 only
HQ_PG_PORT="${HQ_PG_PORT:-5432}"              # PostgreSQL; loopback only
HQ_DEPLOY="${HQ_DEPLOY:-$HQ_ROOT/current/deploy}"
# How to run PostgreSQL client tools as the database superuser. On the server: the postgres OS user,
# through its local socket (peer authentication, so no superuser password exists anywhere).
HQ_PG_RUNAS="${HQ_PG_RUNAS-runuser -u postgres --}"
# Non-secret settings written by install.sh (on Windows: plain backups and the export folder).
HQ_OPS_CONF="${HQ_OPS_CONF:-$HQ_ETC/ops.conf}"
# shellcheck disable=SC1090
[ -r "$HQ_OPS_CONF" ] && . "$HQ_OPS_CONF"
HQ_PLATFORM="${HQ_PLATFORM:-server}"
HQ_BACKUP_PLAIN="${HQ_BACKUP_PLAIN:-0}"
HQ_BACKUP_EXPORT="${HQ_BACKUP_EXPORT:-}"
HQ_BACKUP_KEEP_DAYS="${HQ_BACKUP_KEEP_DAYS:-35}"

# ---- Network exposure -------------------------------------------------------------------------
# A listening socket is CONFINED to this machine only if it is bound to the loopback interface:
#   - an address in 127.0.0.0/8, ::1 or ::ffff:127.x;
#   - a socket tied to lo itself, which ss prints with a "%lo" suffix (systemd-resolved's stub
#     resolver: 127.0.0.53%lo:53);
#   - an address assigned to the lo interface (WSL's DNS tunnelling puts 10.255.255.254 on lo; it is
#     not on any network interface, so nothing outside the machine can route to it).
# Everything else is EXPOSED: wildcards (0.0.0.0, ::, *), and any address of a real interface.
# TCP and UDP are both checked.

# Addresses assigned to lo (one per line, no prefix length). Override with HQ_LO_ADDRS for tests.
lo_addresses() {
  if [ -n "${HQ_LO_ADDRS+x}" ]; then printf '%s\n' $HQ_LO_ADDRS; return; fi
  ip -o addr show dev lo 2>/dev/null | awk '{print $4}' | cut -d/ -f1
}

# Every listening socket as one line: "<CONFINED|EXPOSED> <tcp|udp> <address:port> <iface> <process>".
classify_listeners() {
  local lo; lo=" $(lo_addresses | tr '\n' ' ') "
  ss -Hlntup 2>/dev/null | while read -r netid _state _rq _sq laddr _peer rest; do
    [ -n "${laddr:-}" ] || continue
    local port="${laddr##*:}" host="${laddr%:*}" iface="-" addr verdict proc
    host="${host#[}"; host="${host%]}"
    case "$host" in *%*) iface="${host#*%}"; addr="${host%%%*}";; *) addr="$host";; esac
    proc="$(printf '%s' "${rest:-}" | sed -nE 's/.*users:\(\("([^"]+)".*/\1/p')"
    verdict=EXPOSED
    if [ "$iface" = lo ]; then verdict=CONFINED
    elif [ "$iface" = - ]; then
      case "$addr" in
        127.*|::1|::ffff:127.*) verdict=CONFINED;;
        0.0.0.0|::|'*'|'') verdict=EXPOSED;;
        *) case "$lo" in *" $addr "*) verdict=CONFINED;; esac;;
      esac
    fi
    printf '%s %s %s:%s %s %s\n' "$verdict" "$netid" "$addr" "$port" "$iface" "${proc:-?}"
  done
}

# The exposed ones only, as "<tcp|udp> <address:port> <process>". On a server, SSH (tcp :22) is expected.
public_listeners() { classify_listeners | awk '$1 == "EXPOSED" {print $2, $3, $5}'; }

# TCP listening addresses on one port (for the strict checks of HQ's own ports).
tcp_listeners_on() { ss -Hltn 2>/dev/null | awk '{print $4}' | grep -E ":$1\$" || true; }
# True if something listens on the port and EVERY listener is exactly 127.0.0.1 or ::1.
only_loopback_on() {
  local found; found="$(tcp_listeners_on "$1")"
  [ -n "$found" ] && ! printf '%s\n' "$found" | grep -vqxE "(127\.0\.0\.1|\[::1\]):$1"
}

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
