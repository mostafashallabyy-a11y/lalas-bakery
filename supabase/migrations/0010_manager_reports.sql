-- ============================================================
-- Lala's Bakery — Phase 5: Manager Reports (0010_manager_reports.sql)
-- ============================================================
-- Adds enhanced report functions for manager dashboard:
--   * manager_report_enhanced: revenue, per day, per branch, per payment method,
--     online vs pos, AOV, order count, peak hours heatmap
--   * manager_product_movement: qty/revenue per product, best sellers, slowest,
--     category share, comparison with previous period
--   * manager_staff_performance: orders handled, avg/median prep time, slowest,
--     orders over target, void requests, cash shift differences, shifts worked
--   * settings: target_prep_minutes (manager editable)
--   * Demo seed data marked as demo
-- ============================================================
begin;

-- ---- 1) Settings: target prep time ----
insert into settings (key, value) values
  ('target_prep_minutes', '10')
on conflict (key) do nothing;

-- ---- 2) Enhanced manager report ----
create or replace function manager_report_enhanced(
  p_from date,
  p_to date,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
  v_f timestamptz := p_from::timestamptz at time zone 'Africa/Cairo';
  v_t timestamptz := (p_to::timestamptz + interval '1 day') at time zone 'Africa/Cairo';
begin
  if not is_manager() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'orders_count', count(*),
        'revenue', coalesce(sum(total),0),
        'paid_count', count(*) filter (where payment_confirmed),
        'avg_order', coalesce(avg(total),0)
      ) from orders
      where created_at >= v_f and created_at < v_t
        and (p_branch_id is null or branch_id = p_branch_id)
    ),
    'per_day', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select (created_at at time zone 'Africa/Cairo')::date as day,
               count(*) as orders_count,
               coalesce(sum(total),0) as revenue
        from orders
        where created_at >= v_f and created_at < v_t
          and (p_branch_id is null or branch_id = p_branch_id)
        group by 1 order by 1
      ) x
    ),
    'per_branch', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select b.name as branch, count(o.id) as orders_count,
               coalesce(sum(o.total),0) as revenue
        from orders o
        join branches b on b.id = o.branch_id
        where o.created_at >= v_f and o.created_at < v_t
          and (p_branch_id is null or b.id = p_branch_id)
        group by b.name order by revenue desc
      ) x
    ),
    'per_payment_method', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select o.delivery_type as method, count(o.id) as orders_count,
               coalesce(sum(o.total),0) as revenue
        from orders o
        where o.created_at >= v_f and o.created_at < v_t
          and (p_branch_id is null or o.branch_id = p_branch_id)
        group by o.delivery_type order by revenue desc
      ) x
    ),
    'online_vs_pos', (
      select jsonb_build_object(
        'online', coalesce((select jsonb_build_object('orders_count', count(*), 'revenue', coalesce(sum(total),0))
          from orders where created_at >= v_f and created_at < v_t
            and source = 'online' and (p_branch_id is null or branch_id = p_branch_id)), '{}'::jsonb),
        'pos', coalesce((select jsonb_build_object('orders_count', count(*), 'revenue', coalesce(sum(total),0))
          from orders where created_at >= v_f and created_at < v_t
            and source = 'pos' and (p_branch_id is null or branch_id = p_branch_id)), '{}'::jsonb)
      )
    ),
    'peak_hours', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select extract(hour from (created_at at time zone 'Africa/Cairo'))::int as hour,
               count(*) as orders_count
        from orders
        where created_at >= v_f and created_at < v_t
          and (p_branch_id is null or branch_id = p_branch_id)
        group by 1 order by 1
      ) x
    )
  ) into v_out;

  return v_out;
end $$;
grant execute on function manager_report_enhanced(date, date, uuid) to authenticated;

-- ---- 3) Product movement report ----
create or replace function manager_product_movement(
  p_from date,
  p_to date,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
  v_f timestamptz := p_from::timestamptz at time zone 'Africa/Cairo';
  v_t timestamptz := (p_to::timestamptz + interval '1 day') at time zone 'Africa/Cairo';
  v_prev_f timestamptz := (p_from::date - (p_to - p_from))::timestamptz at time zone 'Africa/Cairo';
  v_prev_t timestamptz := p_from::timestamptz at time zone 'Africa/Cairo';
begin
  if not is_manager() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'products', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select i.name_snapshot as product,
               sum(i.qty) as qty,
               coalesce(sum(i.line_total),0) as revenue
        from order_items i
        join orders o on o.id = i.order_id
        where o.created_at >= v_f and o.created_at < v_t
          and (p_branch_id is null or o.branch_id = p_branch_id)
        group by 1 order by qty desc
      ) x
    ),
    'category_share', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select c.name as category, sum(i.qty) as qty,
               coalesce(sum(i.line_total),0) as revenue
        from order_items i
        join orders o on o.id = i.order_id
        join products p on p.id = i.product_id
        join categories c on c.id = p.category_id
        where o.created_at >= v_f and o.created_at < v_t
          and (p_branch_id is null or o.branch_id = p_branch_id)
        group by c.name order by revenue desc
      ) x
    ),
    'comparison', (
      select jsonb_build_object(
        'current_period_qty', coalesce((select sum(i.qty) from order_items i
          join orders o on o.id = i.order_id
          where o.created_at >= v_f and o.created_at < v_t
            and (p_branch_id is null or o.branch_id = p_branch_id)),0),
        'previous_period_qty', coalesce((select sum(i.qty) from order_items i
          join orders o on o.id = i.order_id
          where o.created_at >= v_prev_f and o.created_at < v_prev_t
            and (p_branch_id is null or o.branch_id = p_branch_id)),0),
        'current_period_revenue', coalesce((select sum(i.line_total) from order_items i
          join orders o on o.id = i.order_id
          where o.created_at >= v_f and o.created_at < v_t
            and (p_branch_id is null or o.branch_id = p_branch_id)),0),
        'previous_period_revenue', coalesce((select sum(i.line_total) from order_items i
          join orders o on o.id = i.order_id
          where o.created_at >= v_prev_f and o.created_at < v_prev_t
            and (p_branch_id is null or o.branch_id = p_branch_id)),0)
      )
    )
  ) into v_out;

  return v_out;
end $$;
grant execute on function manager_product_movement(date, date, uuid) to authenticated;

-- ---- 4) Staff performance report ----
create or replace function manager_staff_performance(
  p_from date,
  p_to date,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
  v_f timestamptz := p_from::timestamptz at time zone 'Africa/Cairo';
  v_t timestamptz := (p_to::timestamptz + interval '1 day') at time zone 'Africa/Cairo';
  v_target int := 10;
begin
  if not is_manager() then
    raise exception 'غير مسموح' using errcode = '42501';
  end if;

  select coalesce((select value::int from settings where key = 'target_prep_minutes'), 10) into v_target;

  select jsonb_build_object(
    'target_prep_minutes', v_target,
    'staff', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select p.full_name, p.email,
               count(distinct o.id) as orders_handled,
               round(avg(extract(epoch from (e2.created_at - o.created_at))) / 60.0, 1) as avg_prep_minutes,
               round(percentile_cont(0.5) within group (order by extract(epoch from (e2.created_at - o.created_at))) / 60.0, 1) as median_prep_minutes,
               count(*) filter (where extract(epoch from (e2.created_at - o.created_at)) > v_target * 60) as orders_over_target,
               count(distinct vr.id) as void_requests,
               coalesce(sum(s.difference),0) as cash_shift_difference,
               count(distinct s.id) as shifts_worked
        from profiles p
        left join orders o on o.created_by = p.id
          and o.created_at >= v_f and o.created_at < v_t
          and (p_branch_id is null or o.branch_id = p_branch_id)
        left join order_events e2 on e2.order_id = o.id and e2.new_status = 'done'
          and e2.created_at >= v_f and e2.created_at < v_t
        left join void_requests vr on vr.staff_id = p.id
          and vr.created_at >= v_f and vr.created_at < v_t
        left join shifts s on s.staff_id = p.id
          and s.status = 'closed'
          and s.created_at >= v_f and s.created_at < v_t
          and (p_branch_id is null or s.branch_id = p_branch_id)
        where p.role in ('staff','manager') and p.is_active
        group by p.id, p.full_name, p.email
        order by orders_handled desc
      ) x
    )
  ) into v_out;

  return v_out;
end $$;
grant execute on function manager_staff_performance(date, date, uuid) to authenticated;

-- ---- 5) Demo seed data (clearly marked) ----
insert into branches (name, description, services, promo_brief, logo, cover_image, is_active, sort_order)
select 'فرع demo التجريبي', 'فرع تجريبي لأغراض العرض التوضيحي فقط — لا يوجد فعلياً', ARRAY['دليفري', 'واي فاي'], 'هذا فرع تجريبي لأغراض الاختبار فقط', '', '', true, 99
where not exists (select 1 from branches where name = 'فرع demo التجريبي');

commit;