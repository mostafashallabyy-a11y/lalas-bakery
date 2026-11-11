-- ============================================================
-- Lala's Bakery - 0024: payment info requires order number + key
-- ============================================================
-- The old 1-argument get_payment_info(text) leaked total/status/branch
-- for any order number and is dropped in 0022. This 2-argument version
-- only answers when the secret tracking key also matches, and is
-- rate-limited per IP.
--
-- Idempotent: safe to re-run.
-- ============================================================
begin;

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
    'created_at', o.created_at
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

commit;
