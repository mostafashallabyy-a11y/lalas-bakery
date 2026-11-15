-- ============================================================
-- Lala's Bakery — 0038: InstaPay prepared WhatsApp message support
-- ============================================================
-- Adds the manager-editable brand WhatsApp number (default +201141465063)
-- and lets get_order_details return the caller's own name/phone for the
-- same tracking-keyed view (needed for the prepared message).
-- New migration only. RLS stays on. No service_role.
-- ============================================================
begin;

insert into settings (key, value)
values ('brand_whatsapp_number', '+201141465063')
on conflict (key) do nothing;

-- ---- get_order_details: same tracking-key view, now includes caller's name/phone ----
create or replace function get_order_details(
  p_order_number text,
  p_tracking_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_out jsonb;
begin
  if length(trim(coalesce(p_order_number, ''))) = 0
     or length(trim(coalesce(p_tracking_key, ''))) = 0 then
    raise exception 'مفتاح التتبع مش مطابق لهذا الطلب' using errcode = 'P0001';
  end if;

  begin perform expire_unconfirmed_obour_orders(); exception when others then null; end;

  select jsonb_build_object(
    'ok', true,
    'order_number', o.order_number,
    'status', o.status::text,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'instapay_claimed_at', o.instapay_claimed_at,
    'branch_name', b.name,
    'delivery_type', o.delivery_type,
    'delivery_fee', o.delivery_fee,
    'delivery_floor', o.delivery_floor,
    'delivery_spot', o.delivery_spot,
    'delivery_address', case when o.delivery_type = 'obour' then o.delivery_address else null end,
    'delivery_landmark', case when o.delivery_type = 'obour' then o.delivery_landmark else null end,
    'customer_name', o.customer_name,
    'customer_phone', o.customer_phone,
    'location_confirmed', o.location_confirmed,
    'location_confirmed_at', o.location_confirmed_at,
    'branch_obour_whatsapp', case when o.delivery_type = 'obour' then b.obour_whatsapp else null end,
    'branch_obour_whatsapp_template', case when o.delivery_type = 'obour' then b.obour_whatsapp_template else null end,
    'obour_location_reminder_minutes', coalesce((select value::int from settings where key='obour_location_reminder_minutes'), 20),
    'obour_location_cancel_minutes', coalesce((select value::int from settings where key='obour_location_cancel_minutes'), 45),
    'customer_note', o.customer_note,
    'subtotal', o.subtotal,
    'total', o.total,
    'created_at', o.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', i.name_snapshot,
        'qty', i.qty,
        'unit_price', i.unit_price,
        'line_total', i.line_total
      ) order by i.id)
      from order_items i where i.order_id = o.id
    ), '[]'::jsonb)
  ) into v_out
  from orders o
  join branches b on b.id = o.branch_id
  where o.order_number = p_order_number
    and o.tracking_key::text = p_tracking_key;

  if v_out is null then
    raise exception 'مفتاح التتبع مش مطابق لهذا الطلب' using errcode = 'P0001';
  end if;

  return v_out;
end $fn$;
grant execute on function get_order_details(text, text) to anon;

commit;
