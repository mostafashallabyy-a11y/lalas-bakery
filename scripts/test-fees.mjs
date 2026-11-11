import fs from "node:fs";
import { Client } from "pg";

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required");
  process.exit(1);
}
const URL = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
const H = { apikey: KEY, "Content-Type": "application/json" };

const c = new Client({
  host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432,
  user: "postgres.lnyodqfksuvgmqkamvbp", password: process.env.DB_PASS, database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const { rows: branches } = await c.query("select id from branches where is_active order by sort_order limit 1");
const { rows: prods } = await c.query("select id, price from products where is_active and branch_id=$1 limit 1", [branches[0].id]);
const branchId = branches[0].id, prod = prods[0];

const mk = (dt) => ({
  p_branch_id: branchId,
  p_items: [{ product_id: prod.id, qty: 1 }],
  p_delivery_type: dt,
  p_customer_name: "اختبار رسوم",
});

for (const dt of ["table", "obour"]) {
  const r = await fetch(`${URL}/rpc/submit_order`, { method: "POST", headers: H, body: JSON.stringify(mk(dt)) });
  const data = await r.json();
  const expect = dt === "table" ? Number(prod.price) + 5 : Number(prod.price) + 50;
  const pass = data?.total === expect;
  console.log(`${pass ? "✅" : "❌"} fee "${dt}": total=${data?.total} (متوقع ${expect})`);
}

await c.end();
// تنظيف بعد الفحص
const sql = fs.readFileSync("scripts/cleanup-tests.sql", "utf8");
const c2 = new Client({
  host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432,
  user: "postgres.lnyodqfksuvgmqkamvbp", password: process.env.DB_PASS, database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await c2.connect();
const res = await c2.query(sql);
for (const row of res.rows.filter((r) => Array.isArray(r))) {
  console.log(row[0]);
}
console.log("🧹 cleanup done (last orders remain: LB-1012 حدثهم آخر تسجيلة security suite)");
await c2.end();
