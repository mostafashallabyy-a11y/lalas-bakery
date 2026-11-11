# Lala's Bakery Backup & Recovery Runbook

## Overview

This document covers backup and recovery procedures for Lala's Bakery. It is written for non-developers and includes step-by-step instructions for common recovery scenarios.

> **Golden rule:** a full `pg_restore` only works into an **empty** database (a scratch container or a brand-new Supabase project). It does **not** work, and must never be run, against the live production database — the tables already exist and the restore will fail or corrupt things. Production recovery is done by copying back the missing rows, or by rebuilding on a new project (Scenario 3).

---

## Backup Strategy

### What is Backed Up
- **Database**: Full PostgreSQL dump (schema + data) via `pg_dump` (custom format, `--no-owner --no-privileges`)
- **Frequency**: Weekly — Mondays 03:00 UTC — via `.github/workflows/backup.yml`. A manual run also works: GitHub → **Actions** → "Supabase weekly backup" → **Run workflow**.
- **Retention**: 30 days (GitHub Actions artifacts, private)
- **Dump filename pattern**: `lalas-YYYYMMDD-HHMM.dump` (e.g. `lalas-20261111-0300.dump`)
- **Storage buckets**: NOT backed up by the workflow (`payment-proofs`, `product-images`, `branch-images`, `products`). Back these up separately/manually until automation exists. Note what this means: the `settings` table (Instapay number, fees, Turnstile secret) **is** in the dump, but the image/proof **files** in the buckets are **not**.

### Where Backups Are Stored
1. **GitHub Actions Artifacts**: `db-backup-<run_id>` — private artifacts, kept 30 days. Download: repo → **Actions** → latest "Supabase weekly backup" run → **Artifacts** section.
2. **Not yet configured**: Cloudflare R2 / off-site encrypted copies (see Gaps)
3. **Encryption**: Artifacts are encrypted at rest by GitHub (private). A separate AES-256 layer (`BACKUP_ENCRYPTION_KEY`) is NOT wired into the current workflow

### What you need installed to restore
- `pg_restore` and `psql` (PostgreSQL client tools). On Windows: install PostgreSQL (the full installer includes them) or use Docker/Podman.
- Docker Desktop or Podman is the easiest way to get a throwaway Postgres to restore into — see `docs/backup-restore-drill-42881749440.md` and the helper scripts in `scripts/backup/`.
- Connection details for your Supabase database: **Dashboard → Project Settings → Database → Connection string → Session pooler**. Host looks like `aws-1-eu-central-1.pooler.supabase.com`, user like `postgres.<project-ref>`, port `5432`. The password is the current DB password.

### Gaps to close for a real launch posture
- [x] Production data volume assessed 2026-11-10: ~22 orders, ~30 items, whole DB < 2 MB — weekly GitHub Actions backup is more than sufficient for now
- [x] Production link + CLI verified working (migration list in sync, read-only queries safe)
- [ ] Confirm the GitHub secret the workflow needs exists and is current: `SUPABASE_DB_PASSWORD`. (Note: the workflow file's header comment says the secret was "rotated and saved 2026-11-10", but this runbook still lists setting it as an open gap — verify with `gh secret list` or the repo's Settings → Secrets → Actions.) The workflow hardcodes the pooler host and DB user; move them to secrets if the project/region changes, and rotate the DB password + secret together.
- [ ] Restore drill — blocked on machines without Docker/Podman: `supabase db dump` and local restores need **Docker Desktop or Podman**, and restoring into a third free Supabase project is impossible without pausing an existing one. To finish the drill: install Docker Desktop → `supabase db dump --linked -f scripts/local/prod.sql` → replay on scratch project → verify counts → delete scratch. Helper scripts: `scripts/backup/restore-drill-42881749440.ps1` / `.sh`; verification queries: `scripts/backup/verify-restore-counts.sql` (also reproduced below). Or keep weekly GH Actions artifact + one manual `pg_restore` verification monthly on any machine with the Postgres tools.
- [ ] Add R2 (or another off-site) copy if you want retention beyond 30 days
- [ ] Bucket backups for the image buckets (out of scope of pg_dump)

---

## Recovery Scenarios

### Scenario 1: Accidental Data Deletion

**Scenario**: A staff member accidentally deleted orders or products.

> **Heads-up:** `order_events` records order *status changes* (created / paid / preparing / …). It does **not** record hard deletes — a deleted order leaves no trace there. To find what's missing, restore the last backup to a scratch database and compare, or just re-check the dashboard.

1. **Download the latest backup**: repo → **Actions** → latest "Supabase weekly backup" run → download `db-backup-<run_id>` → you get `lalas-YYYYMMDD-HHMM.dump`.
2. **Restore it into a scratch database** — never straight into production:
   ```bash
   docker run --name lalas-rescue -e POSTGRES_PASSWORD=postgres -p 54329:5432 -d postgres:15
   # wait ~5 seconds, then:
   pg_restore --no-owner --no-privileges \
     --dbname="postgresql://postgres:postgres@localhost:54329/postgres" \
     lalas-YYYYMMDD-HHMM.dump
   ```
3. **Find what's missing** in the scratch database (table editor if it's a scratch Supabase project, otherwise `psql`):
   ```sql
   SELECT count(*) FROM orders;
   SELECT count(*) FROM order_items;
   SELECT order_number, status, created_at FROM orders ORDER BY id DESC LIMIT 20;
   ```
   Note the order numbers/products that are missing from production.
4. **Copy the missing rows back into production**:
   - For a few rows (the normal case at this size): in scratch, run `SELECT * FROM orders WHERE order_number IN (…);` and re-insert those rows into production via the SQL Editor, then re-insert their `order_items` the same way (match each `order_id`). Menu/products are small enough to recreate by hand in the admin dashboard if easier.
   - For large or unclear loss: don't try to merge — use **Scenario 3** to rebuild on a new project.
   > ⚠️ Anything created **after** the last backup is in no backup. Before re-inserting, check the dashboard for orders that already exist in production so you don't create duplicates or overwrite newer rows.
5. **Verify in production**: counts match scratch; the site shows the orders/products again; a test track-order lookup works.
6. **Clean up**: `docker rm -f lalas-rescue` and delete any local dump copies.

### Scenario 2: Corrupted Data

**Scenario**: Data was corrupted (e.g., wrong values in the orders table).

1. **Identify what and when**: check `order_events` for recent changes, and compare `order_items` prices against `products`:
   ```sql
   SELECT * FROM order_events WHERE created_at > now() - interval '7 days' ORDER BY created_at DESC;
   ```
2. **Restore the last good backup into a scratch database** (Scenario 1, step 2).
3. **Fix only the affected rows in production** by copying the correct values from scratch (run targeted `UPDATE`/`INSERT` statements in the SQL Editor). The catalog is small — prices can also be corrected by hand in the admin dashboard.
4. If almost everything is wrong: use **Scenario 3**.
5. **Verify**: totals and spot-checks match scratch; orders page renders normally.

### Scenario 3: Supabase Project Lost

**Scenario**: Entire Supabase project is deleted or corrupted beyond repair.

> A fresh Supabase project already contains Supabase's own `auth` and `storage` schemas. Do **not** replay the whole dump blindly against it — restore only the app schema (`public`).

1. **Create a new Supabase project** at https://supabase.com/dashboard. Pick the same region (Europe — Frankfurt).
2. **Restore ONLY the `public` schema** into the new (empty) project:
   ```bash
   pg_restore --no-owner --no-privileges --schema=public \
     --dbname="postgresql://postgres.<new-project-ref>:<DB_PASSWORD>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres" \
     lalas-YYYYMMDD-HHMM.dump
   ```
   Warnings about extensions/roles you don't own are usually safe to ignore; fatal errors are not.
   > Alternative (data-only): apply the migrations `0001` → `0022` in filename order in the SQL Editor (note: there are two `0020_*` migrations — filename order is the correct order), then run the same command with `--data-only` added.
3. **Auth users do NOT survive** — they live in Supabase's `auth` schema, not in your app tables. Re-create the manager and staff accounts (**Authentication → Add user**), then clean up the orphaned old profile rows and re-promote the manager:
   ```sql
   DELETE FROM profiles WHERE id NOT IN (SELECT id FROM auth.users);
   SELECT promote_first_manager('your-email@example.com');
   ```
   `promote_first_manager` only works while no active manager exists — same rule as first-time setup. Staff accounts can then be activated from the manager dashboard as usual.
4. **Update the app configuration**:
   - **Cloudflare Pages** → Environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (from Project Settings → API), then **redeploy**.
   - **Supabase** → Authentication → URL Configuration: set Site URL and Redirect URLs to your site's URL (otherwise logins fail silently).
   - **`.github/workflows/ping.yml`** secrets: `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`.
   - **`.github/workflows/backup.yml`**: update the hardcoded pooler host and DB user for the new project (or move them into secrets), and set `SUPABASE_DB_PASSWORD` to the new DB password.
5. **Storage files are gone** — buckets come back empty. Re-upload product and branch images manually. Note that payment proofs for orders paid before the loss are unrecoverable (they lived in storage only); the order records themselves are restored.
6. **Verify end-to-end**: menu loads, tracking works, staff login works, a test order can be placed and paid.

### Scenario 4: GitHub Account Locked

**Scenario**: GitHub account is inaccessible.

**Recovery Steps**:

1. **Contact GitHub Support** to recover account.
2. **If account cannot be recovered**:
   - Clone repository from any local copy or fork.
   - Set up new GitHub repository.
   - Push code: `git push origin main`.
   - Update Cloudflare Pages to point to new repository.

### Scenario 5: Cloudflare Account Locked

**Scenario**: Cloudflare account is inaccessible.

**Recovery Steps**:

1. **Contact Cloudflare Support** to recover account.
2. **If account cannot be recovered**:
   - Export code from GitHub.
   - Deploy to alternative hosting (Vercel, Netlify, etc.).
   - Update DNS to point to new host.

---

## Verifying a Restore (row counts)

After restoring into scratch/staging, run these against the **scratch** database and compare with expectations (~22 orders, ~30 items):

```sql
select 'orders' as table_name, count(*)::bigint as row_count from public.orders
union all select 'order_items', count(*)::bigint from public.order_items
union all select 'stock_movements', count(*)::bigint from public.stock_movements
union all select 'order_events', count(*)::bigint from public.order_events
union all select 'products', count(*)::bigint from public.products
union all select 'branches', count(*)::bigint from public.branches
order by table_name;
```

Pass criteria: restore completes without fatal errors, and the counts match what the backup should contain. The full drill (Docker-based, with cleanup) is documented in `docs/backup-restore-drill-42881749440.md`; the SQL file is `scripts/backup/verify-restore-counts.sql`.

---

## Emergency Contacts

| Role | Name | Contact | 2FA Recovery Codes Location |
|------|------|---------|------------------------------|
| Manager | [Name] | [Email] | [Location] |
| Developer | [Name] | [Email] | [Location] |

---

## When to Upgrade to Supabase Pro

**Free Tier Limits**:
- Database size: 500 MB
- Bandwidth: 5 GB/month
- Realtime connections: 200 concurrent
- Daily backups: Not included

**Consider upgrading when**:
- Database size approaches 400 MB (80% of limit)
- Monthly bandwidth approaches 4 GB (80% of limit)
- You need point-in-time recovery (PITR)
- You need automated daily backups
- You need more than 200 concurrent Realtime connections

**Estimated upgrade cost**: $25/month (Supabase Pro)

---

## Checklist

### Weekly
- [ ] Verify backup ran successfully (repo → Actions: latest backup run is green and the artifact downloads)
- [ ] Check Supabase Dashboard for usage alerts

### Monthly
- [ ] Restore the latest artifact (or the drill dump) to a scratch/staging database and compare row counts (see "Verifying a Restore" above)
- [ ] Spot-check that storage buckets still hold their files (pg_dump does not cover them)
- [ ] Review and rotate API keys (anon/publishable is safe to expose; service_role — never in the repo; rotate in Project Settings → API if leaked)
- [ ] Review the `SUPABASE_DB_PASSWORD` secret; rotate the DB password and the secret together if anything changed
- [ ] Review user access (deactivate inactive staff in the manager panel)

### Quarterly
- [ ] Full disaster recovery drill (Scenario 3)
- [ ] Review security policies
- [ ] Update documentation
- [ ] Review Supabase plan vs. usage
