-- ============================================================
-- Lala's Bakery — Phase 1: schema (0001_init.sql)
-- Run in Supabase SQL Editor (or supabase db push in order)
-- ============================================================
begin;

create extension if not exists pgcrypto;
create extension if not exists citext;

-- pg_net (used by RPCs to verify Turnstile tokens server-side, optional)
do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net already installed or unavailable — Turnstile server-verify will be skipped gracefully';
end $$;

-- ---------- enums ----------
create type order_status as enum ('received', 'preparing', 'done');
create type user_role as enum ('staff', 'manager');

-- ---------- branches ----------
create table branches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 80),
  description text not null default '' check (char_length(description) <= 300),
  services    text[] not null default '{}' check (array_length(services,1) <= 8),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------- categories ----------
create table categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (char_length(name) between 2 and 60),
  is_active  boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- products ----------
create table products (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches(id) on delete cascade,
  category_id uuid not null references categories(id) on delete restrict,
  name        text not null check (char_length(name) between 2 and 80),
  price       numeric(10,2) not null check (price >= 0 and price <= 100000),
  note        text not null default '' check (char_length(note) <= 200),
  image_url   text not null default '' check (char_length(image_url) <= 500),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
create index products_branch_idx on products(branch_id, is_active);

-- ---------- orders ----------
create sequence lb_order_seq start 1001;

create table orders (
  id               uuid primary key default gen_random_uuid(),
  order_number     text not null unique default ('LB-' || nextval('lb_order_seq')::text),
  branch_id        uuid not null references branches(id) on delete restrict,
  customer_name    text not null check (char_length(customer_name) between 2 and 60),
  delivery_type    text not null check (delivery_type in ('pickup','table','obour')),
  delivery_fee     numeric(10,2) not null default 0 check (delivery_fee >= 0),
  subtotal         numeric(10,2) not null default 0 check (subtotal >= 0),
  total            numeric(10,2) not null default 0 check (total >= 0),
  status           order_status not null default 'received',
  payment_confirmed boolean not null default false,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index orders_branch_idx on orders(branch_id, created_at desc);
create index orders_status_idx on orders(status, created_at desc);

-- snapshot items: name/price stored here so later price edits never change old orders
create table order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  product_id   uuid references products(id) on delete set null,
  name_snapshot text not null check (char_length(name_snapshot) between 2 and 80),
  unit_price   numeric(10,2) not null check (unit_price >= 0),
  qty          integer not null check (qty between 1 and 30),
  line_total   numeric(10,2) not null check (line_total >= 0)
);
create index order_items_order_idx on order_items(order_id);

-- ---------- audit log ----------
create table order_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  event_type text not null check (event_type in ('created','payment_confirmed','payment_rejected','status_changed')),
  old_status order_status,
  new_status order_status,
  changed_by uuid references auth.users(id) on delete set null,
  note       text default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now()
);
create index order_events_order_idx on order_events(order_id, created_at);

-- ---------- public status mirror (for anon Realtime tracking; status ONLY) ----------
create table order_status_public (
  order_number text primary key,
  status       order_status not null default 'received',
  updated_at   timestamptz not null default now()
);

-- ---------- feedback ----------
create table feedback (
  id         uuid primary key default gen_random_uuid(),
  message    text not null check (char_length(message) between 3 and 1000),
  name       text check (name is null or char_length(name) <= 60),
  contact    text check (contact is null or char_length(contact) <= 80),
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- profiles (linked to auth.users) ----------
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      citext not null unique,
  full_name  text not null default '' check (char_length(full_name) <= 60),
  role       user_role not null default 'staff',
  is_active  boolean not null default false,  -- new accounts are inactive until a manager activates them
  created_at timestamptz not null default now()
);

-- ---------- settings ----------
create table settings (
  key        text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  value      text not null default '' check (char_length(value) <= 300),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------- rate limiting log (never directly exposed) ----------
create table rate_log (
  id         bigint generated always as identity primary key,
  ip_hash    text not null,
  action     text not null,
  created_at timestamptz not null default now()
);
create index rate_log_idx on rate_log(ip_hash, action, created_at desc);

-- ---------- settings seeds ----------
insert into settings (key, value) values
  ('instapay_number', ''),
  ('delivery_fee_table', '5'),
  ('delivery_fee_obour', '50')
on conflict (key) do nothing;

-- ---------- updated_at helper ----------
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger orders_touch before update on orders
for each row execute function touch_updated_at();

-- ---------- role helpers (security definer, RLS-free checks) ----------
create or replace function is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'manager' and is_active
  );
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('staff','manager') and is_active
  );
$$;

-- ---------- auth.users -> profiles ----------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, is_active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'staff',
    false
  ) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- stop non-managers from escalating their own role/active flag
-- (bypasses only when there is NO JWT at all == DB-direct bootstrap;
--  every app request carries a JWT: anon or authenticated)
create or replace function enforce_profile_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if coalesce(is_manager(), false) then
      new.email := old.email; -- email is managed by auth
      return new;
    end if;
    -- self-edit: only full_name may change
    new.role := old.role;
    new.is_active := old.is_active;
    new.email := old.email;
    return new;
  end if;
  return new; -- no JWT == direct DB/definer context
end $$;

create trigger profiles_guard before update on profiles
for each row execute function enforce_profile_guard();

-- ---------- audit + status mirror triggers ----------
create or replace function on_order_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into order_events (order_id, event_type, new_status, changed_by)
  values (new.id, 'created', 'received', new.created_by);
  return new;
end $$;

create trigger orders_created after insert on orders
for each row execute function on_order_created();

create or replace function sync_order_status_public() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into order_status_public (order_number, status, updated_at)
  values (new.order_number, new.status, now())
  on conflict (order_number) do update
    set status = excluded.status, updated_at = excluded.updated_at;
  return new;
end $$;

create trigger orders_mirror after insert or update of status on orders
for each row execute function sync_order_status_public();

-- ---------- Realtime publication ----------
alter table order_status_public replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
begin
  alter publication supabase_realtime add table order_status_public;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table orders;
exception when duplicate_object then null;
end $$;

-- ---------- Storage bucket for product images ----------
insert into storage.buckets (id, name, public)
values ('products', 'products', true)
on conflict (id) do nothing;

commit;
