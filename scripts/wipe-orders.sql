-- تنظيف أي طلبات اختبار متبقية (المشروع لسه قيد التطوير — مفيش طلبات حقيقية)
delete from order_events where order_id in (select id from orders);
delete from order_items where order_id in (select id from orders);
delete from orders;
delete from rate_log;

select 'orders' as t, count(*) from orders
union all select 'order_items', count(*) from order_items
union all select 'order_events', count(*) from order_events
union all select 'rate_log', count(*) from rate_log
union all select 'feedback', count(*) from feedback;
