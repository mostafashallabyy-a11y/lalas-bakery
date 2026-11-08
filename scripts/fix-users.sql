-- توحيد شكل صفوف المستخدمين مع شكل GoTrue الأصلي تمامًا
-- 1) identity لكل مستخدم بنفس شكل gotrue (provider_id = user id)
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
       now(), now(), now()
from auth.users u
where u.email in ('manager@lalas.app','staff@lalas.app')
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider_id = u.id::text);

-- 2) الأعمدة الفاضية '' بدل NULL زي ما gotrue بيسجل
update auth.users
set recovery_token            = '',
    recovery_sent_at          = null,
    email_change              = '',
    email_change_token_new    = '',
    email_change_token_current = '',
    confirmation_token        = '',
    confirmation_sent_at      = null
where email in ('manager@lalas.app','staff@lalas.app');

select u.email, count(i.id)::int as identities
from auth.users u left join auth.identities i on i.user_id = u.id
group by u.email;
