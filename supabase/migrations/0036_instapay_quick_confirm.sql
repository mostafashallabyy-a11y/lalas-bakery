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
