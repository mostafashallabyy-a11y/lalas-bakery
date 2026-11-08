-- تنظيف بيانات الاختبار (بعد ما نخلص). takes test orders + rate log
delete from orders where customer_name like 'طقس رقم%' or customer_name like 'مروة%' or customer_name like 'هدية كمية%' or customer_name like 'منتج وهمي%' or customer_name like 'تسكين%' or customer_name like 'وسيم فاضي%' or customer_name = 'اختبار الأمان' or customer_name like 'كيك%';
delete from feedback where name = 'عميل سعيد' and message like '%فطاير%';
delete from rate_log;
select 'orders left: ' || count(*) from orders;
