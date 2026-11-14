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
