# Lala's Bakery Backup & Recovery Runbook

## Overview

This document covers backup and recovery procedures for Lala's Bakery. It is written for non-developers and includes step-by-step instructions for common recovery scenarios.

## Backup Strategy

### What is Backed Up
- **Database**: Full PostgreSQL dump (schema + data) via `pg_dump` (custom format, `--no-owner --no-privileges`)
- **Frequency**: Weekly — Mondays 03:00 UTC — via `.github/workflows/backup.yml` (validated workflow_dispatch also works)
- **Retention**: 30 days (GitHub Actions artifacts, private)
- **Storage buckets**: NOT backed up by the current workflow (payment-proofs, product-images, branch-images). Back these up separately/manually until automation exists.

### Where Backups Are Stored
1. **GitHub Actions Artifacts**: `db-backup-<run_id>` — private artifacts, kept 30 days
2. **Not yet configured**: Cloudflare R2 / off-site encrypted copies (see Gaps)
3. **Encryption**: Artifacts are encrypted at rest by GitHub (private). A separate AES-256 layer (`BACKUP_ENCRYPTION_KEY`) is NOT wired into the current workflow

### Gaps to close for a real launch posture
- [ ] Set the three GitHub secrets the workflow needs: `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_HOST` (pooler host — e.g. `aws-1-eu-central-1.pooler.supabase.com`), `SUPABASE_DB_USER` (`postgres.<project-ref>`)
- [ ] Workflow password must match the *current* prod DB password — rotate together
- [ ] Restore drill: restore one artifact into a throwaway/staging project and verify `orders`/`stock_movements` counts match the source
- [ ] Add R2 (or another off-site) copy if you want retention beyond 30 days
- [ ] Bucket backups for the image buckets (out of scope of pg_dump)

---

## Recovery Scenarios

### Scenario 1: Accidental Data Deletion

**Scenario**: A staff member accidentally deleted orders or products.

**Recovery Steps**:

1. **Identify what was deleted**:
   ```sql
   -- Check order_events for recent changes
   SELECT * FROM order_events WHERE created_at > now() - interval '24 hours' ORDER BY created_at DESC;
   ```

2. **Restore from latest backup**:
   ```bash
   # Download latest backup from GitHub Actions artifacts
   # (optional manual layer, only if the dump were encrypted:
   #  gpg --decrypt backups/lalas-bakery-YYYYMMDD-HHMM.dump.gpg > backup.dump)

   # Restore to STAGING first for verification — never straight into production
   pg_restore --no-owner --no-privileges --dbname=postgres backups/lalas-YYYYMMDD-HHMM.dump
   ```

3. **Verify data integrity**:
   ```sql
   SELECT count(*) FROM orders;
   SELECT count(*) FROM order_items;
   ```

4. **Apply to production** (only after verification):
   ```bash
   pg_restore --no-owner --dbname=postgres backups/lalas-bakery-YYYYMMDD-HHMMSS.dump
   ```

### Scenario 2: Corrupted Data

**Scenario**: Data was corrupted (e.g., wrong values in orders table).

**Recovery Steps**:

1. **Identify corruption time**: Check `order_events` and `order_items` for anomalies.
2. **Restore from backup before corruption time**:
   ```bash
   pg_restore --no-owner --dbname=postgres backups/lalas-bakery-YYYYMMDD-HHMMSS.dump
   ```
3. **Verify**: Check that corrupted data is restored to correct values.
4. **Apply to production**: Same as Scenario 1.

### Scenario 3: Supabase Project Lost

**Scenario**: Entire Supabase project is deleted or corrupted beyond repair.

**Recovery Steps**:

1. **Create new Supabase project** at https://supabase.com/dashboard
2. **Restore the dump** (custom format already includes schema + data — do NOT apply migrations first or tables would conflict):
   ```bash
   pg_restore --no-owner --no-privileges --dbname=postgres backups/lalas-YYYYMMDD-HHMM.dump
   ```
   Alternatively, for data-only restore: create a project, apply migrations 0001–0016, then restore with `--data-only`.
3. **Update Cloudflare Pages** to point to the new project URL (`VITE_SUPABASE_URL`) and anon key (`VITE_SUPABASE_PUBLISHABLE_KEY`); redeploy.

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
- [ ] Verify backup ran successfully (check GitHub Actions)
- [ ] Verify backup can be restored (test restore to staging)
- [ ] Check Supabase Dashboard for usage alerts

### Monthly
- [ ] Test full restore to staging project
- [ ] Review and rotate encryption keys
- [ ] Review and rotate API keys
- [ ] Review user access (remove inactive users)

### Quarterly
- [ ] Full disaster recovery drill
- [ ] Review security policies
- [ ] Update documentation
- [ ] Review Supabase plan vs. usage
