select id, order_number, customer_name, total, created_at from orders;
delete from order_events where order_id in (select id from orders);
delete from order_items where order_id in (select id from orders);
delete from orders;
delete from rate_log;
select 'orders' as t, count(*)::int as n from orders
union all select 'rate_log', count(*)::int from rate_log;
