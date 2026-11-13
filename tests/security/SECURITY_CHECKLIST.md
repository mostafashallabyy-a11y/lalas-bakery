# Lala's Bakery Security Checklist

## RLS Policies

| Table | Policy | Role | Action | Status |
|-------|--------|------|--------|--------|
| branches | branches_read | anon, authenticated | select | ✅ |
| branches | branches_manage | authenticated | all | ✅ |
| categories | categories_read | anon, authenticated | select | ✅ |
| categories | categories_manage | authenticated | all | ✅ |
| products | products_read | anon, authenticated | select | ✅ |
| products | products_manage | authenticated | all | ✅ |
| orders | orders_staff_read | authenticated | select | ✅ |
| orders | orders_manage | authenticated | all | ✅ |
| order_items | order_items_staff_read | authenticated | select | ✅ |
| order_items | order_items_manage | authenticated | all | ✅ |
| order_events | order_events_staff_read | authenticated | select | ✅ |
| order_events | order_events_manage | authenticated | all | ✅ |
| order_status_public | order_status_public_read | anon, authenticated | select | ✅ |
| feedback | feedback_manager | authenticated | all | ✅ |
| profiles | profiles_self_read | authenticated | select | ✅ |
| profiles | profiles_staff_read | authenticated | select | ✅ |
| profiles | profiles_self_update | authenticated | update | ✅ |
| profiles | profiles_manager_all | authenticated | all | ✅ |
| settings | settings_read_public | anon, authenticated | select | ✅ |
| settings | settings_read_staff | authenticated | select | ✅ |
| settings | settings_manager_all | authenticated | all | ✅ |
| rate_log | rate_log_manager_read | authenticated | select | ✅ |
| branches | storage_products_read | anon, authenticated | select | ✅ |
| branches | storage_products_write | authenticated | all | ✅ |
| branches | storage_branch_images_read | anon, authenticated | select | ✅ |
| branches | storage_branch_images_write | authenticated | all | ✅ |
| branch_policies | branches_staff_own | authenticated | all | ✅ |
| branch_policies | branches_manager_all | authenticated | all | ✅ |
| void_requests | void_requests_staff_own | authenticated | all | ✅ |
| void_requests | void_requests_manager_all | authenticated | all | ✅ |
| stock_movements | stock_movements_staff_read | authenticated | select | ✅ |
| stock_movements | stock_movements_manager_all | authenticated | all | ✅ |
| low_stock_alerts | low_stock_alerts_staff_read | authenticated | select | ✅ |
| low_stock_alerts | low_stock_alerts_manager_all | authenticated | all | ✅ |

## SECURITY DEFINER Functions

| Function | Security Definer | search_path Fixed | Role Check | Input Validation |
|----------|------------------|-------------------|------------|------------------|
| submit_order_v2 | ✅ | public | anon/auth (rate+turnstile) | ✅ (floor/obour addr+phone+loc/note) |
| pos_create_order | ✅ | public | is_staff() | ✅ (POS-safe: no online-only gates) |
| track_order_by_key | ✅ | public | none (anon) | ✅ (no sensitive fields leaked) |
| get_order_details | ✅ | public | none (tracking key required) | ✅ (same-customer keyed access) |
| get_payment_info | ✅ | public | none (tracking key required) | ✅ |
| confirm_obour_location | ✅ | public | none (order+tracking key) | ✅ |
| staff_set_status | ✅ | public | is_staff() + branch scope | ✅ (obour needs location_confirmed) |
| staff_confirm_payment | ✅ | public | is_staff() + branch scope | ✅ |
| staff_reject_payment | ✅ | public | is_staff() + branch scope | ✅ |
| staff_mark_cash_received | ✅ | public | is_staff() + branch scope | ✅ |
| staff_cancel_order | ✅ | public | is_staff() + branch scope | ✅ |
| staff_mark_location_received | ✅ | public | is_staff() + branch scope | ✅ |
| expire_stale_cash_orders | ✅ | public | internal/cron-safe logic | ✅ |
| expire_unconfirmed_obour_orders | ✅ | public | internal/cron-safe logic | ✅ |
| manager_set_obour_settings | ✅ | public | is_manager() | ✅ + audit (obour_settings_audit) |
| manager_wipe_test_data_preview | ✅ | public | is_manager() | ✅ |
| manager_wipe_test_data | ✅ | public | is_manager() + تأكيد "حذف" | ✅ + undeletable audit (data_wipe_audit) |
| manager_clear_test_data | ✅ | public | is_manager() + تأكيد | ✅ (compat wrapper) |
| manager_report_enhanced | ✅ | public | is_manager() | ✅ (excludes is_test) |
| manager_product_movement | ✅ | public | is_manager() | ✅ (excludes is_test) |
| manager_staff_performance | ✅ | public | is_manager() | ✅ (excludes is_test) |
| shift_open/close/reopen/get_open | ✅ | public | is_staff()/is_manager() | ✅ |
| void_request/approve | ✅ | public | is_staff()/is_manager() | ✅ |
| promote_first_manager | ✅ | public | guarded | ✅ |

## Storage Buckets

| Bucket | Public | Read Policy | Write Policy |
|--------|--------|-------------|--------------|
| products | true | anon, authenticated | manager only |
| branch-images | true | anon, authenticated | manager only |
| payment-proofs | false | none | anon INSERT only |

## Security Issues Fixed

1. ✅ `submit_order_v2` uses `RETURNING` with `FOR UPDATE` for atomic stock deduction
2. ✅ `track_order_by_key` validates tracking_key matches order_number
3. ✅ `submit_order_v2` validates tracking_key before confirming
4. ✅ `staff_confirm_payment` checks payment_proof_path is not null for online orders
5. ✅ `staff_reject_payment` clears payment_proof_path on rejection
6. ✅ All SECURITY DEFINER functions have `set search_path = public`
7. ✅ All RPCs have role checks (is_staff(), is_manager())
8. ✅ Rate limiting on submit_order_v2 (5 per 30 min)
9. ✅ Rate limiting on shift_open (5 per hour)
10. ✅ Rate limiting on submit_feedback (3 per hour)
11. ✅ Rate limiting on track_order (30 per hour)

## Parts 1–7 Security Notes (this change set)
- `orders.delivery_floor`/`delivery_spot`: required server-side for `table`; never exposed via `track_order_by_key`; visible to same customer via tracking-keyed `get_order_details` and to staff/manager by existing branch-scoped RLS.
- Obour (Parts 5–6): availability/fee/hours/WhatsApp/template/closed msg stored per branch; manager-only audited updates (`obour_settings_audit`); server-side enforcement in `submit_order_v2`; obour orders require validated phone+address (and landmark optional), `location_confirmed` enforced before moving to `preparing`; auto-cancel/stock release for unconfirmed obour after timeout; address/phone/location fields exposed only via tracking-keyed customer details and staff/manager access (not `track_order_by_key`).
- `orders.customer_note`: max 300, trimmed/checked server-side; shown to staff and same-customer order page; never rendered as HTML.
- Part 4: manager-only preview/wipe RPCs with fixed `search_path`, explicit confirm, transactional deletes, undeletable `data_wipe_audit`; test orders/shifts flagged `is_test` excluded from reports.
- Added `tests/security/parts4to7-checks.mjs` for: obour rejected without address/phone, notes >300 rejected, anon/staff can’t edit obour settings, anon/staff can’t wipe, and env-gated checks for obour-off, location_confirmed-before-preparing, and cross-branch staff actions.

## Remaining Security Tasks

- [x] Run Supabase Security Advisor (2026-11-10 — only WARNs; see report)
- [ ] Run Supabase Performance Advisor
- [ ] Run gitleaks to scan for secrets (repo scan done manually 2026-11-10 — clean; CI runs weekly gitleaks)
- [x] Run npm audit (2026-11-10 — 4 moderate findings, accepted w/ rationale; see report)
- [ ] Enable Dependabot
- [ ] Configure Turnstile on public forms
- [ ] Configure Cloudflare WAF rules
- [ ] Disable public sign-ups in Auth settings
- [x] Enable MFA for manager accounts — project-level TOTP enabled 2026-11-10 (10 factors); per-user QR enrollment pending (user action)
- [ ] Set short session lifetime for staff

## Live Verification

- 2026-11-10: Anonymous surface checks (`tests/security/run-security-checks.mjs`) **11 PASS / 0 FAIL**. Cash checks (`cash-payment-checks.mjs`) env-gated.
- Parts 4–7: `tests/security/parts4to7-checks.mjs` added; run against staging with required env vars/creds/test data to obtain non-skipped results (some cases are env-gated by design, no service_role).
