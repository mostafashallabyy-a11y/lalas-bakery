-- ============================================================
-- Lala's Bakery - 0025: social media links
-- ============================================================
-- Adds a social_links table for the main brand and per-branch links.
-- scope = 'brand'          -> main brand links (footer + under hero)
-- scope = '<branch uuid>'  -> that branch's own links
-- Link safety: url must start with https:// (DB check constraint).
-- WhatsApp: the app stores https://wa.me/<number> so it passes the check.
-- RLS: anon+auth may SELECT active links only; manager has full control.
-- Idempotent: safe to re-run after a previous partial apply.
-- ============================================================
begin;

-- ---- 1) table ----
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

create index if not exists social_links_scope_idx
  on social_links(scope, is_active, sort_order);
create index if not exists social_links_branch_idx
  on social_links(scope) where scope <> 'brand';

-- ---- 2) updated_at trigger ----
drop trigger if exists social_links_touch on social_links;
create trigger social_links_touch
  before update on social_links
  for each row execute function touch_updated_at();

-- ---- 3) RLS ----
alter table social_links enable row level security;
alter table social_links force row level security;

drop policy if exists social_links_public_read on social_links;
create policy social_links_public_read on social_links for select
  to anon, authenticated using (is_active);

drop policy if exists social_links_manager_all on social_links;
create policy social_links_manager_all on social_links for all to authenticated
  using (is_manager()) with check (is_manager());

-- ---- 4) grants ----
grant all on social_links to authenticated;
grant select on social_links to anon;

commit;
