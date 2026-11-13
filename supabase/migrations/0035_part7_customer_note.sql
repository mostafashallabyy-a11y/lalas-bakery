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
