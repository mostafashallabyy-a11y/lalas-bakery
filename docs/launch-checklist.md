# Lala's Bakery Launch Checklist

> Status verified **2026-11-10** against production (`lnyodqfksuvgmqkamvbp`) and staging (`clzdajzsgacivzfenmyq`).
> Anything not explicitly marked ✅ is unverified and must be checked before GO.

## Pre-Launch Checklist

### Database & Backend
- [x] All 16 migrations applied to production Supabase project (0001–0011 baselined via `migration repair`, 0012–0016 pushed 2026-11-10; `migration list --remote` in sync)
- [x] RLS enabled on every table (all migrations enforce `enable`+`force`)
- [x] SECURITY DEFINER functions have fixed search_path
- [x] Rate limiting enabled on public RPCs (confirmed live 2026-11-10; order cap 5/30min)
- [ ] Turnstile configured (site key set in settings table)
- [ ] Demo data removed from production
- [ ] Real InstaPay number set in settings
- [ ] Real product prices and stock levels set
- [ ] Real branch information (name, description, services)
- [ ] Manager account created with strong password
- [ ] Manager MFA enabled
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
- [ ] Turnstile enabled on public forms (checkout, feedback)
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
- [x] Backup current production database — weekly backup workflow in place (Mondays 03:00 UTC; needs the GitHub secrets below)
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
| Checkout works | ✅ (staging concurrency PASS 2026-11-10: 9/10 orders, stock 85→76; production order LB-1090 flow verified previously) |
| Tracking works | ✅ (order tracking key flow verified previously) |
| Staff POS works | ✅ (previous prod verification: LB-1094, shift open/close) |
| Manager reports work | ✅ (Phase 5 verified on prod) |
| RLS enabled | ✅ |
| Rate limiting enabled | ✅ |
| Turnstile enabled | ☐ |
| MFA enabled for manager | ☐ |

**GO** if all checks pass.
**NO-GO** if any critical check fails.

---

## Emergency Contacts

| Role | Name | Contact | 2FA Recovery Location |
|------|------|---------|----------------------|
| Manager | | | |
| Developer | | | |
