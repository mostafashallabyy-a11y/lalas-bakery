# ✅ قائمة الأمان قبل الإطلاق — Lala's Bakery

اقفل كل بند يقلي ✅ قبل ما تفتح الموقع للعملاء.

### قاعدة البيانات (Supabase)
- [ ] **0001_init.sql** و **0002_security.sql** و **seed.sql** تم تنفيدهم بالترتيب في SQL Editor.
- [ ] RLS شغالة على كل جدول — تأكد سريع: من SQL Editor شغّل
  `select relname, relrowsecurity from pg_class where relname in ('orders','products','settings','feedback','profiles','rate_log');`
  وكل السطور لازم `t`.
- [ ] الخدمة العامة anon:
  - [ ] مش شايفة `orders`/`feedback`/`profiles` (RLS).
  - [ ] إنشاء الطلبات والآراء **عن طريق RPCs بس** (`submit_order`, `submit_feedback`, `track_order`, `get_payment_info`).
- [ ] `promote_first_manager` مقفولة (بعد تفعيل أول مدير، جرب تنفيذها تاني وأكد إنها بترفض).
- [ ] تسجيل المستخدمين من الصفر مقتول: **Authentication → Settings → Disable sign-ups**.
- [ ] Rate limits شغالة (حاول تبعت 6 طلبات متتالية — المحاولة السادسة ترفض برسالة ودودة).
- [ ] Turnstile Secret اتسجل في `settings` → التحقق بقى إجباري من السيرفر (بيتستخدم pg_net).

### المفاتيح (أخطاء شائعة قاتلة)
- [ ] مفيش **service_role** في أي ملف (ابحث: `grep -r "service_role"` → لازم صفر نتائج).
- [ ] `.env` مش في git (`git status` → مش ظاهر).
- [ ] مفتاح واحد بس ظاهر في الكود: الـ **publishable/anon** (عام بالتصميم).
- [ ] Secrets على GitHub: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_HOST`, `SUPABASE_DB_PASSWORD` — كلها Private repo secrets مش في الملفات.

### الموقع (Cloudflare Pages)
- [ ] المتغيرات البيئية الثلاثة اتضافت والنشر آخر وير شايفهم.
- [ ] `_headers` بيرجّع CSP صح — افتح الـ DevTools → Network → على الملف → تأكد `Content-Security-Policy` ظاهر.
- [ ] الـ Realtime شغال (غيّر حالة طلب من الموظف وشوف التتبع يتحدث لحاليًا).
- [ ] الصور بتتعرض (Supabase Storage bucket `products` عام قراءة).

### الحسابات
- [ ] أول مدير اتعمل وتوّقى بـ `promote_first_manager` **مرة واحدة**.
- [ ] باسورد المدير قوي ومحفوظ في مكان آمن (وخد بالك: Supabase بيطلب تأكيد الإيميل — من Users اضبط Confirmed).
- [ ] 2FA مفعّلة على حسابات GitHub و Supabase و Cloudflare نفسها.
- [ ] مفيش حسابات موظفين مش مفعّلة أو زيادة (راجع شاشة الموظفين).

### البيانات والتقارير
- [ ] `backup.yml` عمل أول Artifact ناجح مرة واحدة على الأقل.
- [ ] `ping.yml` نجح مرة واحدة (Actions حاويها شرح الأخطاء لو حصلت).
- [ ] جرب تصدير CSV من التقارير وافتحه بالإكسل (العربي لازم يبان صح).

### بعد الإطلاق (أسبوعيًا)
- [ ] مراجعة شاشة الآراء والتقارير أسبوعيًا.
- [ ] نزّل باكاب شهري (Download Artifact) واحفظه خارج GitHub لو الطلبات زادت.
