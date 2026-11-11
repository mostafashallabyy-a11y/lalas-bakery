-- ============================================================
-- Lala's Bakery — Hotfix: drop leaky RPCs (0022_drop_leaky_rpcs.sql)
-- ============================================================
-- Two anon-callable RPCs from earlier migrations were never dropped
-- when 0021_order_privacy.sql hardened the tracking flow:
--
--   1) get_order_tracking_key(text) — returns the tracking_key UUID
--      for any order number, letting an attacker bypass the key
--      requirement added in 0021.
--
--   2) get_payment_info(text)       — the OLD 1-arg overload from
--      0002_security.sql; reveals total, status, branch_name,
--      created_at for any order number without a tracking key.
--      The secure 2-arg version (order_number + tracking_key)
--      from 0021 remains intact.
-- ============================================================
begin;

-- 1) Drop the tracking-key leak
drop function if exists get_order_tracking_key(text);

-- 2) Drop the old 1-arg get_payment_info (the 2-arg version stays)
drop function if exists get_payment_info(text);

commit;
