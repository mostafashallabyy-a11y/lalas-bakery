-- Trigger الحماية: يمنع تسامي الصلاحيات من التطبيق.
-- لكن الكونتكت اللي مفيهوش JWT أصلاً (اتصال DB مباشر أو definer bootstrap)
-- لازم يعدي — لأن التطبيق دايمًا بيبعت JWT (anon أو authenticated).
create or replace function enforce_profile_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if coalesce(is_manager(), false) then
      new.email := old.email;
      return new;
    end if;
    -- تعديل الشخص لذاته: الاسم فقط
    new.role := old.role;
    new.is_active := old.is_active;
    new.email := old.email;
    return new;
  end if;
  -- مفيش JWT == اتصال إداري مباشر (bootstrap) — سيع
  return new;
end $$;

select promote_first_manager('manager@lalas.app') as promoted;
update profiles set is_active = true where email = 'staff@lalas.app';
select email, role::text, is_active from profiles order by email;
