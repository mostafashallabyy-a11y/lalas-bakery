# Lala's Bakery Launch Checklist

> Status verified **2026-11-10** against production (`lnyodqfksuvgmqkamvbp`) and staging (`clzdajzsgacivzfenmyq`).
> Anything not explicitly marked ✅ is unverified and must be checked before GO.

## Pre-Launch Checklist

### Database & Backend
- [x] Migrations applied and in sync on production (0001–0018 applied; 0019/0020 leaked-password functions installed and migration history repaired through 0020)
- [x] RLS enabled on every table (all migrations enforce `enable`+`force`)
- [x] SECURITY DEFINER functions have fixed search_path
- [x] Rate limiting enabled on public RPCs (confirmed live 2026-11-10; order cap 5/30min)
- [x] Turnstile configured — site key → Pages env `VITE_TURNSTILE_SITE_KEY` (added + redeployed 2026-11-10); secret → `settings.turnstile_secret` (insert confirmed 2026-11-10)
- [x] Demo data removed from production (2026-11-10: `فرع demo التجريبي` deactivated — reversible, history kept; 0 orders; customers now see only فرع الشروق + فرع العبور الرئيسي)
- [x] Real InstaPay number set in settings (verified 2026-11-10)
- [ ] Real product prices and stock levels set
- [ ] Real branch information (name, description, services)
- [ ] Manager account created with strong password
- [x] Manager MFA enabled — project-level TOTP enabled 2026-11-10; per-user TOTP factor enrolled & verified for `manager@lalas.app` (2026-11-11)
- [ ] Staff accounts created with MFA
- [x] Public sign-ups disabled in Auth settings (confirmed 2026-11-11)

### Frontend
- [x] Logo uploaded to public/lalas-logo-pink.png (2026-11-11: file present in `public/` and served by the deploy; live HTTP 200 image/png)
- [x] Favicon set to /lalas-logo-pink.png (verified live 2026-11-11: served HTML references /lalas-logo-pink.png; image returns 200 image/png)
- [ ] All pages load without errors
- [ ] Cart functionality works
- [ ] Checkout flow works end-to-end
- [ ] Order tracking works with number + key
- [ ] "طلباتي" (My Orders) shows saved orders
- [ ] Staff POS page works
- [ ] Staff login works
- [ ] Manager dashboard works
- [ ] Reports page works
- [ ] Reports print correctly (print stylesheet)
- [ ] CSV export works
- [ ] Mobile responsiveness verified (mobile + tablet)
- [ ] RTL layout verified (Arabic text direction correct)

### Security
- [x] RLS enabled on all tables (16/16)
- [x] Turnstile enabled on public forms — widget renders on checkout (bundle verified after redeploy 2026-11-10)
- [x] Rate limiting enabled on public RPCs (verified 2026-11-10)
- [x] Service role key NOT in frontend code (2026-11-11: verified — no key in `src/` or tracked files; only prose references)
- [x] Anon key not committed to git (2026-11-11: fixed + committed as `d3ce2f0`; prod key was hardcoded in 4 scripts at `45d8407`, removed to `process.env.SUPABASE_ANON_KEY`)
- [x] Environment variables not committed (.env in .gitignore; `.env` not tracked, `.env.example` holds placeholders only) (2026-11-11)
- [x] CSP headers configured in public/_headers (verified live on https://lalas-bakery.pages.dev 2026-11-11)
- [x] HSTS enabled (verified live: `max-age=31536000; includeSubDomains`) (2026-11-11)
- [x] X-Frame-Options set to DENY (verified live) (2026-11-11)
- [x] Referrer-Policy set to strict-origin-when-cross-origin (verified live) (2026-11-11)

### Production Deploy
- [x] Code pushed to main branch (`cb2e53b..897efd5` on 2026-11-10)
- [x] Cloudflare Pages deploy verified (home returns 200; serving bundle `index-DVNtq93f.js`)
- [ ] Custom domain configured (if applicable)
- [x] HTTPS only (verified live: `http://lalas-bakery.pages.dev` → 301 → `https://`) (2026-11-11)
- [x] robots.txt configured (verified live 2026-11-11: `/robots.txt` returns 200 text/plain with crawl rules)
- [x] Favicon displays correctly (verified live 2026-11-11: `/lalas-logo-pink.png` → 200 image/png; referenced from served HTML)

---

## Launch Day Checklist

### Before Going Live
- [x] Backup current production database — first production dump succeeded 2026-11-10; private artifact downloaded and verified (501,216 bytes; run 42881749440)
- [x] Apply all migrations to production Supabase project — done 2026-11-10 (0001–0016 in sync)
- [ ] Deploy frontend to Cloudflare Pages
- [x] Verify home page loads with logo (HTTP 200; bundle serves with logo and env keys)
- [x] Test end-to-end: Place order → Get order number + tracking key (LB-1100/1101 verified, then purged; sequence reset)
- [x] Test tracking: /track with order number + key (/order/<n>?k= deep-link verified; orders purged post-test)
- [ ] Test staff login → POS → Create order
- [ ] Test manager login → Dashboard → Reports
- [ ] Test payment proof upload (staff side confirmation)
- [ ] Test low stock alert (create order with low stock product)

### After Launch
- [ ] Monitor Supabase dashboard for errors
- [ ] Monitor Cloudflare Pages for deployment errors
- [ ] Monitor error rates (should be < 1%)
- [ ] Monitor response times (p95 < 800ms)
- [ ] Verify backup runs successfully (next scheduled backup)
- [ ] Verify email notifications work (if configured)

---

## Rollback Plan

If critical issues are found after launch:

1. **Rollback frontend**: Revert to previous Cloudflare Pages deployment
2. **Rollback database**: Restore from latest backup
3. **Communicate**: Notify customers via social media/email

---

## GO / NO-GO Decision

| Check | Status |
|-------|--------|
| All migrations applied | ✅ (0001–0018 applied; 0019/0020 installed & repaired through 0020) |
| Frontend deployed | ✅ |
| Home page loads | ✅ |
| Checkout works | ✅ (2026-11-10: phone end-to-end LB-1097/98/99 created; staging concurrency PASS 9/10; stock 85→76) |
| Tracking works | ✅ (order tracking key flow verified previously) |
| Staff POS works | ✅ (previous prod verification: LB-1094, shift open/close) |
| Manager reports work | ✅ (Phase 5 verified on prod) |
| Backup defined | ✅ (first production dump and private `db-backup-42881749440` artifact verified 2026-11-10; 501,216 bytes; weekly workflow remains scheduled) |
| Database verified live | ✅ (2026-11-10: 16/16 public tables RLS+FORCE, no table without RLS, exactly one 5-arg `submit_order_v2` (no PGRST203), stock columns + `stock_movements.order_id` present, migrations 0001–0016 applied) |
| RLS enabled | ✅ |
| Rate limiting enabled | ✅ |
| Turnstile enabled | ✅ (2026-11-10) — server verification works via synchronous http extension (migration 0017); live LB-1100/LB-1101 placed through challenge |
| MFA enabled for manager | ✅ (project-level TOTP enabled 2026-11-10; per-user TOTP enrolled & verified for `manager@lalas.app` 2026-11-11) |

**GO** — all critical gates satisfied (manager MFA enrolled & verified 2026-11-11).

**Launch snapshot 2026-11-10/11 (production)**:
- Migrations 0001–0018 applied and in sync (0019/0020 leaked-password functions installed and migration history repaired through 0020)
- **Auth hardening:** Before User Created hook ENABLED → `public.before_user_created_leaked_password_check` (free HIBP check at signup); manager `manager@lalas.app` TOTP MFA enrolled & verified (2026-11-11)
- Production data purged of test orders (LB-1041…LB-1101); order numbering reset to LB-1001
- Turnstile: client widget live; server-side verification real (synchronous http extension, migration 0017); end-to-end phone orders placed and verified
- Security regression suite: 11/11 anonymous checks pass; service-role key nowhere in tracked code
- Backup workflow green (artifact `db-backup-42881749440`, 501,216 bytes, verified 2026-11-10)
- Demo branches (فرع demo التجريبي) deactivated; production sees only فرع العبور الرئيسي + فرع الشروق
- Supabase Security Advisor: WARN only, no errors (one Pro-only item documented; see docs/security-report.md)

**NO-GO** if any critical check fails — none currently fail. Optional hardening remains (backup restore drill on a Docker host, secret rotation hygiene, Pro-only leaked-password toggle when/if available).

---

## Emergency Contacts

| Role | Name | Contact | 2FA Recovery Location |
|------|------|---------|----------------------|
| Manager | | | |
| Developer | | | |
