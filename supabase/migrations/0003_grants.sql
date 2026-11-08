-- ============================================================
-- Lala's Bakery — Phase 1 addendum: PostgREST role grants (0003_grants.sql)
-- Tables created outside the dashboard don't inherit Supabase default
-- privileges, so we grant explicitly. RLS stays the real gatekeeper.
-- ============================================================
begin;

revoke all on all tables in schema public from anon, authenticated;

-- ---- anon: قراءة عامة فقط (RLS يحدد الصفوف) ----
grant select on branches to anon;
grant select on categories to anon;
grant select on products to anon;
grant select on settings to anon;             -- RLS: instapay_number فقط
grant select on order_status_public to anon;  -- الحالة فقط

grant execute on function submit_order(uuid, jsonb, text, text, text) to anon;
grant execute on function submit_feedback(text, text, text, text) to anon;
grant execute on function track_order(text) to anon;
grant execute on function get_payment_info(text) to anon;
grant execute on function promote_first_manager(citext) to anon, authenticated;

-- ---- authenticated (staff/manager): قراءة أولية، RLS يفلتر ----
grant select on branches, categories, products, settings to authenticated;
grant select on order_status_public to authenticated;
grant select on orders, order_items, order_events to authenticated;
grant select on profiles to authenticated;
grant select on feedback to authenticated;

-- إدارة كاملة (سياسات RLS تسمح للمدير فقط فعليًا)
grant insert, update, delete on branches, categories, products, settings to authenticated;
grant insert, update, delete on feedback to authenticated;
grant insert, update, delete on profiles to authenticated;
grant insert, update, delete on orders, order_items, order_events to authenticated;

grant execute on function manager_report(date, date) to authenticated;
grant execute on function staff_set_status(uuid, order_status) to authenticated;
grant execute on function staff_set_payment(uuid, boolean) to authenticated;

-- ---- rate_log: مقفول تمامًا (RPCs definer فقط تعمل) ----
revoke all on rate_log from anon, authenticated;

-- الخلاط: أي جدول جديد ينشئه postgres يرث الصلاحيات دي تلقائيًا
alter default privileges for role postgres in schema public
  grant select on tables to anon;
alter default privileges for role postgres in schema public
  grant select on tables to authenticated;

commit;
