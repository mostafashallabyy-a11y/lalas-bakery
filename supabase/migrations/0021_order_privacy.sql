-- ============================================================
-- Lala's Bakery — Part B: Order privacy (0021_order_privacy.sql)
-- ============================================================
-- Hardening so nobody can browse/list orders except:
--   (1) the customer who placed it, via order_number + tracking_key (RPC only),
--   (2) staff of that branch (RLS by profile.branch_id) and the manager (all branches).
--
-- Changes:
--   1) profiles.branch_id (nullable FK) — manager has NULL (all branches), staff has one branch.
--   2) orders RLS: staff sees only their branch; manager sees all; ANON has NO select.
--   3) order_items / order_events RLS: scoped to the staff's branch via the parent order.
--   4) order_status_public: direct SELECT closed to everyone (read only via the
--      track_order_by_key security-definer RPC); removed from Realtime publication.
--   5) track_order_by_key: requires number + key, rate-limited + temporary lockout
--      after repeated wrong attempts; wrong key == same generic "not found" (no enumeration).
--   6) track_order (number-only) RPC dropped — a friendly number never works alone.
--   7) get_payment_info now requires order_number + tracking_key.
-- ============================================================
begin;

-- ---- 1) profiles.branch_id ----
alter table profiles add column if not exists branch_id uuid references branches(id) on delete set null;
create index if not exists profiles_branch_idx on profiles(branch_id);

-- ---- 2) orders RLS: staff = own branch only, manager = all branches, anon = none ----
drop policy if exists orders_staff_read on orders;
create policy orders_staff_read on orders for select to authenticated
  using (
    is_manager()
    or (
      is_staff()
      and branch_id = (select p.branch_id from profiles p where p.id = auth.uid() and p.is_active)
    )
  );

-- keep manage policy (manager only) as-is; ensure it exists
drop policy if exists orders_manage on orders;
create policy orders_manage on orders for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---- 3) order_items RLS: scoped to staff's branch via parent order ----
drop policy if exists order_items_staff_read on order_items;
create policy order_items_staff_read on order_items for select to authenticated
  using (
    is_manager()
    or (
      is_staff()
      and exists (
        select 1 from orders o
        join profiles p on p.id = auth.uid()
        where o.id = order_items.order_id
          and p.is_active
          and o.branch_id = p.branch_id
      )
    )
  );

drop policy if exists order_items_manage on order_items;
create policy order_items_manage on order_items for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---- 4) order_events RLS: same branch scoping ----
drop policy if exists order_events_staff_read on order_events;
create policy order_events_staff_read on order_events for select to authenticated
  using (
    is_manager()
    or (
      is_staff()
      and exists (
        select 1 from orders o
        join profiles p on p.id = auth.uid()
        where o.id = order_events.order_id
          and p.is_active
          and o.branch_id = p.branch_id
      )
    )
  );

drop policy if exists order_events_manage on order_events;
create policy order_events_manage on order_events for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---- 5) order_status_public: close direct SELECT (RPC only), remove from Realtime ----
drop policy if exists order_status_public_read on order_status_public;
revoke select on table order_status_public from anon, authenticated;

do $$
begin
  alter publication supabase_realtime drop table order_status_public;
exception when others then
  raise notice 'order_status_public was not in the supabase_realtime publication';
end $$;

-- ---- 6) track_order_by_key: number + key, rate limit + temporary lockout ----
create or replace function track_order_by_key(p_order_number text, p_tracking_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cnt int;
  v_ip text := client_ip_hash();
  v_action text;
begin
  -- missing input -> same generic message (no enumeration)
  if length(trim(coalesce(p_order_number, ''))) = 0 or length(trim(coalesce(p_tracking_key, ''))) = 0 then
    return jsonb_build_object('ok', false, 'message', 'مفتاح التتبع مش مطابق لهذا الطلب');
  end if;

  -- only the friendly LB-<digits> shape gets its own rate bucket; everything else shares one bucket
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

  -- verify order exists AND key matches (single generic failure message — no enumeration)
  if not exists (
    select 1 from orders
    where order_number = p_order_number
      and tracking_key::text = p_tracking_key
  ) then
    -- record the failed attempt so repeated wrong keys trigger lockout
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
end $$;

grant execute on function track_order_by_key(text, text) to anon;

-- ---- 7) drop the number-only track_order RPC (a friendly number must never work alone) ----
drop function if exists track_order(text);

-- ---- 8) get_payment_info now requires order_number + tracking_key ----
create or replace function get_payment_info(p_order_number text, p_tracking_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
  v_ip text := client_ip_hash();
begin
  -- rate limit on the payment-info endpoint
  if not rate_ok('payment_info', 30, interval '1 hour') then
    raise exception 'طلبات كثيرة زيادة — استنى شوية' using errcode = 'P0001';
  end if;

  if length(trim(coalesce(p_order_number, ''))) = 0 or length(trim(coalesce(p_tracking_key, ''))) = 0 then
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
end $$;

grant execute on function get_payment_info(text, text) to anon;

commit;
