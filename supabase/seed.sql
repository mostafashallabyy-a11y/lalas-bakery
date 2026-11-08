-- ============================================================
-- Lala's Bakery — seed data (seed.sql)
-- Run AFTER migrations. Idempotent-ish: safe to re-run with fresh DB.
-- ============================================================
begin;

insert into branches (name, description, services, sort_order) values
  ('فرع العبور الرئيسي', 'قلب Lala''s Bakery في العبور: كوفي مختصة، مخبوزات طازة من فرننا كل يوم، وجلسات هادية تكمل يومك ✨', array['دليفري','جلسات هادية','كوفي مختصة','مخبوزات طازة','واي فاي'], 0),
  ('فرع الشروق', 'نسمة لالة في الشروق الأصغر بس بنفس الحب: مشروباتنا على مدار اليوم، تسالينا، وأحلى كيك من Lala''s Bakery 🍰', array['جلسات هادية','كوفي مختصة','مخبوزات طازة'], 1);

insert into categories (name, sort_order) values
  ('مشروبات ساخنة', 0),
  ('مشروبات باردة', 1),
  ('تسالي', 2),
  ('Lala''s Bakery', 3);

-- ----------------------------------------------------------------
-- مشروبات ساخنة
-- ----------------------------------------------------------------
with b as (select id from branches where name = 'فرع العبور الرئيسي'),
     c as (select id from categories where name = 'مشروبات ساخنة')
insert into products (branch_id, category_id, name, price, note, image_url, sort_order)
select b.id, c.id, x.name, x.price, x.note, x.image_url, x.so
from (values
  ('إسبريسو لالة', 30.00, 'شوت قهوة مركز بحب بند نضيف', 'https://images.unsplash.com/photo-1510707577719-ae7c14805e3a?w=600&q=60', 0),
  ('كابتشينو', 40.00, 'فوم حليب مخملي وشوية كاكاو على الوش', 'https://images.unsplash.com/photo-1534778101976-62847782c213?w=600&q=60', 1),
  ('لاتيه', 45.00, 'أنعم لاتيه بفانيليا أو كراميل', 'https://images.unsplash.com/photo-1561047029-3000c68339ca?w=600&q=60', 2),
  ('شاي كمانجيتو', 25.00, 'شاي أحمر بنكهة النعناع والليمون', 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=600&q=60', 3),
  ('هوت تشوكليت', 50.00, 'شوكولاتة ساخنة دايرة دفا باشعورك', 'https://images.unsplash.com/photo-1542990253-a781e04c0082?w=600&q=60', 4)
) as x(name, price, note, image_url, so)
cross join b cross join c;

-- ----------------------------------------------------------------
-- مشروبات باردة
-- ----------------------------------------------------------------
with b as (select id from branches where name = 'فرع العبور الرئيسي'),
     c as (select id from categories where name = 'مشروبات باردة')
insert into products (branch_id, category_id, name, price, note, image_url, sort_order)
select b.id, c.id, x.name, x.price, x.note, x.image_url, x.so
from (values
  ('آيس كابتشينو', 55.00, 'كوفي مبرد على الثلج بفوم الكريمة', 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=600&q=60', 0),
  ('آيس لاتيه كراميل', 55.00, 'طبقات الحليب والكراميل بالظبط على بعض', 'https://images.unsplash.com/photo-1517487881594-2787fef5ebf7?w=600&q=60', 1),
  ('آيس تي خوخ', 45.00, 'شاي مثلج بنقع الخوخ الطازج', 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=600&q=60', 2),
  ('ميلك شيك أوريو', 60.00, 'آيس كريم + أوريو مطحون = سعادة', 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?w=600&q=60', 3),
  ('سموذي فواكه الموسم', 65.00, 'عصير كامل من فواكه السوق للعيد', 'https://images.unsplash.com/photo-1553787499-6f9133860278?w=600&q=60', 4)
) as x(name, price, note, image_url, so)
cross join b cross join c;

-- ----------------------------------------------------------------
-- تسالي
-- ----------------------------------------------------------------
with b as (select id from branches where name = 'فرع العبور الرئيسي'),
     c as (select id from categories where name = 'تسالي')
insert into products (branch_id, category_id, name, price, note, image_url, sort_order)
select b.id, c.id, x.name, x.price, x.note, x.image_url, x.so
from (values
  ('كرواسون بالجبنة', 35.00, 'كرواسون فرن بتكّه طازج بالجبنة', 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600&q=60', 0),
  ('بطاطس ناشفة بالجبنة', 40.00, 'مقاطع بطاطس مقرمشة بالبهارات وجبنة الشيدر', 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=600&q=60', 1),
  ('ساندويش شيش طاووق', 70.00, 'دجاج مشوي طرية مع مايونيز خفيف', 'https://images.unsplash.com/photo-1600891964092-4316c2880325?w=600&q=60', 2),
  ('حلوة تغذية الدايت', 30.00, 'كرات عافية من الشوفان والعسل والمكسرات', 'https://images.unsplash.com/photo-1541600168039-690373e84bb6?w=600&q=60', 3)
) as x(name, price, note, image_url, so)
cross join b cross join c;

-- ----------------------------------------------------------------
-- Lala's Bakery
-- ----------------------------------------------------------------
with b as (select id from branches where name = 'فرع العبور الرئيسي'),
     c as (select id from categories where name = 'Lala''s Bakery')
insert into products (branch_id, category_id, name, price, note, image_url, sort_order)
select b.id, c.id, x.name, x.price, x.note, x.image_url, x.so
from (values
  ('كيكة شوكولاتة موييييييييه', 70.00, 'طبقات شوكولاتة غنية بتذوب في بوقك', 'https://images.unsplash.com/photo-1606313564200-e75d35e96371?w=600&q=60', 0),
  ('تيراميسو كوفي', 85.00, 'الوصفة الأصلية الباردة بقلم كوفي لالة', 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=600&q=60', 1),
  ('تشيز كيك فراولة', 80.00, 'تشيك فراولة طازي على قاعدة بسكويت', 'https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=600&q=60', 2),
  ('سينابون كارمل', 65.00, 'ريحة القرفة والكراميل لحد آخر قطرة', 'https://images.unsplash.com/photo-1534065947-73d3a37129ec?w=600&q=60', 3)
) as x(name, price, note, image_url, so)
cross join b cross join c;

-- فرع الشروق: قائمة مصغرة
with b as (select id from branches where name = 'فرع الشروق'),
     c as (select id from categories where name = 'مشروبات ساخنة')
insert into products (branch_id, category_id, name, price, note, image_url, sort_order)
select b.id, c.id, x.name, x.price, x.note, x.image_url, x.so
from (values
  ('كابتشينو', 40.00, 'فوم حليب مخملي وشوية كاكاو على الوش', 'https://images.unsplash.com/photo-1534778101976-62847782c213?w=600&q=60', 0),
  ('لاتيه', 45.00, 'أنعم لاتيه بفانيليا أو كراميل', 'https://images.unsplash.com/photo-1561047029-3000c68339ca?w=600&q=60', 1)
) as x(name, price, note, image_url, so)
cross join b cross join c;

with b as (select id from branches where name = 'فرع الشروق'),
     c as (select id from categories where name = 'Lala''s Bakery')
insert into products (branch_id, category_id, name, price, note, image_url, sort_order)
select b.id, c.id, x.name, x.price, x.note, x.image_url, x.so
from (values
  ('كيكة شوكولاتة موييييييييه', 70.00, 'طبقات شوكولاتة غنية بتذوب في بوقك', 'https://images.unsplash.com/photo-1606313564200-e75d35e96371?w=600&q=60', 0)
) as x(name, price, note, image_url, so)
cross join b cross join c;

commit;
