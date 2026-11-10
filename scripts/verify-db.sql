-- ============================================================
-- Lala's Bakery — post-push verification.
-- Run with psql (you type the DB password; it is never stored):
--   psql "postgresql://postgres.lnyodqfksuvgmqkamvbp:[YOUR-DB-PASSWORD]@aws-1-eu-central-1.pooler.supabase.com:5432/postgres" -f scripts/verify-db.sql
-- ============================================================

\echo '===== 1) public functions (name, args, arg count) ====='
select proname as function_name,
       pronargs as arg_count,
       pg_get_function_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by proname, pronargs;

\echo '===== 2) submit_order_v2 overloads (must be exactly 1 row, arg_count 5) ====='
select pronargs as arg_count, pg_get_function_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'submit_order_v2';

\echo '===== 3) public tables ====='
select table_name
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;

\echo '===== 4) RLS status (rowsecurity + forced) for public tables ====='
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

\echo '===== 5) tables WITHOUT RLS enabled (must return 0 rows) ====='
select c.relname as table_without_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

\echo '===== 6) products stock columns ====='
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'products'
  and column_name in ('stock_qty','low_stock_threshold','track_stock')
order by column_name;

\echo '===== 7) stock_movements.order_id column ====='
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'stock_movements' and column_name = 'order_id';

\echo '===== 8) policies on stock tables ====='
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename in ('stock_movements','low_stock_alerts')
order by tablename, policyname;

\echo '===== 9) applied migration versions ====='
select version, name from supabase_migrations.schema_migrations order by version;
