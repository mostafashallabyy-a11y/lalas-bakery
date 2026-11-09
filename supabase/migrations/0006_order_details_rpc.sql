-- ============================================================
-- Lala's Bakery — Phase 1 fix: order details for customer (0006_order_details_rpc.sql)
-- ============================================================
-- Returns order details (items, totals) ONLY when verified by order_number + tracking_key.
-- Never exposes personal data beyond what's needed for the customer's own receipt view.
-- ============================================================
begin;

create or replace function get_order_details(p_order_number text, p_tracking_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_items jsonb;
begin
  if length(trim(coalesce(p_order_number,''))) = 0 or length(trim(coalesce(p_tracking_key,''))) = 0 then
    return jsonb_build_object('ok', false, 'message', 'بيانات ناقصة');
  end if;

  select o.id, o.order_number, o.status, o.delivery_type, o.delivery_fee, o.subtotal, o.total, o.created_at, b.name as branch_name
  into v_order
  from orders o
  join branches b on b.id = o.branch_id
  where o.order_number = p_order_number
    and o.tracking_key::text = p_tracking_key;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'مفتاح التتبع مش مطابق لهذا الطلب');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', i.name_snapshot,
    'qty', i.qty,
    'unit_price', i.unit_price,
    'line_total', i.line_total
  ) order by i.id), '[]'::jsonb)
  into v_items
  from order_items i
  where i.order_id = v_order.id;

  return jsonb_build_object(
    'ok', true,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'branch_name', v_order.branch_name,
    'delivery_type', v_order.delivery_type,
    'delivery_fee', v_order.delivery_fee,
    'subtotal', v_order.subtotal,
    'total', v_order.total,
    'created_at', v_order.created_at,
    'items', v_items
  );
end $$;

grant execute on function get_order_details(text, text) to anon;

commit;
