import pg from "pg";
import fs from "node:fs";
const c = new pg.Client({
  host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432,
  user: "postgres.lnyodqfksuvgmqkamvbp", password: process.env.DB_PASS, database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const rl = await c.query("select count(*)::int as n from rate_log");
console.log("rate_log rows:", rl.rows[0].n);
const ord = await c.query("select count(*)::int as n from orders");
console.log("orders:", ord.rows[0].n);
const recent = await c.query("select order_number, customer_name, total from orders order by created_at desc limit 3");
console.log("last orders:", recent.rows);

// تنظيف كل بيانات الاختبار
const sql = fs.readFileSync("scripts/cleanup-tests.sql", "utf8");
const parts = sql.split(";").map((s) => s.trim()).filter(Boolean);
for (const q of parts) {
  try {
    const res = await c.query(q);
    const out = res.rows?.[0];
    if (out && typeof Object.values(out)[0] === "string" || (out && "count" in (out || {}))) console.log(Object.values(out ?? {})[0]);
  } catch (e) {
    console.log("skip:", e.message.slice(0, 60));
  }
}
const left = await c.query("select count(*)::int as n from orders, rate_log limit 1").catch(() => null);
const o2 = await c.query("select count(*)::int as orders from orders");
const r2 = await c.query("select count(*)::int as rate_rows from rate_log");
console.log("after cleanup → orders:", o2.rows[0].orders, "| rate_log rows:", r2.rows[0].rate_rows);
await c.end();
