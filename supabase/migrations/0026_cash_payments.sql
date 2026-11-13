-- ============================================================
-- Lala's Bakery — 0026: Cash + InstaPay payment methods
-- ============================================================
-- Adds payment method/status, customer phone, cash receipt fields,
-- branch cash settings, server-side validation/rate limits/timeout
-- auto-cancel, and updates RPCs/UI contracts for cash + instapay.
-- New migration only. RLS stays on. No service_role usage.
-- ============================================================
begin;

-- ---- 1) Branch-level cash settings ----
alter table branches add column if not exists cash_enabled boolean not null default true;
alter table branches add column if not exists cash_max_amount numeric(10,2) not null default 500 check (cash_max_amount >= 0);

-- Global settings
insert into settings (key, value) values ('cash_accept_timeout_minutes', '30')
on conflict (key) do nothing;

-- ---- 2) Orders: payment method/status/phone/cash receipt ----
alter table orders add column if not exists payment_method text;
alter table orders add column if not exists payment_status text;
alter table orders add column if not exists customer_phone text;
alter table orders add column if not exists cash_received_at timestamptz;
alter table orders add column if not exists cash_received_by uuid references auth.users(id) on delete set null;

-- Backfill existing rows (online => instapay, pos => cash by default)
update orders
set payment_method = case when source = 'pos' then 'cash' else 'instapay' end
where payment_method is null;

update orders
set payment_status = case
  when payment_confirmed then 'paid'
  else 'pending'
end
where payment_status is null;

alter table orders alter column payment_method set default 'instapay';
alter table orders alter column payment_method set not null;
alter table orders alter column payment_status set default 'pending';
alter table orders alter column payment_status set not null;

do $$ begin
  alter table orders add constraint orders_payment_method_check check (payment_method in ('cash','instapay'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table orders add constraint orders_payment_status_check check (payment_status in ('pending','paid','rejected','refunded'));
exception when duplicate_object then null; end $$;
-- Cash orders need a phone for ONLINE orders (callback number).
-- POS/counter cash orders (source='pos') have no customer phone by design.
do $$ begin
  alter table orders add constraint orders_cash_phone_check check (
    payment_method <> 'cash' or source = 'pos' or length(btrim(coalesce(customer_phone,''))) > 0
  );
exception when duplicate_object then null; end $$;

create index if not exists orders_payment_method_idx on orders(payment_method, payment_status, created_at desc);

-- ---- 3) Event types for cash flow ----
-- order_events.event_type is a text check in 0001; extend it safely.
alter table order_events drop constraint if exists order_events_event_type_check;
alter table order_events add constraint order_events_event_type_check
  check (event_type in ('created','payment_confirmed','payment_rejected','status_changed','order_cancelled','cash_received'));

-- ---- 4) Helpers ----
create or replace function is_valid_eg_phone(p_phone text)
returns boolean
language sql immutable as $$
  select coalesce(p_phone,'') ~ '^01[0125][0-9]{8}$';
$$;

create or replace function cash_accept_timeout_minutes()
returns int
language sql stable security definer set search_path = public as $$
  select greatest(1, coalesce((select value::int from settings where key='cash_accept_timeout_minutes'), 30));
$$;

-- Auto-cancel expired cash orders (online cash, still received/pending, not accepted in time)
-- Returns number of orders cancelled. Releases reserved stock and logs events.
create or replace function expire_stale_cash_orders(p_branch_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timeout int := cash_accept_timeout_minutes();
  v_order record;
  v_count int := 0;
begin
  for v_order in
    select o.id, o.branch_id, o.status, o.payment_method, o.payment_status, o.source
    from orders o
    where o.payment_method = 'cash'
      and o.source = 'online'
      and o.status = 'received'
      and o.payment_status = 'pending'
      and o.created_at < now() - make_interval(mins => v_timeout)
      and (p_branch_id is null or o.branch_id = p_branch_id)
    for update skip locked
  loop
    -- return stock if not already returned for this order
    insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, order_id, note)
    select i.product_id, v_order.branch_id, i.qty, 'expiry', null, v_order.id, 'إلغاء تلقائي لطلب كاش لم يُقبل في الوقت المحدد'
    from order_items i
    join products p on p.id = i.product_id
    where i.order_id = v_order.id
      and i.product_id is not null
      and p.track_stock
      and not exists (
        select 1 from stock_movements sm where sm.order_id = v_order.id and sm.reason in ('expiry','void')
      );

    update products p
    set stock_qty = p.stock_qty + s.qty
    from (
      select i.product_id, sum(i.qty)::int as qty
      from order_items i
      where i.order_id = v_order.id and i.product_id is not null
      group by i.product_id
    ) s
    where p.id = s.product_id and p.track_stock
      and exists (select 1 from stock_movements sm where sm.order_id = v_order.id and sm.reason = 'expiry' and sm.product_id = p.id);

    update orders
    set status = 'done', payment_status = 'rejected', updated_at = now()
    where id = v_order.id;

    insert into order_events (order_id, event_type, old_status, new_status, changed_by, note)
    values (v_order.id, 'order_cancelled', 'received', 'done', null, 'تم إلغاء الطلب تلقائيًا لعدم القبول خلال الوقت المحدد');

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'cancelled', v_count);
end $$;
grant execute on function expire_stale_cash_orders(uuid) to authenticated;

-- ---- 5) Replace submit_order_v2 (backward-compatible signature extension) ----
-- Old callers pass 5 args; new callers can pass payment method/phone.
-- Keep function name/signature prefix compatible by adding defaults.
create or replace function submit_order_v2(
  p_branch_id uuid,
  p_items jsonb,
  p_delivery_type text,
  p_customer_name text,
  p_turnstile_token text default null,
  p_payment_method text default 'instapay',
  p_customer_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name text;
  v_phone text;
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

  if v_method = 'cash' then
    if not coalesce(v_branch.cash_enabled, true) then
      raise exception 'الدفع كاش غير متاح حاليًا في هذا الفرع' using errcode = 'P0001';
    end if;
    if not is_valid_eg_phone(v_phone) then
      raise exception 'اكتب رقم موبايل مصري صحيح (11 رقم يبدأ بـ 010 أو 011 أو 012 أو 015)' using errcode = 'P0001';
    end if;
    -- rate limit cash by IP and by phone
    if not rate_ok('cash_order_ip', 5, interval '30 minutes') then
      raise exception 'طلبات كاش كثيرة من هذا الجهاز — استنى شوية وحاول تاني' using errcode = 'P0001';
    end if;
    if not rate_ok('cash_order_phone:' || md5(v_phone), 3, interval '30 minutes') then
      raise exception 'طلبات كاش كثيرة على هذا الرقم — استنى شوية وحاول تاني' using errcode = 'P0001';
    end if;
  end if;

  insert into orders (branch_id, customer_name, customer_phone, delivery_type, delivery_fee, source, payment_confirmed, payment_method, payment_status, created_by)
  values (v_branch.id, v_name, case when v_method='cash' then v_phone else v_phone end, p_delivery_type, v_fee, 'online', false, v_method, 'pending', auth.uid())
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

-- Keep old and new call signatures usable
grant execute on function submit_order_v2(uuid, jsonb, text, text, text) to anon;
grant execute on function submit_order_v2(uuid, jsonb, text, text, text) to authenticated;
grant execute on function submit_order_v2(uuid, jsonb, text, text, text, text, text) to anon;
grant execute on function submit_order_v2(uuid, jsonb, text, text, text, text, text) to authenticated;

-- ---- 6) Payment/status enforcement updates ----
-- Replace trigger: instapay (online) cannot go to preparing before paid/confirmed.
-- Cash orders can be accepted (moved to preparing) while payment pending.
create or replace function enforce_payment_before_preparing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (old.status is distinct from new.status) and new.status = 'preparing' then
    if new.payment_method = 'instapay' and new.source = 'online' and not new.payment_confirmed then
      raise exception 'لا يمكن نقل طلب أونلاين (انستا باي) إلى "جاري التحضير" قبل تأكيد الدفع' using errcode = 'P0001';
    end if;
    -- cash: allowed to move to preparing without payment confirmed (acceptance)
  end if;

  -- prevent double-cash-paid / inconsistent paid states
  if new.payment_method = 'cash' and new.payment_status = 'paid' then
    if old.payment_status = 'paid' and old.cash_received_at is not null and new.cash_received_at is not null then
      -- allow idempotent-like updates that don't change receipt facts
      null;
    end if;
  end if;

  -- sync legacy flag
  if new.payment_status = 'paid' then
    new.payment_confirmed := true;
  elsif new.payment_status in ('pending','rejected','refunded') and new.payment_method = 'cash' then
    new.payment_confirmed := false;
  end if;

  return new;
end $$;

drop trigger if exists orders_enforce_payment on orders;
create trigger orders_enforce_payment
  before update of status, source, payment_confirmed, payment_method, payment_status, cash_received_at on orders
  for each row execute function enforce_payment_before_preparing();

-- ---- 7) Staff RPCs: status, instapay confirm/reject, cash accept/receive/cancel ----
-- Replace staff_set_status to be branch-scoped and to run expiry cleanup.
create or replace function staff_set_status(p_order_id uuid, p_new_status order_status)
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

  begin perform expire_stale_cash_orders(null); exception when others then null; end;

  select * into v_order from orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'message', 'الطلب مش موجود'); end if;

  -- branch scoping: non-manager staff limited to own branch
  if not is_manager() then
    select branch_id into v_profile_branch from profiles where id = auth.uid();
    if v_profile_branch is not null and v_order.branch_id is distinct from v_profile_branch then
      raise exception 'غير مسموح لفرع آخر' using errcode = '42501';
    end if;
  end if;

  if v_order.status = 'done' then
    return jsonb_build_object('ok', false, 'message', 'الطلب خلص خلاص — مفيش رجوع لورا');
  end if;
  if p_new_status is null then
    return jsonb_build_object('ok', false, 'message', 'حالة مش معروفة');
  end if;

  update orders set status = p_new_status where id = p_order_id;
  insert into order_events (order_id, event_type, old_status, new_status, changed_by, note)
  values (p_order_id, 'status_changed', v_order.status, p_new_status, auth.uid(), '');

  return jsonb_build_object('ok', true, 'status', p_new_status);
end $$;
grant execute on function staff_set_status(uuid, order_status) to authenticated;

-- InstaPay proof confirm/reject (by id) — keep names used by UI
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
    return jsonb_build_object('ok', false, 'message', 'تأكيد التحويل متاح لطلبات انستا باي فقط');
  end if;
  if v_order.source = 'online' and v_order.payment_proof_path is null then
    return jsonb_build_object('ok', false, 'message', 'مفيش إثبات تحويل للطلب ده');
  end if;

  update orders set payment_confirmed = true, payment_status = 'paid' where id = v_order.id;
  insert into order_events (order_id, event_type, changed_by, note)
  values (v_order.id, 'payment_confirmed', auth.uid(), 'تأكيد الدفع من الموظف');

  return jsonb_build_object('ok', true, 'payment_status', 'paid');
end $$;
grant execute on function staff_confirm_payment(uuid) to authenticated;

create or replace function staff_reject_payment(p_order_id uuid, p_reason text default null)
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
    return jsonb_build_object('ok', false, 'message', 'رفض إثبات الدفع متاح لطلبات انستا باي فقط');
  end if;

  update orders
  set payment_confirmed = false, payment_status = 'rejected', payment_proof_path = null
  where id = v_order.id;

  insert into order_events (order_id, event_type, changed_by, note)
  values (v_order.id, 'payment_rejected', auth.uid(), coalesce(nullif(btrim(coalesce(p_reason,'')),''), 'الصورة غير واضحة'));

  return jsonb_build_object('ok', true, 'payment_status', 'rejected');
end $$;
grant execute on function staff_reject_payment(uuid, text) to authenticated;

-- Cash: staff marks cash received (payment becomes paid). Can be called once.
create or replace function staff_mark_cash_received(p_order_id uuid)
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

  if v_order.payment_method <> 'cash' then
    return jsonb_build_object('ok', false, 'message', 'هذا الإجراء متاح لطلبات الكاش فقط');
  end if;
  if v_order.payment_status = 'paid' or v_order.cash_received_at is not null then
    return jsonb_build_object('ok', false, 'message', 'تم تسجيل استلام الكاش لهذا الطلب بالفعل');
  end if;
  if v_order.status = 'done' and v_order.payment_status in ('rejected','refunded') then
    return jsonb_build_object('ok', false, 'message', 'لا يمكن تسجيل كاش لطلب ملغي');
  end if;

  update orders
  set payment_status = 'paid', payment_confirmed = true, cash_received_at = now(), cash_received_by = auth.uid()
  where id = v_order.id;

  insert into order_events (order_id, event_type, changed_by, note)
  values (v_order.id, 'cash_received', auth.uid(), 'تم استلام الكاش');

  return jsonb_build_object('ok', true, 'payment_status', 'paid', 'cash_received_at', now());
end $$;
grant execute on function staff_mark_cash_received(uuid) to authenticated;

-- Staff cancel/reject order (with reason). Releases stock if reserved.
create or replace function staff_cancel_order(p_order_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
  v_profile_branch uuid;
  v_reason text := coalesce(nullif(btrim(coalesce(p_reason,'')),''), 'تم الإلغاء من الموظف');
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

  if v_order.status = 'done' and v_order.payment_status in ('rejected','refunded') then
    return jsonb_build_object('ok', false, 'message', 'الطلب ملغي بالفعل');
  end if;

  -- return stock once
  if not exists (select 1 from stock_movements sm where sm.order_id = v_order.id and sm.reason in ('expiry','void')) then
    insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, order_id, note)
    select i.product_id, v_order.branch_id, i.qty, 'void', auth.uid(), v_order.id, v_reason
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
  values (v_order.id, 'order_cancelled', v_order.status, 'done', auth.uid(), v_reason);

  return jsonb_build_object('ok', true, 'status', 'done');
end $$;
grant execute on function staff_cancel_order(uuid, text) to authenticated;

-- Keep number+key confirm/reject RPCs in sync for instapay
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

-- ---- 8) Customer-facing RPCs include payment fields ----
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
    'payment_status', o.payment_status
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

create or replace function track_order_by_key(
  p_order_number text,
  p_tracking_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_norm   text := upper(btrim(coalesce(p_order_number, '')));
  v_action text;
  v_recent int;
  v_out    jsonb;
begin
  if v_norm ~ '^LB-[0-9]+$' then
    v_action := 'track_wrong_' || v_norm;
  else
    v_action := 'track_wrong_invalid';
  end if;

  select count(*) into v_recent
  from rate_log
  where action = v_action
    and ip_hash = client_ip_hash()
    and created_at > now() - interval '1 hour';

  if v_recent >= 5 then
    raise exception 'محاولات كتير غلط — استنى شوية وجرب تاني' using errcode = 'P0001';
  end if;

  if length(v_norm) = 0 or length(trim(coalesce(p_tracking_key, ''))) = 0 then
    insert into rate_log (ip_hash, action) values (client_ip_hash(), v_action);
    raise exception 'مفتاح التتبع مش مطابق لهذا الطلب' using errcode = 'P0001';
  end if;

  -- expire stale cash orders opportunistically (no leakage)
  begin perform expire_stale_cash_orders(null); exception when others then null; end;

  select jsonb_build_object(
    'ok', true,
    'order_number', o.order_number,
    'status', p.status::text,
    'updated_at', p.updated_at,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status
  ) into v_out
  from orders o
  join order_status_public p on p.order_number = o.order_number
  where o.order_number = v_norm
    and o.tracking_key::text = p_tracking_key;

  if v_out is null then
    insert into rate_log (ip_hash, action) values (client_ip_hash(), v_action);
    raise exception 'مفتاح التتبع مش مطابق لهذا الطلب' using errcode = 'P0001';
  end if;

  return v_out;
end $fn$;
grant execute on function track_order_by_key(text, text) to anon;

-- ---- 9) POS and shifts updates ----
create or replace function pos_create_order(
  p_branch_id uuid,
  p_items jsonb,
  p_delivery_type text default 'pickup',
  p_customer_name text default null,
  p_payment_method text default 'cash',
  p_staff_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
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

  select * into v_branch from branches where id = p_branch_id and is_active;
  if not found then raise exception 'الفرع اللي اخترته مش متاح حاليًا' using errcode = 'P0001'; end if;
  if p_delivery_type not in ('pickup','table','obour') then raise exception 'اختر طريقة استلام صحيحة' using errcode = 'P0001'; end if;

  v_fee := case p_delivery_type
    when 'table'  then coalesce((select value::numeric from settings where key='delivery_fee_table'), 5)
    when 'obour'  then coalesce((select value::numeric from settings where key='delivery_fee_obour'), 50)
    else 0
  end;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then
    raise exception 'طلبيتك فاضية أو أكبر من اللازم' using errcode = 'P0001';
  end if;

  -- POS instapay considered paid at counter when recorded; cash paid immediately at counter
  v_pay_status := 'paid';

  insert into orders (branch_id, customer_name, delivery_type, delivery_fee, source, payment_confirmed, payment_method, payment_status, created_by)
  values (v_branch.id, coalesce(v_name, 'عميل فرع'), p_delivery_type, v_fee, 'pos', true, v_method, v_pay_status, auth.uid())
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

-- Shift close: include POS cash + online cash-on-delivery received in shift window, split reporting.
create or replace function shift_close(
  p_shift_id uuid,
  p_counted_cash numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift shifts;
  v_pos_cash numeric(10,2);
  v_online_cod_cash numeric(10,2);
  v_expected numeric(10,2);
  v_diff numeric(10,2);
  v_end timestamptz := now();
begin
  if not is_staff() then raise exception 'غير مسموح' using errcode = '42501'; end if;

  select * into v_shift from shifts where id = p_shift_id;
  if not found then return jsonb_build_object('ok', false, 'message', 'الفترة مش موجودة'); end if;
  if v_shift.staff_id <> auth.uid() then raise exception 'هذه الفترة ليست خاصتك' using errcode = '42501'; end if;
  if v_shift.status <> 'open' then return jsonb_build_object('ok', false, 'message', 'الفترة مغلقة بالفعل'); end if;

  -- POS cash orders paid at counter
  select coalesce(sum(o.total),0) into v_pos_cash
  from orders o
  where o.branch_id = v_shift.branch_id
    and o.source = 'pos'
    and o.payment_method = 'cash'
    and o.payment_status = 'paid'
    and o.created_at >= v_shift.opened_at and o.created_at <= v_end;

  -- Online cash-on-delivery: cash received during shift window
  select coalesce(sum(o.total),0) into v_online_cod_cash
  from orders o
  where o.branch_id = v_shift.branch_id
    and o.source = 'online'
    and o.payment_method = 'cash'
    and o.payment_status = 'paid'
    and o.cash_received_at is not null
    and o.cash_received_at >= v_shift.opened_at and o.cash_received_at <= v_end;

  v_expected := coalesce(v_pos_cash,0) + coalesce(v_online_cod_cash,0);
  v_diff := p_counted_cash - v_expected;

  update shifts
  set closing_cash = v_expected,
      counted_cash = p_counted_cash,
      difference = v_diff,
      note = coalesce(btrim(coalesce(p_note,'')),''),
      status = 'closed',
      closed_at = v_end
  where id = p_shift_id;

  return jsonb_build_object(
    'ok', true,
    'expected_cash', v_expected,
    'counted_cash', p_counted_cash,
    'difference', v_diff,
    'pos_cash', v_pos_cash,
    'online_cash_on_delivery', v_online_cod_cash,
    'instapay_in_drawer', 0
  );
end $$;
grant execute on function shift_close(uuid, numeric, text) to authenticated;

-- ---- 10) Reports: revenue/payment method, unpaid/pending/cancelled cash ----
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
        and (p_branch_id is null or branch_id = p_branch_id)
    ),
    'per_day', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select (created_at at time zone 'Africa/Cairo')::date as day,
               count(*) as orders_count,
               coalesce(sum(total) filter (where payment_status='paid'),0) as revenue
        from orders
        where created_at >= v_f and created_at < v_t
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
          and (p_branch_id is null or o.branch_id = p_branch_id)
        group by o.payment_method order by revenue desc
      ) x
    ),
    'online_vs_pos', (
      select jsonb_build_object(
        'online', coalesce((select jsonb_build_object('orders_count', count(*), 'revenue', coalesce(sum(total) filter (where payment_status='paid'),0))
          from orders where created_at >= v_f and created_at < v_t
            and source = 'online' and (p_branch_id is null or branch_id = p_branch_id)), '{}'::jsonb),
        'pos', coalesce((select jsonb_build_object('orders_count', count(*), 'revenue', coalesce(sum(total) filter (where payment_status='paid'),0))
          from orders where created_at >= v_f and created_at < v_t
            and source = 'pos' and (p_branch_id is null or branch_id = p_branch_id)), '{}'::jsonb)
      )
    ),
    'cash_summary', (
      select jsonb_build_object(
        'unpaid_pending_cash_orders', count(*) filter (where payment_method='cash' and payment_status='pending' and status <> 'done'),
        'cancelled_cash_orders', count(*) filter (where payment_method='cash' and status='done' and payment_status in ('rejected','refunded'))
      ) from orders
      where created_at >= v_f and created_at < v_t
        and (p_branch_id is null or branch_id = p_branch_id)
    ),
    'peak_hours', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select extract(hour from (created_at at time zone 'Africa/Cairo'))::int as hour,
               count(*) as orders_count
        from orders
        where created_at >= v_f and created_at < v_t
          and (p_branch_id is null or branch_id = p_branch_id)
        group by 1 order by 1
      ) x
    )
  ) into v_out;

  return v_out;
end $$;
grant execute on function manager_report_enhanced(date, date, uuid) to authenticated;

-- Keep staff performance/prod movement RPCs unchanged behaviorally except they remain valid; no signature change needed.

-- ---- 11) Update release_reserved_stock to respect payment method semantics ----
create or replace function release_reserved_stock()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  if not is_manager() then raise exception 'غير مسموح' using errcode = '42501'; end if;
  -- expire stale cash orders (not accepted in time)
  perform expire_stale_cash_orders(null);
  -- legacy: instapay unpaid online orders older than 30 min (proof not confirmed) -> cancel/release
  with stale as (
    select o.id, o.branch_id
    from orders o
    where o.source='online' and o.payment_method='instapay' and o.payment_confirmed=false and o.status='received'
      and o.created_at < now() - interval '30 minutes'
    for update skip locked
  ), ins as (
    insert into stock_movements (product_id, branch_id, change_qty, reason, changed_by, order_id, note)
    select i.product_id, s.branch_id, i.qty, 'expiry', null, s.id, 'إلغاء تلقائي لطلب انستا باي غير مدفوع'
    from order_items i join stale s on s.id=i.order_id join products p on p.id=i.product_id
    where i.product_id is not null and p.track_stock
      and not exists (select 1 from stock_movements sm where sm.order_id=s.id and sm.reason in ('expiry','void'))
    returning order_id
  )
  update orders o set status='done', payment_status='rejected'
  from stale s where o.id=s.id and exists (select 1 from ins i where i.order_id=s.id);
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'released_orders', v_count);
end $$;
grant execute on function release_reserved_stock() to authenticated;

commit;
