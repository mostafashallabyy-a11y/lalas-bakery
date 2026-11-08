-- إضافة هويات البريد للحسابات اللي اتعملت مباشرة
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, 'email', 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u
where u.email in ('manager@lalas.app','staff@lalas.app')
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider_id = 'email');

select u.email, count(i.id)::int as identities
from auth.users u left join auth.identities i on i.user_id = u.id
group by u.email;
