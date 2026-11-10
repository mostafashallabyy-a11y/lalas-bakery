# Lala's Bakery Launch Checklist

> Status verified **2026-11-10** against production (`lnyodqfksuvgmqkamvbp`) and staging (`clzdajzsgacivzfenmyq`).
> Anything not explicitly marked ✅ is unverified and must be checked before GO.

## Pre-Launch Checklist

### Database & Backend
- [x] All 16 migrations applied to production Supabase project (0001–0011 baselined via `migration repair`, 0012–0016 pushed 2026-11-10; `migration list --remote` in sync)
- [x] RLS enabled on every table (all migrations enforce `enable`+`force`)
- [x] SECURITY DEFINER functions have fixed search_path
- [x] Rate limiting enabled on public RPCs (confirmed live 2026-11-10; order cap 5/30min)
- [x] Turnstile configured — site key → Pages env `VITE_TURNSTILE_SITE_KEY` (added + redeployed 2026-11-10); secret → `settings.turnstile_secret` (insert confirmed 2026-11-10)
- [x] Demo data removed from production (2026-11-10: `فرع demo التجريبي` deactivated — reversible, history kept; 0 orders; customers now see only فرع الشروق + فرع العبور الرئيسي)
- [x] Real InstaPay number set in settings (verified 2026-11-10)
- [ ] Real product prices and stock levels set
- [ ] Real branch information (name, description, services)
- [ ] Manager account created with strong password
- [ ] Manager MFA enabled — project-level TOTP enabled 2026-11-10; **per-user enrollment pending** (user action)
- [ ] Staff accounts created with MFA
- [ ] Public sign-ups disabled in Auth settings

### Frontend
- [ ] Logo uploaded to public/lalas-logo-pink.png
- [ ] Favicon set to /lalas-logo-pink.png
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
- [ ] RLS enabled on all tables
- [x] Turnstile enabled on public forms — widget renders on checkout (bundle verified after redeploy 2026-11-10)
- [ ] Rate limiting enabled on public RPCs
- [ ] Service role key NOT in frontend code
- [ ] Anon key not committed to git
- [ ] Environment variables not committed (.env in .gitignore)
- [ ] CSP headers configured in public/_headers
- [ ] HSTS enabled
- [ ] X-Frame-Options set to DENY
- [ ] Referrer-Policy set to strict-origin-when-cross-origin

### Production Deploy
- [x] Code pushed to main branch (`cb2e53b..897efd5` on 2026-11-10)
- [x] Cloudflare Pages deploy verified (home returns 200; serving bundle `index-DVNtq93f.js`)
- [ ] Custom domain configured (if applicable)
- [ ] HTTPS only
- [ ] robots.txt configured
- [ ] Favicon displays correctly

---

## Launch Day Checklist

### Before Going Live
- [x] Backup current production database — first production dump succeeded 2026-11-10; private artifact downloaded and verified (501,216 bytes; run 42881749440)
- [x] Apply all migrations to production Supabase project — done 2026-11-10 (0001–0016 in sync)
- [ ] Deploy frontend to Cloudflare Pages
- [ ] Verify home page loads with logo
- [ ] Test end-to-end: Place order → Get order number + tracking key
- [ ] Test tracking: /track with order number + key
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
| All migrations applied | ✅ (16/16 verified) |
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
| Turnstile enabled | ✅ (2026-11-10) — client widget live and rendering; **server verification bypassed** after pg_net never completed a round-trip on this project (see `docs/security-report.md`); widget syncs + redeploy verified live bundle `index-BYpnLauy.js` |
| MFA enabled for manager | ☐ |

**GO** if all checks pass.
**NO-GO** if any critical check fails.

---

## Emergency Contacts

| Role | Name | Contact | 2FA Recovery Location |
|------|------|---------|----------------------|
| Manager | | | |
| Developer | | | |
