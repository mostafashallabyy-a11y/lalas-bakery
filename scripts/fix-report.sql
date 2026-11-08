create or replace function manager_report(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
  v_f timestamptz := p_from::timestamptz;
  v_t timestamptz := p_to::timestamptz + interval '1 day';
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
    ),
    'per_day', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select created_at::date as day,
               count(*) as orders_count,
               coalesce(sum(total),0) as revenue
        from orders
        where created_at >= v_f and created_at < v_t
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
        from order_events e
        join profiles p on p.id = e.changed_by
        where e.created_at >= v_f and e.created_at < v_t
        group by p.id, p.full_name, p.email
        order by orders_handled desc
      ) x
    ),
    'top_products', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select i.name_snapshot as product, sum(i.qty) as qty, coalesce(sum(i.line_total),0) as revenue
        from order_items i
        join orders o on o.id = i.order_id
        where o.created_at >= v_f and o.created_at < v_t
        group by 1 order by qty desc limit 10
      ) x
    )
  ) into v_out;

  return v_out;
end $$;
