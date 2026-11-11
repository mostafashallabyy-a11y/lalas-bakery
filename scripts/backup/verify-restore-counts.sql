-- Verification counts for backup restore drill (run against scratch/staging target only).
-- Requested key tables: orders, order_items, stock_movements.

select 'orders' as table_name, count(*)::bigint as row_count from public.orders
union all select 'order_items', count(*)::bigint from public.order_items
union all select 'stock_movements', count(*)::bigint from public.stock_movements;

-- Additional core tables (sanity check)
select 'order_events' as table_name, count(*)::bigint as row_count from public.order_events
union all select 'products', count(*)::bigint from public.products
union all select 'categories', count(*)::bigint from public.categories
union all select 'branches', count(*)::bigint from public.branches
union all select 'profiles', count(*)::bigint from public.profiles
union all select 'feedback', count(*)::bigint from public.feedback
union all select 'shifts', count(*)::bigint from public.shifts
union all select 'branch_promos', count(*)::bigint from public.branch_promos
union all select 'low_stock_alerts', count(*)::bigint from public.low_stock_alerts
union all select 'social_links', count(*)::bigint from public.social_links
union all select 'settings', count(*)::bigint from public.settings
order by table_name;
