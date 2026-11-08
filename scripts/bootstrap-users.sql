-- إنشاء حسابين (مدير + موظف) مباشرة في auth.users — التريجر بيعمل profile تلقائي
insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
   'authenticated', 'authenticated', 'manager@lalas.app',
   crypt('<SET-NEW-PASSWORD-HERE>', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"لالة المدير"}',
   now(), now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
   'authenticated', 'authenticated', 'staff@lalas.app',
   crypt('<SET-NEW-PASSWORD-HERE>', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"سارة الموظفة"}',
   now(), now());

select email from auth.users where email in ('manager@lalas.app','staff@lalas.app');

-- تفعيل وترقية المدير (دالة الـ bootstrap المؤمّنة)
select promote_first_manager('manager@lalas.app') as promoted;

-- تفعيل الموظفة (بدل ما تعملها يدوي من لوحة المدير)
update profiles set is_active = true, full_name = 'سارة الموظفة'
where email = 'staff@lalas.app';

select email, role, is_active, full_name from profiles;

-- تحسين وصف الفرع الأول في الداتابيز (نفس التصحيح في seed)
update branches set description = 'قلب Lala''s Bakery في العبور: كوفي مختصة، مخبوزات طازة من فرننا كل يوم، وجلسات هادية تكمل يومك ✨'
where name = 'فرع العبور الرئيسي';
