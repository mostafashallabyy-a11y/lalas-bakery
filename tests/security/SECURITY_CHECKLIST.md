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
| submit_order_v2 | ✅ | public | is_staff() | ✅ |
| track_order_by_key | ✅ | public | none (anon) | ✅ |
| get_order_tracking_key | ✅ | public | none (anon) | ✅ |
| submit_feedback | ✅ | public | none (anon) | ✅ |
| track_order | ✅ | public | none (anon) | ✅ |
| get_payment_info | ✅ | public | none (anon) | ✅ |
| staff_set_status | ✅ | public | is_staff() | ✅ |
| staff_set_payment | ✅ | public | is_staff() | ✅ |
| promote_first_manager | ✅ | public | none (guard) | ✅ |
| manager_report | ✅ | public | is_manager() | ✅ |
| staff_set_payment | ✅ | public | is_staff() | ✅ |
| staff_set_payment | ✅ | public | is_staff() | ✅ |
| staff_confirm_payment | ✅ | public | is_staff() | ✅ |
| staff_reject_payment | ✅ | public | is_staff() | ✅ |
| shift_open | ✅ | public | is_staff() | ✅ |
| shift_close | ✅ | public | is_staff() | ✅ |
| void_request | ✅ | public | is_staff() | ✅ |
| void_approve | ✅ | public | is_manager() | ✅ |
| shift_reopen | ✅ | public | is_manager() | ✅ |
| staff_get_open_shift | ✅ | public | is_staff() | ✅ |
| manager_report | ✅ | public | is_manager() | ✅ |
| manager_report_enhanced | ✅ | public | is_manager() | ✅ |
| manager_product_movement | ✅ | public | is_manager() | ✅ |
| manager_staff_performance | ✅ | public | is_manager() | ✅ |

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

## Remaining Security Tasks

- [ ] Run Supabase Security Advisor
- [ ] Run Supabase Performance Advisor
- [ ] Run gitleaks to scan for secrets
- [ ] Run npm audit
- [ ] Enable Dependabot
- [ ] Configure Turnstile on public forms
- [ ] Configure Cloudflare WAF rules
- [ ] Disable public sign-ups in Auth settings
- [ ] Enable MFA for manager accounts
- [ ] Set short session lifetime for staff
