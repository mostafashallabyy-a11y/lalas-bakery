#!/usr/bin/env bash
set -euo pipefail

# Backup restore drill for db-backup-42881749440 (scratch/staging only).
# Run on a machine with Docker and PostgreSQL client tools (pg_restore/psql).
# NEVER restores into production.
#
# Usage:
#   ./scripts/backup/restore-drill-42881749440.sh artifact [dump_path]
#   ./scripts/backup/restore-drill-42881749440.sh linked-dump [sql_dump_path]
#
# Env overrides: RUN_ID, ARTIFACT_NAME, WORK_DIR, CONTAINER_NAME, PORT

MODE="${1:-artifact}"
ARG_PATH="${2:-}"
RUN_ID="${RUN_ID:-42881749440}"
ARTIFACT_NAME="${ARTIFACT_NAME:-db-backup-42881749440}"
WORK_DIR="${WORK_DIR:-./restore-drill}"
CONTAINER_NAME="${CONTAINER_NAME:-lalas-restore-drill}"
PORT="${PORT:-54329}"

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Required command not found: $1" >&2; exit 1; }; }

echo "== Lala's Bakery restore drill =="
echo "Mode=$MODE RunId=$RUN_ID Target=scratch (localhost:$PORT)"

require_cmd docker

if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "Removing existing container $CONTAINER_NAME"
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

echo "Starting scratch Postgres container..."
docker run --name "$CONTAINER_NAME" -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres -p "$PORT:5432" -d postgres:15 >/dev/null
sleep 3

CONN="postgresql://postgres:postgres@localhost:$PORT/postgres"

if [[ "$MODE" == "artifact" ]]; then
  require_cmd pg_restore
  mkdir -p "$WORK_DIR"
  DUMP_PATH="$ARG_PATH"
  if [[ -z "$DUMP_PATH" ]]; then
    if command -v gh >/dev/null 2>&1; then
      echo "Downloading artifact via gh..."
      gh run download "$RUN_ID" -n "$ARTIFACT_NAME" -D "$WORK_DIR"
    else
      echo "WARN: gh not found. Download artifact '$ARTIFACT_NAME' (run $RUN_ID) manually into $WORK_DIR" >&2
    fi
    DUMP_PATH="$(find "$WORK_DIR" -type f -name '*.dump' | head -n 1 || true)"
  fi
  [[ -n "$DUMP_PATH" && -f "$DUMP_PATH" ]] || { echo "No .dump file found. Pass dump path as 2nd arg." >&2; exit 1; }
  echo "Restoring dump: $DUMP_PATH"
  pg_restore --no-owner --no-privileges --dbname="$CONN" "$DUMP_PATH"
elif [[ "$MODE" == "linked-dump" ]]; then
  require_cmd supabase
  require_cmd psql
  SQL_DUMP_PATH="${ARG_PATH:-scripts/local/prod.sql}"
  echo "Dumping linked database to $SQL_DUMP_PATH ..."
  supabase db dump --linked -f "$SQL_DUMP_PATH"
  [[ -f "$SQL_DUMP_PATH" ]] || { echo "Dump file not created: $SQL_DUMP_PATH" >&2; exit 1; }
  echo "Replaying into scratch..."
  psql "$CONN" -v ON_ERROR_STOP=1 -f "$SQL_DUMP_PATH"
else
  echo "Unknown mode: $MODE (use 'artifact' or 'linked-dump')" >&2
  exit 1
fi

echo
echo "== Verification counts =="
VERIFY_SQL=$(cat <<'SQL'
select 'orders' as table_name, count(*)::bigint as row_count from public.orders
union all select 'order_items', count(*)::bigint from public.order_items
union all select 'stock_movements', count(*)::bigint from public.stock_movements
union all select 'order_events', count(*)::bigint from public.order_events
union all select 'products', count(*)::bigint from public.products
union all select 'categories', count(*)::bigint from public.categories
union all select 'branches', count(*)::bigint from public.branches
union all select 'profiles', count(*)::bigint from public.profiles
union all select 'feedback', count(*)::bigint from public.feedback
union all select 'shifts', count(*)::bigint from public.shifts
union all select 'branch_promos', count(*)::bigint from public.branch_promos
union all select 'low_stock_alerts', count(*)::bigint from public.low_stock_alerts
union all select 'social_links', count(*)::bigint from public.social_links
union all select 'settings', count(*)::bigint from public.settings
order by table_name;
SQL
)

if command -v psql >/dev/null 2>&1; then
  psql "$CONN" -c "$VERIFY_SQL"
else
  echo "WARN: psql not found; run verification manually against $CONN" >&2
  echo "$VERIFY_SQL"
fi

echo
echo "Drill restore complete (scratch). Record counts, then clean up:"
echo "  docker rm -f $CONTAINER_NAME"
echo "  Remove $WORK_DIR / dump copies if no longer needed."
