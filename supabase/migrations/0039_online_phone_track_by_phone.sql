-- ============================================================
-- Lala's Bakery — 0039: online phone required + friendly phone tracking
-- ============================================================
-- Makes the phone number mandatory for every ONLINE order (InstaPay and cash)
-- and adds track_order_by_phone(order_number, phone) so customers can track a
-- request from any device without seeing the long tracking key.
-- Generic errors only. No enumeration. Rate limited + temporary lockout.
-- New migration only. RLS stays on. No service_role.
-- ============================================================
begin;

-- Normalize Egyptian phone numbers for validation/comparison.
create or replace function normalize_eg_phone(p_phone text)
returns text
language sql immutable
as $fn$
  select case
    when regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') ~ '^0020[0-9]{10}$'
      then '0' || substring(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') from 5)
    when regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') ~ '^20[0-9]{10}$'
      then '0' || substring(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') from 3)
    when regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') ~ '^1[0125][0-9]{8}$'
      then '0' || regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
    else regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
  end
$fn$;

-- Online orders always need a valid Egyptian phone (defense in depth).
do $fn$ begin
  alter table orders add constraint orders_online_phone_check
    check (source <> 'online' or normalize_eg_phone(customer_phone) ~ '^01[0125][0-9]{8}$')
    not valid;
exception when duplicate_object then null; end $fn$;

create or replace function enforce_online_order_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.source = 'online' and not is_valid_eg_phone(normalize_eg_phone(new.customer_phone)) then
    raise exception 'اكتب رقم موبايل مصري صحيح (11 رقم يبدأ بـ 010 أو 011 أو 012 أو 015)' using errcode = 'P0001';
  end if;
  return new;
end $fn$;

drop trigger if exists orders_online_phone_required on orders;
create trigger orders_online_phone_required
  before insert on orders
  for each row execute function enforce_online_order_phone();

-- Friendly tracking from any device: order number + phone used in the order.
-- Returns status only. Constant-time phone comparison and no order enumeration.
create or replace function track_order_by_phone(p_order_number text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_num text := upper(btrim(coalesce(p_order_number, '')));
  v_phone text := normalize_eg_phone(p_phone);
  v_order orders;
  v_wrong int := 0;
  v_wrong_total int := 0;
  v_hash text := client_ip_hash();
begin
  -- Broad per-IP rate limit (logs attempts; successes included).
  if not rate_ok('track_phone', 60, interval '1 hour') then
    raise exception 'مش لاقيين الطلب، راجع الرقم' using errcode = 'P0001';
  end if;

  if length(v_num) = 0 or not is_valid_eg_phone(v_phone) then
    raise exception 'مش لاقيين الطلب، راجع الرقم' using errcode = 'P0001';
  end if;

  -- Temporary lockout after repeated wrong attempts for this order number.
  select count(*) into v_wrong
  from rate_log
  where ip_hash = v_hash
    and action = 'track_phone_wrong:' || v_num
    and created_at > now() - interval '15 minutes';

  select count(*) into v_wrong_total
  from rate_log
  where ip_hash = v_hash
    and action = 'track_phone_wrong'
    and created_at > now() - interval '15 minutes';

  if v_wrong >= 5 or v_wrong_total >= 20 then
    raise exception 'مش لاقيين الطلب، راجع الرقم' using errcode = 'P0001';
  end if;

  select * into v_order
  from orders
  where order_number = v_num
  for share;

  if not found
     or md5(coalesce(normalize_eg_phone(v_order.customer_phone), '')) <> md5(v_phone) then
    insert into rate_log (ip_hash, action) values
      (v_hash, 'track_phone_wrong:' || v_num),
      (v_hash, 'track_phone_wrong');
    raise exception 'مش لاقيين الطلب، راجع الرقم' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_number', v_order.order_number,
    'status', v_order.status::text,
    'updated_at', v_order.updated_at,
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status
  );
end $fn$;
grant execute on function track_order_by_phone(text, text) to anon;

commit;
