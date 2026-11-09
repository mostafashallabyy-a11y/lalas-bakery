-- ============================================================
-- Lala's Bakery — Phase 3: Manager-only content editing (0008_manager_content_editing.sql)
-- ============================================================
-- Adds:
--   * Branch columns: logo, cover_image, promo_brief
--   * Product image resizing handled client-side (max 1000px)
--   * Storage buckets: product-images (public), branch-images (public)
--   * Storage policies: manager-only write, public read
--   * RLS policies already exist for branches/products manage (manager only)
-- ============================================================
begin;

-- ---- 1) Branch columns: logo, cover_image, promo_brief ----
alter table branches add column if not exists logo text default '';
alter table branches add column if not exists cover_image text default '';
alter table branches add column if not exists promo_brief text default '' check (char_length(promo_brief) <= 200);

-- ---- 2) Storage buckets (public-read, manager-only write) ----
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('branch-images', 'branch-images', true)
on conflict (id) do nothing;

-- ---- 3) Storage policies: product-images ----
create policy storage_product_images_read on storage.objects for select
  to anon, authenticated using (bucket_id = 'product-images');

create policy storage_product_images_write on storage.objects for all to authenticated
  using (bucket_id = 'product-images' and is_manager())
  with check (bucket_id = 'product-images' and is_manager());

-- ---- 4) Storage policies: branch-images ----
create policy storage_branch_images_read on storage.objects for select
  to anon, authenticated using (bucket_id = 'branch-images');

create policy storage_branch_images_write on storage.objects for all to authenticated
  using (bucket_id = 'branch-images' and is_manager())
  with check (bucket_id = 'branch-images' and is_manager());

-- ---- 5) Grant storage access ----
--    (authenticated already has insert/update/delete via existing grants in 0002/0003;
--     RLS policies are the real gatekeeper via is_manager())

commit;