import { Client } from "pg";
const URL = "https://lnyodqfksuvgmqkamvbp.supabase.co/rest/v1";
const KEY = "sb_publishable_0YvB7bk2iSPOqHdciYi1YQ_V5MJV63P";

const c = new Client({
  host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432,
  user: "postgres.lnyodqfksuvgmqkamvbp", password: process.env.DB_PASS, database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const { rows: branches } = await c.query("select id from branches where is_active order by sort_order limit 1");
const { rows: prods } = await c.query("select id, price::text from products where is_active and branch_id=$1 limit 1", [branches[0].id]);
const branchId = branches[0].id, prod = prods[0];
await c.end();

for (const dt of ["table", "obour"]) {
  const r = await fetch(`${URL}/rpc/submit_order`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ p_branch_id: branchId, p_items: [{ product_id: prod.id, qty: 1 }], p_delivery_type: dt, p_customer_name: "اختبار رسوم" }),
  });
  console.log(dt, r.status, await r.text());
}
