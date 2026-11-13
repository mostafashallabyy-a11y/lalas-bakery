-- ============================================================
-- Lala's Bakery — 0030 (Part 4): Manager test data/reports cleanup
-- ============================================================
-- Adds test flags, undeletable wipe audit log, preview/export helpers, and
-- a manager-only transactional wipe RPC. New migration only. RLS stays on.
-- No service_role. Storage proof file deletion is performed client-side by
-- manager after wipe RPC returns paths (RPC deletes DB references transactionally).
-- ============================================================
begin;

-- ---- 1) Optional test flags (excluded from reports when true) ----
alter table orders add column if not exists is_test boolean not null default false;
alter table shifts add column if not exists is_test boolean not null default false;

create index if not exists orders_is_test_created_idx on orders(is_test, created_at desc);
create index if not exists shifts_is_test_opened_idx on shifts(is_test, opened_at desc);

-- ---- 2) Undeletable audit log for wipes ----
create table if not exists data_wipe_audit (
  id uuid primary key default gen_random_uuid(),
  performed_by uuid not null references auth.users(id) on delete restrict,
  performed_at timestamptz not null default now(),
  from_date date not null,
  to_date date not null,
  branch_id uuid references branches(id) on delete set null,
  options jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  note text
);

alter table data_wipe_audit enable row level security;
alter table data_wipe_audit force row level security;

drop policy if exists data_wipe_audit_manager_select on data_wipe_audit;
create policy data_wipe_audit_manager_select on data_wipe_audit
  for select to authenticated using (is_manager());

drop policy if exists data_wipe_audit_manager_insert on data_wipe_audit;
create policy data_wipe_audit_manager_insert on data_wipe_audit
  for insert to authenticated with check (is_manager() and performed_by = auth.uid());

-- No UPDATE/DELETE policies => undeletable/immutable via RLS for app roles
revoke delete, update on data_wipe_audit from anon, authenticated;

grant select, insert on data_wipe_audit to authenticated;

-- ---- 3) Preview counts (manager-only) ----
create or replace function manager_wipe_test_data_preview(
  p_from date,
  p_to date,
  p_branch_id uuid default null,
  p_delete_orders boolean default true,
  p_delete_proofs boolean default true,
  p_delete_stock_movements boolean default true,
  p_delete_shifts boolean default false,
  p_reset_customer_stats boolean default false,
  p_only_test boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_f timestamptz := p_from::timestamptz at time zone 'Africa/Cairo';
  v_t timestamptz := (p_to::timestamptz + interval '1 day') at time zone 'Africa/Cairo';
  v_order_ids uuid[];
  v_orders int := 0;
  v_items int := 0;
  v_proofs int := 0;
  v_movements int := 0;
  v_shifts int := 0;
begin
  if not is_manager() then raise exception 'غير مسموح' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'نطاق التاريخ غير صحيح' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(o.id), array[]::uuid[]) into v_order_ids
  from orders o
  where o.created_at >= v_f and o.created_at < v_t
    and (p_branch_id is null or o.branch_id = p_branch_id)
    and (not coalesce(p_only_test,false) or o.is_test = true);

  v_orders := coalesce(array_length(v_order_ids,1),0);

  if coalesce(p_delete_orders,true) and v_orders > 0 then
    select count(*) into v_items from order_items i where i.order_id = any(v_order_ids);
  end if;

  if coalesce(p_delete_proofs,true) and v_orders > 0 then
    select count(*) into v_proofs from orders o where o.id = any(v_order_ids) and o.payment_proof_path is not null and btrim(o.payment_proof_path) <> '';
  end if;

  if coalesce(p_delete_stock_movements,true) and v_orders > 0 then
    select count(*) into v_movements from stock_movements sm where sm.order_id = any(v_order_ids);
  end if;

  if coalesce(p_delete_shifts,false) then
    select count(*) into v_shifts from shifts s
    where s.opened_at >= v_f and s.opened_at < v_t
      and (p_branch_id is null or s.branch_id = p_branch_id)
      and (not coalesce(p_only_test,false) or s.is_test = true);
  end if;

  return jsonb_build_object(
    'ok', true,
    'orders', v_orders,
    'order_items', v_items,
    'payment_proofs', v_proofs,
    'stock_movements', v_movements,
    'shifts', v_shifts,
    'reset_customer_stats', coalesce(p_reset_customer_stats,false)
  );
end $$;
grant execute on function manager_wipe_test_data_preview(date,date,uuid,boolean,boolean,boolean,boolean,boolean,boolean) to authenticated;

-- ---- 4) Transactional wipe (manager-only). Requires confirm word "حذف".
-- Returns deleted counts and storage proof paths the client should remove (backup done client-side before call).
create or replace function manager_wipe_test_data(
  p_from date,
  p_to date,
  p_branch_id uuid default null,
  p_delete_orders boolean default true,
  p_delete_proofs boolean default true,
  p_delete_stock_movements boolean default true,
  p_delete_shifts boolean default false,
  p_reset_customer_stats boolean default false,
  p_only_test boolean default false,
  p_confirm text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_f timestamptz := p_from::timestamptz at time zone 'Africa/Cairo';
  v_t timestamptz := (p_to::timestamptz + interval '1 day') at time zone 'Africa/Cairo';
  v_order_ids uuid[];
  v_proof_paths text[] := array[]::text[];
  v_deleted_orders int := 0;
  v_deleted_items int := 0;
  v_deleted_movements int := 0;
  v_deleted_shifts int := 0;
  v_deleted_proof_refs int := 0;
  v_stock_products int := 0;
  v_audit_id uuid;
  v_counts jsonb;
begin
  if not is_manager() then raise exception 'غير مسموح' using errcode = '42501'; end if;

  if btrim(coalesce(p_confirm,'')) <> 'حذف' then
    raise exception 'اكتب كلمة "حذف" للتأكيد' using errcode = 'P0001';
  end if;

  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'نطاق التاريخ غير صحيح' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(o.id), array[]::uuid[]) into v_order_ids
  from orders o
  where o.created_at >= v_f and o.created_at < v_t
    and (p_branch_id is null or o.branch_id = p_branch_id)
    and (not coalesce(p_only_test,false) or o.is_test = true);

  -- Collect proof paths to delete from storage (client-side) before DB refs removed
  if coalesce(p_delete_proofs,true) and coalesce(array_length(v_order_ids,1),0) > 0 then
    select coalesce(array_agg(o.payment_proof_path), array[]::text[]), count(*)
      into v_proof_paths, v_deleted_proof_refs
    from orders o
    where o.id = any(v_order_ids) and o.payment_proof_path is not null and btrim(o.payment_proof_path) <> '';
  end if;

  if coalesce(p_delete_orders,true) and coalesce(array_length(v_order_ids,1),0) > 0 then
    -- Restore stock for orders with net reserved qty not yet returned (tracked products)
    with net as (
      select sm.product_id,
             sum(case when sm.reason = 'sale' then abs(sm.change_qty) else -abs(sm.change_qty) end)::int as reserved_qty
      from stock_movements sm
      join products p on p.id = sm.product_id
      where sm.order_id = any(v_order_ids)
        and sm.reason in ('sale','void','expiry','restock')
        and p.track_stock
      group by sm.product_id
    ), to_return as (
      select product_id, reserved_qty from net where reserved_qty > 0
    ), upd as (
      update products p
      set stock_qty = p.stock_qty + t.reserved_qty
      from to_return t
      where p.id = t.product_id
      returning p.id
    )
    select count(*) into v_stock_products from upd;

    select count(*) into v_deleted_items from order_items i where i.order_id = any(v_order_ids);

    if coalesce(p_delete_stock_movements,true) then
      delete from stock_movements where order_id = any(v_order_ids);
      get diagnostics v_deleted_movements = row_count;
    end if;

    delete from low_stock_alerts where product_id in (
      select distinct i.product_id from order_items i
      where i.order_id = any(v_order_ids) and i.product_id is not null
    );
    delete from void_requests where order_id = any(v_order_ids);
    delete from order_status_public where order_number in (select o.order_number from orders o where o.id = any(v_order_ids));

    delete from orders o where o.id = any(v_order_ids);
    get diagnostics v_deleted_orders = row_count;
  end if;

  if coalesce(p_delete_shifts,false) then
    delete from shifts s
    where s.opened_at >= v_f and s.opened_at < v_t
      and (p_branch_id is null or s.branch_id = p_branch_id)
      and (not coalesce(p_only_test,false) or s.is_test = true);
    get diagnostics v_deleted_shifts = row_count;
  end if;

  -- reset customer stats: best-effort (no dedicated stats table assumed); recorded in audit
  -- (kept for future-safe compliance; no-op if no such aggregates exist)

  v_counts := jsonb_build_object(
    'deleted_orders', v_deleted_orders,
    'deleted_order_items', v_deleted_items,
    'deleted_payment_proofs_refs', coalesce(v_deleted_proof_refs,0),
    'deleted_stock_movements', v_deleted_movements,
    'deleted_shifts', v_deleted_shifts,
    'stock_returned_products', v_stock_products,
    'reset_customer_stats_requested', coalesce(p_reset_customer_stats,false)
  );

  insert into data_wipe_audit(performed_by, from_date, to_date, branch_id, options, counts)
  values (
    auth.uid(), p_from, p_to, p_branch_id,
    jsonb_build_object(
      'delete_orders', coalesce(p_delete_orders,true),
      'delete_proofs', coalesce(p_delete_proofs,true),
      'delete_stock_movements', coalesce(p_delete_stock_movements,true),
      'delete_shifts', coalesce(p_delete_shifts,false),
      'reset_customer_stats', coalesce(p_reset_customer_stats,false),
      'only_test', coalesce(p_only_test,false)
    ),
    v_counts
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'ok', true,
    'audit_id', v_audit_id,
    'counts', v_counts,
    'proof_paths', to_jsonb(coalesce(v_proof_paths, array[]::text[]))
  );
end $$;
grant execute on function manager_wipe_test_data(date,date,uuid,boolean,boolean,boolean,boolean,boolean,boolean,text) to authenticated;

-- Replace 0027 manager_clear_test_data to also log audit and accept "حذف" (keep DELETE for compat) and exclude-is_test default off
drop function if exists public.manager_clear_test_data(date, date, uuid, boolean, text);
create or replace function manager_clear_test_data(
  p_from date,
  p_to date,
  p_branch_id uuid default null,
  p_include_shifts boolean default false,
  p_confirm text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v jsonb;
begin
  if not is_manager() then raise exception 'غير مسموح' using errcode = '42501'; end if;
  if btrim(coalesce(p_confirm,'')) not in ('DELETE','حذف') then
    raise exception 'اكتب كلمة "حذف" أو DELETE للتأكيد' using errcode = 'P0001';
  end if;
  v := manager_wipe_test_data(p_from, p_to, p_branch_id, true, true, true, coalesce(p_include_shifts,false), false, false, 'حذف');
  return jsonb_build_object(
    'ok', true,
    'deleted_orders', coalesce((v->'counts'->>'deleted_orders')::int,0),
    'deleted_shifts', coalesce((v->'counts'->>'deleted_shifts')::int,0),
    'stock_returned_products', coalesce((v->'counts'->>'stock_returned_products')::int,0),
    'audit_id', v->>'audit_id'
  );
end $$;
grant execute on function manager_clear_test_data(date, date, uuid, boolean, text) to authenticated;

commit;
