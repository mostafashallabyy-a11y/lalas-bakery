# Lala's Bakery Launch Checklist

## Pre-Launch Checklist

### Database & Backend
- [ ] All 12 migrations applied to production Supabase project
- [ ] RLS enabled on every table
- [ ] SECURITY DEFINER functions have fixed search_path
- [ ] Rate limiting enabled on public RPCs
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
- [ ] Code pushed to main branch
- [ ] Cloudflare Pages deployed successfully
- [ ] Custom domain configured (if applicable)
- [ ] HTTPS only
- [ ] robots.txt configured
- [ ] Favicon displays correctly

---

## Launch Day Checklist

### Before Going Live
- [ ] Backup current production database (if migrating from existing)
- [ ] Apply all migrations to production Supabase project
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
| All migrations applied | ☐ |
| Frontend deployed | ☐ |
| Home page loads | ☐ |
| Checkout works | ☐ |
| Tracking works | ☐ |
| Staff POS works | ☐ |
| Manager reports work | ☐ |
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
