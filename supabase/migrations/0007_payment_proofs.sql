-- ============================================================
-- Lala's Bakery — Phase 2: InstaPay proof upload (0007_payment_proofs.sql)
-- ============================================================
-- Adds:
--   * orders.source ('online'|'pos') and orders.payment_proof_path
--   * private storage bucket 'payment-proofs' (anon INSERT only, jpg/png/webp, <= 3 MB)
--   * RPC upload_payment_proof (verifies number + tracking key, stores path)
--   * RPC confirm_payment / reject_payment (staff/manager only)
--   * DB trigger: an online order cannot move to 'preparing' before payment_confirmed
-- ============================================================
begin;

-- ---- 1) source + payment_proof_path columns on orders ----
alter table orders add column if not exists source text not null default 'online' check (source in ('online','pos'));
alter table orders add column if not exists payment_proof_path text;

-- ---- 2) Private storage bucket 'payment-proofs' ----
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do nothing;

-- ---- 3) Storage policies: anon INSERT only (no select/list/update/delete) ----
--    Allowed mimes: jpg/png/webp. Max size: 3 MB (3145728 bytes).
--    Path must look like: <order_id>/<random>.<ext>
create policy storage_payment_proofs_insert on storage.objects for insert to anon
  with check (
    bucket_id = 'payment-proofs'
    and length(coalesce(name, '')) > 0
    and (metadata->>'mimetype') in ('image/jpeg','image/png','image/webp')
    and coalesce((metadata->>'size')::bigint, 0) <= 3145728
    and name ~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.(jpg|jpeg|png|webp)$'
  );

-- Deny everything else for anon on this bucket
create policy storage_payment_proofs_deny_all_other on storage.objects for all to anon
  using (false) with check (false);

-- Staff/manager read via signed URLs only (no direct select)
create policy storage_payment_proofs_staff_select on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and is_staff());

-- ---- 4) Rate limit for proof uploads ----
--    (uses existing rate_ok() helper from 0002)

-- ---- 5) RPC: upload_payment_proof (anon, verifies number + tracking key) ----
create or replace function upload_payment_proof(
  p_order_number text,
  p_tracking_key text,
  p_path text
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
    return jsonb_build_object('ok', false, 'message', 'بيانات ناقصة');
  end if;

  -- rate limit: max 10 proof uploads per hour per IP
  if not rate_ok('payment_proof', 10, interval '1 hour') then
    raise exception 'لقد أرسلت إثباتات دفع كثيرة — استنى شوية وحاول تاني بعد قليل ❤️' using errcode = 'P0001';
  end if;

  select * into v_order from orders
  where order_number = p_order_number
    and tracking_key::text = p_tracking_key;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'مفتاح التتبع مش مطابق لهذا الطلب');
  end if;

  -- validate path format + bucket
  if p_path !~ '^payment-proofs/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\.(jpg|jpeg|png|webp)$' then
    return jsonb_build_object('ok', false, 'message', 'مسار الملف غير صالح');
  end if;

  update orders
  set payment_proof_path = p_path
  where id = v_order.id;

  return jsonb_build_object('ok', true, 'path', p_path);
end $$;
grant execute on function upload_payment_proof(text, text, text) to anon;

-- ---- 6) RPC: confirm_payment (staff/manager) ----
create or replace function confirm_payment(
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
  if not is_staff() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  select * into v_order from orders
  where order_number = p_order_number
    and tracking_key::text = p_tracking_key;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'مفتاح التتبع مش مطابق لهذا الطلب');
  end if;

  if v_order.payment_proof_path is null then
    return jsonb_build_object('ok', false, 'message', 'مفيش إثبات تحويل للطلب ده');
  end if;

  update orders set payment_confirmed = true where id = v_order.id;

  insert into order_events (order_id, event_type, changed_by, note)
  values (v_order.id, 'payment_confirmed', auth.uid(), 'تأكيد الدفع من الموظف');

  return jsonb_build_object('ok', true, 'payment_confirmed', true);
end $$;
grant execute on function confirm_payment(text, text) to authenticated;

-- ---- 7) RPC: reject_payment (staff/manager) ----
create or replace function reject_payment(
  p_order_number text,
  p_tracking_key text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
begin
  if not is_staff() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  select * into v_order from orders
  where order_number = p_order_number
    and tracking_key::text = p_tracking_key;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'مفتاح التتبع مش مطابق لهذا الطلب');
  end if;

  update orders
  set payment_confirmed = false,
      payment_proof_path = null
  where id = v_order.id;

  insert into order_events (order_id, event_type, changed_by, note)
  values (
    v_order.id,
    'payment_rejected',
    auth.uid(),
    coalesce(nullif(btrim(coalesce(p_reason,'')),''), 'الصورة غير واضحة')
  );

  return jsonb_build_object('ok', true, 'payment_confirmed', false);
end $$;
grant execute on function reject_payment(text, text, text) to authenticated;

-- ---- 7b) Staff RPCs by order_id (staff screen operates on order_id) ----
create or replace function staff_confirm_payment(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
begin
  if not is_staff() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  select * into v_order from orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'الطلب مش موجود');
  end if;

  if v_order.source = 'online' and v_order.payment_proof_path is null then
    return jsonb_build_object('ok', false, 'message', 'مفيش إثبات تحويل للطلب ده');
  end if;

  update orders set payment_confirmed = true where id = v_order.id;

  insert into order_events (order_id, event_type, changed_by, note)
  values (v_order.id, 'payment_confirmed', auth.uid(), 'تأكيد الدفع من الموظف');

  return jsonb_build_object('ok', true, 'payment_confirmed', true);
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
begin
  if not is_staff() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  select * into v_order from orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'الطلب مش موجود');
  end if;

  update orders
  set payment_confirmed = false,
      payment_proof_path = null
  where id = v_order.id;

  insert into order_events (order_id, event_type, changed_by, note)
  values (
    v_order.id,
    'payment_rejected',
    auth.uid(),
    coalesce(nullif(btrim(coalesce(p_reason,'')),''), 'الصورة غير واضحة')
  );

  return jsonb_build_object('ok', true, 'payment_confirmed', false);
end $$;
grant execute on function staff_reject_payment(uuid, text) to authenticated;

-- ---- 8) DB enforcement: online order cannot move to 'preparing' before payment_confirmed ----
create or replace function enforce_payment_before_preparing()
returns trigger language plpgsql security definer as $$
begin
  if new.source = 'online'
     and new.status = 'preparing'
     and (old.status is distinct from new.status)
     and not new.payment_confirmed then
    raise exception 'لا يمكن نقل طلب أونلاين إلى "جاري التحضير" قبل تأكيد الدفع' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists orders_enforce_payment on orders;
create trigger orders_enforce_payment
  before update of status, source, payment_confirmed on orders
  for each row execute function enforce_payment_before_preparing();

commit;