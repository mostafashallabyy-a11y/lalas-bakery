-- ============================================================
-- Lala's Bakery — 0027: Fix POS cash phone constraint + manager clear test data
-- ============================================================
-- 1) Ensures orders_cash_phone_check allows POS cash orders without customer phone
--    (fixes: "new row for relation \"orders\" violates check constraint
--     \"orders_cash_phone_check\"" in POS/cashier).
-- 2) Adds manager_clear_test_data RPC (manager-only) to remove test
--    transactions/reports in a selected date range/branch so they don't
--    pollute official reports. Restores reserved stock where needed.
-- Safe to re-run. New migration only. RLS stays on. No service_role.
-- ============================================================
begin;

-- ---- 1) Relax/ensure cash phone constraint for POS orders ----
alter table orders drop constraint if exists orders_cash_phone_check;
alter table orders add constraint orders_cash_phone_check check (
  payment_method <> 'cash'
  or source = 'pos'
  or length(btrim(coalesce(customer_phone, ''))) > 0
);

-- ---- 2) Manager: clear/delete test transactions and reports in range ----
drop function if exists public.manager_clear_test_data(date, date, uuid, boolean, text);
drop function if exists public.manager_clear_test_data(date, date, uuid, boolean);
drop function if exists public.manager_clear_test_data(date, date, uuid);
drop function if exists public.manager_clear_test_data(date, date);

create or replace function manager_clear_test_data(
  p_from date,
  p_to date,
  p_branch_id uuid default null,
  p_include_shifts boolean default false,
  p_confirm text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_f timestamptz := p_from::timestamptz at time zone 'Africa/Cairo';
  v_t timestamptz := (p_to::timestamptz + interval '1 day') at time zone 'Africa/Cairo';
  v_order_ids uuid[];
  v_deleted_orders int := 0;
  v_deleted_shifts int := 0;
  v_stock_products int := 0;
begin
  if not is_manager() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  if btrim(coalesce(p_confirm, '')) <> 'DELETE' then
    raise exception 'اكتب DELETE للتأكيد' using errcode = 'P0001';
  end if;

  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'نطاق التاريخ غير صحيح' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(o.id), array[]::uuid[]) into v_order_ids
  from orders o
  where o.created_at >= v_f and o.created_at < v_t
    and (p_branch_id is null or o.branch_id = p_branch_id);

  if coalesce(array_length(v_order_ids, 1), 0) = 0 then
    if coalesce(p_include_shifts, false) then
      delete from shifts s
      where s.opened_at >= v_f and s.opened_at < v_t
        and (p_branch_id is null or s.branch_id = p_branch_id);
      get diagnostics v_deleted_shifts = row_count;
    end if;
    return jsonb_build_object(
      'ok', true,
      'deleted_orders', 0,
      'deleted_shifts', v_deleted_shifts,
      'stock_returned_products', 0,
      'message', 'لا توجد بيانات للاختبار في هذا النطاق'
    );
  end if;

  -- Restore stock for orders that still have net reserved (sale) quantity not yet returned
  with net as (
    select sm.product_id,
           sum(case when sm.reason = 'sale' then abs(sm.change_qty) else -abs(sm.change_qty) end)::int as reserved_qty
    from stock_movements sm
    join products p on p.id = sm.product_id
    where sm.order_id = any(v_order_ids)
      and sm.reason in ('sale','void','expiry','restock')
      and p.track_stock
    group by sm.product_id
  ), to_return as (
    select product_id, reserved_qty from net where reserved_qty > 0
  ), upd as (
    update products p
    set stock_qty = p.stock_qty + t.reserved_qty
    from to_return t
    where p.id = t.product_id
    returning p.id
  )
  select count(*) into v_stock_products from upd;

  -- Remove related records (order_items/order_events cascade on order delete, but clear explicit links first)
  delete from low_stock_alerts where product_id in (
    select distinct i.product_id from order_items i
    where i.order_id = any(v_order_ids) and i.product_id is not null
  );
  delete from stock_movements where order_id = any(v_order_ids);
  delete from void_requests where order_id = any(v_order_ids);
  delete from order_status_public where order_number in (select o.order_number from orders o where o.id = any(v_order_ids));

  delete from orders o where o.id = any(v_order_ids);
  get diagnostics v_deleted_orders = row_count;

  if coalesce(p_include_shifts, false) then
    delete from shifts s
    where s.opened_at >= v_f and s.opened_at < v_t
      and (p_branch_id is null or s.branch_id = p_branch_id);
    get diagnostics v_deleted_shifts = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'deleted_orders', v_deleted_orders,
    'deleted_shifts', v_deleted_shifts,
    'stock_returned_products', v_stock_products
  );
end $$;

grant execute on function manager_clear_test_data(date, date, uuid, boolean, text) to authenticated;

commit;
