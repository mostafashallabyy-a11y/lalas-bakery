-- ============================================================
-- Lala's Bakery — 0015: submit_order_v2 with stock check/decrement.
-- Replaces the 0005 version (same 5-argument signature, so PostgREST
-- still matches the Checkout page call) — no new overload is created.
-- Improvements over the old body:
--   * one row lock per product (was locked twice)
--   * low-stock alert only when stock CROSSES the threshold
--   * sale movement carries order_id for audit
-- ============================================================
begin;

create or replace function submit_order_v2(
  p_branch_id uuid,
  p_items jsonb,
  p_delivery_type text,
  p_customer_name text,
  p_turnstile_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_name text;
  v_branch branches;
  v_fee numeric(10,2);
  v_raw jsonb;
  v_pid uuid;
  v_qty int;
  v_prod products;
  v_count int := 0;
  v_sub numeric(10,2) := 0;
  v_oid uuid;
  v_num text;
  v_key uuid;
begin
  if p_turnstile_token::text is null then p_turnstile_token := null; end if;
  perform verify_turnstile(p_turnstile_token, 'order');

  if not rate_ok('order', 5, interval '30 minutes') then
    raise exception 'لقد تركت طلبات كثيرة في وقت قصير — استنى شوية وحاول تاني بعد قليل ❤️' using errcode = 'P0001';
  end if;

  v_name := regexp_replace(coalesce(p_customer_name,''), '\s+', ' ', 'g');
  v_name := btrim(v_name);
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'اكتب اسمك من ٢ لحروف ٦٠ حروف' using errcode = 'P0001';
  end if;

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

  insert into orders (branch_id, customer_name, delivery_type, delivery_fee, source, payment_confirmed, created_by)
  values (v_branch.id, v_name, p_delivery_type, v_fee, 'online', false, auth.uid())
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
    raise exception 'طلبيتك فاضة — اختار من المنيو الأول' using errcode = 'P0001';
  end if;

  update orders set subtotal = v_sub, total = v_sub + v_fee where id = v_oid;

  insert into order_events (order_id, event_type, new_status, changed_by, note)
  values (v_oid, 'created', 'received', auth.uid(), '');

  return jsonb_build_object(
    'ok', true,
    'order_number', v_num,
    'order_id', v_oid,
    'tracking_key', v_key,
    'branch_name', v_branch.name,
    'subtotal', v_sub,
    'delivery_fee', v_fee,
    'total', v_sub + v_fee,
    'status', 'received'
  );
end $fn$;
grant execute on function submit_order_v2(uuid, jsonb, text, text, text) to authenticated;

commit;
