-- ضبط رقم InstaPay اللي يظهر للعملاء
insert into settings (key, value) values ('instapay_number', '+201141465063')
on conflict (key) do update set value = excluded.value;

select key, value from settings order by key;
