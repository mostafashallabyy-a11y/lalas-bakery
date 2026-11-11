import { Client } from "pg";
const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required");
  process.exit(1);
}
const URL = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;

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
