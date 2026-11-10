-- ============================================================
-- Lala's Bakery — 0013: stock RPC functions (atomic, row-locked).
-- Uses named dollar tags so any truncation is obvious.
-- ============================================================
begin;

-- belt and braces: ensure stock_movements.order_id exists even if an older
-- 0012 was already applied (order_id was added later).
alter table stock_movements add column if not exists order_id uuid references orders(id) on delete set null;
create index if not exists stock_movements_order_idx on stock_movements(order_id);

-- decrement_stock: called by order flows; returns ok:false (never throws) on insufficient stock
create or replace function decrement_stock(
  p_product_id uuid,
  p_qty integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_prod products;
  v_new_qty integer;
begin
  if p_qty <= 0 then
    raise exception 'الكمية يجب أن تكون أكبر من صفر' using errcode = 'P0001';
  end if;

  select * into v_prod from products where id = p_product_id for update;
  if not found then
    raise exception 'المنتج غير موجود' using errcode = 'P0001';
  end if;

  if not v_prod.track_stock then
    return jsonb_build_object('ok', true, 'stock_decremented', false, 'reason', 'تتبع المخزون معطل');
  end if;

  if v_prod.stock_qty < p_qty then
    return jsonb_build_object('ok', false, 'message', 'الكمية المطلوبة غير متوفرة', 'available', v_prod.stock_qty);
  end if;

  v_new_qty := v_prod.stock_qty - p_qty;
  update products set stock_qty = v_new_qty where id = p_product_id;

  insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, note)
  values (v_prod.id, v_prod.branch_id, -p_qty, 'sale', auth.uid(), 'بيع');

  if v_new_qty <= v_prod.low_stock_threshold and v_prod.stock_qty > v_prod.low_stock_threshold then
    insert into low_stock_alerts (product_id, branch_id, stock_qty, threshold)
    values (v_prod.id, v_prod.branch_id, v_new_qty, v_prod.low_stock_threshold);
  end if;

  return jsonb_build_object('ok', true, 'stock_decremented', true, 'new_qty', v_new_qty, 'product_id', v_prod.id);
end $fn$;
grant execute on function decrement_stock(uuid, integer) to authenticated;

-- increment_stock: restock, manager-only
create or replace function increment_stock(
  p_product_id uuid,
  p_qty integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_prod products;
  v_new_qty integer;
begin
  if not is_manager() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  if p_qty <= 0 then
    raise exception 'الكمية يجب أن تكون أكبر من صفر' using errcode = 'P0001';
  end if;

  select * into v_prod from products where id = p_product_id for update;
  if not found then
    raise exception 'المنتج غير موجود' using errcode = 'P0001';
  end if;

  v_new_qty := v_prod.stock_qty + p_qty;
  update products set stock_qty = v_new_qty where id = p_product_id;

  insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, note)
  values (v_prod.id, v_prod.branch_id, p_qty, 'restock', auth.uid(), coalesce(btrim(coalesce(p_note, '')), ''));

  update low_stock_alerts
  set resolved = true, resolved_by = auth.uid(), resolved_at = now()
  where product_id = p_product_id and resolved = false;

  return jsonb_build_object('ok', true, 'new_qty', v_new_qty, 'product_id', v_prod.id);
end $fn$;
grant execute on function increment_stock(uuid, integer, text) to authenticated;

-- set_stock: exact count correction, manager-only
create or replace function set_stock(
  p_product_id uuid,
  p_qty integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_prod products;
  v_diff integer;
begin
  if not is_manager() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  if p_qty < 0 then
    raise exception 'الكمية يجب أن تكون غير سالبة' using errcode = 'P0001';
  end if;

  select * into v_prod from products where id = p_product_id for update;
  if not found then
    raise exception 'المنتج غير موجود' using errcode = 'P0001';
  end if;

  v_diff := p_qty - v_prod.stock_qty;
  update products set stock_qty = p_qty where id = p_product_id;

  if v_diff <> 0 then
    insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, note)
    values (v_prod.id, v_prod.branch_id, v_diff, 'manual_edit', auth.uid(), 'تعديل يدوي للكمية');
  end if;

  if p_qty > v_prod.low_stock_threshold then
    update low_stock_alerts
    set resolved = true, resolved_by = auth.uid(), resolved_at = now()
    where product_id = p_product_id and resolved = false;
  end if;

  return jsonb_build_object('ok', true, 'new_qty', p_qty, 'product_id', v_prod.id);
end $fn$;
grant execute on function set_stock(uuid, integer) to authenticated;

commit;
