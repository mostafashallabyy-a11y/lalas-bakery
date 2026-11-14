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
