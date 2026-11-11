-- ============================================================
-- Lala's Bakery - 0021: order privacy (RLS only)
-- ============================================================
-- Goal: nobody can browse/list orders except
--   (1) the customer, via order_number + tracking_key (RPC only), and
--   (2) staff of that branch (profiles.branch_id) or the manager (all).
--
-- This file contains ONLY the schema/RLS changes.
-- The public RPCs live in 0023 (tracking) and 0024 (payment info).
--
-- Idempotent: safe to re-run.
-- ============================================================
begin;

-- ---- 1) profiles.branch_id (manager = NULL -> all branches) ----
alter table profiles add column if not exists branch_id uuid
  references branches(id) on delete set null;
create index if not exists profiles_branch_idx on profiles(branch_id);

-- ---- 2) orders: staff = own branch, manager = all, anon = none ----
drop policy if exists orders_staff_read on orders;
create policy orders_staff_read on orders for select to authenticated
  using (
    is_manager()
    or (
      is_staff()
      and branch_id = (
        select p.branch_id from profiles p
        where p.id = auth.uid() and p.is_active
      )
    )
  );

drop policy if exists orders_manage on orders;
create policy orders_manage on orders for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---- 3) order_items: scoped via the parent order's branch ----
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

-- ---- 4) order_events: same branch scoping ----
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

-- ---- 5) order_status_public: RPC only, no direct SELECT, no Realtime ----
drop policy if exists order_status_public_read on order_status_public;
revoke select on table order_status_public from anon, authenticated;

do $fn$
begin
  alter publication supabase_realtime drop table order_status_public;
exception when others then
  raise notice 'order_status_public was not in the supabase_realtime publication';
end $fn$;

commit;
