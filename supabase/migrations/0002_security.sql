-- ============================================================
-- Lala's Bakery — Phase 1: security (0002_security.sql)
-- RLS on EVERY table + public RPC functions + manager report
-- Run AFTER 0001_init.sql
-- ============================================================
begin;

-- ============================================================
-- 1. RLS everywhere (default deny)
-- ============================================================
alter table branches enable row level security; alter table branches force row level security;
alter table categories enable row level security; alter table categories force row level security;
alter table products enable row level security; alter table products force row level security;
alter table orders enable row level security; alter table orders force row level security;
alter table order_items enable row level security; alter table order_items force row level security;
alter table order_events enable row level security; alter table order_events force row level security;
alter table order_status_public enable row level security; alter table order_status_public force row level security;
alter table feedback enable row level security; alter table feedback force row level security;
alter table profiles enable row level security; alter table profiles force row level security;
alter table settings enable row level security; alter table settings force row level security;
alter table rate_log enable row level security; alter table rate_log force row level security;

-- ---------- branches ----------
create policy branches_read on branches for select
  to anon, authenticated using (is_active or is_manager());
create policy branches_manage on branches for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---------- categories ----------
create policy categories_read on categories for select
  to anon, authenticated using (is_active or is_manager());
create policy categories_manage on categories for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---------- products ----------
create policy products_read on products for select
  to anon, authenticated using (is_active or is_manager());
create policy products_manage on products for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---------- orders : staff read only (no anon select -- data privacy) ----------
create policy orders_staff_read on orders for select
  to authenticated using (is_staff());
create policy orders_manage on orders for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---------- order_items ----------
create policy order_items_staff_read on order_items for select
  to authenticated using (is_staff() or is_manager());
create policy order_items_manage on order_items for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---------- order_events : audit ----------
create policy order_events_staff_read on order_events for select
  to authenticated using (is_staff() or is_manager());
create policy order_events_manage on order_events for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---------- order_status_public : status ONLY, everyone can read ----------
create policy order_status_public_read on order_status_public for select
  to anon, authenticated using (true);

-- ---------- feedback : manager only ----------
create policy feedback_manager on feedback for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---------- profiles ----------
create policy profiles_self_read on profiles for select to authenticated
  using (id = auth.uid());
create policy profiles_staff_read on profiles for select to authenticated
  using (is_staff());
create policy profiles_self_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_manager_all on profiles for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---------- settings : instapay_number is public; other keys staff/manager ----------
create policy settings_read_public on settings for select
  to anon, authenticated using (key = 'instapay_number');
create policy settings_read_staff on settings for select to authenticated
  using (key like 'instapay%' or key like 'delivery_fee%');
create policy settings_manager_all on settings for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---------- rate_log : manager read only, inserts happen inside RPCs ----------
create policy rate_log_manager_read on rate_log for select to authenticated
  using (is_manager());

-- ============================================================
-- 2. Storage policies (products bucket)
-- ============================================================
create policy storage_products_read on storage.objects for select
  to anon, authenticated using (bucket_id = 'products');

create policy storage_products_write on storage.objects for all to authenticated
  using (bucket_id = 'products' and is_manager())
  with check (bucket_id = 'products' and is_manager());

-- ============================================================
-- 3. Server-side Turnstile verification (optional; uses pg_net)
--    Skipped gracefully when no secret is stored in settings
-- ============================================================
create or replace function verify_turnstile(p_token text, p_action text default null)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret  text;
  v_url     text := 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
  v_req_id  bigint;
  v_content text;
  v_success text;
  v_tries   int := 0;
begin
  select s.value into v_secret from settings s where s.key = 'turnstile_secret';
  if coalesce(v_secret, '') = '' then
    -- not configured yet (e.g. local dev) — DB-level rate limits still apply
    return true;
  end if;

  if p_token is null or length(btrim(p_token)) = 0 or length(p_token) > 2048 then
    raise exception 'يرجى التحقق أنك مش روبوت قبل الحفظ' using errcode = 'P0001';
  end if;

  if to_regclass('extensions.net.http_post') is null then
    raise warning 'pg_net missing — skipping Turnstile verification';
    return true;
  end if;

  v_req_id := net.http_post(
    v_url,
    jsonb_build_object('secret', v_secret, 'response', p_token)::text,
    '[{"name":"Content-Type","value":"application/json"}]'::jsonb
  );

  -- wait up to ~4s for the async pg_net response
  loop
    v_content := null;
    select r.response ->> 'content' into v_content
    from extensions.net._http_response r
    where r.id = v_req_id;
    exit when v_content is not null or v_tries >= 40;
    v_tries := v_tries + 1;
    perform pg_sleep(0.1);
  end loop;

  if v_content is not null then
    begin
      v_success := (v_content::jsonb ->> 'success');
    exception when others then v_success := null;
    end;
  end if;

  if coalesce(v_success, '') <> 'true' then
    raise exception 'فشل التحقق من روبوت — جرب تاني' using errcode = 'P0001';
  end if;
  return true;
end $$;

-- ============================================================
-- 4. Rate limit helper (DB-level limit; IP hashed)
-- ============================================================
create or replace function client_ip_hash() returns text
language plpgsql stable
as $$
declare
  v_ip text;
begin
  begin
    v_ip := coalesce(
      current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''
    );
  exception when others then v_ip := '';
  end;
  return md5(coalesce(btrim(v_ip), 'unknown'));
end $$;

create or replace function rate_ok(p_action text, p_max int, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := client_ip_hash();
  v_count int;
begin
  select count(*) into v_count
  from rate_log
  where ip_hash = v_hash and action = p_action and created_at > now() - p_window;

  if v_count >= p_max then
    return false;
  end if;

  insert into rate_log (ip_hash, action) values (v_hash, p_action);

  -- opportunistic cleanup
  if random() < 0.05 then
    delete from rate_log where created_at < now() - interval '2 days';
  end if;
  return true;
end $$;

-- ============================================================
-- 5. Public RPC: create order (price verified server-side!)
-- ============================================================
create or replace function submit_order(
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
  returning id, order_number into v_oid, v_num;

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
    'branch_name', v_branch.name,
    'subtotal', v_sub,
    'delivery_fee', v_fee,
    'total', v_sub + v_fee,
    'status', 'received'
  );
end $$;

-- ============================================================
-- 6. Public RPC: feedback (validated, rate-limited)
-- ============================================================
create or replace function submit_feedback(
  p_message text,
  p_name text default null,
  p_contact text default null,
  p_turnstile_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg text;
  v_name text;
  v_contact text;
begin
  perform verify_turnstile(p_turnstile_token, 'feedback');

  if not rate_ok('feedback', 3, interval '1 hour') then
    raise exception 'رسالتك وصلتنا قبل كده ❤️ استنى شوية قبل ما تبعت تاني' using errcode = 'P0001';
  end if;

  v_msg := btrim(coalesce(p_message, ''));
  if char_length(v_msg) < 3 or char_length(v_msg) > 1000 then
    raise exception 'اكتب رسالتك من ٣ لحد ١٠٠٠ حرف' using errcode = 'P0001';
  end if;

  v_name := nullif(btrim(coalesce(p_name,'')), '');
  if char_length(v_name) > 60 then
    raise exception 'الاسم طويل زيادة عن اللزوم' using errcode = 'P0001';
  end if;

  v_contact := nullif(btrim(coalesce(p_contact,'')), '');
  if char_length(v_contact) > 80 then
    raise exception 'بيانات التواصل طويلة زيادة عن اللزوم' using errcode = 'P0001';
  end if;

  insert into feedback (message, name, contact) values (v_msg, v_name, v_contact);
  return jsonb_build_object('ok', true, 'message', 'رسالتك وصلت لقلبتنا ❤️ شكراً إنك بتساعدنا نتطور');
end $$;

-- ============================================================
-- 7. Public RPC: track order (returns STATUS ONLY, never names)
-- ============================================================
create or replace function track_order(p_order_number text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_num text := btrim(coalesce(p_order_number,''));
  v_row order_status_public;
begin
  select * into v_row from order_status_public where order_number = v_num;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'مش لاقيين رقم الطلب ده — اتأكد أنه زي LB-1001');
  end if;
  return jsonb_build_object(
    'ok', true,
    'order_number', v_row.order_number,
    'status', v_row.status,
    'updated_at', v_row.updated_at
  );
end $$;

-- ============================================================
-- 7b. Public RPC: payment info for the payer (order_number + total +
--     status + branch ONLY — never customer name/phone)
-- ============================================================
create or replace function get_payment_info(p_order_number text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_num text := btrim(coalesce(p_order_number,''));
  v_out  jsonb;
begin
  if not rate_ok('payment_info', 30, interval '1 hour') then
    raise exception 'طلبات كثيرة زيادة — استنى شوية' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'ok', true,
    'order_number', o.order_number,
    'total', o.total,
    'status', o.status::text,
    'branch_name', b.name,
    'created_at', o.created_at
  ) into v_out
  from orders o join branches b on b.id = o.branch_id
  where o.order_number = v_num;

  if v_out is null then
    raise exception 'مش لاقيين رقم الطلب ده — اتأكد منه تاني ❤️' using errcode = 'P0001';
  end if;
  return v_out;
end $$;

-- ============================================================
-- 8. Staff RPCs (authenticated + active profile required)
-- ============================================================
create or replace function staff_set_status(p_order_id uuid, p_new_status order_status)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old order_status;
begin
  if not is_staff() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  select status into v_old from orders where id = p_order_id for update;
  if not found then
    raise exception 'الطلب مش موجود' using errcode = 'P0001';
  end if;

  if v_old = 'done' then
    raise exception 'الطلب خلص خلاص — مفيش رجوع لورا' using errcode = 'P0001';
  end if;

  if p_new_status not in ('received','preparing','done') then
    raise exception 'حالة غير معروفة' using errcode = 'P0001';
  end if;

  update orders set status = p_new_status where id = p_order_id;

  insert into order_events (order_id, event_type, old_status, new_status, changed_by, note)
  values (p_order_id, 'status_changed', v_old, p_new_status, auth.uid(), '');

  return jsonb_build_object('ok', true, 'status', p_new_status);
end $$;

create or replace function staff_set_payment(p_order_id uuid, p_confirmed boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_staff() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  if not exists (select 1 from orders where id = p_order_id) then
    raise exception 'الطلب مش موجود' using errcode = 'P0001';
  end if;

  update orders set payment_confirmed = p_confirmed where id = p_order_id and payment_confirmed <> p_confirmed;
  if found then
    insert into order_events (order_id, event_type, changed_by, note)
    values (
      p_order_id,
      case when p_confirmed then 'payment_confirmed' else 'payment_rejected' end,
      auth.uid(),
      ''
    );
  end if;
  return jsonb_build_object('ok', true, 'payment_confirmed', p_confirmed);
end $$;

-- ============================================================
-- 9. Bootstrap: promote the VERY FIRST manager (guarded)
--    Only callable while NO active manager exists.
--    Disable public signups in Dashboard > Auth before using.
-- ============================================================
create or replace function promote_first_manager(p_email citext)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from profiles where role = 'manager' and is_active) then
    raise exception 'موجود مدير للموقع بالفعل — العملية دي مقفولة' using errcode = '42501';
  end if;

  update profiles
    set role = 'manager', is_active = true
    where email = p_email and is_active = false;

  if not found then
    raise exception 'مفيش حساب بالبريد ده — اعمله الأول من Dashboard > Auth' using errcode = 'P0001';
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- ============================================================
-- 10. Manager report (sales / per day / branch / staff / prep time)
-- ============================================================
create or replace function manager_report(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if not is_manager() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  with period as (select p_from::timestamptz as f, p_to::timestamptz + interval '1 day' as t)
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'orders_count', count(*),
        'revenue', coalesce(sum(total),0),
        'paid_count', count(*) filter (where payment_confirmed),
        'avg_order', coalesce(avg(total),0)
      ) from orders, period where created_at >= period.f and created_at < period.t
    ),
    'per_day', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select created_at::date as day,
               count(*) as orders_count,
               coalesce(sum(total),0) as revenue
        from orders, period
        where created_at >= period.f and created_at < period.t
        group by 1 order by 1
      ) x
    ),
    'per_branch', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select b.name as branch, count(o.id) as orders_count,
               coalesce(sum(o.total),0) as revenue
        from orders o, period
        join branches b on b.id = o.branch_id
        where o.created_at >= period.f and o.created_at < period.t
        group by b.name order by revenue desc
      ) x
    ),
    'per_staff', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select p.full_name, p.email,
               count(distinct e.order_id) filter (where e.event_type = 'status_changed') as orders_handled,
               (select round(avg(extract(epoch from (e2.created_at - o2.created_at))) / 60.0, 1)
                from order_events e2
                join orders o2 on o2.id = e2.order_id
                where e2.changed_by = p.id and e2.event_type = 'status_changed' and e2.new_status = 'done'
                ) as avg_prep_minutes
        from order_events e, period
        join profiles p on p.id = e.changed_by
        where e.created_at >= period.f and e.created_at < period.t
        group by p.id, p.full_name, p.email
        order by orders_handled desc
      ) x
    ),
    'top_products', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select i.name_snapshot as product, sum(i.qty) as qty, coalesce(sum(i.line_total),0) as revenue
        from order_items i, period
        join orders o on o.id = i.order_id
        where o.created_at >= period.f and o.created_at < period.t
        group by 1 order by qty desc limit 10
      ) x
    )
  ) into v_out from period;

  return v_out;
end $$;

-- ============================================================
-- 11. Grants: only RPCs exposed, everything else via RLS policies
-- ============================================================
grant execute on function submit_feedback(text, text, text, text) to anon;
grant execute on function track_order(text) to anon;
grant execute on function get_payment_info(text) to anon;

revoke execute on function manager_report(date, date) from anon, authenticated;
grant execute on function manager_report(date, date) to authenticated;
grant execute on function promote_first_manager(citext) to anon, authenticated;
grant execute on function staff_set_status(uuid, order_status) to authenticated;
grant execute on function staff_set_payment(uuid, boolean) to authenticated;

revoke all on table rate_log from anon, authenticated;
revoke all on table order_status_public from anon, authenticated;

commit;
