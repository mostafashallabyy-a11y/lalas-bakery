-- ============================================================
-- Lala's Bakery — 0016: drop the accidental 6-argument overload of
-- submit_order_v2 (p_staff_note text) if it exists. It was created by a
-- broken draft and causes PostgREST error PGRST203
-- ("ambiguous function"), which rejects every checkout call.
-- The canonical signature is the 5-arg one from 0005/0015.
-- ============================================================
begin;

do $fn$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'submit_order_v2'
      and p.pronargs = 6
  ) then
    drop function public.submit_order_v2(uuid, jsonb, text, text, text, text);
    raise notice 'dropped 6-arg overload of submit_order_v2';
  else
    raise notice 'no 6-arg overload present — nothing to drop';
  end if;
end $fn$;

-- belt and braces: also drop if it was created with the parameter named differently
do $fn$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'submit_order_v2'
      and p.pronargs > 5
  ) then
    raise exception 'another overload of submit_order_v2 with >5 args still exists — inspect pg_proc manually';
  end if;
end $fn$;

commit;
