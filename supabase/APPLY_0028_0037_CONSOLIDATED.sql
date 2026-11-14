-- Consolidated migrations 0028-0037 for Lala's Bakery (apply in Supabase SQL Editor)
-- Run this as a single script, then verify pg_notify and obour expiry schedule.

-- ========== BEGIN supabase/migrations/0028_part1_delivery_floor_spot.sql ==========
-- ============================================================
-- Lala's Bakery — 0028 (Part 1): Floor + spot for in-branch delivery ("توصيل داخل الفرع")
-- ============================================================
-- Adds per-branch delivery floors config and per-order floor/spot.
-- Floor is REQUIRED for delivery_type='table' (in-branch delivery), optional/ignored for pickup/obour.
-- Validated client-side AND inside submit_order_v2 / pos_create_order.
-- Exposed to the same customer via get_order_details (tracking-keyed), never via track_order_by_key.
-- New migration only. RLS stays on. No service_role.
-- ============================================================
begin;

-- ---- 1) Per-branch floors config ----
-- JSON array of floor labels shown as chips (manager-editable). Default: أرضي + 1..5.
alter table branches
  add column if not exists delivery_floors jsonb
  not null default '["الأرضي","1","2","3","4","5"]'::jsonb;

do $$ begin
  alter table branches add constraint branches_delivery_floors_check
    check (jsonb_typeof(delivery_floors) = 'array' and jsonb_array_length(delivery_floors) between 1 and 30);
exception when duplicate_object then null; end $$;

-- ---- 2) Orders: floor + spot (in-branch delivery) ----
alter table orders add column if not exists delivery_floor text;
alter table orders add column if not exists delivery_spot text;

-- Trim/limit helper conditions (NULL allowed for non-table orders)
do $$ begin
  alter table orders add constraint orders_delivery_floor_len_check
    check (delivery_floor is null or char_length(delivery_floor) between 1 and 60);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table orders add constraint orders_delivery_spot_len_check
    check (delivery_spot is null or char_length(delivery_spot) <= 120);
exception when duplicate_object then null; end $$;

-- Floor required iff in-branch delivery (table)
do $$ begin
  alter table orders add constraint orders_delivery_floor_required_check
    check (
      (delivery_type = 'table' and length(btrim(coalesce(delivery_floor,''))) > 0)
      or (delivery_type <> 'table')
    ) not valid;
exception when duplicate_object then null; end $$;

-- Keep existing cash phone constraint semantics (POS cash exempt) intact
alter table orders drop constraint if exists orders_cash_phone_check;
alter table orders add constraint orders_cash_phone_check check (
  payment_method <> 'cash'
  or source = 'pos'
  or length(btrim(coalesce(customer_phone, ''))) > 0
) not valid;

-- ---- 3) submit_order_v2: add floor/spot params + validation (backward compatible) ----
drop function if exists public.submit_order_v2(uuid, jsonb, text, text, text, text, text, text, text);

create or replace function submit_order_v2(
  p_branch_id uuid,
  p_items jsonb,
  p_delivery_type text,
  p_customer_name text,
  p_turnstile_token text default null,
  p_payment_method text default 'instapay',
  p_customer_phone text default null,
  p_delivery_floor text default null,
  p_delivery_spot text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name text;
  v_phone text;
  v_floor text;
  v_spot text;
  v_branch branches;
  v_fee numeric(10,2);
  v_raw jsonb;
  v_pid uuid;
  v_qty int;
  v_prod products;
  v_count int := 0;
  v_sub numeric(10,2) := 0;
  v_total numeric(10,2) := 0;
  v_oid uuid;
  v_num text;
  v_key uuid;
  v_method text := lower(btrim(coalesce(p_payment_method,'instapay')));
  v_timeout int;
  v_max_cash numeric(10,2);
begin
  if p_turnstile_token::text is null then p_turnstile_token := null; end if;
  perform verify_turnstile(p_turnstile_token, 'order');

  if not rate_ok('order', 5, interval '30 minutes') then
    raise exception 'لقد تركت طلبات كثيرة في وقت قصير — استنى شوية وحاول تاني بعد قليل ❤️' using errcode = 'P0001';
  end if;

  -- opportunistic expiry cleanup (best-effort)
  begin perform expire_stale_cash_orders(null); exception when others then null; end;

  v_name := regexp_replace(coalesce(p_customer_name,''), '\s+', ' ', 'g');
  v_name := btrim(v_name);
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'اكتب اسمك من ٢ لحروف ٦٠ حروف' using errcode = 'P0001';
  end if;

  if v_method not in ('cash','instapay') then
    raise exception 'طريقة الدفع غير صحيحة' using errcode = 'P0001';
  end if;

  v_phone := nullif(regexp_replace(coalesce(p_customer_phone,''), '\s+', '', 'g'), '');
  v_floor := nullif(btrim(regexp_replace(coalesce(p_delivery_floor,''), '\s+', ' ', 'g')), '');
  v_spot  := nullif(btrim(regexp_replace(coalesce(p_delivery_spot,''),  '\s+', ' ', 'g')), '');

  select * into v_branch from branches where id = p_branch_id and is_active;
  if not found then
    raise exception 'الفرع اللي اخترته مش متاح حاليًا' using errcode = 'P0001';
  end if;

  if p_delivery_type not in ('pickup','table','obour') then
    raise exception 'اختر طريقة استلام صحيحة' using errcode = 'P0001';
  end if;

  if p_delivery_type = 'table' then
    if v_floor is null or char_length(v_floor) < 1 then
      raise exception 'اختار رقم الدور عشان الموظفة توصلك بسرعة 💗' using errcode = 'P0001';
    end if;
    if char_length(v_floor) > 60 then
      raise exception 'رقم الدور طويل — اختصره شوية' using errcode = 'P0001';
    end if;
    if v_spot is not null and char_length(v_spot) > 120 then
      raise exception 'مكان الجلوس/الغرفة طويل — اختصره شوية' using errcode = 'P0001';
    end if;
  else
    -- not required for pickup/obour; ignore if sent
    v_floor := null;
    v_spot := null;
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

  if v_method = 'cash' then
    if not coalesce(v_branch.cash_enabled, true) then
      raise exception 'الدفع كاش غير متاح حاليًا في هذا الفرع' using errcode = 'P0001';
    end if;
    if not is_valid_eg_phone(v_phone) then
      raise exception 'اكتب رقم موبايل مصري صحيح (11 رقم يبدأ بـ 010 أو 011 أو 012 أو 015)' using errcode = 'P0001';
    end if;
    if not rate_ok('cash_order_ip', 5, interval '30 minutes') then
      raise exception 'طلبات كاش كثيرة من هذا الجهاز — استنى شوية وحاول تاني' using errcode = 'P0001';
    end if;
    if not rate_ok('cash_order_phone:' || md5(v_phone), 3, interval '30 minutes') then
      raise exception 'طلبات كاش كثيرة على هذا الرقم — استنى شوية وحاول تاني' using errcode = 'P0001';
    end if;
  end if;

  insert into orders (branch_id, customer_name, customer_phone, delivery_type, delivery_fee, delivery_floor, delivery_spot, source, payment_confirmed, payment_method, payment_status, created_by)
  values (v_branch.id, v_name, v_phone, p_delivery_type, v_fee, v_floor, v_spot, 'online', false, v_method, 'pending', auth.uid())
  returning id, order_number, tracking_key into v_oid, v_num, v_key;

  for v_raw in select * from jsonb_array_elements(p_items) loop
    v_pid := v_raw->>'product_id';
    v_qty := (v_raw->>'qty')::int;

    select * into v_prod from products
    where id = v_pid and is_active and branch_id = v_branch.id
    for update;
    if not found then
      raise exception 'واحد من المنتجات غير متاح في الفرع ده — حدّث الصفحة' using errcode = 'P0001';
    end if;

    if v_qty is null or v_qty < 1 or v_qty > 30 then
      raise exception 'الكمية غير صحيحة' using errcode = 'P0001';
    end if;

    if v_prod.track_stock and v_prod.stock_qty < v_qty then
      raise exception 'الكمية المطلوبة غير متوفرة' using errcode = 'P0002';
    end if;

    if v_prod.track_stock then
      update products set stock_qty = stock_qty - v_qty where id = v_pid;
      insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, order_id, note)
      values (v_pid, v_prod.branch_id, -v_qty, 'sale', auth.uid(), v_oid, 'بيع');
      if v_prod.stock_qty - v_qty <= v_prod.low_stock_threshold
         and v_prod.stock_qty > v_prod.low_stock_threshold then
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
    raise exception 'طلبيتك فاضية — اختار من المنيو الأول' using errcode = 'P0001';
  end if;

  v_total := v_sub + v_fee;

  if v_method = 'cash' then
    v_max_cash := coalesce(v_branch.cash_max_amount, 500);
    if v_total > v_max_cash then
      raise exception 'حد أقصى لطلبات الكاش % ج — لو طلبك أكبر اختار الدفع بانستا باي', v_max_cash using errcode = 'P0001';
    end if;
  end if;

  update orders set subtotal = v_sub, total = v_total where id = v_oid;

  insert into order_events (order_id, event_type, new_status, changed_by, note)
  values (v_oid, 'created', 'received', auth.uid(), case when v_method='cash' then 'طلب كاش (أونلاين)' else '' end);

  return jsonb_build_object(
    'ok', true,
    'order_number', v_num,
    'order_id', v_oid,
    'tracking_key', v_key,
    'branch_name', v_branch.name,
    'subtotal', v_sub,
    'delivery_fee', v_fee,
    'total', v_total,
    'status', 'received',
    'payment_method', v_method,
    'payment_status', 'pending'
  );
end $fn$;

-- Grants (keep old signatures usable + new)
grant execute on function submit_order_v2(uuid, jsonb, text, text, text) to anon, authenticated;
grant execute on function submit_order_v2(uuid, jsonb, text, text, text, text, text) to anon, authenticated;
grant execute on function submit_order_v2(uuid, jsonb, text, text, text, text, text, text, text) to anon, authenticated;

-- ---- 4) pos_create_order: add floor/spot params + validation ----
drop function if exists public.pos_create_order(uuid, jsonb, text, text, text, text, text, text);

create or replace function pos_create_order(
  p_branch_id uuid,
  p_items jsonb,
  p_delivery_type text default 'pickup',
  p_customer_name text default null,
  p_payment_method text default 'cash',
  p_staff_note text default null,
  p_delivery_floor text default null,
  p_delivery_spot text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_floor text;
  v_spot text;
  v_branch branches;
  v_fee numeric(10,2) := 0;
  v_raw jsonb;
  v_pid uuid;
  v_qty int;
  v_prod products;
  v_count int := 0;
  v_sub numeric(10,2) := 0;
  v_oid uuid;
  v_num text;
  v_method text := lower(btrim(coalesce(p_payment_method,'cash')));
  v_pay_status text;
begin
  if not is_staff() then raise exception 'غير مسموح' using errcode = '42501'; end if;
  if v_method not in ('cash','instapay') then
    raise exception 'طريقة دفع غير صحيحة' using errcode = 'P0001';
  end if;

  v_name := nullif(btrim(coalesce(p_customer_name,'')), '');
  if char_length(v_name) > 60 then raise exception 'الاسم طويل زيادة عن اللزوم' using errcode = 'P0001'; end if;

  v_floor := nullif(btrim(regexp_replace(coalesce(p_delivery_floor,''), '\s+', ' ', 'g')), '');
  v_spot  := nullif(btrim(regexp_replace(coalesce(p_delivery_spot,''),  '\s+', ' ', 'g')), '');

  select * into v_branch from branches where id = p_branch_id and is_active;
  if not found then raise exception 'الفرع اللي اخترته مش متاح حاليًا' using errcode = 'P0001'; end if;
  if p_delivery_type not in ('pickup','table','obour') then raise exception 'اختر طريقة استلام صحيحة' using errcode = 'P0001'; end if;

  if p_delivery_type = 'table' then
    if v_floor is null or char_length(v_floor) < 1 then
      raise exception 'اكتب/اختار رقم الدور لطلب التوصيل داخل الفرع' using errcode = 'P0001';
    end if;
    if char_length(v_floor) > 60 then
      raise exception 'رقم الدور طويل — اختصره شوية' using errcode = 'P0001';
    end if;
    if v_spot is not null and char_length(v_spot) > 120 then
      raise exception 'مكان الجلوس/الغرفة طويل — اختصره شوية' using errcode = 'P0001';
    end if;
  else
    v_floor := null;
    v_spot := null;
  end if;

  v_fee := case p_delivery_type
    when 'table'  then coalesce((select value::numeric from settings where key='delivery_fee_table'), 5)
    when 'obour'  then coalesce((select value::numeric from settings where key='delivery_fee_obour'), 50)
    else 0
  end;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then
    raise exception 'طلبيتك فاضية أو أكبر من اللازم' using errcode = 'P0001';
  end if;

  v_pay_status := 'paid';

  insert into orders (branch_id, customer_name, delivery_type, delivery_fee, delivery_floor, delivery_spot, source, payment_confirmed, payment_method, payment_status, created_by)
  values (v_branch.id, coalesce(v_name, 'عميل فرع'), p_delivery_type, v_fee, v_floor, v_spot, 'pos', true, v_method, v_pay_status, auth.uid())
  returning id, order_number into v_oid, v_num;

  for v_raw in select * from jsonb_array_elements(p_items) loop
    v_pid := v_raw->>'product_id';
    v_qty := (v_raw->>'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 30 then raise exception 'الكمية غير صحيحة' using errcode = 'P0001'; end if;
    select * into v_prod from products p where p.id = v_pid and p.is_active and p.branch_id = v_branch.id for update;
    if not found then raise exception 'واحد من المنتجات مش متاح في الفرع ده — حدّث الصفحة' using errcode = 'P0001'; end if;

    if v_prod.track_stock and v_prod.stock_qty < v_qty then
      raise exception 'الكمية المطلوبة غير متوفرة' using errcode = 'P0002';
    end if;
    if v_prod.track_stock then
      update products set stock_qty = stock_qty - v_qty where id = v_pid;
      insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, order_id, note)
      values (v_pid, v_prod.branch_id, -v_qty, 'sale', auth.uid(), v_oid, 'بيع POS');
    end if;

    insert into order_items (order_id, product_id, name_snapshot, unit_price, qty, line_total)
    values (v_oid, v_prod.id, v_prod.name, v_prod.price, v_qty, (v_prod.price * v_qty));
    v_sub := v_sub + (v_prod.price * v_qty);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'طلبيتك فاضية — اختار من المنيو الأول' using errcode = 'P0001'; end if;
  update orders set subtotal = v_sub, total = v_sub + v_fee where id = v_oid;
  insert into order_events (order_id, event_type, new_status, changed_by, note)
  values (v_oid, 'created', 'received', auth.uid(), coalesce(p_staff_note, ''));

  if v_method = 'cash' then
    update orders set cash_received_at = now(), cash_received_by = auth.uid() where id = v_oid;
  end if;

  return jsonb_build_object('ok', true, 'order_number', v_num, 'order_id', v_oid, 'total', v_sub + v_fee, 'status', 'received', 'source', 'pos', 'payment_method', v_method, 'payment_status', v_pay_status);
end $$;

grant execute on function pos_create_order(uuid, jsonb, text, text, text, text) to authenticated;
grant execute on function pos_create_order(uuid, jsonb, text, text, text, text, text, text) to authenticated;

-- ---- 5) get_order_details: include floor/spot for the same customer's own order (tracking-keyed) ----
create or replace function get_order_details(
  p_order_number text,
  p_tracking_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_out jsonb;
begin
  if length(trim(coalesce(p_order_number, ''))) = 0
     or length(trim(coalesce(p_tracking_key, ''))) = 0 then
    raise exception 'مفتاح التتبع مش مطابق لهذا الطلب' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'ok', true,
    'order_number', o.order_number,
    'status', o.status::text,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'branch_name', b.name,
    'delivery_type', o.delivery_type,
    'delivery_fee', o.delivery_fee,
    'delivery_floor', o.delivery_floor,
    'delivery_spot', o.delivery_spot,
    'subtotal', o.subtotal,
    'total', o.total,
    'created_at', o.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', i.name_snapshot,
        'qty', i.qty,
        'unit_price', i.unit_price,
        'line_total', i.line_total
      ) order by i.id)
      from order_items i where i.order_id = o.id
    ), '[]'::jsonb)
  ) into v_out
  from orders o
  join branches b on b.id = o.branch_id
  where o.order_number = p_order_number
    and o.tracking_key::text = p_tracking_key;

  if v_out is null then
    raise exception 'مفتاح التتبع مش مطابق لهذا الطلب' using errcode = 'P0001';
  end if;

  return v_out;
end $fn$;
grant execute on function get_order_details(text, text) to anon;

-- track_order_by_key intentionally unchanged: does NOT expose delivery_floor/spot (public tracking).

commit;


-- ========== END supabase/migrations/0028_part1_delivery_floor_spot.sql ==========

-- ========== BEGIN supabase/migrations/0029_part3_pos_fix.sql ==========
-- ============================================================
-- Lala's Bakery — 0029 (Part 3): Fix POS order creation blockers
-- ============================================================
-- Ensures branch/POS cash orders with no phone never violate constraints,
-- and POS RPC/constraints never block on online-only requirements.
-- New migration only. RLS stays on. No service_role.
-- ============================================================
begin;

-- 1) Phone required only for ONLINE cash orders (POS/counter has no phone by design)
alter table orders drop constraint if exists orders_cash_phone_check;
alter table orders add constraint orders_cash_phone_check check (
  payment_method <> 'cash'
  or source = 'pos'
  or length(btrim(coalesce(customer_phone, ''))) > 0
) not valid;

-- Floor required only for in-branch delivery (table) — applies to POS and online (correct);
-- pickup/obour never require floor/spot.
-- (constraint from 0028 remains correct; reassert for clarity/idempotence)
do $$ begin
  alter table orders add constraint orders_delivery_floor_required_check
    check (
      (delivery_type = 'table' and length(btrim(coalesce(delivery_floor,''))) > 0)
      or (delivery_type <> 'table')
    ) not valid;
exception when duplicate_object then null; end $$;

-- 2) POS RPC: staff counter orders must not be blocked by online-only rules
--    (turnstile/rate limits/online cash phone-max/obour address/location/notes rules live in submit_order_v2 or future checks).
--    POS: name/phone optional, payment_method cash|instapay only, status received + paid at counter.
drop function if exists public.pos_create_order(uuid, jsonb, text, text, text, text, text, text);

create or replace function pos_create_order(
  p_branch_id uuid,
  p_items jsonb,
  p_delivery_type text default 'pickup',
  p_customer_name text default null,
  p_payment_method text default 'cash',
  p_staff_note text default null,
  p_delivery_floor text default null,
  p_delivery_spot text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_floor text;
  v_spot text;
  v_branch branches;
  v_fee numeric(10,2) := 0;
  v_raw jsonb;
  v_pid uuid;
  v_qty int;
  v_prod products;
  v_count int := 0;
  v_sub numeric(10,2) := 0;
  v_oid uuid;
  v_num text;
  v_method text := lower(btrim(coalesce(p_payment_method,'cash')));
begin
  if not is_staff() then raise exception 'غير مسموح' using errcode = '42501'; end if;
  if v_method not in ('cash','instapay') then
    raise exception 'طريقة دفع غير صحيحة' using errcode = 'P0001';
  end if;

  -- POS: customer name/phone optional (no phone column set for POS)
  v_name := nullif(btrim(coalesce(p_customer_name,'')), '');
  if char_length(v_name) > 60 then raise exception 'الاسم طويل زيادة عن اللزوم' using errcode = 'P0001'; end if;

  v_floor := nullif(btrim(regexp_replace(coalesce(p_delivery_floor,''), '\s+', ' ', 'g')), '');
  v_spot  := nullif(btrim(regexp_replace(coalesce(p_delivery_spot,''),  '\s+', ' ', 'g')), '');

  select * into v_branch from branches where id = p_branch_id and is_active;
  if not found then raise exception 'الفرع اللي اخترته مش متاح حاليًا' using errcode = 'P0001'; end if;
  if p_delivery_type not in ('pickup','table','obour') then raise exception 'اختر طريقة استلام صحيحة' using errcode = 'P0001'; end if;

  if p_delivery_type = 'table' then
    if v_floor is null or char_length(v_floor) < 1 then
      raise exception 'اكتب/اختار رقم الدور لطلب التوصيل داخل الفرع' using errcode = 'P0001';
    end if;
    if char_length(v_floor) > 60 then
      raise exception 'رقم الدور طويل — اختصره شوية' using errcode = 'P0001';
    end if;
    if v_spot is not null and char_length(v_spot) > 120 then
      raise exception 'مكان الجلوس/الغرفة طويل — اختصره شوية' using errcode = 'P0001';
    end if;
  else
    v_floor := null;
    v_spot := null;
  end if;

  v_fee := case p_delivery_type
    when 'table'  then coalesce((select value::numeric from settings where key='delivery_fee_table'), 5)
    when 'obour'  then coalesce((select value::numeric from settings where key='delivery_fee_obour'), 50)
    else 0
  end;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then
    raise exception 'طلبيتك فاضية أو أكبر من اللازم' using errcode = 'P0001';
  end if;

  -- POS orders are counter orders: paid/confirmed at source, no online-only gates
  insert into orders (
    branch_id, customer_name, delivery_type, delivery_fee, delivery_floor, delivery_spot,
    source, payment_confirmed, payment_method, payment_status, created_by
  )
  values (
    v_branch.id, coalesce(v_name, 'عميل فرع'), p_delivery_type, v_fee, v_floor, v_spot,
    'pos', true, v_method, 'paid', auth.uid()
  )
  returning id, order_number into v_oid, v_num;

  for v_raw in select * from jsonb_array_elements(p_items) loop
    v_pid := v_raw->>'product_id';
    v_qty := (v_raw->>'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 30 then raise exception 'الكمية غير صحيحة' using errcode = 'P0001'; end if;
    select * into v_prod from products p where p.id = v_pid and p.is_active and p.branch_id = v_branch.id for update;
    if not found then raise exception 'واحد من المنتجات مش متاح في الفرع ده — حدّث الصفحة' using errcode = 'P0001'; end if;

    if v_prod.track_stock and v_prod.stock_qty < v_qty then
      raise exception 'الكمية المطلوبة غير متوفرة' using errcode = 'P0002';
    end if;
    if v_prod.track_stock then
      update products set stock_qty = stock_qty - v_qty where id = v_pid;
      insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, order_id, note)
      values (v_pid, v_prod.branch_id, -v_qty, 'sale', auth.uid(), v_oid, 'بيع POS');
    end if;

    insert into order_items (order_id, product_id, name_snapshot, unit_price, qty, line_total)
    values (v_oid, v_prod.id, v_prod.name, v_prod.price, v_qty, (v_prod.price * v_qty));
    v_sub := v_sub + (v_prod.price * v_qty);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'طلبيتك فاضية — اختار من المنيو الأول' using errcode = 'P0001'; end if;
  update orders set subtotal = v_sub, total = v_sub + v_fee where id = v_oid;

  insert into order_events (order_id, event_type, new_status, changed_by, note)
  values (v_oid, 'created', 'received', auth.uid(), coalesce(p_staff_note, ''));

  if v_method = 'cash' then
    update orders set cash_received_at = now(), cash_received_by = auth.uid() where id = v_oid;
  end if;

  return jsonb_build_object('ok', true, 'order_number', v_num, 'order_id', v_oid, 'total', v_sub + v_fee, 'status', 'received', 'source', 'pos', 'payment_method', v_method, 'payment_status', 'paid');
end $$;

grant execute on function pos_create_order(uuid, jsonb, text, text, text, text) to authenticated;
grant execute on function pos_create_order(uuid, jsonb, text, text, text, text, text, text) to authenticated;

commit;


-- ========== END supabase/migrations/0029_part3_pos_fix.sql ==========

-- ========== BEGIN supabase/migrations/0030_part4_test_data_wipe.sql ==========
-- ============================================================
-- Lala's Bakery — 0030 (Part 4): Manager test data/reports cleanup
-- ============================================================
-- Adds test flags, undeletable wipe audit log, preview/export helpers, and
-- a manager-only transactional wipe RPC. New migration only. RLS stays on.
-- No service_role. Storage proof file deletion is performed client-side by
-- manager after wipe RPC returns paths (RPC deletes DB references transactionally).
-- ============================================================
begin;

-- ---- 1) Optional test flags (excluded from reports when true) ----
alter table orders add column if not exists is_test boolean not null default false;
alter table shifts add column if not exists is_test boolean not null default false;

create index if not exists orders_is_test_created_idx on orders(is_test, created_at desc);
create index if not exists shifts_is_test_opened_idx on shifts(is_test, opened_at desc);

-- ---- 2) Undeletable audit log for wipes ----
create table if not exists data_wipe_audit (
  id uuid primary key default gen_random_uuid(),
  performed_by uuid not null references auth.users(id) on delete restrict,
  performed_at timestamptz not null default now(),
  from_date date not null,
  to_date date not null,
  branch_id uuid references branches(id) on delete set null,
  options jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  note text
);

alter table data_wipe_audit enable row level security;
alter table data_wipe_audit force row level security;

drop policy if exists data_wipe_audit_manager_select on data_wipe_audit;
create policy data_wipe_audit_manager_select on data_wipe_audit
  for select to authenticated using (is_manager());

drop policy if exists data_wipe_audit_manager_insert on data_wipe_audit;
create policy data_wipe_audit_manager_insert on data_wipe_audit
  for insert to authenticated with check (is_manager() and performed_by = auth.uid());

-- No UPDATE/DELETE policies => undeletable/immutable via RLS for app roles
revoke delete, update on data_wipe_audit from anon, authenticated;

grant select, insert on data_wipe_audit to authenticated;

-- ---- 3) Preview counts (manager-only) ----
create or replace function manager_wipe_test_data_preview(
  p_from date,
  p_to date,
  p_branch_id uuid default null,
  p_delete_orders boolean default true,
  p_delete_proofs boolean default true,
  p_delete_stock_movements boolean default true,
  p_delete_shifts boolean default false,
  p_reset_customer_stats boolean default false,
  p_only_test boolean default false
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
  v_orders int := 0;
  v_items int := 0;
  v_proofs int := 0;
  v_movements int := 0;
  v_shifts int := 0;
begin
  if not is_manager() then raise exception 'غير مسموح' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'نطاق التاريخ غير صحيح' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(o.id), array[]::uuid[]) into v_order_ids
  from orders o
  where o.created_at >= v_f and o.created_at < v_t
    and (p_branch_id is null or o.branch_id = p_branch_id)
    and (not coalesce(p_only_test,false) or o.is_test = true);

  v_orders := coalesce(array_length(v_order_ids,1),0);

  if coalesce(p_delete_orders,true) and v_orders > 0 then
    select count(*) into v_items from order_items i where i.order_id = any(v_order_ids);
  end if;

  if coalesce(p_delete_proofs,true) and v_orders > 0 then
    select count(*) into v_proofs from orders o where o.id = any(v_order_ids) and o.payment_proof_path is not null and btrim(o.payment_proof_path) <> '';
  end if;

  if coalesce(p_delete_stock_movements,true) and v_orders > 0 then
    select count(*) into v_movements from stock_movements sm where sm.order_id = any(v_order_ids);
  end if;

  if coalesce(p_delete_shifts,false) then
    select count(*) into v_shifts from shifts s
    where s.opened_at >= v_f and s.opened_at < v_t
      and (p_branch_id is null or s.branch_id = p_branch_id)
      and (not coalesce(p_only_test,false) or s.is_test = true);
  end if;

  return jsonb_build_object(
    'ok', true,
    'orders', v_orders,
    'order_items', v_items,
    'payment_proofs', v_proofs,
    'stock_movements', v_movements,
    'shifts', v_shifts,
    'reset_customer_stats', coalesce(p_reset_customer_stats,false)
  );
end $$;
grant execute on function manager_wipe_test_data_preview(date,date,uuid,boolean,boolean,boolean,boolean,boolean,boolean) to authenticated;

-- ---- 4) Transactional wipe (manager-only). Requires confirm word "حذف".
-- Returns deleted counts and storage proof paths the client should remove (backup done client-side before call).
create or replace function manager_wipe_test_data(
  p_from date,
  p_to date,
  p_branch_id uuid default null,
  p_delete_orders boolean default true,
  p_delete_proofs boolean default true,
  p_delete_stock_movements boolean default true,
  p_delete_shifts boolean default false,
  p_reset_customer_stats boolean default false,
  p_only_test boolean default false,
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
  v_proof_paths text[] := array[]::text[];
  v_deleted_orders int := 0;
  v_deleted_items int := 0;
  v_deleted_movements int := 0;
  v_deleted_shifts int := 0;
  v_deleted_proof_refs int := 0;
  v_stock_products int := 0;
  v_audit_id uuid;
  v_counts jsonb;
begin
  if not is_manager() then raise exception 'غير مسموح' using errcode = '42501'; end if;

  if btrim(coalesce(p_confirm,'')) <> 'حذف' then
    raise exception 'اكتب كلمة "حذف" للتأكيد' using errcode = 'P0001';
  end if;

  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'نطاق التاريخ غير صحيح' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(o.id), array[]::uuid[]) into v_order_ids
  from orders o
  where o.created_at >= v_f and o.created_at < v_t
    and (p_branch_id is null or o.branch_id = p_branch_id)
    and (not coalesce(p_only_test,false) or o.is_test = true);

  -- Collect proof paths to delete from storage (client-side) before DB refs removed
  if coalesce(p_delete_proofs,true) and coalesce(array_length(v_order_ids,1),0) > 0 then
    select coalesce(array_agg(o.payment_proof_path), array[]::text[]), count(*)
      into v_proof_paths, v_deleted_proof_refs
    from orders o
    where o.id = any(v_order_ids) and o.payment_proof_path is not null and btrim(o.payment_proof_path) <> '';
  end if;

  if coalesce(p_delete_orders,true) and coalesce(array_length(v_order_ids,1),0) > 0 then
    -- Restore stock for orders with net reserved qty not yet returned (tracked products)
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

    select count(*) into v_deleted_items from order_items i where i.order_id = any(v_order_ids);

    if coalesce(p_delete_stock_movements,true) then
      delete from stock_movements where order_id = any(v_order_ids);
      get diagnostics v_deleted_movements = row_count;
    end if;

    delete from low_stock_alerts where product_id in (
      select distinct i.product_id from order_items i
      where i.order_id = any(v_order_ids) and i.product_id is not null
    );
    delete from void_requests where order_id = any(v_order_ids);
    delete from order_status_public where order_number in (select o.order_number from orders o where o.id = any(v_order_ids));

    delete from orders o where o.id = any(v_order_ids);
    get diagnostics v_deleted_orders = row_count;
  end if;

  if coalesce(p_delete_shifts,false) then
    delete from shifts s
    where s.opened_at >= v_f and s.opened_at < v_t
      and (p_branch_id is null or s.branch_id = p_branch_id)
      and (not coalesce(p_only_test,false) or s.is_test = true);
    get diagnostics v_deleted_shifts = row_count;
  end if;

  -- reset customer stats: best-effort (no dedicated stats table assumed); recorded in audit
  -- (kept for future-safe compliance; no-op if no such aggregates exist)

  v_counts := jsonb_build_object(
    'deleted_orders', v_deleted_orders,
    'deleted_order_items', v_deleted_items,
    'deleted_payment_proofs_refs', coalesce(v_deleted_proof_refs,0),
    'deleted_stock_movements', v_deleted_movements,
    'deleted_shifts', v_deleted_shifts,
    'stock_returned_products', v_stock_products,
    'reset_customer_stats_requested', coalesce(p_reset_customer_stats,false)
  );

  insert into data_wipe_audit(performed_by, from_date, to_date, branch_id, options, counts)
  values (
    auth.uid(), p_from, p_to, p_branch_id,
    jsonb_build_object(
      'delete_orders', coalesce(p_delete_orders,true),
      'delete_proofs', coalesce(p_delete_proofs,true),
      'delete_stock_movements', coalesce(p_delete_stock_movements,true),
      'delete_shifts', coalesce(p_delete_shifts,false),
      'reset_customer_stats', coalesce(p_reset_customer_stats,false),
      'only_test', coalesce(p_only_test,false)
    ),
    v_counts
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'ok', true,
    'audit_id', v_audit_id,
    'counts', v_counts,
    'proof_paths', to_jsonb(coalesce(v_proof_paths, array[]::text[]))
  );
end $$;
grant execute on function manager_wipe_test_data(date,date,uuid,boolean,boolean,boolean,boolean,boolean,boolean,text) to authenticated;

-- Replace 0027 manager_clear_test_data to also log audit and accept "حذف" (keep DELETE for compat) and exclude-is_test default off
drop function if exists public.manager_clear_test_data(date, date, uuid, boolean, text);
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
declare v jsonb;
begin
  if not is_manager() then raise exception 'غير مسموح' using errcode = '42501'; end if;
  if btrim(coalesce(p_confirm,'')) not in ('DELETE','حذف') then
    raise exception 'اكتب كلمة "حذف" أو DELETE للتأكيد' using errcode = 'P0001';
  end if;
  v := manager_wipe_test_data(p_from, p_to, p_branch_id, true, true, true, coalesce(p_include_shifts,false), false, false, 'حذف');
  return jsonb_build_object(
    'ok', true,
    'deleted_orders', coalesce((v->'counts'->>'deleted_orders')::int,0),
    'deleted_shifts', coalesce((v->'counts'->>'deleted_shifts')::int,0),
    'stock_returned_products', coalesce((v->'counts'->>'stock_returned_products')::int,0),
    'audit_id', v->>'audit_id'
  );
end $$;
grant execute on function manager_clear_test_data(date, date, uuid, boolean, text) to authenticated;

commit;


-- ========== END supabase/migrations/0030_part4_test_data_wipe.sql ==========

-- ========== BEGIN supabase/migrations/0031_part4_reports_exclude_test.sql ==========
-- ============================================================
-- Lala's Bakery — 0031 (Part 4): Exclude is_test orders/shifts from reports
-- ============================================================
-- Ensures "طلب تجريبي" (is_test=true) is excluded from all manager reports.
-- Carries forward 0026 payment-aware manager_report_enhanced.
-- New migration only. RLS stays on. No service_role.
-- ============================================================
begin;

-- manager_report_enhanced: 0026 semantics + exclude is_test
create or replace function manager_report_enhanced(
  p_from date,
  p_to date,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
  v_f timestamptz := p_from::timestamptz at time zone 'Africa/Cairo';
  v_t timestamptz := (p_to::timestamptz + interval '1 day') at time zone 'Africa/Cairo';
begin
  if not is_manager() then raise exception 'غير مسموح' using errcode = '42501'; end if;

  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'orders_count', count(*),
        'revenue', coalesce(sum(total) filter (where payment_status = 'paid'), 0),
        'paid_count', count(*) filter (where payment_status = 'paid'),
        'avg_order', coalesce(avg(total) filter (where payment_status = 'paid'), 0)
      ) from orders
      where created_at >= v_f and created_at < v_t
        and coalesce(is_test,false) = false
        and (p_branch_id is null or branch_id = p_branch_id)
    ),
    'per_day', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select (created_at at time zone 'Africa/Cairo')::date as day,
               count(*) as orders_count,
               coalesce(sum(total) filter (where payment_status='paid'),0) as revenue
        from orders
        where created_at >= v_f and created_at < v_t
          and coalesce(is_test,false) = false
          and (p_branch_id is null or branch_id = p_branch_id)
        group by 1 order by 1
      ) x
    ),
    'per_branch', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select b.name as branch, count(o.id) as orders_count,
               coalesce(sum(o.total) filter (where o.payment_status='paid'),0) as revenue
        from orders o
        join branches b on b.id = o.branch_id
        where o.created_at >= v_f and o.created_at < v_t
          and coalesce(o.is_test,false) = false
          and (p_branch_id is null or b.id = p_branch_id)
        group by b.name order by revenue desc
      ) x
    ),
    'per_payment_method', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select o.payment_method as method,
               count(o.id) as orders_count,
               coalesce(sum(o.total) filter (where o.payment_status='paid'),0) as revenue,
               count(*) filter (where o.payment_status='paid') as paid_count,
               count(*) filter (where o.payment_method='cash' and o.payment_status='pending' and o.status <> 'done') as unpaid_pending_count,
               count(*) filter (where o.payment_method='cash' and o.payment_status in ('rejected','refunded') and o.status='done') as cancelled_count
        from orders o
        where o.created_at >= v_f and o.created_at < v_t
          and coalesce(o.is_test,false) = false
          and (p_branch_id is null or o.branch_id = p_branch_id)
        group by o.payment_method order by revenue desc
      ) x
    ),
    'online_vs_pos', (
      select jsonb_build_object(
        'online', coalesce((select jsonb_build_object('orders_count', count(*), 'revenue', coalesce(sum(total) filter (where payment_status='paid'),0))
          from orders where created_at >= v_f and created_at < v_t
            and coalesce(is_test,false) = false
            and source = 'online' and (p_branch_id is null or branch_id = p_branch_id)), '{}'::jsonb),
        'pos', coalesce((select jsonb_build_object('orders_count', count(*), 'revenue', coalesce(sum(total) filter (where payment_status='paid'),0))
          from orders where created_at >= v_f and created_at < v_t
            and coalesce(is_test,false) = false
            and source = 'pos' and (p_branch_id is null or branch_id = p_branch_id)), '{}'::jsonb)
      )
    ),
    'cash_summary', (
      select jsonb_build_object(
        'unpaid_pending_cash_orders', count(*) filter (where payment_method='cash' and payment_status='pending' and status <> 'done'),
        'cancelled_cash_orders', count(*) filter (where payment_method='cash' and status='done' and payment_status in ('rejected','refunded'))
      ) from orders
      where created_at >= v_f and created_at < v_t
        and coalesce(is_test,false) = false
        and (p_branch_id is null or branch_id = p_branch_id)
    ),
    'peak_hours', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select extract(hour from (created_at at time zone 'Africa/Cairo'))::int as hour,
               count(*) as orders_count
        from orders
        where created_at >= v_f and created_at < v_t
          and coalesce(is_test,false) = false
          and (p_branch_id is null or branch_id = p_branch_id)
        group by 1 order by 1
      ) x
    )
  ) into v_out;

  return v_out;
end $$;
grant execute on function manager_report_enhanced(date, date, uuid) to authenticated;

-- manager_product_movement: exclude is_test orders
create or replace function manager_product_movement(
  p_from date,
  p_to date,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
  v_f timestamptz := p_from::timestamptz at time zone 'Africa/Cairo';
  v_t timestamptz := (p_to::timestamptz + interval '1 day') at time zone 'Africa/Cairo';
  v_prev_f timestamptz := (p_from::date - (p_to - p_from))::timestamptz at time zone 'Africa/Cairo';
  v_prev_t timestamptz := p_from::timestamptz at time zone 'Africa/Cairo';
begin
  if not is_manager() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'products', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select i.name_snapshot as product,
               sum(i.qty) as qty,
               coalesce(sum(i.line_total),0) as revenue
        from order_items i
        join orders o on o.id = i.order_id
        where o.created_at >= v_f and o.created_at < v_t
          and coalesce(o.is_test,false) = false
          and (p_branch_id is null or o.branch_id = p_branch_id)
        group by 1 order by qty desc
      ) x
    ),
    'category_share', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select c.name as category, sum(i.qty) as qty,
               coalesce(sum(i.line_total),0) as revenue
        from order_items i
        join orders o on o.id = i.order_id
        join products p on p.id = i.product_id
        join categories c on c.id = p.category_id
        where o.created_at >= v_f and o.created_at < v_t
          and coalesce(o.is_test,false) = false
          and (p_branch_id is null or o.branch_id = p_branch_id)
        group by c.name order by revenue desc
      ) x
    ),
    'comparison', (
      select jsonb_build_object(
        'current_period_qty', coalesce((select sum(i.qty) from order_items i
          join orders o on o.id = i.order_id
          where o.created_at >= v_f and o.created_at < v_t
            and coalesce(o.is_test,false) = false
            and (p_branch_id is null or o.branch_id = p_branch_id)),0),
        'previous_period_qty', coalesce((select sum(i.qty) from order_items i
          join orders o on o.id = i.order_id
          where o.created_at >= v_prev_f and o.created_at < v_prev_t
            and coalesce(o.is_test,false) = false
            and (p_branch_id is null or o.branch_id = p_branch_id)),0),
        'current_period_revenue', coalesce((select sum(i.line_total) from order_items i
          join orders o on o.id = i.order_id
          where o.created_at >= v_f and o.created_at < v_t
            and coalesce(o.is_test,false) = false
            and (p_branch_id is null or o.branch_id = p_branch_id)),0),
        'previous_period_revenue', coalesce((select sum(i.line_total) from order_items i
          join orders o on o.id = i.order_id
          where o.created_at >= v_prev_f and o.created_at < v_prev_t
            and coalesce(o.is_test,false) = false
            and (p_branch_id is null or o.branch_id = p_branch_id)),0)
      )
    )
  ) into v_out;

  return v_out;
end $$;
grant execute on function manager_product_movement(date, date, uuid) to authenticated;

-- manager_staff_performance: exclude is_test orders/shifts
create or replace function manager_staff_performance(
  p_from date,
  p_to date,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
  v_f timestamptz := p_from::timestamptz at time zone 'Africa/Cairo';
  v_t timestamptz := (p_to::timestamptz + interval '1 day') at time zone 'Africa/Cairo';
  v_target int := 10;
begin
  if not is_manager() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  select coalesce((select value::int from settings where key = 'target_prep_minutes'), 10) into v_target;

  select jsonb_build_object(
    'target_prep_minutes', v_target,
    'staff', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select p.full_name, p.email,
               count(distinct o.id) as orders_handled,
               round(avg(extract(epoch from (e2.created_at - o.created_at)))::numeric / 60.0, 1) as avg_prep_minutes,
               round(percentile_cont(0.5) within group (order by extract(epoch from (e2.created_at - o.created_at)))::numeric / 60.0, 1) as median_prep_minutes,
               count(*) filter (where extract(epoch from (e2.created_at - o.created_at)) > v_target * 60) as orders_over_target,
               count(distinct vr.id) as void_requests,
               coalesce(sum(s.difference),0) as cash_shift_difference,
               count(distinct s.id) as shifts_worked
        from profiles p
        left join orders o on o.created_by = p.id
          and o.created_at >= v_f and o.created_at < v_t
          and coalesce(o.is_test,false) = false
          and (p_branch_id is null or o.branch_id = p_branch_id)
        left join order_events e2 on e2.order_id = o.id and e2.new_status = 'done'
          and e2.created_at >= v_f and e2.created_at < v_t
        left join void_requests vr on vr.staff_id = p.id
          and vr.created_at >= v_f and vr.created_at < v_t
        left join shifts s on s.staff_id = p.id
          and s.status = 'closed'
          and coalesce(s.is_test,false) = false
          and s.created_at >= v_f and s.created_at < v_t
          and (p_branch_id is null or s.branch_id = p_branch_id)
        where p.role in ('staff','manager') and p.is_active
        group by p.id, p.full_name, p.email
        order by orders_handled desc
      ) x
    )
  ) into v_out;

  return v_out;
end $$;
grant execute on function manager_staff_performance(date, date, uuid) to authenticated;

commit;


-- ========== END supabase/migrations/0031_part4_reports_exclude_test.sql ==========

-- ========== BEGIN supabase/migrations/0032_part5_obour_controls.sql ==========
-- ============================================================
-- Lala's Bakery — 0032 (Part 5): Manager control of Obour delivery
-- ============================================================
-- Per-branch Obour availability/fee/hours/WhatsApp/template/closed message,
-- audit log, manager-only update RPC, and server-side enforcement in submit_order_v2.
-- New migration only. RLS stays on. No service_role.
-- ============================================================
begin;

-- ---- 1) Branch Obour settings ----
alter table branches add column if not exists obour_enabled boolean not null default true;
alter table branches add column if not exists obour_fee numeric(10,2) not null default 50 check (obour_fee >= 0);
-- Optional delivery hours (Africa/Cairo). Example: {"enabled":true,"from":"09:00","to":"22:00"}
alter table branches add column if not exists obour_hours jsonb not null default '{"enabled":false}'::jsonb;
alter table branches add column if not exists obour_whatsapp text;
alter table branches add column if not exists obour_whatsapp_template text not null default 'مرحبًا، أنا {name}. رقم الطلب: {order_number}
العنوان: {address}
هبعت اللوكيشن دلوقتي 📍';
alter table branches add column if not exists obour_closed_message text not null default 'التوصيل داخل العبور غير متاح حاليًا 💗 تقدر تستلم من الفرع أو نوصّلك لحد مكانك جوه الفرع';

-- ---- 2) Audit table for Obour setting changes ----
create table if not exists obour_settings_audit (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete cascade,
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default now(),
  old_settings jsonb,
  new_settings jsonb
);

alter table obour_settings_audit enable row level security;
alter table obour_settings_audit force row level security;

drop policy if exists obour_settings_audit_manager_select on obour_settings_audit;
create policy obour_settings_audit_manager_select on obour_settings_audit
  for select to authenticated using (is_manager());

-- inserts performed by SECURITY DEFINER RPC (and/or manager) but no delete/update
drop policy if exists obour_settings_audit_manager_insert on obour_settings_audit;
create policy obour_settings_audit_manager_insert on obour_settings_audit
  for insert to authenticated with check (is_manager() and changed_by = auth.uid());

revoke delete, update on obour_settings_audit from anon, authenticated;
grant select, insert on obour_settings_audit to authenticated;
create index if not exists obour_settings_audit_branch_idx on obour_settings_audit(branch_id, changed_at desc);

-- ---- 3) Helper: is Obour delivery currently available for a branch row ----
create or replace function is_obour_available(p_branch branches)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_now time;
  v_from time;
  v_to time;
  v_enabled boolean;
begin
  if not coalesce(p_branch.obour_enabled, true) then
    return false;
  end if;
  v_enabled := coalesce((p_branch.obour_hours->>'enabled')::boolean, false);
  if v_enabled then
    begin
      v_from := (p_branch.obour_hours->>'from')::time;
      v_to := (p_branch.obour_hours->>'to')::time;
    exception when others then
      return true; -- malformed hours => treat as available when switch on
    end;
    if v_from is null or v_to is null then return true; end if;
    v_now := (now() at time zone 'Africa/Cairo')::time;
    if v_from <= v_to then
      return v_now >= v_from and v_now <= v_to;
    else
      -- overnight window
      return v_now >= v_from or v_now <= v_to;
    end if;
  end if;
  return true;
end $$;
grant execute on function is_obour_available(branches) to anon, authenticated;

-- ---- 4) Manager-only RPC to update Obour settings + audit ----
create or replace function manager_set_obour_settings(
  p_branch_id uuid,
  p_enabled boolean,
  p_fee numeric,
  p_hours jsonb default '{"enabled":false}'::jsonb,
  p_whatsapp text default null,
  p_template text default null,
  p_closed_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old branches;
  v_new branches;
  v_fee numeric(10,2) := greatest(0, coalesce(p_fee, 50));
  v_hours jsonb := coalesce(p_hours, '{"enabled":false}'::jsonb);
  v_template text := coalesce(nullif(btrim(coalesce(p_template,'')), ''), 'مرحبًا، أنا {name}. رقم الطلب: {order_number}
العنوان: {address}
هبعت اللوكيشن دلوقتي 📍');
  v_closed text := coalesce(nullif(btrim(coalesce(p_closed_message,'')), ''), 'التوصيل داخل العبور غير متاح حاليًا 💗 تقدر تستلم من الفرع أو نوصّلك لحد مكانك جوه الفرع');
  v_whatsapp text := nullif(regexp_replace(coalesce(p_whatsapp,''), '\s+', '', 'g'), '');
begin
  if not is_manager() then raise exception 'غير مسموح' using errcode = '42501'; end if;

  select * into v_old from branches where id = p_branch_id for update;
  if not found then raise exception 'الفرع غير موجود' using errcode = 'P0001'; end if;

  update branches set
    obour_enabled = coalesce(p_enabled, true),
    obour_fee = v_fee,
    obour_hours = v_hours,
    obour_whatsapp = v_whatsapp,
    obour_whatsapp_template = v_template,
    obour_closed_message = v_closed
  where id = p_branch_id
  returning * into v_new;

  insert into obour_settings_audit(branch_id, changed_by, old_settings, new_settings)
  values (
    p_branch_id, auth.uid(),
    jsonb_build_object('obour_enabled', v_old.obour_enabled, 'obour_fee', v_old.obour_fee, 'obour_hours', v_old.obour_hours, 'obour_whatsapp', v_old.obour_whatsapp, 'obour_whatsapp_template', v_old.obour_whatsapp_template, 'obour_closed_message', v_old.obour_closed_message),
    jsonb_build_object('obour_enabled', v_new.obour_enabled, 'obour_fee', v_new.obour_fee, 'obour_hours', v_new.obour_hours, 'obour_whatsapp', v_new.obour_whatsapp, 'obour_whatsapp_template', v_new.obour_whatsapp_template, 'obour_closed_message', v_new.obour_closed_message)
  );

  return jsonb_build_object('ok', true, 'branch_id', p_branch_id, 'obour_enabled', v_new.obour_enabled, 'obour_fee', v_new.obour_fee, 'obour_available', is_obour_available(v_new));
end $$;
grant execute on function manager_set_obour_settings(uuid, boolean, numeric, jsonb, text, text, text) to authenticated;

-- ---- 5) submit_order_v2: enforce Obour availability + use branch obour_fee ----
drop function if exists public.submit_order_v2(uuid, jsonb, text, text, text, text, text, text, text);

create or replace function submit_order_v2(
  p_branch_id uuid,
  p_items jsonb,
  p_delivery_type text,
  p_customer_name text,
  p_turnstile_token text default null,
  p_payment_method text default 'instapay',
  p_customer_phone text default null,
  p_delivery_floor text default null,
  p_delivery_spot text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name text;
  v_phone text;
  v_floor text;
  v_spot text;
  v_branch branches;
  v_fee numeric(10,2);
  v_raw jsonb;
  v_pid uuid;
  v_qty int;
  v_prod products;
  v_count int := 0;
  v_sub numeric(10,2) := 0;
  v_total numeric(10,2) := 0;
  v_oid uuid;
  v_num text;
  v_key uuid;
  v_method text := lower(btrim(coalesce(p_payment_method,'instapay')));
  v_max_cash numeric(10,2);
begin
  if p_turnstile_token::text is null then p_turnstile_token := null; end if;
  perform verify_turnstile(p_turnstile_token, 'order');

  if not rate_ok('order', 5, interval '30 minutes') then
    raise exception 'لقد تركت طلبات كثيرة في وقت قصير — استنى شوية وحاول تاني بعد قليل ❤️' using errcode = 'P0001';
  end if;

  begin perform expire_stale_cash_orders(null); exception when others then null; end;

  v_name := regexp_replace(coalesce(p_customer_name,''), '\s+', ' ', 'g');
  v_name := btrim(v_name);
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'اكتب اسمك من ٢ لحروف ٦٠ حروف' using errcode = 'P0001';
  end if;

  if v_method not in ('cash','instapay') then
    raise exception 'طريقة الدفع غير صحيحة' using errcode = 'P0001';
  end if;

  v_phone := nullif(regexp_replace(coalesce(p_customer_phone,''), '\s+', '', 'g'), '');
  v_floor := nullif(btrim(regexp_replace(coalesce(p_delivery_floor,''), '\s+', ' ', 'g')), '');
  v_spot  := nullif(btrim(regexp_replace(coalesce(p_delivery_spot,''),  '\s+', ' ', 'g')), '');

  select * into v_branch from branches where id = p_branch_id and is_active;
  if not found then
    raise exception 'الفرع اللي اخترته مش متاح حاليًا' using errcode = 'P0001';
  end if;

  if p_delivery_type not in ('pickup','table','obour') then
    raise exception 'اختر طريقة استلام صحيحة' using errcode = 'P0001';
  end if;

  -- Part 5: Obour availability enforced server-side (not UI only)
  if p_delivery_type = 'obour' and not is_obour_available(v_branch) then
    raise exception '%', coalesce(nullif(btrim(v_branch.obour_closed_message),''), 'التوصيل داخل العبور غير متاح حاليًا 💗 تقدر تستلم من الفرع أو نوصّلك لحد مكانك جوه الفرع') using errcode = 'P0001';
  end if;

  if p_delivery_type = 'table' then
    if v_floor is null or char_length(v_floor) < 1 then
      raise exception 'اختار رقم الدور عشان الموظفة توصلك بسرعة 💗' using errcode = 'P0001';
    end if;
    if char_length(v_floor) > 60 then
      raise exception 'رقم الدور طويل — اختصره شوية' using errcode = 'P0001';
    end if;
    if v_spot is not null and char_length(v_spot) > 120 then
      raise exception 'مكان الجلوس/الغرفة طويل — اختصره شوية' using errcode = 'P0001';
    end if;
  else
    v_floor := null;
    v_spot := null;
  end if;

  v_fee := case p_delivery_type
    when 'table'  then coalesce((select value::numeric from settings where key='delivery_fee_table'), 5)
    when 'obour'  then coalesce(v_branch.obour_fee, (select value::numeric from settings where key='delivery_fee_obour'), 50)
    else 0
  end;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'طلبيتك فاضية — اختار من المنيو الأول' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then
    raise exception 'طلبيتك فاضية أو أكبر من اللازم' using errcode = 'P0001';
  end if;

  if v_method = 'cash' then
    if not coalesce(v_branch.cash_enabled, true) then
      raise exception 'الدفع كاش غير متاح حاليًا في هذا الفرع' using errcode = 'P0001';
    end if;
    if not is_valid_eg_phone(v_phone) then
      raise exception 'اكتب رقم موبايل مصري صحيح (11 رقم يبدأ بـ 010 أو 011 أو 012 أو 015)' using errcode = 'P0001';
    end if;
    if not rate_ok('cash_order_ip', 5, interval '30 minutes') then
      raise exception 'طلبات كاش كثيرة من هذا الجهاز — استنى شوية وحاول تاني' using errcode = 'P0001';
    end if;
    if not rate_ok('cash_order_phone:' || md5(v_phone), 3, interval '30 minutes') then
      raise exception 'طلبات كاش كثيرة على هذا الرقم — استنى شوية وحاول تاني' using errcode = 'P0001';
    end if;
  end if;

  insert into orders (branch_id, customer_name, customer_phone, delivery_type, delivery_fee, delivery_floor, delivery_spot, source, payment_confirmed, payment_method, payment_status, created_by)
  values (v_branch.id, v_name, v_phone, p_delivery_type, v_fee, v_floor, v_spot, 'online', false, v_method, 'pending', auth.uid())
  returning id, order_number, tracking_key into v_oid, v_num, v_key;

  for v_raw in select * from jsonb_array_elements(p_items) loop
    v_pid := v_raw->>'product_id';
    v_qty := (v_raw->>'qty')::int;

    select * into v_prod from products
    where id = v_pid and is_active and branch_id = v_branch.id
    for update;
    if not found then
      raise exception 'واحد من المنتجات غير متاح في الفرع ده — حدّث الصفحة' using errcode = 'P0001';
    end if;

    if v_qty is null or v_qty < 1 or v_qty > 30 then
      raise exception 'الكمية غير صحيحة' using errcode = 'P0001';
    end if;

    if v_prod.track_stock and v_prod.stock_qty < v_qty then
      raise exception 'الكمية المطلوبة غير متوفرة' using errcode = 'P0002';
    end if;

    if v_prod.track_stock then
      update products set stock_qty = stock_qty - v_qty where id = v_pid;
      insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, order_id, note)
      values (v_pid, v_prod.branch_id, -v_qty, 'sale', auth.uid(), v_oid, 'بيع');
      if v_prod.stock_qty - v_qty <= v_prod.low_stock_threshold
         and v_prod.stock_qty > v_prod.low_stock_threshold then
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
    raise exception 'طلبيتك فاضية — اختار من المنيو الأول' using errcode = 'P0001';
  end if;

  v_total := v_sub + v_fee;

  if v_method = 'cash' then
    v_max_cash := coalesce(v_branch.cash_max_amount, 500);
    if v_total > v_max_cash then
      raise exception 'حد أقصى لطلبات الكاش % ج — لو طلبك أكبر اختار الدفع بانستا باي', v_max_cash using errcode = 'P0001';
    end if;
  end if;

  update orders set subtotal = v_sub, total = v_total where id = v_oid;

  insert into order_events (order_id, event_type, new_status, changed_by, note)
  values (v_oid, 'created', 'received', auth.uid(), case when v_method='cash' then 'طلب كاش (أونلاين)' else '' end);

  return jsonb_build_object(
    'ok', true,
    'order_number', v_num,
    'order_id', v_oid,
    'tracking_key', v_key,
    'branch_name', v_branch.name,
    'subtotal', v_sub,
    'delivery_fee', v_fee,
    'total', v_total,
    'status', 'received',
    'payment_method', v_method,
    'payment_status', 'pending'
  );
end $fn$;

grant execute on function submit_order_v2(uuid, jsonb, text, text, text) to anon, authenticated;
grant execute on function submit_order_v2(uuid, jsonb, text, text, text, text, text) to anon, authenticated;
grant execute on function submit_order_v2(uuid, jsonb, text, text, text, text, text, text, text) to anon, authenticated;

commit;


-- ========== END supabase/migrations/0032_part5_obour_controls.sql ==========

-- ========== BEGIN supabase/migrations/0033_part6_obour_location.sql ==========
-- ============================================================
-- Lala's Bakery — 0033 (Part 6): Obour address + WhatsApp location confirmation
-- ============================================================
-- Adds address/landmark/location confirmation fields, customer+staff RPCs,
-- DB enforcement (obour cannot move to preparing unless location_confirmed),
-- and auto-cancel/stock release for unconfirmed obour orders after timeout.
-- New migration only. RLS stays on. No service_role.
-- ============================================================
begin;

-- Settings for obour confirmation timeouts
insert into settings (key, value) values ('obour_location_reminder_minutes', '20') on conflict (key) do nothing;
insert into settings (key, value) values ('obour_location_cancel_minutes', '45') on conflict (key) do nothing;

-- ---- 1) Orders columns ----
alter table orders add column if not exists delivery_address text;
alter table orders add column if not exists delivery_landmark text;
alter table orders add column if not exists location_confirmed boolean not null default false;
alter table orders add column if not exists location_confirmed_at timestamptz;
alter table orders add column if not exists location_confirmed_by_staff uuid references auth.users(id) on delete set null;
alter table orders add column if not exists location_confirmed_via text; -- 'customer' | 'staff'

do $$ begin
  alter table orders add constraint orders_delivery_address_len_check check (delivery_address is null or char_length(delivery_address) <= 300) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table orders add constraint orders_delivery_landmark_len_check check (delivery_landmark is null or char_length(delivery_landmark) <= 120) not valid;
exception when duplicate_object then null; end $$;

-- ---- 2) Customer RPC: confirm location (verifies order_number + tracking_key) ----
create or replace function confirm_obour_location(
  p_order_number text,
  p_tracking_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
begin
  if length(trim(coalesce(p_order_number,''))) = 0 or length(trim(coalesce(p_tracking_key,''))) = 0 then
    raise exception 'بيانات الطلب غير صحيحة' using errcode = 'P0001';
  end if;

  select * into v_order from orders
  where order_number = p_order_number and tracking_key::text = p_tracking_key
  for update;

  if not found then
    raise exception 'مفتاح التتبع مش مطابق لهذا الطلب' using errcode = 'P0001';
  end if;

  if v_order.delivery_type <> 'obour' then
    raise exception 'هذا الطلب ليس طلب توصيل داخل العبور' using errcode = 'P0001';
  end if;

  if v_order.status = 'done' and v_order.payment_status in ('rejected','refunded') then
    raise exception 'لا يمكن تأكيد اللوكيشن لطلب ملغي' using errcode = 'P0001';
  end if;

  if v_order.location_confirmed then
    return jsonb_build_object('ok', true, 'already', true, 'location_confirmed_at', v_order.location_confirmed_at);
  end if;

  update orders
  set location_confirmed = true,
      location_confirmed_at = now(),
      location_confirmed_via = 'customer'
  where id = v_order.id;

  insert into order_events(order_id, event_type, changed_by, note)
  values (v_order.id, 'status_changed', auth.uid(), 'العميل أكد إرسال العنوان واللوكيشن على واتساب');

  return jsonb_build_object('ok', true, 'location_confirmed', true, 'location_confirmed_at', now());
end $$;
grant execute on function confirm_obour_location(text, text) to anon, authenticated;

-- ---- 3) Staff RPC: mark location received on WhatsApp ----
create or replace function staff_mark_location_received(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
  v_profile_branch uuid;
begin
  if not is_staff() then raise exception 'غير مسموح' using errcode = '42501'; end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'message', 'الطلب مش موجود'); end if;

  if not is_manager() then
    select branch_id into v_profile_branch from profiles where id = auth.uid();
    if v_profile_branch is not null and v_order.branch_id is distinct from v_profile_branch then
      raise exception 'غير مسموح لفرع آخر' using errcode = '42501';
    end if;
  end if;

  if v_order.delivery_type <> 'obour' then
    return jsonb_build_object('ok', false, 'message', 'هذا الطلب ليس طلب توصيل داخل العبور');
  end if;

  update orders
  set location_confirmed = true,
      location_confirmed_at = coalesce(location_confirmed_at, now()),
      location_confirmed_by_staff = auth.uid(),
      location_confirmed_via = 'staff'
  where id = v_order.id;

  insert into order_events(order_id, event_type, changed_by, note)
  values (v_order.id, 'status_changed', auth.uid(), 'تم استلام اللوكيشن على واتساب (تأكيد الموظف)');

  return jsonb_build_object('ok', true, 'location_confirmed', true);
end $$;
grant execute on function staff_mark_location_received(uuid) to authenticated;

-- ---- 4) DB enforcement: Obour cannot move to preparing unless location_confirmed ----
create or replace function enforce_payment_before_preparing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (old.status is distinct from new.status) and new.status = 'preparing' then
    if new.payment_method = 'instapay' and new.source = 'online' and not new.payment_confirmed then
      raise exception 'لا يمكن نقل طلب أونلاين (انستا باي) إلى "جاري التحضير" قبل تأكيد الدفع' using errcode = 'P0001';
    end if;
    if new.delivery_type = 'obour' and new.source = 'online' and not coalesce(new.location_confirmed, false) then
      raise exception 'لا يمكن بدء تحضير طلب العبور قبل تأكيد العنوان واللوكيشن على واتساب' using errcode = 'P0001';
    end if;
    -- cash: allowed to move to preparing without payment confirmed (acceptance)
  end if;

  if new.payment_status = 'paid' then
    new.payment_confirmed := true;
  elsif new.payment_status in ('pending','rejected','refunded') and new.payment_method = 'cash' then
    new.payment_confirmed := false;
  end if;

  return new;
end $$;

drop trigger if exists orders_enforce_payment on orders;
create trigger orders_enforce_payment
  before update of status, source, payment_confirmed, payment_method, payment_status, cash_received_at, location_confirmed, delivery_type on orders
  for each row execute function enforce_payment_before_preparing();

-- ---- 5) Auto-cancel unconfirmed Obour orders after timeout (and release stock) ----
create or replace function expire_unconfirmed_obour_orders()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cancel_mins int := greatest(1, coalesce((select value::int from settings where key='obour_location_cancel_minutes'), 45));
  v_order record;
  v_count int := 0;
begin
  for v_order in
    select o.id, o.branch_id, o.status
    from orders o
    where o.delivery_type = 'obour'
      and o.source = 'online'
      and coalesce(o.location_confirmed,false) = false
      and o.status = 'received'
      and o.created_at < now() - make_interval(mins => v_cancel_mins)
    for update skip locked
  loop
    if not exists (select 1 from stock_movements sm where sm.order_id = v_order.id and sm.reason in ('expiry','void')) then
      insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, order_id, note)
      select i.product_id, v_order.branch_id, i.qty, 'expiry', null, v_order.id, 'إلغاء تلقائي لعدم تأكيد اللوكيشن'
      from order_items i
      join products p on p.id = i.product_id
      where i.order_id = v_order.id and i.product_id is not null and p.track_stock;

      update products p
      set stock_qty = p.stock_qty + s.qty
      from (
        select i.product_id, sum(i.qty)::int as qty
        from order_items i where i.order_id = v_order.id and i.product_id is not null
        group by i.product_id
      ) s
      where p.id = s.product_id and p.track_stock;
    end if;

    update orders
    set status = 'done', payment_status = case when payment_status = 'paid' then 'refunded' else 'rejected' end, updated_at = now()
    where id = v_order.id;

    insert into order_events (order_id, event_type, old_status, new_status, changed_by, note)
    values (v_order.id, 'order_cancelled', 'received', 'done', null, 'تم إلغاء الطلب تلقائيًا لعدم تأكيد العنوان/اللوكيشن');

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'cancelled', v_count);
end $$;
grant execute on function expire_unconfirmed_obour_orders() to authenticated;

-- Best-effort: schedule expiry if pg_cron exists (no failure if not available)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'expire-unconfirmed-obour-orders';
    perform cron.schedule('expire-unconfirmed-obour-orders', '*/5 * * * *', 'select public.expire_unconfirmed_obour_orders();');
  end if;
exception when others then
  null;
end $$;

commit;


-- ========== END supabase/migrations/0033_part6_obour_location.sql ==========

-- ========== BEGIN supabase/migrations/0034_part6_obour_submit_and_details.sql ==========
-- ============================================================
-- Lala's Bakery — 0034 (Part 6 cont.): Obour address/phone in submit + order details
-- ============================================================
-- Extends submit_order_v2 for Obour required fields (name, validated Egyptian phone,
-- detailed address, optional landmark). Extends get_order_details for same-customer
-- (tracking-keyed) view of obour confirmation fields and branch WhatsApp/template.
-- Never exposes address/phone/location details via track_order_by_key.
-- New migration only. RLS stays on. No service_role.
-- ============================================================
begin;

-- Replace submit_order_v2 with Obour address/phone/landmark params (backward-compatible defaults)
drop function if exists public.submit_order_v2(uuid, jsonb, text, text, text, text, text, text, text, text, text);

create or replace function submit_order_v2(
  p_branch_id uuid,
  p_items jsonb,
  p_delivery_type text,
  p_customer_name text,
  p_turnstile_token text default null,
  p_payment_method text default 'instapay',
  p_customer_phone text default null,
  p_delivery_floor text default null,
  p_delivery_spot text default null,
  p_delivery_address text default null,
  p_delivery_landmark text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name text;
  v_phone text;
  v_floor text;
  v_spot text;
  v_address text;
  v_landmark text;
  v_branch branches;
  v_fee numeric(10,2);
  v_raw jsonb;
  v_pid uuid;
  v_qty int;
  v_prod products;
  v_count int := 0;
  v_sub numeric(10,2) := 0;
  v_total numeric(10,2) := 0;
  v_oid uuid;
  v_num text;
  v_key uuid;
  v_method text := lower(btrim(coalesce(p_payment_method,'instapay')));
  v_max_cash numeric(10,2);
begin
  if p_turnstile_token::text is null then p_turnstile_token := null; end if;
  perform verify_turnstile(p_turnstile_token, 'order');

  if not rate_ok('order', 5, interval '30 minutes') then
    raise exception 'لقد تركت طلبات كثيرة في وقت قصير — استنى شوية وحاول تاني بعد قليل ❤️' using errcode = 'P0001';
  end if;

  begin perform expire_stale_cash_orders(null); exception when others then null; end;
  begin perform expire_unconfirmed_obour_orders(); exception when others then null; end;

  v_name := regexp_replace(coalesce(p_customer_name,''), '\s+', ' ', 'g');
  v_name := btrim(v_name);
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'اكتب اسمك من ٢ لـ ٦٠ حرف' using errcode = 'P0001';
  end if;

  if v_method not in ('cash','instapay') then
    raise exception 'طريقة الدفع غير صحيحة' using errcode = 'P0001';
  end if;

  v_phone := nullif(regexp_replace(coalesce(p_customer_phone,''), '\s+', '', 'g'), '');
  v_floor := nullif(btrim(regexp_replace(coalesce(p_delivery_floor,''), '\s+', ' ', 'g')), '');
  v_spot  := nullif(btrim(regexp_replace(coalesce(p_delivery_spot,''),  '\s+', ' ', 'g')), '');
  v_address := nullif(btrim(regexp_replace(coalesce(p_delivery_address,''), '\s+', ' ', 'g')), '');
  v_landmark := nullif(btrim(regexp_replace(coalesce(p_delivery_landmark,''), '\s+', ' ', 'g')), '');

  select * into v_branch from branches where id = p_branch_id and is_active;
  if not found then
    raise exception 'الفرع اللي اخترته مش متاح حاليًا' using errcode = 'P0001';
  end if;

  if p_delivery_type not in ('pickup','table','obour') then
    raise exception 'اختر طريقة استلام صحيحة' using errcode = 'P0001';
  end if;

  -- Part 5: Obour availability enforced server-side
  if p_delivery_type = 'obour' and not is_obour_available(v_branch) then
    raise exception '%', coalesce(nullif(btrim(v_branch.obour_closed_message),''), 'التوصيل داخل العبور غير متاح حاليًا 💗 تقدر تستلم من الفرع أو نوصّلك لحد مكانك جوه الفرع') using errcode = 'P0001';
  end if;

  if p_delivery_type = 'table' then
    if v_floor is null or char_length(v_floor) < 1 then
      raise exception 'اختار رقم الدور عشان الموظفة توصلك بسرعة 💗' using errcode = 'P0001';
    end if;
    if char_length(v_floor) > 60 then raise exception 'رقم الدور طويل — اختصره شوية' using errcode = 'P0001'; end if;
    if v_spot is not null and char_length(v_spot) > 120 then raise exception 'مكان الجلوس/الغرفة طويل — اختصره شوية' using errcode = 'P0001'; end if;
    v_address := null; v_landmark := null;
  elsif p_delivery_type = 'obour' then
    -- Part 6: required for obour (name already validated above)
    if not is_valid_eg_phone(v_phone) then
      raise exception 'اكتب رقم موبايل مصري صحيح (11 رقم يبدأ بـ 010 أو 011 أو 012 أو 015)' using errcode = 'P0001';
    end if;
    if v_address is null or char_length(v_address) < 10 then
      raise exception 'اكتب العنوان بالتفصيل (الحي/المنطقة، الشارع، رقم العمارة/الدور/الشقة)' using errcode = 'P0001';
    end if;
    if char_length(v_address) > 300 then
      raise exception 'العنوان طويل — اختصره شوية' using errcode = 'P0001';
    end if;
    if v_landmark is not null and char_length(v_landmark) > 120 then
      raise exception 'العلامة المميزة طويلة — اختصرها شوية' using errcode = 'P0001';
    end if;
    v_floor := null; v_spot := null;
  else
    v_floor := null; v_spot := null; v_address := null; v_landmark := null;
  end if;

  v_fee := case p_delivery_type
    when 'table'  then coalesce((select value::numeric from settings where key='delivery_fee_table'), 5)
    when 'obour'  then coalesce(v_branch.obour_fee, (select value::numeric from settings where key='delivery_fee_obour'), 50)
    else 0
  end;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'طلبيتك فاضية — اختار من المنيو الأول' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then
    raise exception 'طلبيتك فاضية أو أكبر من اللازم' using errcode = 'P0001';
  end if;

  if v_method = 'cash' then
    if not coalesce(v_branch.cash_enabled, true) then
      raise exception 'الدفع كاش غير متاح حاليًا في هذا الفرع' using errcode = 'P0001';
    end if;
    if not is_valid_eg_phone(v_phone) then
      raise exception 'اكتب رقم موبايل مصري صحيح (11 رقم يبدأ بـ 010 أو 011 أو 012 أو 015)' using errcode = 'P0001';
    end if;
    if not rate_ok('cash_order_ip', 5, interval '30 minutes') then
      raise exception 'طلبات كاش كثيرة من هذا الجهاز — استنى شوية وحاول تاني' using errcode = 'P0001';
    end if;
    if not rate_ok('cash_order_phone:' || md5(v_phone), 3, interval '30 minutes') then
      raise exception 'طلبات كاش كثيرة على هذا الرقم — استنى شوية وحاول تاني' using errcode = 'P0001';
    end if;
  end if;

  insert into orders (
    branch_id, customer_name, customer_phone, delivery_type, delivery_fee,
    delivery_floor, delivery_spot, delivery_address, delivery_landmark,
    location_confirmed,
    source, payment_confirmed, payment_method, payment_status, created_by
  )
  values (
    v_branch.id, v_name, v_phone, p_delivery_type, v_fee,
    v_floor, v_spot, v_address, v_landmark,
    false,
    'online', false, v_method, 'pending', auth.uid()
  )
  returning id, order_number, tracking_key into v_oid, v_num, v_key;

  for v_raw in select * from jsonb_array_elements(p_items) loop
    v_pid := v_raw->>'product_id';
    v_qty := (v_raw->>'qty')::int;

    select * into v_prod from products
    where id = v_pid and is_active and branch_id = v_branch.id
    for update;
    if not found then
      raise exception 'واحد من المنتجات غير متاح في الفرع ده — حدّث الصفحة' using errcode = 'P0001';
    end if;

    if v_qty is null or v_qty < 1 or v_qty > 30 then
      raise exception 'الكمية غير صحيحة' using errcode = 'P0001';
    end if;

    if v_prod.track_stock and v_prod.stock_qty < v_qty then
      raise exception 'الكمية المطلوبة غير متوفرة' using errcode = 'P0002';
    end if;

    if v_prod.track_stock then
      update products set stock_qty = stock_qty - v_qty where id = v_pid;
      insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, order_id, note)
      values (v_pid, v_prod.branch_id, -v_qty, 'sale', auth.uid(), v_oid, 'بيع');
      if v_prod.stock_qty - v_qty <= v_prod.low_stock_threshold
         and v_prod.stock_qty > v_prod.low_stock_threshold then
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
    raise exception 'طلبيتك فاضية — اختار من المنيو الأول' using errcode = 'P0001';
  end if;

  v_total := v_sub + v_fee;

  if v_method = 'cash' then
    v_max_cash := coalesce(v_branch.cash_max_amount, 500);
    if v_total > v_max_cash then
      raise exception 'حد أقصى لطلبات الكاش % ج — لو طلبك أكبر اختار الدفع بانستا باي', v_max_cash using errcode = 'P0001';
    end if;
  end if;

  update orders set subtotal = v_sub, total = v_total where id = v_oid;

  insert into order_events (order_id, event_type, new_status, changed_by, note)
  values (v_oid, 'created', 'received', auth.uid(),
    case
      when p_delivery_type = 'obour' then 'طلب توصيل عبور — في انتظار تأكيد اللوكيشن'
      when v_method='cash' then 'طلب كاش (أونلاين)'
      else ''
    end
  );

  return jsonb_build_object(
    'ok', true,
    'order_number', v_num,
    'order_id', v_oid,
    'tracking_key', v_key,
    'branch_name', v_branch.name,
    'subtotal', v_sub,
    'delivery_fee', v_fee,
    'total', v_total,
    'status', 'received',
    'payment_method', v_method,
    'payment_status', 'pending'
  );
end $fn$;

-- Grants: keep previous signatures valid
grant execute on function submit_order_v2(uuid, jsonb, text, text, text) to anon, authenticated;
grant execute on function submit_order_v2(uuid, jsonb, text, text, text, text, text) to anon, authenticated;
grant execute on function submit_order_v2(uuid, jsonb, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function submit_order_v2(uuid, jsonb, text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- get_order_details: include obour confirmation fields for same-customer (tracking-keyed) page only
create or replace function get_order_details(
  p_order_number text,
  p_tracking_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_out jsonb;
begin
  if length(trim(coalesce(p_order_number, ''))) = 0
     or length(trim(coalesce(p_tracking_key, ''))) = 0 then
    raise exception 'مفتاح التتبع مش مطابق لهذا الطلب' using errcode = 'P0001';
  end if;

  -- opportunistic expiry for unconfirmed obour orders
  begin perform expire_unconfirmed_obour_orders(); exception when others then null; end;

  select jsonb_build_object(
    'ok', true,
    'order_number', o.order_number,
    'status', o.status::text,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'branch_name', b.name,
    'delivery_type', o.delivery_type,
    'delivery_fee', o.delivery_fee,
    'delivery_floor', o.delivery_floor,
    'delivery_spot', o.delivery_spot,
    'delivery_address', case when o.delivery_type = 'obour' then o.delivery_address else null end,
    'delivery_landmark', case when o.delivery_type = 'obour' then o.delivery_landmark else null end,
    'customer_name', case when o.delivery_type = 'obour' then o.customer_name else null end,
    'customer_phone', case when o.delivery_type = 'obour' then o.customer_phone else null end,
    'location_confirmed', o.location_confirmed,
    'location_confirmed_at', o.location_confirmed_at,
    'branch_obour_whatsapp', case when o.delivery_type = 'obour' then b.obour_whatsapp else null end,
    'branch_obour_whatsapp_template', case when o.delivery_type = 'obour' then b.obour_whatsapp_template else null end,
    'obour_location_reminder_minutes', coalesce((select value::int from settings where key='obour_location_reminder_minutes'), 20),
    'obour_location_cancel_minutes', coalesce((select value::int from settings where key='obour_location_cancel_minutes'), 45),
    'subtotal', o.subtotal,
    'total', o.total,
    'created_at', o.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', i.name_snapshot,
        'qty', i.qty,
        'unit_price', i.unit_price,
        'line_total', i.line_total
      ) order by i.id)
      from order_items i where i.order_id = o.id
    ), '[]'::jsonb)
  ) into v_out
  from orders o
  join branches b on b.id = o.branch_id
  where o.order_number = p_order_number
    and o.tracking_key::text = p_tracking_key;

  if v_out is null then
    raise exception 'مفتاح التتبع مش مطابق لهذا الطلب' using errcode = 'P0001';
  end if;

  return v_out;
end $fn$;
grant execute on function get_order_details(text, text) to anon;

commit;


-- ========== END supabase/migrations/0034_part6_obour_submit_and_details.sql ==========

-- ========== BEGIN supabase/migrations/0035_part7_customer_note.sql ==========
-- ============================================================
-- Lala's Bakery — 0035 (Part 7): Order notes before payment
-- ============================================================
-- Adds orders.customer_note (max 300, trimmed, server-checked). Stored and shown
-- to staff and same-customer order summary; never exposed via public tracking RPC.
-- New migration only. RLS stays on. No service_role.
-- ============================================================
begin;

alter table orders add column if not exists customer_note text;

do $$ begin
  alter table orders add constraint orders_customer_note_len_check
    check (customer_note is null or char_length(customer_note) <= 300);
exception when duplicate_object then null; end $$;

-- Replace submit_order_v2 to accept p_customer_note (carry forward 0034)
drop function if exists public.submit_order_v2(uuid, jsonb, text, text, text, text, text, text, text, text, text, text);

create or replace function submit_order_v2(
  p_branch_id uuid,
  p_items jsonb,
  p_delivery_type text,
  p_customer_name text,
  p_turnstile_token text default null,
  p_payment_method text default 'instapay',
  p_customer_phone text default null,
  p_delivery_floor text default null,
  p_delivery_spot text default null,
  p_delivery_address text default null,
  p_delivery_landmark text default null,
  p_customer_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name text;
  v_phone text;
  v_floor text;
  v_spot text;
  v_address text;
  v_landmark text;
  v_note text;
  v_branch branches;
  v_fee numeric(10,2);
  v_raw jsonb;
  v_pid uuid;
  v_qty int;
  v_prod products;
  v_count int := 0;
  v_sub numeric(10,2) := 0;
  v_total numeric(10,2) := 0;
  v_oid uuid;
  v_num text;
  v_key uuid;
  v_method text := lower(btrim(coalesce(p_payment_method,'instapay')));
  v_max_cash numeric(10,2);
begin
  if p_turnstile_token::text is null then p_turnstile_token := null; end if;
  perform verify_turnstile(p_turnstile_token, 'order');

  if not rate_ok('order', 5, interval '30 minutes') then
    raise exception 'لقد تركت طلبات كثيرة في وقت قصير — استنى شوية وحاول تاني بعد قليل ❤️' using errcode = 'P0001';
  end if;

  begin perform expire_stale_cash_orders(null); exception when others then null; end;
  begin perform expire_unconfirmed_obour_orders(); exception when others then null; end;

  v_name := regexp_replace(coalesce(p_customer_name,''), '\s+', ' ', 'g');
  v_name := btrim(v_name);
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'اكتب اسمك من ٢ لـ ٦٠ حرف' using errcode = 'P0001';
  end if;

  if v_method not in ('cash','instapay') then
    raise exception 'طريقة الدفع غير صحيحة' using errcode = 'P0001';
  end if;

  v_phone := nullif(regexp_replace(coalesce(p_customer_phone,''), '\s+', '', 'g'), '');
  v_floor := nullif(btrim(regexp_replace(coalesce(p_delivery_floor,''), '\s+', ' ', 'g')), '');
  v_spot  := nullif(btrim(regexp_replace(coalesce(p_delivery_spot,''),  '\s+', ' ', 'g')), '');
  v_address := nullif(btrim(regexp_replace(coalesce(p_delivery_address,''), '\s+', ' ', 'g')), '');
  v_landmark := nullif(btrim(regexp_replace(coalesce(p_delivery_landmark,''), '\s+', ' ', 'g')), '');
  v_note := nullif(btrim(regexp_replace(coalesce(p_customer_note,''), E'[\\r\\n\\t]+', ' ', 'g')), '');
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'ملاحظات الطلب طويلة — الحد الأقصى 300 حرف' using errcode = 'P0001';
  end if;

  select * into v_branch from branches where id = p_branch_id and is_active;
  if not found then
    raise exception 'الفرع اللي اخترته مش متاح حاليًا' using errcode = 'P0001';
  end if;

  if p_delivery_type not in ('pickup','table','obour') then
    raise exception 'اختر طريقة استلام صحيحة' using errcode = 'P0001';
  end if;

  if p_delivery_type = 'obour' and not is_obour_available(v_branch) then
    raise exception '%', coalesce(nullif(btrim(v_branch.obour_closed_message),''), 'التوصيل داخل العبور غير متاح حاليًا 💗 تقدر تستلم من الفرع أو نوصّلك لحد مكانك جوه الفرع') using errcode = 'P0001';
  end if;

  if p_delivery_type = 'table' then
    if v_floor is null or char_length(v_floor) < 1 then
      raise exception 'اختار رقم الدور عشان الموظفة توصلك بسرعة 💗' using errcode = 'P0001';
    end if;
    if char_length(v_floor) > 60 then raise exception 'رقم الدور طويل — اختصره شوية' using errcode = 'P0001'; end if;
    if v_spot is not null and char_length(v_spot) > 120 then raise exception 'مكان الجلوس/الغرفة طويل — اختصره شوية' using errcode = 'P0001'; end if;
    v_address := null; v_landmark := null;
  elsif p_delivery_type = 'obour' then
    if not is_valid_eg_phone(v_phone) then
      raise exception 'اكتب رقم موبايل مصري صحيح (11 رقم يبدأ بـ 010 أو 011 أو 012 أو 015)' using errcode = 'P0001';
    end if;
    if v_address is null or char_length(v_address) < 10 then
      raise exception 'اكتب العنوان بالتفصيل (الحي/المنطقة، الشارع، رقم العمارة/الدور/الشقة)' using errcode = 'P0001';
    end if;
    if char_length(v_address) > 300 then raise exception 'العنوان طويل — اختصره شوية' using errcode = 'P0001'; end if;
    if v_landmark is not null and char_length(v_landmark) > 120 then raise exception 'العلامة المميزة طويلة — اختصرها شوية' using errcode = 'P0001'; end if;
    v_floor := null; v_spot := null;
  else
    v_floor := null; v_spot := null; v_address := null; v_landmark := null;
  end if;

  v_fee := case p_delivery_type
    when 'table'  then coalesce((select value::numeric from settings where key='delivery_fee_table'), 5)
    when 'obour'  then coalesce(v_branch.obour_fee, (select value::numeric from settings where key='delivery_fee_obour'), 50)
    else 0
  end;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'طلبيتك فاضية — اختار من المنيو الأول' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then
    raise exception 'طلبيتك فاضية أو أكبر من اللازم' using errcode = 'P0001';
  end if;

  if v_method = 'cash' then
    if not coalesce(v_branch.cash_enabled, true) then
      raise exception 'الدفع كاش غير متاح حاليًا في هذا الفرع' using errcode = 'P0001';
    end if;
    if not is_valid_eg_phone(v_phone) then
      raise exception 'اكتب رقم موبايل مصري صحيح (11 رقم يبدأ بـ 010 أو 011 أو 012 أو 015)' using errcode = 'P0001';
    end if;
    if not rate_ok('cash_order_ip', 5, interval '30 minutes') then
      raise exception 'طلبات كاش كثيرة من هذا الجهاز — استنى شوية وحاول تاني' using errcode = 'P0001';
    end if;
    if not rate_ok('cash_order_phone:' || md5(v_phone), 3, interval '30 minutes') then
      raise exception 'طلبات كاش كثيرة على هذا الرقم — استنى شوية وحاول تاني' using errcode = 'P0001';
    end if;
  end if;

  insert into orders (
    branch_id, customer_name, customer_phone, delivery_type, delivery_fee,
    delivery_floor, delivery_spot, delivery_address, delivery_landmark,
    location_confirmed, customer_note,
    source, payment_confirmed, payment_method, payment_status, created_by
  )
  values (
    v_branch.id, v_name, v_phone, p_delivery_type, v_fee,
    v_floor, v_spot, v_address, v_landmark,
    false, v_note,
    'online', false, v_method, 'pending', auth.uid()
  )
  returning id, order_number, tracking_key into v_oid, v_num, v_key;

  for v_raw in select * from jsonb_array_elements(p_items) loop
    v_pid := v_raw->>'product_id';
    v_qty := (v_raw->>'qty')::int;

    select * into v_prod from products
    where id = v_pid and is_active and branch_id = v_branch.id
    for update;
    if not found then
      raise exception 'واحد من المنتجات غير متاح في الفرع ده — حدّث الصفحة' using errcode = 'P0001';
    end if;

    if v_qty is null or v_qty < 1 or v_qty > 30 then
      raise exception 'الكمية غير صحيحة' using errcode = 'P0001';
    end if;

    if v_prod.track_stock and v_prod.stock_qty < v_qty then
      raise exception 'الكمية المطلوبة غير متوفرة' using errcode = 'P0002';
    end if;

    if v_prod.track_stock then
      update products set stock_qty = stock_qty - v_qty where id = v_pid;
      insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, order_id, note)
      values (v_pid, v_prod.branch_id, -v_qty, 'sale', auth.uid(), v_oid, 'بيع');
      if v_prod.stock_qty - v_qty <= v_prod.low_stock_threshold
         and v_prod.stock_qty > v_prod.low_stock_threshold then
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
    raise exception 'طلبيتك فاضية — اختار من المنيو الأول' using errcode = 'P0001';
  end if;

  v_total := v_sub + v_fee;

  if v_method = 'cash' then
    v_max_cash := coalesce(v_branch.cash_max_amount, 500);
    if v_total > v_max_cash then
      raise exception 'حد أقصى لطلبات الكاش % ج — لو طلبك أكبر اختار الدفع بانستا باي', v_max_cash using errcode = 'P0001';
    end if;
  end if;

  update orders set subtotal = v_sub, total = v_total where id = v_oid;

  insert into order_events (order_id, event_type, new_status, changed_by, note)
  values (v_oid, 'created', 'received', auth.uid(),
    case
      when p_delivery_type = 'obour' then 'طلب توصيل عبور — في انتظار تأكيد اللوكيشن'
      when v_method='cash' then 'طلب كاش (أونلاين)'
      else ''
    end
  );

  return jsonb_build_object(
    'ok', true,
    'order_number', v_num,
    'order_id', v_oid,
    'tracking_key', v_key,
    'branch_name', v_branch.name,
    'subtotal', v_sub,
    'delivery_fee', v_fee,
    'total', v_total,
    'status', 'received',
    'payment_method', v_method,
    'payment_status', 'pending'
  );
end $fn$;

-- Keep older signatures callable
grant execute on function submit_order_v2(uuid, jsonb, text, text, text) to anon, authenticated;
grant execute on function submit_order_v2(uuid, jsonb, text, text, text, text, text) to anon, authenticated;
grant execute on function submit_order_v2(uuid, jsonb, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function submit_order_v2(uuid, jsonb, text, text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function submit_order_v2(uuid, jsonb, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- pos_create_order: accept optional staff/customer note (stored in customer_note for staff visibility)
drop function if exists public.pos_create_order(uuid, jsonb, text, text, text, text, text, text, text);

create or replace function pos_create_order(
  p_branch_id uuid,
  p_items jsonb,
  p_delivery_type text default 'pickup',
  p_customer_name text default null,
  p_payment_method text default 'cash',
  p_staff_note text default null,
  p_delivery_floor text default null,
  p_delivery_spot text default null,
  p_customer_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_floor text;
  v_spot text;
  v_note text;
  v_branch branches;
  v_fee numeric(10,2) := 0;
  v_raw jsonb;
  v_pid uuid;
  v_qty int;
  v_prod products;
  v_count int := 0;
  v_sub numeric(10,2) := 0;
  v_oid uuid;
  v_num text;
  v_method text := lower(btrim(coalesce(p_payment_method,'cash')));
begin
  if not is_staff() then raise exception 'غير مسموح' using errcode = '42501'; end if;
  if v_method not in ('cash','instapay') then
    raise exception 'طريقة دفع غير صحيحة' using errcode = 'P0001';
  end if;

  v_name := nullif(btrim(coalesce(p_customer_name,'')), '');
  if char_length(v_name) > 60 then raise exception 'الاسم طويل زيادة عن اللزوم' using errcode = 'P0001'; end if;

  v_floor := nullif(btrim(regexp_replace(coalesce(p_delivery_floor,''), '\s+', ' ', 'g')), '');
  v_spot  := nullif(btrim(regexp_replace(coalesce(p_delivery_spot,''),  '\s+', ' ', 'g')), '');
  v_note := nullif(btrim(regexp_replace(coalesce(p_customer_note, p_staff_note,''), E'[\\r\\n\\t]+', ' ', 'g')), '');
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'الملاحظة طويلة — الحد الأقصى 300 حرف' using errcode = 'P0001';
  end if;

  select * into v_branch from branches where id = p_branch_id and is_active;
  if not found then raise exception 'الفرع اللي اخترته مش متاح حاليًا' using errcode = 'P0001'; end if;
  if p_delivery_type not in ('pickup','table','obour') then raise exception 'اختر طريقة استلام صحيحة' using errcode = 'P0001'; end if;

  if p_delivery_type = 'table' then
    if v_floor is null or char_length(v_floor) < 1 then
      raise exception 'اكتب/اختار رقم الدور لطلب التوصيل داخل الفرع' using errcode = 'P0001';
    end if;
    if char_length(v_floor) > 60 then raise exception 'رقم الدور طويل — اختصره شوية' using errcode = 'P0001'; end if;
    if v_spot is not null and char_length(v_spot) > 120 then raise exception 'مكان الجلوس/الغرفة طويل — اختصره شوية' using errcode = 'P0001'; end if;
  else
    v_floor := null; v_spot := null;
  end if;

  v_fee := case p_delivery_type
    when 'table'  then coalesce((select value::numeric from settings where key='delivery_fee_table'), 5)
    when 'obour'  then coalesce(v_branch.obour_fee, (select value::numeric from settings where key='delivery_fee_obour'), 50)
    else 0
  end;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then
    raise exception 'طلبيتك فاضية أو أكبر من اللازم' using errcode = 'P0001';
  end if;

  insert into orders (
    branch_id, customer_name, delivery_type, delivery_fee, delivery_floor, delivery_spot,
    customer_note,
    source, payment_confirmed, payment_method, payment_status, created_by
  )
  values (
    v_branch.id, coalesce(v_name, 'عميل فرع'), p_delivery_type, v_fee, v_floor, v_spot,
    v_note,
    'pos', true, v_method, 'paid', auth.uid()
  )
  returning id, order_number into v_oid, v_num;

  for v_raw in select * from jsonb_array_elements(p_items) loop
    v_pid := v_raw->>'product_id';
    v_qty := (v_raw->>'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 30 then raise exception 'الكمية غير صحيحة' using errcode = 'P0001'; end if;
    select * into v_prod from products p where p.id = v_pid and p.is_active and p.branch_id = v_branch.id for update;
    if not found then raise exception 'واحد من المنتجات مش متاح في الفرع ده — حدّث الصفحة' using errcode = 'P0001'; end if;

    if v_prod.track_stock and v_prod.stock_qty < v_qty then
      raise exception 'الكمية المطلوبة غير متوفرة' using errcode = 'P0002';
    end if;
    if v_prod.track_stock then
      update products set stock_qty = stock_qty - v_qty where id = v_pid;
      insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, order_id, note)
      values (v_pid, v_prod.branch_id, -v_qty, 'sale', auth.uid(), v_oid, 'بيع POS');
    end if;

    insert into order_items (order_id, product_id, name_snapshot, unit_price, qty, line_total)
    values (v_oid, v_prod.id, v_prod.name, v_prod.price, v_qty, (v_prod.price * v_qty));
    v_sub := v_sub + (v_prod.price * v_qty);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'طلبيتك فاضية — اختار من المنيو الأول' using errcode = 'P0001'; end if;
  update orders set subtotal = v_sub, total = v_sub + v_fee where id = v_oid;

  insert into order_events (order_id, event_type, new_status, changed_by, note)
  values (v_oid, 'created', 'received', auth.uid(), coalesce(p_staff_note, ''));

  if v_method = 'cash' then
    update orders set cash_received_at = now(), cash_received_by = auth.uid() where id = v_oid;
  end if;

  return jsonb_build_object('ok', true, 'order_number', v_num, 'order_id', v_oid, 'total', v_sub + v_fee, 'status', 'received', 'source', 'pos', 'payment_method', v_method, 'payment_status', 'paid');
end $$;

grant execute on function pos_create_order(uuid, jsonb, text, text, text, text) to authenticated;
grant execute on function pos_create_order(uuid, jsonb, text, text, text, text, text, text) to authenticated;
grant execute on function pos_create_order(uuid, jsonb, text, text, text, text, text, text, text) to authenticated;

-- get_order_details: include customer_note for same-customer (tracking-keyed) view
create or replace function get_order_details(
  p_order_number text,
  p_tracking_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_out jsonb;
begin
  if length(trim(coalesce(p_order_number, ''))) = 0
     or length(trim(coalesce(p_tracking_key, ''))) = 0 then
    raise exception 'مفتاح التتبع مش مطابق لهذا الطلب' using errcode = 'P0001';
  end if;

  begin perform expire_unconfirmed_obour_orders(); exception when others then null; end;

  select jsonb_build_object(
    'ok', true,
    'order_number', o.order_number,
    'status', o.status::text,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'branch_name', b.name,
    'delivery_type', o.delivery_type,
    'delivery_fee', o.delivery_fee,
    'delivery_floor', o.delivery_floor,
    'delivery_spot', o.delivery_spot,
    'delivery_address', case when o.delivery_type = 'obour' then o.delivery_address else null end,
    'delivery_landmark', case when o.delivery_type = 'obour' then o.delivery_landmark else null end,
    'customer_name', case when o.delivery_type = 'obour' then o.customer_name else null end,
    'customer_phone', case when o.delivery_type = 'obour' then o.customer_phone else null end,
    'location_confirmed', o.location_confirmed,
    'location_confirmed_at', o.location_confirmed_at,
    'branch_obour_whatsapp', case when o.delivery_type = 'obour' then b.obour_whatsapp else null end,
    'branch_obour_whatsapp_template', case when o.delivery_type = 'obour' then b.obour_whatsapp_template else null end,
    'obour_location_reminder_minutes', coalesce((select value::int from settings where key='obour_location_reminder_minutes'), 20),
    'obour_location_cancel_minutes', coalesce((select value::int from settings where key='obour_location_cancel_minutes'), 45),
    'customer_note', o.customer_note,
    'subtotal', o.subtotal,
    'total', o.total,
    'created_at', o.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', i.name_snapshot,
        'qty', i.qty,
        'unit_price', i.unit_price,
        'line_total', i.line_total
      ) order by i.id)
      from order_items i where i.order_id = o.id
    ), '[]'::jsonb)
  ) into v_out
  from orders o
  join branches b on b.id = o.branch_id
  where o.order_number = p_order_number
    and o.tracking_key::text = p_tracking_key;

  if v_out is null then
    raise exception 'مفتاح التتبع مش مطابق لهذا الطلب' using errcode = 'P0001';
  end if;

  return v_out;
end $fn$;
grant execute on function get_order_details(text, text) to anon;

commit;


-- ========== END supabase/migrations/0035_part7_customer_note.sql ==========

-- ========== BEGIN supabase/migrations/0036_instapay_quick_confirm.sql ==========
-- ============================================================
-- Lala's Bakery — 0036: InstaPay optimization (no proof upload, quick confirm)
-- ============================================================
-- Removes mandatory proof upload flow for online InstaPay: customer can claim
-- "تم التحويل" (instapay_claimed_at) and staff confirms with one click by order.
-- Prevents tampering/duplication: staff-only branch-scoped confirm, idempotent,
-- DB-enforced (preparing still requires payment_confirmed for online instapay).
-- New migration only. RLS stays on. No service_role.
-- ============================================================
begin;

alter table orders add column if not exists instapay_claimed_at timestamptz;

-- ---- Customer RPC: claim InstaPay transfer done (no proof image) ----
create or replace function customer_claim_instapay_payment(
  p_order_number text,
  p_tracking_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
begin
  if not rate_ok('instapay_claim', 20, interval '1 hour') then
    raise exception 'محاولات كثيرة — استنى شوية وحاول تاني' using errcode = 'P0001';
  end if;

  if length(trim(coalesce(p_order_number,''))) = 0 or length(trim(coalesce(p_tracking_key,''))) = 0 then
    raise exception 'بيانات الطلب غير صحيحة' using errcode = 'P0001';
  end if;

  select * into v_order from orders
  where order_number = p_order_number and tracking_key::text = p_tracking_key
  for update;

  if not found then
    raise exception 'مفتاح التتبع مش مطابق لهذا الطلب' using errcode = 'P0001';
  end if;

  if v_order.payment_method <> 'instapay' then
    raise exception 'هذا الطلب ليس طلب InstaPay' using errcode = 'P0001';
  end if;

  if v_order.payment_status = 'paid' or v_order.payment_confirmed then
    return jsonb_build_object('ok', true, 'already_paid', true, 'payment_status', 'paid');
  end if;

  if v_order.payment_status in ('rejected','refunded') then
    raise exception 'لا يمكن تأكيد التحويل لهذا الطلب' using errcode = 'P0001';
  end if;

  if v_order.instapay_claimed_at is not null then
    return jsonb_build_object('ok', true, 'already_claimed', true, 'instapay_claimed_at', v_order.instapay_claimed_at);
  end if;

  update orders set instapay_claimed_at = now() where id = v_order.id;

  insert into order_events(order_id, event_type, changed_by, note)
  values (v_order.id, 'status_changed', auth.uid(), 'العميل أبلغ بإتمام تحويل InstaPay (بانتظار تأكيد الموظف)');

  return jsonb_build_object('ok', true, 'instapay_claimed_at', now());
end $$;
grant execute on function customer_claim_instapay_payment(text, text) to anon, authenticated;

-- ---- Staff: confirm InstaPay (one-click, no proof required), idempotent ----
create or replace function staff_confirm_payment(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
  v_profile_branch uuid;
begin
  if not is_staff() then raise exception 'غير مسموح' using errcode = '42501'; end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'message', 'الطلب مش موجود'); end if;

  if not is_manager() then
    select branch_id into v_profile_branch from profiles where id = auth.uid();
    if v_profile_branch is not null and v_order.branch_id is distinct from v_profile_branch then
      raise exception 'غير مسموح لفرع آخر' using errcode = '42501';
    end if;
  end if;

  if v_order.payment_method <> 'instapay' then
    return jsonb_build_object('ok', false, 'message', 'تأكيد التحويل متاح لطلبات InstaPay فقط');
  end if;

  -- idempotent: prevent duplicate/tampering side effects
  if v_order.payment_status = 'paid' and v_order.payment_confirmed then
    return jsonb_build_object('ok', true, 'payment_status', 'paid', 'already', true);
  end if;

  update orders set payment_confirmed = true, payment_status = 'paid' where id = v_order.id;

  insert into order_events (order_id, event_type, changed_by, note)
  values (v_order.id, 'payment_confirmed', auth.uid(), 'تأكيد دفع InstaPay (تأكيد سريع برقم الطلب)');

  return jsonb_build_object('ok', true, 'payment_status', 'paid');
end $$;
grant execute on function staff_confirm_payment(uuid) to authenticated;

-- ---- Staff: reject InstaPay (kept for cases where payment not received) ----
create or replace function staff_reject_payment(p_order_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
  v_profile_branch uuid;
  v_reason text := coalesce(nullif(btrim(coalesce(p_reason,'')),''), 'لم يتم التحقق من التحويل');
begin
  if not is_staff() then raise exception 'غير مسموح' using errcode = '42501'; end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'message', 'الطلب مش موجود'); end if;

  if not is_manager() then
    select branch_id into v_profile_branch from profiles where id = auth.uid();
    if v_profile_branch is not null and v_order.branch_id is distinct from v_profile_branch then
      raise exception 'غير مسموح لفرع آخر' using errcode = '42501';
    end if;
  end if;

  if v_order.payment_status = 'paid' then
    return jsonb_build_object('ok', false, 'message', 'لا يمكن رفض دفعة مؤكدة');
  end if;

  update orders
  set payment_confirmed = false,
      payment_status = 'rejected',
      instapay_claimed_at = null,
      payment_proof_path = null
  where id = v_order.id;

  insert into order_events (order_id, event_type, changed_by, note)
  values (v_order.id, 'payment_rejected', auth.uid(), v_reason);

  return jsonb_build_object('ok', true, 'payment_status', 'rejected');
end $$;
grant execute on function staff_reject_payment(uuid, text) to authenticated;

-- Keep number+key wrappers in sync (instapay)
create or replace function confirm_payment(p_order_number text, p_tracking_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order orders;
begin
  if not is_staff() then raise exception 'غير مسموح' using errcode = '42501'; end if;
  select * into v_order from orders where order_number = p_order_number and tracking_key::text = p_tracking_key;
  if not found then return jsonb_build_object('ok', false, 'message', 'مفتاح التتبع مش مطابق لهذا الطلب'); end if;
  return staff_confirm_payment(v_order.id);
end $$;
grant execute on function confirm_payment(text, text) to authenticated;

create or replace function reject_payment(p_order_number text, p_tracking_key text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order orders;
begin
  if not is_staff() then raise exception 'غير مسموح' using errcode = '42501'; end if;
  select * into v_order from orders where order_number = p_order_number and tracking_key::text = p_tracking_key;
  if not found then return jsonb_build_object('ok', false, 'message', 'مفتاح التتبع مش مطابق لهذا الطلب'); end if;
  return staff_reject_payment(v_order.id, p_reason);
end $$;
grant execute on function reject_payment(text, text, text) to authenticated;

-- ---- get_payment_info: include instapay_claimed_at (carry forward 0026) ----
create or replace function get_payment_info(
  p_order_number text,
  p_tracking_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_out jsonb;
begin
  if not rate_ok('payment_info', 30, interval '1 hour') then
    raise exception 'طلبات كثيرة زيادة — استنى شوية' using errcode = 'P0001';
  end if;

  if length(trim(coalesce(p_order_number, ''))) = 0
     or length(trim(coalesce(p_tracking_key, ''))) = 0 then
    raise exception 'مفتاح التتبع مش مطابق لهذا الطلب' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'ok', true,
    'order_number', o.order_number,
    'total', o.total,
    'status', o.status::text,
    'branch_name', b.name,
    'created_at', o.created_at,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'instapay_claimed_at', o.instapay_claimed_at
  ) into v_out
  from orders o
  join branches b on b.id = o.branch_id
  where o.order_number = p_order_number
    and o.tracking_key::text = p_tracking_key;

  if v_out is null then
    raise exception 'مفتاح التتبع مش مطابق لهذا الطلب' using errcode = 'P0001';
  end if;

  return v_out;
end $fn$;
grant execute on function get_payment_info(text, text) to anon;

-- ---- get_order_details: include instapay_claimed_at (carry forward 0035) ----
create or replace function get_order_details(
  p_order_number text,
  p_tracking_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_out jsonb;
begin
  if length(trim(coalesce(p_order_number, ''))) = 0
     or length(trim(coalesce(p_tracking_key, ''))) = 0 then
    raise exception 'مفتاح التتبع مش مطابق لهذا الطلب' using errcode = 'P0001';
  end if;

  begin perform expire_unconfirmed_obour_orders(); exception when others then null; end;

  select jsonb_build_object(
    'ok', true,
    'order_number', o.order_number,
    'status', o.status::text,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'instapay_claimed_at', o.instapay_claimed_at,
    'branch_name', b.name,
    'delivery_type', o.delivery_type,
    'delivery_fee', o.delivery_fee,
    'delivery_floor', o.delivery_floor,
    'delivery_spot', o.delivery_spot,
    'delivery_address', case when o.delivery_type = 'obour' then o.delivery_address else null end,
    'delivery_landmark', case when o.delivery_type = 'obour' then o.delivery_landmark else null end,
    'customer_name', case when o.delivery_type = 'obour' then o.customer_name else null end,
    'customer_phone', case when o.delivery_type = 'obour' then o.customer_phone else null end,
    'location_confirmed', o.location_confirmed,
    'location_confirmed_at', o.location_confirmed_at,
    'branch_obour_whatsapp', case when o.delivery_type = 'obour' then b.obour_whatsapp else null end,
    'branch_obour_whatsapp_template', case when o.delivery_type = 'obour' then b.obour_whatsapp_template else null end,
    'obour_location_reminder_minutes', coalesce((select value::int from settings where key='obour_location_reminder_minutes'), 20),
    'obour_location_cancel_minutes', coalesce((select value::int from settings where key='obour_location_cancel_minutes'), 45),
    'customer_note', o.customer_note,
    'subtotal', o.subtotal,
    'total', o.total,
    'created_at', o.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', i.name_snapshot,
        'qty', i.qty,
        'unit_price', i.unit_price,
        'line_total', i.line_total
      ) order by i.id)
      from order_items i where i.order_id = o.id
    ), '[]'::jsonb)
  ) into v_out
  from orders o
  join branches b on b.id = o.branch_id
  where o.order_number = p_order_number
    and o.tracking_key::text = p_tracking_key;

  if v_out is null then
    raise exception 'مفتاح التتبع مش مطابق لهذا الطلب' using errcode = 'P0001';
  end if;

  return v_out;
end $fn$;
grant execute on function get_order_details(text, text) to anon;

commit;


-- ========== END supabase/migrations/0036_instapay_quick_confirm.sql ==========

-- ========== BEGIN supabase/migrations/0037_product_price_positive_check.sql ==========
-- منع المنتجات بسعر غير موجب من الآن (المشكلة: Coffee cake, Marbel cake, Sheko cake كانوا بـ 0)
-- NOT VALID: يجبر أي صف جديد/مُحدّث، من غير ما يأثر على الصفوف القديمة أو يعطل التطبيق.
-- بعد ما الأدمن يصحح أسعار المنتجات الثلاثة في شاشة الإدارة شغّل في سطر واحد:
--   alter table products validate constraint products_price_positive;
-- ملاحظة: هذه الهجرة كانت مسجلة مكررة بالرقم 0027؛ تم نقلها لـ 0037 حتى تُنفذ مرة واحدة وبصيغتها المطابقة للتاريخ.

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_price_positive') then
    alter table products
      add constraint products_price_positive
      check (price > 0)
      not valid;
  end if;
end $$;

comment on constraint products_price_positive on products
is 'السعر لازم يكون أكبر من صفر — يُتحقق على مستوى قاعدة البيانات (NOT VALID لحين تصحيح الصفوف القديمة)';


-- ========== END supabase/migrations/0037_product_price_positive_check.sql ==========

select pg_notify('pgrst','reload schema');

-- Verify/schedule obour expiry (if pg_cron available):
-- select jobname, schedule, command from cron.job where jobname = 'expire-unconfirmed-obour-orders';
-- If missing, schedule: select cron.schedule('expire-unconfirmed-obour-orders', '*/5 * * * *', 'select public.expire_unconfirmed_obour_orders();');
