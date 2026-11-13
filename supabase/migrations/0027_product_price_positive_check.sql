-- منع المنتجات بسعر غير موجب من الآن (المشكلة: Coffee cake, Marbel cake, Sheko cake كانوا بـ 0)
-- NOT VALID: يجبر أي صف جديد/مُحدّث، من غير ما يأثر على الصفوف القديمة أو يعطل التطبيق.
-- بعد ما الأدمن يصحح أسعار المنتجات الثلاثة في شاشة الإدارة شغّل في سطر واحد:
--   alter table products validate constraint products_price_positive;

alter table products
  add constraint products_price_positive
  check (price > 0)
  not valid;

comment on constraint products_price_positive on products
  is 'السعر لازم يكون أكبر من صفر — يُتحقق على مستوى قاعدة البيانات (NOT VALID لحين تصحيح الصفوف القديمة)';
