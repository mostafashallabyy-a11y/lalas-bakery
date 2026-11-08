-- حد نفس سياسة موظف قراءة الإعدادات: حماية مفاتيح سرية من موظفين
drop policy if exists settings_read_staff on settings;
create policy settings_read_staff on settings for select to authenticated
  using (key like 'instapay%' or key like 'delivery_fee%');
