-- ============================================================
-- Lala's Bakery — 0031 (Part 4): Exclude is_test orders/shifts from reports
-- ============================================================
-- Ensures "طلب تجريبي" (is_test=true) is excluded from all manager reports.
-- Carries forward 0026 payment-aware manager_report_enhanced.
-- New migration only. RLS stays on. No service_role.
-- ============================================================
begin;

-- manager_report_enhanced: 0026 semantics + exclude is_test
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
  if not is_manager() then raise exception 'غير مسموح' using errcode = '42501'; end if;

  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'orders_count', count(*),
        'revenue', coalesce(sum(total) filter (where payment_status = 'paid'), 0),
        'paid_count', count(*) filter (where payment_status = 'paid'),
        'avg_order', coalesce(avg(total) filter (where payment_status = 'paid'), 0)
      ) from orders
      where created_at >= v_f and created_at < v_t
        and coalesce(is_test,false) = false
        and (p_branch_id is null or branch_id = p_branch_id)
    ),
    'per_day', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select (created_at at time zone 'Africa/Cairo')::date as day,
               count(*) as orders_count,
               coalesce(sum(total) filter (where payment_status='paid'),0) as revenue
        from orders
        where created_at >= v_f and created_at < v_t
          and coalesce(is_test,false) = false
          and (p_branch_id is null or branch_id = p_branch_id)
        group by 1 order by 1
      ) x
    ),
    'per_branch', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select b.name as branch, count(o.id) as orders_count,
               coalesce(sum(o.total) filter (where o.payment_status='paid'),0) as revenue
        from orders o
        join branches b on b.id = o.branch_id
        where o.created_at >= v_f and o.created_at < v_t
          and coalesce(o.is_test,false) = false
          and (p_branch_id is null or b.id = p_branch_id)
        group by b.name order by revenue desc
      ) x
    ),
    'per_payment_method', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select o.payment_method as method,
               count(o.id) as orders_count,
               coalesce(sum(o.total) filter (where o.payment_status='paid'),0) as revenue,
               count(*) filter (where o.payment_status='paid') as paid_count,
               count(*) filter (where o.payment_method='cash' and o.payment_status='pending' and o.status <> 'done') as unpaid_pending_count,
               count(*) filter (where o.payment_method='cash' and o.payment_status in ('rejected','refunded') and o.status='done') as cancelled_count
        from orders o
        where o.created_at >= v_f and o.created_at < v_t
          and coalesce(o.is_test,false) = false
          and (p_branch_id is null or o.branch_id = p_branch_id)
        group by o.payment_method order by revenue desc
      ) x
    ),
    'online_vs_pos', (
      select jsonb_build_object(
        'online', coalesce((select jsonb_build_object('orders_count', count(*), 'revenue', coalesce(sum(total) filter (where payment_status='paid'),0))
          from orders where created_at >= v_f and created_at < v_t
            and coalesce(is_test,false) = false
            and source = 'online' and (p_branch_id is null or branch_id = p_branch_id)), '{}'::jsonb),
        'pos', coalesce((select jsonb_build_object('orders_count', count(*), 'revenue', coalesce(sum(total) filter (where payment_status='paid'),0))
          from orders where created_at >= v_f and created_at < v_t
            and coalesce(is_test,false) = false
            and source = 'pos' and (p_branch_id is null or branch_id = p_branch_id)), '{}'::jsonb)
      )
    ),
    'cash_summary', (
      select jsonb_build_object(
        'unpaid_pending_cash_orders', count(*) filter (where payment_method='cash' and payment_status='pending' and status <> 'done'),
        'cancelled_cash_orders', count(*) filter (where payment_method='cash' and status='done' and payment_status in ('rejected','refunded'))
      ) from orders
      where created_at >= v_f and created_at < v_t
        and coalesce(is_test,false) = false
        and (p_branch_id is null or branch_id = p_branch_id)
    ),
    'peak_hours', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select extract(hour from (created_at at time zone 'Africa/Cairo'))::int as hour,
               count(*) as orders_count
        from orders
        where created_at >= v_f and created_at < v_t
          and coalesce(is_test,false) = false
          and (p_branch_id is null or branch_id = p_branch_id)
        group by 1 order by 1
      ) x
    )
  ) into v_out;

  return v_out;
end $$;
grant execute on function manager_report_enhanced(date, date, uuid) to authenticated;

-- manager_product_movement: exclude is_test orders
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
          and coalesce(o.is_test,false) = false
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
          and coalesce(o.is_test,false) = false
          and (p_branch_id is null or o.branch_id = p_branch_id)
        group by c.name order by revenue desc
      ) x
    ),
    'comparison', (
      select jsonb_build_object(
        'current_period_qty', coalesce((select sum(i.qty) from order_items i
          join orders o on o.id = i.order_id
          where o.created_at >= v_f and o.created_at < v_t
            and coalesce(o.is_test,false) = false
            and (p_branch_id is null or o.branch_id = p_branch_id)),0),
        'previous_period_qty', coalesce((select sum(i.qty) from order_items i
          join orders o on o.id = i.order_id
          where o.created_at >= v_prev_f and o.created_at < v_prev_t
            and coalesce(o.is_test,false) = false
            and (p_branch_id is null or o.branch_id = p_branch_id)),0),
        'current_period_revenue', coalesce((select sum(i.line_total) from order_items i
          join orders o on o.id = i.order_id
          where o.created_at >= v_f and o.created_at < v_t
            and coalesce(o.is_test,false) = false
            and (p_branch_id is null or o.branch_id = p_branch_id)),0),
        'previous_period_revenue', coalesce((select sum(i.line_total) from order_items i
          join orders o on o.id = i.order_id
          where o.created_at >= v_prev_f and o.created_at < v_prev_t
            and coalesce(o.is_test,false) = false
            and (p_branch_id is null or o.branch_id = p_branch_id)),0)
      )
    )
  ) into v_out;

  return v_out;
end $$;
grant execute on function manager_product_movement(date, date, uuid) to authenticated;

-- manager_staff_performance: exclude is_test orders/shifts
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
               round(avg(extract(epoch from (e2.created_at - o.created_at)))::numeric / 60.0, 1) as avg_prep_minutes,
               round(percentile_cont(0.5) within group (order by extract(epoch from (e2.created_at - o.created_at)))::numeric / 60.0, 1) as median_prep_minutes,
               count(*) filter (where extract(epoch from (e2.created_at - o.created_at)) > v_target * 60) as orders_over_target,
               count(distinct vr.id) as void_requests,
               coalesce(sum(s.difference),0) as cash_shift_difference,
               count(distinct s.id) as shifts_worked
        from profiles p
        left join orders o on o.created_by = p.id
          and o.created_at >= v_f and o.created_at < v_t
          and coalesce(o.is_test,false) = false
          and (p_branch_id is null or o.branch_id = p_branch_id)
        left join order_events e2 on e2.order_id = o.id and e2.new_status = 'done'
          and e2.created_at >= v_f and e2.created_at < v_t
        left join void_requests vr on vr.staff_id = p.id
          and vr.created_at >= v_f and vr.created_at < v_t
        left join shifts s on s.staff_id = p.id
          and s.status = 'closed'
          and coalesce(s.is_test,false) = false
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

commit;
