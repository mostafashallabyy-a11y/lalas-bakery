-- ============================================================
-- Lala's Bakery - 0023: public order tracking (number + key)
-- ============================================================
-- Replaces the number-only track_order() flow. Requires BOTH the
-- friendly order number and the secret tracking key, rate-limits wrong
-- attempts, and returns status only (never personal data).
--
-- Idempotent: safe to re-run.
-- ============================================================
begin;

-- a friendly number must never work alone
drop function if exists track_order(text);

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
  v_cnt    int;
  v_ip     text := client_ip_hash();
  v_action text;
begin
  -- missing input -> same generic message (no enumeration)
  if length(trim(coalesce(p_order_number, ''))) = 0
     or length(trim(coalesce(p_tracking_key, ''))) = 0 then
    return jsonb_build_object('ok', false, 'message', 'مفتاح التتبع مش مطابق لهذا الطلب');
  end if;

  -- only LB-<digits> gets its own bucket; everything else shares one
  if p_order_number ~ '^LB-[0-9]+$' then
    v_action := 'track_wrong_' || p_order_number;
  else
    v_action := 'track_wrong_invalid';
  end if;

  -- temporary lockout after repeated wrong attempts within the window
  select count(*) into v_cnt
  from rate_log
  where ip_hash = v_ip
    and action = v_action
    and created_at > now() - interval '1 hour';

  if v_cnt >= 5 then
    raise exception
      'محاولات تتبع خاطئة كثيرة — تم قفل تتبع هذا الطلب مؤقتًا. جرب لاحقًا بعد ساعة.'
      using errcode = 'P0001';
  end if;

  -- verify order exists AND key matches (one generic failure message)
  if not exists (
    select 1 from orders
    where order_number = p_order_number
      and tracking_key::text = p_tracking_key
  ) then
    insert into rate_log (ip_hash, action) values (v_ip, v_action);
    return jsonb_build_object('ok', false, 'message', 'مفتاح التتبع مش مطابق لهذا الطلب');
  end if;

  -- status only, from the public mirror
  return jsonb_build_object(
    'ok', true,
    'order_number', p_order_number,
    'status', (select status from order_status_public where order_number = p_order_number),
    'updated_at', (select updated_at from order_status_public where order_number = p_order_number)
  );
end $fn$;

grant execute on function track_order_by_key(text, text) to anon;

commit;
