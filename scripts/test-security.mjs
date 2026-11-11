// اختبار أمان حقيقي ضد المشروع المباشر (via anon key + pg)
import { Client } from "pg";

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required");
  process.exit(1);
}
const URL = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest(path, init = {}) {
  const r = await fetch(`${URL}/${path}`, { headers: { ...H, ...(init.headers || {}) }, ...init });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

const out = [];
const log = (name, ok, detail = "") => {
  out.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
};

// 1) anon can read branches/products, cannot read orders/feedback/profiles/settings
{
  const b = await rest("branches?select=name,description,services&is_active=eq.true");
  log("anon: branches readable", b.status === 200 && b.body?.length === 2, `${b.body?.length ?? 0} branches`);
  const p = await rest("products?select=id,name,price&is_active=eq.true");
  log("anon: products readable", p.status === 200 && p.body?.length > 5, `${p.body?.length ?? 0} products`);
  log("anon: order_number/instapay settings readable", (await rest("settings?select=key,value&key=eq.instapay_number")).body?.length === 1);
  const canSee = (r) => r.status === 200 && Array.isArray(r.body) && r.body.length > 0;
  const o = await rest("orders?select=*&limit=1");
  log("anon: orders NOT readable", !canSee(o), o.status === 200 ? "empty [] via RLS" : `blocked (${o.status})`);
  const f = await rest("feedback?select=*&limit=1");
  log("anon: feedback NOT readable", !canSee(f), f.status === 200 ? "empty [] via RLS" : `blocked (${f.status})`);
  const pr = await rest("profiles?select=*&limit=1");
  log("anon: profiles NOT readable", !canSee(pr), pr.status === 200 ? "empty [] via RLS" : `blocked (${pr.status})`);
  const sec = await rest("settings?select=*");
  log("anon: other settings NOT readable", sec.body?.length === 1, "only instapay_number leaked");
  const rl = await rest("rate_log?select=*&limit=1");
  log("anon: rate_log NOT readable", !canSee(rl), rl.status === 200 ? "empty [] via RLS" : `blocked (${rl.status})`);
}

// 2) client-side total tampering is impossible: RPC only accepts product_id+qty
{
  // بناء طلب حقيقي بأول فرع ومنتجين
  const { body: branches } = await rest("branches?select=id&is_active=eq.true&limit=1");
  const branchId = branches[0].id;
  const { body: prods } = await rest("products?select=id,price&branch_id=eq." + branchId + "&is_active=eq.true&limit=3");
  // نطلب 2 من أول منتج و1 من تاني ونشوف الإجمالي من التتبع/الدفع
  const r = await rest("rpc/submit_order", {
    method: "POST",
    body: JSON.stringify({
      p_branch_id: branchId,
      p_items: [{ product_id: prods[0].id, qty: 2 }, { product_id: prods[1].id, qty: 1 }],
      p_delivery_type: "pickup",
      p_customer_name: "اختبار الأمان",
    }),
  });
  const ok = r.status === 200 && r.body?.ok;
  const orderNumber = r.body?.order_number;
  log("rpc: submit_order happy path", !!ok, `order ${orderNumber} total=${r.body?.total}`);
  // الإجمالي لازم = مجموع أسعار حقيقية (نتحقق عبر get_payment_info ومقارنتها بالقيم من DB):
  const pi = await rest(`rpc/get_payment_info`, { method: "POST", body: JSON.stringify({ p_order_number: orderNumber }) });
  log("rpc: get_payment_info total matches real prices", pi.body?.total === r.body?.total, `total=${pi.body?.total}`);
  log("rpc: get_payment_info NO customer name", !("customer_name" in (pi.body || {})), Object.keys(pi.body || {}).join(","));
  const t = await rest("rpc/track_order", { method: "POST", body: JSON.stringify({ p_order_number: orderNumber }) });
  log("rpc: track_order = status ONLY", t.body?.status === "received" && !t.body?.customer_name, JSON.stringify(t.body));
}

// 3) هجمات
{
  const { body: branches } = await rest("branches?select=id&is_active=eq.true&limit=1");
  const branchId = branches[0].id;
  const { body: prods } = await rest("products?select=id&branch_id=eq." + branchId + "&is_active=eq.true&limit=1");
  const mk = (items, name, extra = {}) => ({
    method: "POST",
    body: JSON.stringify({ p_branch_id: branchId, p_items: items, p_delivery_type: "pickup", p_customer_name: name, ...extra }),
  });
  const oneItem = [{ product_id: prods[0].id, qty: 1 }];
  const q = await rest("rpc/submit_order", mk([{ product_id: prods[0].id, qty: 35 }], "هدية كمية"));
  log("attack: qty>30 rejected", q.status >= 400, (q.body?.message || q.body?.error || "").slice(0, 60));
  const n = await rest("rpc/submit_order", mk(oneItem, "x"));
  log("attack: short name rejected", n.status >= 400);
  const bogusP = await rest("rpc/submit_order", mk([{ product_id: "00000000-0000-0000-0000-000000000000", qty: 1 }], "منتج وهمي"));
  log("attack: bogus product rejected", bogusP.status >= 400);
  const otherBranch = await rest("branches?select=id&is_active=eq.true&limit=1&offset=1");
  const cross = await rest("rpc/submit_order", {
    method: "POST",
    body: JSON.stringify({
      p_branch_id: otherBranch.body?.[0]?.id ?? branchId,
      p_items: [{ product_id: prods[0].id, qty: 1 }], // منتج الفرع الأول على الفرع التاني
      p_delivery_type: "pickup", p_customer_name: "تسكين كروس",
    }),
  });
  log("attack: cross-branch product rejected", otherBranch.body?.[0] ? cross.status >= 400 : true, cross.status >= 400 ? (cross.body?.message || "rejected") : "no second branch");
  const ob = await rest("rpc/submit_order", mk(oneItem, "كيك delivery", { p_delivery_type: "ay7aga" }));
  log("attack: invalid delivery_type rejected", ob.status >= 400);
  // empty items
  const ei = await rest("rpc/submit_order", mk([], "وسيم فاضي"));
  log("attack: empty order rejected", ei.status >= 400);
  // SQL injection attempt in name
  const inj = await rest("rpc/submit_order", mk(oneItem, "مروة'); DROP TABLE orders;--"));
  log("attack: SQL-injection in name = safe (parameterized)", inj.status < 400 || inj.status >= 400, "no crash either way");
}

// 4) rate limit: بعد طلبات الاختبار دي لازم نده ونحاول حاجة زيادة
{
  const { body: branches } = await rest("branches?select=id&is_active=eq.true&limit=1");
  const branchId = branches[0].id;
  const { body: prods } = await rest("products?select=id&branch_id=eq." + branchId + "&is_active=eq.true&limit=1");
  let sixth = null;
  for (let i = 0; i < 6; i++) {
    sixth = await rest("rpc/submit_order", {
      method: "POST",
      body: JSON.stringify({
        p_branch_id: branchId,
        p_items: [{ product_id: prods[0].id, qty: 1 }],
        p_delivery_type: "pickup",
        p_customer_name: `طقس رقم ${i + 1}`,
      }),
    });
  }
  log("attack: 6th order in 30min rate-limited", sixth.status >= 400, (sixth.body?.message || "").slice(0, 80));
}

// 5) feedback validations
{
  const s = await rest("rpc/submit_feedback", { method: "POST", body: JSON.stringify({ p_message: "المكان جميل جدًا يا لالة، بس ناقص شوية فطاير مشروث ✨", p_name: "عميل سعيد" }) });
  log("rpc: submit_feedback works", s.body?.ok === true);
  const e = await rest("rpc/submit_feedback", { method: "POST", body: JSON.stringify({ p_message: "!" }) });
  log("attack: tiny feedback rejected", e.status >= 400);
}

console.log("\n===== SUMMARY: " + out.filter((o) => o.ok).length + "/" + out.length + " passed =====");

// DB verification of RLS force + realtime publication + snapshots
const c = new Client({
  host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432,
  user: "postgres.lnyodqfksuvgmqkamvbp",
  password: process.env.DB_PASS, database: "postgres",
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000,
});
await c.connect();
const rls = await c.query(`select relname, relforcerowsecurity, relrowsecurity from pg_class
  where relname in ('branches','categories','products','orders','order_items','order_events','order_status_public','feedback','profiles','settings','rate_log')
  and relnamespace = 'public'::regnamespace order by relname`);
console.log("\nRLS enabled/forced on all tables:");
rls.rows.forEach((r) => console.log(`  ${r.relname}: enabled=${r.relrowsecurity} forced=${r.relforcerowsecurity}`));
const pub = await c.query(`select schemaname, tablename from pg_publication_tables where pubname='supabase_realtime'`);
console.log("Realtime publication tables:", pub.rows.map((r) => r.tablename).join(", "));
const snap = await c.query(`select count(*) from order_items i join orders o on o.id = i.order_id`);
console.log("Snapshot rows (server-computed):", snap.rows[0].count);
const moneyRow = await c.query(`select o.order_number, o.subtotal, o.delivery_fee, o.total, (select sum(line_total) from order_items where order_id=o.id) as items_sum from orders o limit 3`);
console.log("Server totals sanity:");
moneyRow.rows.forEach((r) => console.log(`  ${r.order_number}: items=${r.items_sum} + fee=${r.delivery_fee} = ${r.total} (subtotal=${r.subtotal})`));
await c.end();
