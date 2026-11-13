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
