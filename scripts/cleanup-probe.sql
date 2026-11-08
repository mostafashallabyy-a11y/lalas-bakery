-- حذف مستخدم التمحيص + التأكد من وصف الفرع
delete from auth.users where email = 'probe-test@x.com';

select email, role::text, is_active, full_name from profiles order by role desc, email;
select name, description from branches order by sort_order;
