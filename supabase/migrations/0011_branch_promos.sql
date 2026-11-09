-- ============================================================
-- Lala's Bakery — Phase 6: Branch promo banner (0011_branch_promos.sql)
-- ============================================================
-- Adds:
--   * branch_promos table: banner promos per branch (manager-only write)
--   * Storage bucket branch-images already exists (public read)
--   * Link safety: only https:// URLs (DB check constraint)
--   * RLS: public reads active promos; manager creates/edits/deletes/reorders
-- ============================================================
begin;

-- ---- 1) branch_promos table ----
create table if not exists branch_promos (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references branches(id) on delete cascade,
  title        text not null check (char_length(title) between 2 and 100),
  text         text not null check (char_length(text) between 2 and 200),
  image_url    text default '' check (char_length(image_url) <= 500),
  link_url     text not null check (link_url ~ '^https://'),
  button_label text not null default 'زور صفحة الفرع' check (char_length(button_label) between 2 and 60),
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index branch_promos_branch_idx on branch_promos(branch_id, is_active);

-- trigger updated_at
create trigger branch_promos_touch before update on branch_promos for each row execute function touch_updated_at();

-- ---- 2) RLS ----
alter table branch_promos enable row level security; alter table branch_promos force row level security;

-- public reads active promos only
create policy branch_promos_public_read on branch_promos for select
  to anon, authenticated using (is_active);

-- manager full access
create policy branch_promos_manager_all on branch_promos for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---- 3) Grants ----
grant all on branch_promos to authenticated;
grant select on branch_promos to anon;

commit;