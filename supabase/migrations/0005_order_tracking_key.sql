-- ============================================================
-- Lala's Bakery — Phase 1: Order tracking key (0005_order_tracking_key.sql)
-- ============================================================
-- Add tracking_key to orders so every order gets a random 8+ char key
-- that customers use to prove ownership without exposing sequential numbers.
-- Also adds a trigger to auto-generate the key on insert.
-- ============================================================
begin;

-- ---- 1) إضافة عمود tracking_key للأوامر ----
-- uuid ensures randomness + uniqueness; default generates a new uuid on insert
alter table orders add column if not exists tracking_key uuid unique;

-- ---- 2) trigger: لو RPC_insert مش بينزل المفتاح يقوم generating واحد ----
create or replace function orders_set_tracking_key()
returns trigger language plpgsql security definer as $$
begin
  if new.tracking_key is null then
    new.tracking_key := gen_random_uuid();
  end if;
  return new;
end $$;

drop trigger if exists orders_tracking_key_trigger on orders;
create trigger orders_tracking_key_trigger
  before insert on orders
  for each row execute function orders_set_tracking_key();

-- ---- 3) Public RPC: track_order_by_key (returns STATUS ONLY, never personal data) ----
-- هذا الرابط الجديد يقبل رقم الطلب + المفتاح ويعطي الحالة ديالو فقط
create or replace function track_order_by_key(p_order_number text, p_tracking_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row order_status_public;
begin
  -- input sanity
  if length(trim(btrim(p_order_number))) = 0 or length(trim(btrim(p_tracking_key))) = 0 then
    return jsonb_build_object('ok', false, 'message', 'بيانات ناقصة');
  end if;

  -- verify order exists and key matches (simple equality, no expose of personal data)
  if not exists (
    select 1 from orders
    where order_number = p_order_number
      and tracking_key::text = p_tracking_key
  ) then
    return jsonb_build_object('ok', false, 'message', 'مفتاح التتبع مش مطابق لهذا الطلب');
  end if;

  -- استرجاع الحالة من الطاولة العامة (status only)
  select * into v_row from order_status_public where order_number = p_order_number;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'مفيش حالة للدهر');
  end if;
  return jsonb_build_object(
    'ok', true,
    'order_number', v_row.order_number,
    'status', v_row.status,
    'updated_at', v_row.updated_at
  );
end $$;
grant execute on function track_order_by_key(text, text) to anon;

-- ---- 4) Public RPC: get_order_tracking_key ----
-- يرجع مفتاح التتبع لطلب معين (يستخدم بعد submit_order لضبط الرابط)
create or replace function get_order_tracking_key(p_order_number text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from orders where order_number = p_order_number) then
    return null;
  end if;
  return (select tracking_key::text from orders where order_number = p_order_number);
end $$;
grant execute on function get_order_tracking_key(text) to anon;

-- ---- 5) Public RPC: submit_order_v2 ----
-- نسخة مطوَّر من submit_order بإضافة tracking_key للنتيجة finale
-- (يُستخدم بدلاً من القديمة لضمان إرجاع المفتاح للعملاء)
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
as $$
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

  -- clean + validate name
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

  -- items: jsonb array of {product_id, qty}
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'طلبيتك فاضية — اختار من المنيو الأول' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then
    raise exception 'طلبيتك فاضية أو أكبر من اللازم' using errcode = 'P0001';
  end if;

  -- create the order shell
  insert into orders (branch_id, customer_name, delivery_type, delivery_fee, created_by)
  values (v_branch.id, v_name, p_delivery_type, v_fee, auth.uid())
  returning id, order_number, tracking_key into v_oid, v_num, v_key;

  -- validate each item against REAL prices
  for v_raw in select * from jsonb_array_elements(p_items) loop
    if v_raw->>'product_id' is null or v_raw->>'qty' is null then
      raise exception 'فيه حاجة غلط في الطلب' using errcode = 'P0001';
    end if;
    v_pid := v_raw->>'product_id';
    if v_raw->>'qty' !~ '^[0-9]{1,2}$' then
      raise exception 'الكمية غير صحيحة' using errcode = 'P0001';
    end if;
    v_qty := (v_raw->>'qty')::int;
    if v_qty < 1 or v_qty > 30 then
      raise exception 'أقل كمية ١ وأكبر كمية ٣٠ للمنتج الواحد' using errcode = 'P0001';
    end if;
    select * into v_prod from products p
    where p.id = v_pid and p.is_active and p.branch_id = v_branch.id;
    if not found then
      raise exception 'واحد من المنتجات مش متاح في الفرع ده — حدّث الصفحة' using errcode = 'P0001';
    end if;

    insert into order_items (order_id, product_id, name_snapshot, unit_price, qty, line_total)
    values (v_oid, v_prod.id, v_prod.name, v_prod.price, v_qty, (v_prod.price * v_qty));

    v_sub := v_sub + (v_prod.price * v_qty);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'طلبيتك فاضية — اختار من المنيو الأول' using errcode = 'P0001';
  end if;

  update orders set subtotal = v_sub, total = v_sub + v_fee where id = v_oid;

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
end $$;

grant execute on function submit_order_v2(uuid, jsonb, text, text, text) to anon;

commit;