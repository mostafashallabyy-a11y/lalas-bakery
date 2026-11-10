-- ============================================================
-- Lala's Bakery — 0012: stock tables (products columns, stock_movements,
-- low_stock_alerts, RLS, grants). Idempotent: safe to re-run.
-- ============================================================
begin;

alter table products add column if not exists stock_qty integer default 0 check (stock_qty >= 0);
alter table products add column if not exists low_stock_threshold integer default 10 check (low_stock_threshold >= 0);
alter table products add column if not exists track_stock boolean default true;

create index if not exists products_stock_idx on products(stock_qty, track_stock);

create table if not exists stock_movements (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references products(id) on delete cascade,
  branch_id    uuid not null references branches(id) on delete cascade,
  change_qty   integer not null,
  reason       text not null check (reason in ('sale','restock','manual_edit','void','expiry')),
  changed_by   uuid references auth.users(id) on delete set null,
  order_id     uuid references orders(id) on delete set null,
  note         text default '' check (char_length(note) <= 300),
  created_at   timestamptz not null default now()
);
alter table stock_movements add column if not exists order_id uuid references orders(id) on delete set null;
create index if not exists stock_movements_product_idx on stock_movements(product_id, created_at desc);
create index if not exists stock_movements_branch_idx on stock_movements(branch_id, created_at desc);
create index if not exists stock_movements_order_idx on stock_movements(order_id);

create table if not exists low_stock_alerts (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  branch_id   uuid not null references branches(id) on delete cascade,
  stock_qty   integer not null,
  threshold   integer not null,
  resolved    boolean not null default false,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists low_stock_alerts_product_idx on low_stock_alerts(product_id, resolved);
create index if not exists low_stock_alerts_branch_idx on low_stock_alerts(branch_id, resolved, created_at desc);

alter table stock_movements enable row level security;
alter table stock_movements force row level security;
alter table low_stock_alerts enable row level security;
alter table low_stock_alerts force row level security;

drop policy if exists stock_movements_staff_read on stock_movements;
create policy stock_movements_staff_read on stock_movements for select to authenticated
  using (is_staff());
drop policy if exists stock_movements_manager_all on stock_movements;
create policy stock_movements_manager_all on stock_movements for all to authenticated
  using (is_manager()) with check (is_manager());

drop policy if exists low_stock_alerts_staff_read on low_stock_alerts;
create policy low_stock_alerts_staff_read on low_stock_alerts for select to authenticated
  using (is_staff());
drop policy if exists low_stock_alerts_manager_all on low_stock_alerts;
create policy low_stock_alerts_manager_all on low_stock_alerts for all to authenticated
  using (is_manager()) with check (is_manager());

revoke all on stock_movements from anon;
revoke all on low_stock_alerts from anon;
grant select, insert on stock_movements to authenticated;
grant select, insert, update on low_stock_alerts to authenticated;

commit;
