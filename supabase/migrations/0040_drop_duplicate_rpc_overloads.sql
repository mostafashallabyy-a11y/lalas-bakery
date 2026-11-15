-- ============================================================
-- Lala's Bakery — 0040: drop duplicate RPC overloads
-- ============================================================
-- PostgREST cannot choose between same-name function overloads; old
-- signatures were left behind by prior migrations. Keep only the latest
-- signatures used by the app:
--   submit_order_v2(... 12 args, p_customer_note)
--   pos_create_order(... 9 args, p_customer_note)
-- New migration only. RLS stays on. No service_role.
-- ============================================================
begin;

-- submit_order_v2 overloads to drop (keep the 12-argument version)
drop function if exists public.submit_order_v2(uuid, jsonb, text, text, text);
drop function if exists public.submit_order_v2(uuid, jsonb, text, text, text, text, text);
drop function if exists public.submit_order_v2(uuid, jsonb, text, text, text, text, text, text, text);
drop function if exists public.submit_order_v2(uuid, jsonb, text, text, text, text, text, text, text, text, text);

-- pos_create_order overloads to drop (keep the 9-argument version)
drop function if exists public.pos_create_order(uuid, jsonb, text, text, text, text);
drop function if exists public.pos_create_order(uuid, jsonb, text, text, text, text, text, text);

select pg_notify('pgrst','reload schema');

commit;
