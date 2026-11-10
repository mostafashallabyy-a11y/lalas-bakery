-- ============================================================
-- Lala's Bakery — post-push verification.
-- Plain SQL (no psql meta-commands) so scripts/db-run.mjs can run it:
--   node scripts/db-run.mjs scripts/verify-db.sql   (read-only)
-- ============================================================

select '1) public functions (name, args, count)' as section;
select proname as function_name,
       pronargs as arg_count,
       pg_get_function_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by proname, pronargs;

select '2) submit_order_v2 overloads (must be exactly 1 row, arg_count 5)' as section;
select pronargs as arg_count, pg_get_function_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'submit_order_v2';

select '3) public tables WITHOUT RLS enabled (must return 0 rows)' as section;
select c.relname as table_without_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

select '4) RLS status for public tables' as section;
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

select '5) RLS + FORCE on every public table' as section;
select count(*) filter (where c.relrowsecurity and c.relforcerowsecurity) as tables_fully_locked,
       count(*) as total_tables
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

select '6) products stock columns' as section;
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'products'
  and column_name in ('stock_qty','low_stock_threshold','track_stock')
order by column_name;

select '7) stock_movements.order_id' as section;
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'stock_movements' and column_name = 'order_id';

select '8) policies on stock tables' as section;
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public' and tablename in ('stock_movements','low_stock_alerts')
order by tablename, policyname;

select '9) applied migration versions' as section;
select version, name from supabase_migrations.schema_migrations order by version;

