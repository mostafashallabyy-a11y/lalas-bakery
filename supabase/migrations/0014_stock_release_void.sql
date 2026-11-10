-- ============================================================
-- Lala's Bakery — 0014: stock release (stale unpaid orders) and
-- stock return (void approved). Fixed versions:
--   * release_reserved_stock: two statements, no broken RETURNING INTO
--   * return_stock_on_void: correct branch_id from products, one summed
--     movement per product, idempotent via stock_movements.order_id
-- ============================================================
begin;

create or replace function release_reserved_stock()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_released integer := 0;
begin
  if not is_manager() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  -- 1) put stock back (grouped per product)
  update products p
  set stock_qty = p.stock_qty + s.qty
  from (
    select oi.product_id, sum(oi.qty) as qty
    from orders o
    join order_items oi on oi.order_id = o.id
    where o.source = 'online'
      and o.payment_confirmed = false
      and o.created_at < now() - interval '30 minutes'
      and o.status = 'received'
      and oi.product_id is not null
    group by oi.product_id
  ) s
  where p.id = s.product_id;

  -- 2) log one movement per (order, product)
  insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, order_id, note)
  select oi.product_id, p.branch_id, oi.qty, 'expiry', auth.uid(), o.id, 'إطلاق مخزون طلب غير مدفوع بعد 30 دقيقة'
  from orders o
  join order_items oi on oi.order_id = o.id
  join products p on p.id = oi.product_id
  where o.source = 'online'
    and o.payment_confirmed = false
    and o.created_at < now() - interval '30 minutes'
    and o.status = 'received'
    and oi.product_id is not null;

  -- 3) close the stale orders
  update orders set status = 'done'
  where source = 'online'
    and payment_confirmed = false
    and created_at < now() - interval '30 minutes'
    and status = 'received';
  get diagnostics v_released = row_count;

  return jsonb_build_object('ok', true, 'released_orders', v_released);
end $fn$;
grant execute on function release_reserved_stock() to authenticated;

create or replace function return_stock_on_void(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_order orders;
begin
  if not is_manager() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  select * into v_order from orders where id = p_order_id;
  if not found then
    raise exception 'الطلب غير موجود' using errcode = 'P0001';
  end if;

  -- idempotent: refuse to return stock twice for the same order
  if exists (select 1 from stock_movements where order_id = p_order_id and reason = 'void') then
    return jsonb_build_object('ok', false, 'message', 'تم إرجاع المخزون لهذا الطلب بالفعل');
  end if;

  insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, order_id, note)
  select oi.product_id, p.branch_id, sum(oi.qty)::integer, 'void', auth.uid(), p_order_id, 'إرجاع مخزون بسبب إلغاء الطلب'
  from order_items oi
  join products p on p.id = oi.product_id
  where oi.order_id = p_order_id and oi.product_id is not null
  group by oi.product_id, p.branch_id;

  update products p
  set stock_qty = p.stock_qty + sub.qty
  from (
    select oi.product_id, sum(oi.qty) as qty
    from order_items oi
    where oi.order_id = p_order_id and oi.product_id is not null
    group by oi.product_id
  ) sub
  where p.id = sub.product_id;

  update low_stock_alerts l
  set resolved = true, resolved_by = auth.uid(), resolved_at = now()
  from products p
  where l.product_id = p.id
    and l.resolved = false
    and p.stock_qty > p.low_stock_threshold;

  return jsonb_build_object('ok', true, 'stock_returned', true, 'order_id', p_order_id);
end $fn$;
grant execute on function return_stock_on_void(uuid) to authenticated;

commit;
