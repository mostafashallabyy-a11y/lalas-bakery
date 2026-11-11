-- ============================================================
-- Lala's Bakery — Part A: Social media links (0020_social_links.sql)
-- ============================================================
-- Adds a social_links table for the main brand and per-branch links.
-- scope = 'brand'  -> main brand links (home footer + under hero)
-- scope = <branch_id> -> that branch's own links (branch card + landing)
-- Link safety: url must start with https:// (DB check constraint).
-- WhatsApp: manager enters a phone number; the app/helper builds https://wa.me/<number>
--           and stores that (so the stored url still passes the https check).
-- RLS: public (anon+auth) can SELECT active links only.
--      Only manager can insert/update/delete/reorder.
-- ============================================================
begin;

-- ---- 1) social_links table ----
create table if not exists social_links (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null
    check (scope = 'brand' or scope ~ '^[0-9a-fA-F-]{36}$'),
  platform    text not null
    check (platform in (
      'instagram','facebook','tiktok','whatsapp','youtube','x',
      'snapchat','telegram','google_maps','website'
    )),
  url         text not null check (url ~ '^https://'),
  label       text check (label is null or char_length(label) <= 60),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index social_links_scope_idx on social_links(scope, is_active, sort_order);
create index social_links_branch_idx on social_links(scope) where scope <> 'brand';

-- trigger updated_at
create trigger social_links_touch before update on social_links
  for each row execute function touch_updated_at();

-- ---- 2) RLS ----
alter table social_links enable row level security;
alter table social_links force row level security;

-- public: read active links only (brand or a branch)
create policy social_links_public_read on social_links for select
  to anon, authenticated using (is_active);

-- manager: full control
create policy social_links_manager_all on social_links for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---- 3) Grants ----
grant all on social_links to authenticated;
grant select on social_links to anon;

commit;
