-- ============================================================
-- 0041_menu_merchandising.sql
-- Storefront merchandising for the customer menu (Parts: menu redesign)
--   * products.featured  — manager-picked hero / best-seller carousel
--   * products.is_new    — manager "جديد" badge flag
--   * indexes for fast menu ordering
--   * default category order: Lala's Bakery first, then hot, cold, snacks
--   * one-off seed of `featured` from real (non-test) sales, only when
--     nothing is featured yet — afterwards the manager owns the list.
-- No RLS/table policy changes: products/categories stay manager-write only.
-- ============================================================
begin;

-- ---- 1) manager flags ----
alter table products add column if not exists featured boolean not null default false;
alter table products add column if not exists is_new   boolean not null default false;

create index if not exists products_menu_order_idx
  on products (branch_id, category_id, sort_order);

create index if not exists products_featured_idx
  on products (branch_id, featured)
  where featured;

-- ---- 2) default category order (only the four known sections) ----
with desired(name, ord) as (
  values
    ('Lala''s Bakery', 0),
    ('مشروبات ساخنة', 1),
    ('مشروبات باردة', 2),
    ('تسالي', 3)
)
update categories c
   set sort_order = d.ord
  from desired d
 where c.name = d.name;

-- ---- 3) seed "featured" from real sales (once) ----
do $$
begin
  if not exists (select 1 from products where featured) then
    update products p
       set featured = true
      from (
        select oi.product_id, sum(oi.qty) as qty
          from order_items oi
          join orders o on o.id = oi.order_id
         where oi.product_id is not null
           and coalesce(o.is_test, false) = false
           and o.created_at > now() - interval '180 days'
         group by oi.product_id
         order by qty desc
         limit 5
      ) t
     where p.id = t.product_id
       and p.is_active
       and p.price > 0;
  end if;
end $$;

commit;

-- PostgREST schema cache
select pg_notify('pgrst', 'reload schema');
