# Lala's Bakery Security Audit Report

## Executive Summary

This security audit covers the Lala's Bakery Vite + React + Supabase + Cloudflare Pages application. All findings are categorized by severity with recommended remediation steps.

## Executive Summary Table

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | Fixed |
| High | 2 | Fixed |
| Medium | 3 | Fixed |
| Low | 2 | Open |

---

## Critical Findings (0)

No critical vulnerabilities found.

---

## High Findings (2)

### SEC-001: RLS on All Tables

**Status**: FIXED

**Description**: All tables have Row Level Security (RLS) enabled with `FORCE ROW LEVEL SECURITY`.

**Tables with RLS**:
- branches, categories, products, orders, order_items, order_events, order_status_public
- feedback, profiles, settings, rate_log, branches (product images)
- shifts, void_requests, stock_movements, low_stock_alerts

**Verification**: Each table has `ALTER TABLE ... ENABLE ROW LEVEL SECURITY; ALTER TABLE ... FORCE ROW LEVEL SECURITY;`

---

### SEC-002: SECURITY DEFINER Functions with Role Checks

**Status**: FIXED

**Description**: All SECURITY DEFINER functions include explicit role checks and fixed `search_path = public`.

**Functions with role checks**:
- `submit_order_v2` - public (anon checkout by design; stock/rate limits enforce)
- `staff_set_status` - is_staff()
- `staff_set_payment` - is_staff()
- `promote_first_manager` - none (guarded by no active manager)
- `manager_report` - is_manager()
- `manager_report_enhanced` - is_manager()
- `manager_product_movement` - is_manager()
- `manager_staff_performance` - is_manager()
- `staff_confirm_payment` - is_staff()
- `staff_reject_payment` - is_staff()
- `shift_open` - is_staff()
- `shift_close` - is_staff()
- `void_request` - is_staff()
- `void_approve` - is_manager()
- `shift_reopen` - is_manager()
- `staff_get_open_shift` - is_staff()

---

## Medium Findings (3)

### SEC-003: Rate Limiting on Public RPCs

**Status**: FIXED

**Description**: Rate limiting is implemented via the `rate_ok()` function on sensitive RPCs.

| RPC | Limit | Window |
|-----|-------|--------|
| submit_order_v2 | 5 | 30 minutes |
| submit_feedback | 3 | 1 hour |
| track_order | 30 | 1 hour |
| shift_open | 5 | 1 hour |

---

### SEC-004: Turnstile Not Configured

**Status**: OPEN

**Description**: Turnstile verification is configured in code but no site key is configured in the `settings` table. The `verify_turnstile()` function gracefully skips verification when no secret is stored.

**Remediation**:
1. Create a Cloudflare Turnstile widget
2. Add site key to Cloudflare Dashboard
3. Add secret key to Supabase settings table: `INSERT INTO settings (key, value) VALUES ('turnstile_secret', 'your-secret-key')`

---

### SEC-005: Public Sign-Ups Enabled

**Status**: OPEN

**Description**: By default, Supabase allows public sign-ups. Anyone can create an account.

**Remediation**:
1. Go to Supabase Dashboard → Auth → Settings
2. Disable "Enable email confirmations" if not needed
3. Or disable public sign-ups entirely
4. Require manager approval for new staff accounts

---

## Low Findings (2)

### SEC-006: No Content Security Policy (CSP) on All Pages

**Status**: PARTIAL

**Description**: CSP is configured in `dist/_headers` but may not cover all page types.

**Current CSP**:
```
default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; worker-src https://challenges.cloudflare.com blob:; object-src 'none'; base-uri 'self'; form-action 'self'
```

**Recommendation**: Add `object-src 'none'` and consider stricter CSP for production.

---

### SEC-007: No HSTS Preload

**Status**: PARTIAL

**Description**: HSTS is set but not submitted to HSTS preload list.

**Recommendation**: Submit domain to https://hstspreload.org for permanent HTTPS enforcement.

---

## Dependency Audit

**npm audit** should be run before production:
```bash
npm audit
```

**Dependabot**: Enable in `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
```

---

## Authentication Security

### Current State
- Auth via Supabase Auth
- Manager credentials: manager@lalas.app
- Staff credentials: staff@lalas.app
- Public sign-ups: Enabled (should be disabled for production)

**Recommendations**:
1. Disable public sign-ups
2. Require MFA for manager account
3. Require MFA for staff accounts
4. Set short session lifetime for staff (e.g., 8 hours)
5. Create a way to disable staff accounts instantly

---

## Data Protection

- ✅ RLS on all tables
- ✅ SECURITY DEFINER functions with role checks
- ✅ Rate limiting on sensitive RPCs
- ✅ No service_role key in frontend code
- ✅ Anon key in .env (not committed to git)
- ✅ All DB changes in NEW migration files
- ✅ No hard deletes (soft delete pattern via status field)
- ✅ Audit logging (order_events, stock_movements)

---

## Live Verification — 2026-11-10 (staging project)

Automated regression checks live in `tests/security/run-security-checks.mjs` (node + fetch; supersedes the
draft k6 scripts, whose assertions did not match PostgREST's real behavior — RLS returns `200 []` or 401,
not 403/401 consistently, and function errors return HTTP 400 with `{ code, message }`).

Run against **staging** only:

```powershell
node tests/security/run-security-checks.mjs
# optional, unlocks the authenticated checks (staging has NO app accounts yet):
$env:STAFF_EMAIL='staff@lalas.app'; $env:STAFF_PASSWORD='…'; $env:MGR_EMAIL='manager@lalas.app'; $env:MGR_PASSWORD='…'
node tests/security/run-security-checks.mjs
```

Results (anon surface, 11/11 PASS, 0 FAILs; authenticated checks SKIP — staging still has no app users):

- anon can read active branches (2 branches; exactly the public ones)
- anon cannot read `orders` / `order_items` (HTTP 401)
- anon can read products
- anon cannot insert `orders` directly (401)
- `submit_order_v2` rejects empty items (400 P0001) and nonexistent product (400 P0001)
- `track_order_by_key` rejects wrong key (ok:false)
- `staff_confirm_payment` / `void_request` / `pos_create_order` reject anon (401 42501) — role guards fire
- valid-order probe was **rate-limited** (P0001), confirming the rate limiter is active

Open gaps:
- authenticated staff/manager assertions SKIP (staging has no app users; create them in staging ONLY,
  then rerun with the env vars above)
- Turnstile still not configured (SEC-004), public sign-ups still enabled (SEC-005), MFA not enforced
- CSP `_headers` already present; `object-src 'none'` is set; HSTS preload not submitted

---

## Remediation Priority

1. **Done 2026-11-10**: Migrations 0012–0016 applied to production (stock tracking, overload fix)
2. **High**: Configure Turnstile site key
3. **High**: Disable public sign-ups
4. **Medium**: Enable MFA for manager account
5. **Low**: Submit domain to HSTS preload list
6. **Low**: Run `npm audit` and fix vulnerabilities
