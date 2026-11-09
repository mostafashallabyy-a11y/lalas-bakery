-- ============================================================
-- Lala's Bakery — Phase 4: Staff POS + Cash Drawer / Shifts (0009_staff_pos_shifts.sql)
-- ============================================================
-- Adds:
--   * shifts table: staff opens/closes shift with opening/expected/counted cash
--   * void_requests table: staff requests void, manager approves
--   * RPCs: pos_create_order, shift_open, shift_close, void_request, void_approve, shift_reopen, staff_get_open_shift
--   * Rate limits on sensitive RPCs
-- ============================================================
begin;

-- ---- 1) Shifts table ----
create table if not exists shifts (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references auth.users(id) on delete restrict,
  branch_id    uuid not null references branches(id) on delete restrict,
  opening_cash numeric(10,2) not null check (opening_cash >= 0),
  closing_cash numeric(10,2),
  counted_cash numeric(10,2),
  difference   numeric(10,2),
  note         text default '' check (char_length(note) <= 300),
  status       text not null default 'open' check (status in ('open','closed','reopened')),
  opened_at    timestamptz not null default now(),
  closed_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index shifts_staff_idx on shifts(staff_id, created_at desc);
create index shifts_branch_idx on shifts(branch_id, created_at desc);

-- ---- 2) Void requests table ----
create table if not exists void_requests (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete restrict,
  staff_id      uuid not null references auth.users(id) on delete restrict,
  reason        text not null check (char_length(reason) between 3 and 300),
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  approved_by   uuid references auth.users(id) on delete set null,
  approved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index void_requests_staff_idx on void_requests(staff_id, created_at desc);
create index void_requests_status_idx on void_requests(status, created_at desc);

-- ---- 3) RLS on shifts ----
alter table shifts enable row level security; alter table shifts force row level security;
create policy shifts_staff_own on shifts for all to authenticated
  using (auth.uid() = staff_id) with check (auth.uid() = staff_id);
create policy shifts_manager_all on shifts for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---- 4) RLS on void_requests ----
alter table void_requests enable row level security; alter table void_requests force row level security;
create policy void_requests_staff_own on void_requests for all to authenticated
  using (auth.uid() = staff_id) with check (auth.uid() = staff_id);
create policy void_requests_manager_all on void_requests for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---- 5) RPC: pos_create_order (staff, server-priced, source='pos') ----
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
begin
  if not is_staff() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  if p_payment_method not in ('cash','instapay') then
    raise exception 'طريقة دفع غير صحيحة' using errcode = 'P0001';
  end if;

  v_name := btrim(coalesce(p_customer_name,''));
  if char_length(v_name) > 60 then
    raise exception 'الاسم طويل زيادة عن اللزوم' using errcode = 'P0001';
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
  values (v_branch.id, coalesce(v_name, 'عميل فرع'), p_delivery_type, v_fee, 'pos', true, auth.uid())
  returning id, order_number into v_oid, v_num;

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

  insert into order_events (order_id, event_type, new_status, changed_by, note)
  values (v_oid, 'created', 'received', auth.uid(), coalesce(p_staff_note, ''));

  return jsonb_build_object(
    'ok', true,
    'order_number', v_num,
    'order_id', v_oid,
    'total', v_sub + v_fee,
    'status', 'received',
    'source', 'pos'
  );
end $$;
grant execute on function pos_create_order(uuid, jsonb, text, text, text, text) to authenticated;

-- ---- 6) RPC: shift_open ----
create or replace function shift_open(
  p_branch_id uuid,
  p_opening_cash numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open shifts;
  v_existing shifts;
begin
  if not is_staff() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  if not rate_ok('shift_open', 5, interval '1 hour') then
    raise exception 'لقد فتحت ورديات كثيرة — استنى شوية وحاول تاني' using errcode = 'P0001';
  end if;

  select * into v_existing from shifts
  where staff_id = auth.uid() and status = 'open'
  limit 1;
  if found then
    return jsonb_build_object('ok', false, 'message', 'لديك فترة عمل مفتوحة بالفعل — أغلقها أولًا');
  end if;

  insert into shifts (staff_id, branch_id, opening_cash, status)
  values (auth.uid(), p_branch_id, p_opening_cash, 'open')
  returning * into v_open;

  return jsonb_build_object('ok', true, 'shift_id', v_open.id, 'opened_at', v_open.opened_at);
end $$;
grant execute on function shift_open(uuid, numeric) to authenticated;

-- ---- 7) RPC: shift_close ----
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
  v_expected numeric(10,2);
  v_diff numeric(10,2);
begin
  if not is_staff() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  select * into v_shift from shifts where id = p_shift_id;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'الفترة مش موجودة');
  end if;
  if v_shift.staff_id <> auth.uid() then
    raise exception 'هذه الفترة ليست خاصتك' using errcode = '42501';
  end if;
  if v_shift.status <> 'open' then
    return jsonb_build_object('ok', false, 'message', 'الفترة مغلقة بالفعل');
  end if;

  select coalesce(sum(o.total),0) into v_expected
  from orders o
  where o.branch_id = v_shift.branch_id
    and o.source = 'pos'
    and o.payment_confirmed = true
    and o.created_at >= v_shift.opened_at
    and o.created_at <= coalesce(v_shift.closed_at, now());

  v_diff := p_counted_cash - v_expected;

  update shifts
  set closing_cash = v_expected,
      counted_cash = p_counted_cash,
      difference = v_diff,
      note = coalesce(btrim(coalesce(p_note,'')),''),
      status = 'closed',
      closed_at = now()
  where id = p_shift_id;

  return jsonb_build_object(
    'ok', true,
    'expected_cash', v_expected,
    'counted_cash', p_counted_cash,
    'difference', v_diff
  );
end $$;
grant execute on function shift_close(uuid, numeric, text) to authenticated;

-- ---- 8) RPC: void_request ----
create or replace function void_request(
  p_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
  v_existing void_requests;
begin
  if not is_staff() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  select * into v_order from orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'الطلب مش موجود');
  end if;

  select * into v_existing from void_requests
  where order_id = p_order_id and status = 'pending'
  limit 1;
  if found then
    return jsonb_build_object('ok', false, 'message', 'يوجد بالفعل طلب إلغاء معلق لهذا الطلب');
  end if;

  insert into void_requests (order_id, staff_id, reason, status)
  values (p_order_id, auth.uid(), p_reason, 'pending');

  return jsonb_build_object('ok', true, 'message', 'تم إرسال طلب الإلغاء للموافقة');
end $$;
grant execute on function void_request(uuid, text) to authenticated;

-- ---- 9) RPC: void_approve (manager only) ----
create or replace function void_approve(
  p_void_id uuid,
  p_approved boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_void void_requests;
  v_order orders;
begin
  if not is_manager() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  select * into v_void from void_requests where id = p_void_id;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'طلب الإلغاء مش موجود');
  end if;
  if v_void.status <> 'pending' then
    return jsonb_build_object('ok', false, 'message', 'طلب الإلغاء تم النظر فيه بالفعل');
  end if;

  update void_requests
  set status = case when p_approved then 'approved' else 'rejected' end,
      approved_by = auth.uid(),
      approved_at = now()
  where id = p_void_id;

  if p_approved then
    select * into v_order from orders where id = v_void.order_id;
    update orders set status = 'done' where id = v_void.order_id;
    insert into order_events (order_id, event_type, old_status, new_status, changed_by, note)
    values (v_void.order_id, 'status_changed', v_order.status, 'done', auth.uid(), coalesce(btrim(coalesce(p_note,'')),'تم إلغاء الطلب'));
  end if;

  return jsonb_build_object('ok', true, 'approved', p_approved);
end $$;
grant execute on function void_approve(uuid, boolean, text) to authenticated;

-- ---- 10) RPC: shift_reopen (manager only) ----
create or replace function shift_reopen(
  p_shift_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift shifts;
begin
  if not is_manager() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  select * into v_shift from shifts where id = p_shift_id;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'الفترة مش موجودة');
  end if;
  if v_shift.status = 'open' then
    return jsonb_build_object('ok', false, 'message', 'الفترة مفتوحة أصلًا');
  end if;

  update shifts
  set status = 'reopened',
      closed_at = null
  where id = p_shift_id;

  return jsonb_build_object('ok', true, 'message', 'تم إعادة فتح الفترة');
end $$;
grant execute on function shift_reopen(uuid) to authenticated;

-- ---- 11) RPC: staff_get_open_shift ----
create or replace function staff_get_open_shift()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift shifts;
begin
  if not is_staff() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  select * into v_shift from shifts
  where staff_id = auth.uid() and status = 'open'
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'لا توجد فترة عمل مفتوحة');
  end if;

  return jsonb_build_object('ok', true, 'shift_id', v_shift.id, 'opened_at', v_shift.opened_at, 'opening_cash', v_shift.opening_cash);
end $$;
grant execute on function staff_get_open_shift() to authenticated;

-- ---- 12) Grants ----
grant all on shifts to authenticated;
grant all on void_requests to authenticated;

commit;