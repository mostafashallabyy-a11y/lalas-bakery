-- ============================================================
-- Lala's Bakery — Phase 7: Stock counts + scarcity + alerts (0012_stock_counts.sql)
-- ============================================================
-- Adds:
--   * products: stock_qty, low_stock_threshold, track_stock
--   * stock_movements: log of all stock changes
--   * low_stock_alerts: manager notifications
--   * Stock decrement RPCs (atomic, row-locked, no overselling)
--   * Stock release for unpaid online orders (30 min TTL)
--   * Stock return on approved voids
--   * RLS + SECURITY DEFINER functions
-- ============================================================
begin;

-- ---- 1) Products: stock columns ----
alter table products add column if not exists stock_qty integer default 0 check (stock_qty >= 0);
alter table products add column if not exists low_stock_threshold integer default 10 check (low_stock_threshold >= 0);
alter table products add column if not exists track_stock boolean default true;

-- index for stock queries
create index products_stock_idx on products(stock_qty, track_stock);

-- ---- 2) stock_movements table ----
create table if not exists stock_movements (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,
  branch_id    uuid not null references branches(id) on delete cascade,
  change_qty   integer not null,
  reason       text not null check (reason in ('sale','restock','manual_edit','void','expiry')),
  changed_by   uuid references auth.users(id) on delete set null,
  note         text default '' check (char_length(note) <= 300),
  created_at   timestamptz not null default now()
);
create index stock_movements_product_idx on stock_movements(product_id, created_at desc);
create index stock_movements_branch_idx on stock_movements(branch_id, created_at desc);

-- ---- 3) low_stock_alerts table ----
create table if not exists low_stock_alerts (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  branch_id   uuid not null references branches(id) on delete cascade,
  stock_qty   integer not null,
  threshold   integer not null,
  resolved    boolean not null default false,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index low_stock_alerts_product_idx on low_stock_alerts(product_id, resolved);
create index low_stock_alerts_branch_idx on low_stock_alerts(branch_id, resolved, created_at desc);

-- ---- 4) RLS ----
alter table stock_movements enable row level security; alter table stock_movements force row level security;
alter table low_stock_alerts enable row level security; alter table low_stock_alerts force row level security;

-- stock_movements: staff read own branch, manager all
create policy stock_movements_staff_read on stock_movements for select to authenticated
  using (is_staff());
create policy stock_movements_manager_all on stock_movements for all to authenticated
  using (is_manager()) with check (is_manager());

-- low_stock_alerts: staff read own branch, manager all
create policy low_stock_alerts_staff_read on low_stock_alerts for select to authenticated
  using (is_staff());
create policy low_stock_alerts_manager_all on low_stock_alerts for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---- 5) RPC: decrement_stock (atomic, row-locked) ----
create or replace function decrement_stock(
  p_product_id uuid,
  p_qty integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    return jsonb_build_object('ok', false, 'message', 'الكمية المطلوبة غير متوفرة', 'available', v_prod.stock_qty) using errcode = 'P0002';
  end if;

  v_new_qty := v_prod.stock_qty - p_qty;

  update products set stock_qty = v_new_qty where id = p_product_id;

  insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, note)
  values (v_prod.id, v_prod.branch_id, -p_qty, 'sale', auth.uid(), 'بيع');

  -- check low stock alert
  if v_new_qty <= v_prod.low_stock_threshold and v_prod.stock_qty > v_prod.low_stock_threshold then
    insert into low_stock_alerts (product_id, branch_id, stock_qty, threshold)
    values (v_prod.id, v_prod.branch_id, v_new_qty, v_prod.low_stock_threshold);
  end if;

  return jsonb_build_object(
    'ok', true,
    'stock_decremented', true,
    'new_qty', v_new_qty,
    'product_id', v_prod.id
  );
end $$;
grant execute on function decrement_stock(uuid, integer) to authenticated;

-- ---- 6) RPC: increment_stock (restock, manager-only) ----
create or replace function increment_stock(
  p_product_id uuid,
  p_qty integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  values (v_prod.id, v_prod.branch_id, p_qty, 'restock', auth.uid(), coalesce(btrim(p_note), ''));

  -- resolve low stock alert if restocked above threshold
  update low_stock_alerts
  set resolved = true, resolved_by = auth.uid(), resolved_at = now()
  where product_id = p_product_id and resolved = false;

  return jsonb_build_object(
    'ok', true,
    'new_qty', v_new_qty,
    'product_id', v_prod.id
  );
end $$;
grant execute on function increment_stock(uuid, integer, text) to authenticated;

-- ---- 7) RPC: set_stock (exact count, manager-only) ----
create or replace function set_stock(
  p_product_id uuid,
  p_qty integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  -- resolve low stock alert if restocked above threshold
  if p_qty > v_prod.low_stock_threshold then
    update low_stock_alerts
    set resolved = true, resolved_by = auth.uid(), resolved_at = now()
    where product_id = p_product_id and resolved = false;
  end if;

  return jsonb_build_object(
    'ok', true,
    'new_qty', p_qty,
    'product_id', v_prod.id
  );
end $$;
grant execute on function set_stock(uuid, integer) to authenticated;

-- ---- 8) RPC: release_reserved_stock (release stock for unpaid orders older than 30 min) ----
create or replace function release_reserved_stock()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released integer := 0;
begin
  if not is_manager() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  -- Release stock for online orders older than 30 min that are not paid
  with stale_orders as (
    select o.id, oi.product_id, oi.qty, oi.unit_price, oi.line_total, oi.name_snapshot
    from orders o
    join order_items oi on oi.order_id = o.id
    where o.source = 'online'
      and o.payment_confirmed = false
      and o.created_at < now() - interval '30 minutes'
      and o.status = 'received'
  )
  update products p
  set stock_qty = p.stock_qty + so.qty
  from stale_orders so
  where p.id = so.product_id
  returning p.id, so.qty into v_released;

  -- mark stale orders as cancelled
  update orders
  set status = 'done'
  where source = 'online'
    and payment_confirmed = false
    and created_at < now() - interval '30 minutes'
    and status = 'received';

  -- log movements
  insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, note)
  select p.id, p.branch_id, so.qty, 'expiry', auth.uid(), 'إطلاق مخزون طلب غير مدفوع بعد 30 دقيقة'
  from stale_orders so
  join products p on p.id = so.product_id;

  return jsonb_build_object('ok', true, 'released_orders', v_released);
end $$;
grant execute on function release_reserved_stock() to authenticated;

-- ---- 9) RPC: return_stock_on_void (return stock when void approved) ----
create or replace function return_stock_on_void(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  -- return stock for each item
  insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, note)
  select oi.product_id, oi.product_id::text::uuid, oi.qty, 'void', auth.uid(), 'إرجاع مخزون بسبب إلغاء الطلب'
  from order_items oi
  where oi.order_id = p_order_id;

  -- update product stock
  update products p
  set stock_qty = p.stock_qty + sub.qty
  from (
    select oi.product_id, sum(oi.qty) as qty
    from order_items oi
    where oi.order_id = p_order_id
    group by oi.product_id
  ) sub
  where p.id = sub.product_id;

  -- resolve low stock alert if restocked above threshold
  update low_stock_alerts l
  set resolved = true, resolved_by = auth.uid(), resolved_at = now()
  from products p
  where l.product_id = p.product_id
    and l.resolved = false
    and p.stock_qty > p.low_stock_threshold;

  return jsonb_build_object('ok', true, 'stock_returned', true, 'order_id', p_order_id);
end $$;
grant execute on function return_stock_on_void(uuid) to authenticated;

-- ---- 10) RPC: submit_order_v2 with stock checking/decrementing ----
create or replace function submit_order_v2(
  p_branch_id uuid,
  p_items jsonb,
  p_delivery_type text,
  p_customer_name text,
  p_turnstile_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_branch branches;
  v_fee numeric(10,2);
  v_raw jsonb;
  v_pid uuid;
  v_qty int;
  v_prod products;
  v_count int := 0;
  v_sub numeric(10,2) := 0;
  v_oid uuid;
  v_num text;
  v_key uuid;
begin
  if p_turnstile_token::text is null then p_turnstile_token := null; end if;
  perform verify_turnstile(p_turnstile_token, 'order');

  if not rate_ok('order', 5, interval '30 minutes') then
    raise exception 'لقد تركت طلبات كثيرة في وقت قصير — استنى شوية وحاول تاني بعد قليل ❤️' using errcode = 'P0001';
  end if;

  v_name := regexp_replace(coalesce(p_customer_name,''), '\s+', ' ', 'g');
  v_name := btrim(v_name);
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'اكتب اسمك من ٢ لحروف ٦٠ حروف' using errcode = 'P0001';
  end if;

  select * into v_branch from branches where id = p_branch_id and is_active;
  if not found then
    raise exception 'الفرع اللي اخترته مش متاح حاليًا' using errcode = 'P0001';
  end if;

  if p_delivery_type not in ('pickup','table','obour') then
    raise exception 'اختر طريقة استلام صحيحة' using errcode = 'P0001';
  end if;

  v_fee := case p_delivery_type
    when 'table'  then coalesce((select value::numeric from settings where key='delivery_fee_table'), 5)
    when 'obour'  then coalesce((select value::numeric from settings where key='delivery_fee_obour'), 50)
    else 0
  end;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'طلبيتك فاضية — اختار من المنيو الأول' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then
    raise exception 'طلبيتك فاضية أو أكبر من اللازم' using errcode = 'P0001';
  end if;

  insert into orders (branch_id, customer_name, delivery_type, delivery_fee, source, payment_confirmed, created_by)
  values (v_branch.id, v_name, p_delivery_type, v_fee, 'online', false, auth.uid())
  returning id, order_number, tracking_key into v_oid, v_num, v_key;

  for v_raw in select * from jsonb_array_elements(p_items) loop
    v_pid := v_raw->>'product_id';
    v_qty := (v_raw->>'qty')::int;

    select * into v_prod from products where id = v_pid for update;
    if not found then
      raise exception 'واحد من المنتجات غير موجود' using errcode = 'P0001';
    end if;

    if v_prod.track_stock and v_prod.stock_qty < v_qty then
      raise exception 'الكمية المطلوبة غير متوفرة' using errcode = 'P0002';
    end if;

    select * into v_prod from products p
    where p.id = v_pid and p.is_active and p.branch_id = v_branch.id;
    if not found then
      raise exception 'واحد من المنتجات غير متاح في الفرع ده — حدّث الصفحة' using errcode = 'P0001';
    end if;

    if v_prod.track_stock then
      update products set stock_qty = stock_qty - v_qty where id = v_pid;
      insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, note)
      values (v_pid, v_prod.branch_id, -v_qty, 'sale', auth.uid(), 'بيع');

      if v_prod.stock_qty - v_qty <= v_prod.low_stock_threshold then
        insert into low_stock_alerts (product_id, branch_id, stock_qty, threshold)
        values (v_pid, v_prod.branch_id, v_prod.stock_qty - v_qty, v_prod.low_stock_threshold);
      end if;
    end if;

    insert into order_items (order_id, product_id, name_snapshot, unit_price, qty, line_total)
    values (v_oid, v_prod.id, v_prod.name, v_prod.price, v_qty, (v_prod.price * v_qty));

    v_sub := v_sub + (v_prod.price * v_qty);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'طلبيتك فاضة — اختار من المنيو الأول' using errcode = 'P0001';
  end if;

  update orders set subtotal = v_sub, total = v_sub + v_fee where id = v_oid;

  insert into order_events (order_id, event_type, new_status, changed_by, note)
  values (v_oid, 'created', 'received', auth.uid(), '');

  return jsonb_build_object(
    'ok', true,
    'order_number', v_num,
    'order_id', v_oid,
    'tracking_key', v_key,
    'branch_name', v_branch.name,
    'subtotal', v_sub,
    'delivery_fee', v_fee,
    'total', v_sub + v_fee,
    'status', 'received'
  );
end $$;
grant execute on function submit_order_v2(uuid, jsonb, text, text, text) to authenticated;

-- ---- 10) Grants ----
grant all on stock_movements to authenticated;
grant all on low_stock_alerts to authenticated;
grant select on stock_movements to anon;
grant select on low_stock_alerts to anon;

commit;