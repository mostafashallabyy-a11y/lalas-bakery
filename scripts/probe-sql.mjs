import pg from "pg";
const c = new pg.Client({
  host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432,
  user: "postgres.lnyodqfksuvgmqkamvbp", password: process.env.DB_PASS, database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

// 1) نفس الاستعلام اللي بيفشل
try {
  const r = await c.query("delete from orders where customer_name like 'مروة أحمد (تدفق%')");
  console.log("A fails-there OK:", r.rowCount);
} catch (e) { console.log("A FAILED:", e.message); }

// 2) بدون أقواس
try {
  const r = await c.query("select customer_name from orders where customer_name like 'مروة%'");
  console.log("B no-paren OK:", r.rowCount);
} catch (e) { console.log("B FAILED:", e.message); }

// 3) التحديد بالـ id من الكود (الطريقة الصح)
const ids = await c.query("select id, customer_name, order_number from orders where customer_name like '%تدفق حقيقي%'");
console.log("C matched:", ids.rows.map(r => r.order_number + " / " + r.customer_name));
await c.end();
