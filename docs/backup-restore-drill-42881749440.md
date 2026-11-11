# Backup Restore Drill — `db-backup-42881749440`

**Date:** 2026-11-11  
**Operator (local machine):** `D:\lalas-bakery.html` (Windows, no Docker/Podman)  
**Status:** ⚠️ **NOT EXECUTED LOCALLY** — required restore tooling unavailable on this machine. Execute on a machine with Docker Desktop/Podman + PostgreSQL client tools (and `gh`/Supabase CLI as needed).

## Local preflight (this machine)

| Check | Result |
|---|---|
| `docker` | not installed |
| `podman` | not installed |
| `supabase` CLI | not installed |
| `pg_restore` / `psql` | not installed |
| `gh` CLI | installed and authenticated to `mostafashallabyy-a11y` |
| Local copy of `db-backup-42881749440` | not found in workspace |
| GitHub artifact | confirmed available (114,842 bytes; not expired) |
| Runbook | `docs/backup-restore-runbook.md` (reviewed) |
| Backup workflow | `.github/workflows/backup.yml` produces `db-backup-${{ github.run_id }}` (custom-format `pg_dump`, 30-day artifact) |

**Conclusion:** Restore/replay and row-count verification cannot be performed here. Follow the procedure below on a Docker-capable machine (user-confirmed).

## Target artifact

- **Artifact name:** `db-backup-42881749440`
- **Source:** GitHub Actions artifacts for this repo (private, retained 30 days per workflow). Run ID implied: `42881749440`.
- **Availability checked:** 2026-11-11; artifact is present and not expired (114,842 bytes).
- **Format:** `pg_dump` custom format (`-F c`), `--no-owner --no-privileges` (see `.github/workflows/backup.yml`).

## Restore procedure (run on a machine with Docker)

> **Safety:** Restore into a **scratch/staging** target only. Never restore straight into production. Do not apply migrations before restoring a full custom-format dump (schema + data included) unless doing an explicit data-only restore per runbook Scenario 3.

### Option A — Restore GitHub Actions artifact (`db-backup-42881749440`)

1. **Download the artifact** (requires repo access):
   ```bash
   gh run download 42881749440 -n db-backup-42881749440 -D ./restore-drill
   # or download the artifact ZIP from the Actions run UI
   ```
2. **Identify the dump file:**
   ```bash
   ls ./restore-drill
   # expect: lalas-YYYYMMDD-HHMM.dump
   ```
3. **Start a scratch Postgres target** (ephemeral/local container or a disposable Supabase project):
   ```bash
   docker run --name lalas-restore-drill -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres -p 54329:5432 -d postgres:15
   ```
4. **Restore:**
   ```bash
   pg_restore --no-owner --no-privileges \
     --dbname="postgresql://postgres:postgres@localhost:54329/postgres" \
     ./restore-drill/lalas-YYYYMMDD-HHMM.dump
   ```
   Review `pg_restore` warnings; some extension/role notices can be expected depending on target.

### Option B — `supabase db dump --linked` (linked project) → replay to scratch

> Requires Docker (for local Supabase workflows where applicable), Supabase CLI, and an authenticated/linked project.

1. **Dump linked database:**
   ```bash
   supabase db dump --linked -f scripts/local/prod.sql
   ```
2. **Replay into scratch/staging target** (example: local container):
   ```bash
   docker run --name lalas-restore-drill -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres -p 54329:5432 -d postgres:15
   psql "postgresql://postgres:postgres@localhost:54329/postgres" -v ON_ERROR_STOP=1 -f scripts/local/prod.sql
   ```
   (If using a custom-format dump instead, use `pg_restore` as in Option A.)

## Verification — row counts (required)

After restore/replay completes, connect to the **scratch/staging** database and record counts:

```sql
-- Key tables (requested)
select 'orders' as table_name, count(*)::bigint as row_count from public.orders
union all select 'order_items', count(*)::bigint from public.order_items
union all select 'stock_movements', count(*)::bigint from public.stock_movements;

-- Additional core tables (recommended sanity check)
select 'order_events' as table_name, count(*)::bigint as row_count from public.order_events
union all select 'products', count(*)::bigint from public.products
union all select 'categories', count(*)::bigint from public.categories
union all select 'branches', count(*)::bigint from public.branches
union all select 'profiles', count(*)::bigint from public.profiles
union all select 'feedback', count(*)::bigint from public.feedback
union all select 'shifts', count(*)::bigint from public.shifts
union all select 'branch_promos', count(*)::bigint from public.branch_promos
union all select 'low_stock_alerts', count(*)::bigint from public.low_stock_alerts
union all select 'social_links', count(*)::bigint from public.social_links
union all select 'settings', count(*)::bigint from public.settings;
```

**Pass criteria:**
- Restore/replay completes without fatal errors.
- `orders`, `order_items`, `stock_movements` (and other key tables) return counts consistent with the backup source / expected production snapshot at backup time.
- Spot-check referential integrity if needed (e.g. `order_items.order_id` exists in `orders`).

## Record results (fill in on execution)

| Item | Value |
|---|---|
| Executed on (host/OS) | |
| Artifact/dump used | `db-backup-42881749440` / path: |
| Restore target | scratch/staging (details): |
| `orders` count | |
| `order_items` count | |
| `stock_movements` count | |
| Other key table counts / notes | |
| Errors/warnings | |
| Outcome | PASS / FAIL |
| Cleanup (container/scratch project removed) | |

## Cleanup

- Stop/remove the scratch container: `docker rm -f lalas-restore-drill`
- Delete any temporary scratch Supabase project created for the drill.
- Remove local dump copies if they contain production data and are no longer needed.

## References

- `docs/backup-restore-runbook.md`
- `.github/workflows/backup.yml`
- Migrations defining key tables: `supabase/migrations/0001_init.sql` (`orders`, `order_items`, …), `supabase/migrations/0012_stock_tables.sql` (`stock_movements`, `low_stock_alerts`), etc.
