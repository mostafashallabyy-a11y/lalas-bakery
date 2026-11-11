# Backup Restore Drill — executed via GitHub Actions

**Date:** 2026-11-11
**Executed by:** GitHub Actions run `42948984903` (workflow `.github/workflows/restore-drill.yml`, committed to `main`)
**Artifact drilled:** `db-backup-42947888384` (created 2026-11-11T02:43Z by "Supabase weekly backup", 111,626 bytes)
**Status:** ✅ **PASS** — the backup artifact restores cleanly and row counts match current production.

The original local plan asked for Docker Desktop / a local Postgres on a Windows machine with no admin rights (neither was available). Instead the drill runs on `ubuntu-latest` runners (Docker + Postgres client preinstalled) via a committed workflow — repeatable, and it never touches production.

## What was done (2026-11-11)

1. **`backup.yml` wired to secrets.** The weekly dump now reads `SUPABASE_DB_HOST` / `SUPABASE_DB_USER` from secrets (they were hardcoded in the file). `SUPABASE_DB_PASSWORD` etc. are confirmed present and the workflow is green (manual run `42947888384`, today 02:43Z).
2. **`restore-drill.yml` created** (manual trigger only): downloads the artifact on the runner → restores `auth` + `public` into a throwaway `postgres:15` container → prints row counts → destroys the container. Counts only, never personal data.
3. **Scratch restore quirk fixed:** vanilla Postgres needs the `auth` schema pre-created plus `pgcrypto`, `citext` and stub Supabase roles before `pg_restore`, because every app table FK-references `auth.users`. After that, restore is clean (see below). On a **fresh Supabase project** (runbook Scenario 3) `auth.users` already exists, so a public-only restore is the right path there.

## Row counts (current production state, 2026-11-11)

| Table | Rows |
|---|---|
| products | 21 |
| profiles | 2 |
| settings | 5 |
| feedback | 8 |
| branches | 3 |
| categories | 4 |
| shifts | 1 |
| stock_movements | 1 |
| **orders** | **0** |
| **order_items** | **0** |
| **order_events** | **0** |
| branch_promos | 0 |
| low_stock_alerts | 0 |
| social_links | 0 |

Integrity check: `orphaned_order_items` = 0 (no order items without a parent order); `orphaned_order_events` query ran clean (0 rows).

Restore details: `pg_restore` exit 1 with **1 error ignored** — the only error was `unrecognized configuration parameter "transaction_timeout"`, a Supabase-side setting; harmless on vanilla PG15. All application tables restored.

## ⚠️ Finding: `orders` is EMPTY in production right now

The 2026-11-10 assessment recorded ~22 orders (and ~30 items). Every backup artifact we have (both are from today) shows **0 orders**. The backup runs from 2026-11-10 all **failed**, so there is no artifact from that day to compare against.

Either:
- the ~22 were test orders that were intentionally wiped today (e.g. `scripts/local/wipe-test-orders.sql`) as part of launch prep, or
- production orders were lost and **no recoverable backup exists** (nothing before today survived).

**Owner action required:** confirm whether clearing orders was intentional. If not, this needs immediate attention — a restore cannot bring them back because there is no backup from before today.

## Re-running the drill

GitHub → **Actions** → "Backup restore drill" → **Run workflow** → enter the backup run ID (e.g. `42947888384`) → **Run**. Takes ~1–2 minutes. Check the log for the counts table. The scratch container is destroyed automatically. Nothing is downloaded to or left on your local machine.

## Manual alternative (Docker machine)

If you prefer a fully local drill, on any machine with Docker and the Postgres 15 client tools:

```bash
docker run --name lalas-restore-drill -e POSTGRES_PASSWORD=postgres -p 54329:5432 -d postgres:15
gh run download <run_id> -n db-backup-<run_id> -D ./restore-drill
pg_restore --no-owner --no-privileges --schema=auth --schema=public \
  --dbname="postgresql://postgres:postgres@localhost:54329/postgres" ./restore-drill/*.dump
```

then run the count queries from `scripts/backup/verify-restore-counts.sql` (adapted with `public.` prefixes), and `docker rm -f lalas-restore-drill` when done. Note: the dump restores `auth.users` too — the container holds production user data locally; delete it (and any local dump files) when finished.

## References

- `.github/workflows/backup.yml` — weekly backup (secrets-wired 2026-11-11)
- `.github/workflows/restore-drill.yml` — CI restore drill (this document)
- `.github/workflows/backup-offsite.yml` — gated off-site copy to R2 + bucket sync (not yet enabled)
- `docs/backup-restore-runbook.md` — recovery procedures
- `scripts/backup/verify-restore-counts.sql` — count queries
- Run `42948984903` in this repo's Actions tab — full drill log
