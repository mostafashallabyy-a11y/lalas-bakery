-- Drop duplicate order_events insert for new orders.
-- Both the on_order_created trigger and the explicit insert in submit_order_v2 /
-- pos_create_order log a 'created' row for every order. Keep the explicit insert
-- (it carries context like pickup/POS source) and drop the trigger.
begin;

drop trigger if exists orders_created on orders;

commit;
