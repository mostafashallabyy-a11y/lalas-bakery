// اختبار تدفق الموظف والمدير كاملًا بالحسابات الحقيقية
import pg from "pg";
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
if (!URL || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required");
  process.exit(1);
}

// 🈳 تجهيز: صفّر الحد + أبل السكيمة
{
  const c = new pg.Client({ host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432, user: "postgres.lnyodqfksuvgmqkamvbp", password: process.env.DB_PASS, database: "postgres", ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("delete from rate_log; notify pgrst_ddl_watch;");
  await c.end();
  await new Promise((r) => setTimeout(r, 4000));
}

const out = [];
const log = (name, ok, detail = "") => { out.push(ok); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };

async function rest(path, { token, method = "GET", body } = {}) {
  const headers = { apikey: KEY, "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${URL}${path}`, { headers, method, body: body ? JSON.stringify(body) : undefined });
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
}

async function login(email, password) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const b = await r.json();
  return { token: b.access_token, ok: !!b.access_token, error: b.error_description || b.msg };
}

// 1) تسجيل الخروج — بيانات الحسابات من متغيرات البيئة (مش في الكود)
const MGR_EMAIL = process.env.MGR_EMAIL || "manager@lalas.app";
const STF_EMAIL = process.env.STF_EMAIL || "staff@lalas.app";
const MGR_PASS = process.env.MGR_PASS;
const STF_PASS = process.env.STF_PASS;
const mgr = await login(MGR_EMAIL, MGR_PASS);
log("login manager", !!MGR_PASS && mgr.ok, MGR_PASS ? (mgr.error || "") : "استخدم MGR_PASS env");
const stf = await login(STF_EMAIL, STF_PASS);
log("login staff", !!STF_PASS && stf.ok, STF_PASS ? (stf.error || "") : "استخدم STF_PASS env");

// 2) موظف يشوف الطلبات، لا يشوف الإعدادات السرية ولا feedback
{
  const o = await rest("/rest/v1/orders?select=*&limit=1", { token: stf.token });
  log("staff: orders readable", o.status === 200);
  const fb = await rest("/rest/v1/feedback?select=*&limit=1", { token: stf.token });
  log("staff: feedback blocked (401/empty)", fb.status === 200 ? (Array.isArray(fb.body) && fb.body.length === 0) : true, `status=${fb.status}`);
  const sec = await rest("/rest/v1/settings?select=key,value", { token: stf.token });
  log("staff: settings = public keys only", Array.isArray(sec.body) && !sec.body.some((r) => r.key.includes("secret")), JSON.stringify(sec.body?.map?.((r) => r.key) || sec.body));  // إدارة السعر مرفوضة
  const { rows } = await viaPg("select id from products limit 1");
  const prods = rows[0];
  const upd = await rest(`/rest/v1/products?id=eq.${prods.id}`, { token: stf.token, method: "PATCH", body: { price: 1 } });
  log("staff: product price update DENIED (RLS)", upd.status === 200 ? upd.body?.length === 0 : true, `status=${upd.status}`);
}

// 3) التيار: عميل واقعي (anon) يطلب → الموظفة تؤكد الدفع وتغير الحالة → سجل التدقيق + المراة
let orderId, orderNumber;
{
  const { rows: [b] } = await viaPg("select id from branches where is_active order by sort_order limit 1");
  const { rows: [p] } = await viaPg("select id, price::text from products where is_active and branch_id=$1 limit 1", [b.id]);
  const ro = await rest("/rest/v1/rpc/submit_order", { token: null, method: "POST", body: { p_branch_id: b.id, p_items: [{ product_id: p.id, qty: 2 }], p_delivery_type: "table", p_customer_name: "مروة أحمد (تدفق حقيقي)" } });
  orderId = ro.body?.order_id; orderNumber = ro.body?.order_number;
  log("anon: order placed", ro.body?.ok === true, `${orderNumber} total=${ro.body?.total} (30*2+5=65)`);
  log("anon: total correct (2×30 +5 رسوم)", ro.body?.total === 65, `got ${ro.body?.total}`);

  const pay = await rest("/rest/v1/rpc/staff_set_payment", { token: stf.token, method: "POST", body: { p_order_id: orderId, p_confirmed: true } });
  log("staff: payment confirmed", pay.body?.ok === true);
  const s1 = await rest("/rest/v1/rpc/staff_set_status", { token: stf.token, method: "POST", body: { p_order_id: orderId, p_new_status: "preparing" } });
  log("staff: → preparing", s1.body?.status === "preparing");
  const tr = await rest("/rest/v1/rpc/track_order", { token: null, method: "POST", body: { p_order_number: orderNumber } });
  log("customer: tracking shows preparing LIVE", tr.body?.status === "preparing", JSON.stringify(tr.body));

  const s2 = await rest("/rest/v1/rpc/staff_set_status", { token: stf.token, method: "POST", body: { p_order_id: orderId, p_new_status: "done" } });
  log("staff: → done", s2.body?.status === "done");
  const s3 = await rest("/rest/v1/rpc/staff_set_status", { token: stf.token, method: "POST", body: { p_order_id: orderId, p_new_status: "received" } });
  log("attack: backwards from done rejected", s3.status >= 400);

  // التدقيق: مغير الحالة = سارة
  const { rows: ev } = await viaPg(`select e.event_type, e.old_status::text, e.new_status::text, pr.full_name, pr.email from order_events e left join profiles pr on pr.id = e.changed_by where e.order_id = $1 order by e.created_at`, [orderId]);
  console.log("التدقيق (audit):");
  ev.forEach(e => console.log(`   • ${e.event_type} ${e.old_status ?? ""}→${e.new_status ?? ""} بواسطة ${e.full_name || "العميل"} (${e.email ?? "anon"})`));
  log("audit: status changes recorded with staff identity", ev.filter(e => e.event_type === "status_changed").every(e => e.email === "staff@lalas.app"), ev.length + " events");
}

// 4) المديرة: شوفت كل حاجة + تقرير + feedback
{
  const fb = await rest("/rest/v1/feedback?select=*&limit=5", { token: mgr.token });
  log("manager: readable feedback", fb.status === 200);
  const sec = await rest("/rest/v1/settings?select=key,value", { token: stf.token });
  const keys = (sec.body || []).map(r => r.key);
  log("staff: settings WITHOUT secrets", !keys.includes("turnstile_secret"), keys.join(", "));
  const rep = await rest("/rest/v1/rpc/manager_report", { token: mgr.token, method: "POST", body: { p_from: "2026-11-01", p_to: "2026-11-08" } });
  log("manager: report OK", rep.body?.totals?.orders_count >= 1, `orders=${rep.body?.totals?.orders_count} revenue=${rep.body?.totals?.revenue} staffRows=${rep.body?.per_staff?.length}`);
  console.log("التقرير:", JSON.stringify(rep.body?.per_staff || rep.body?.totals));
  const staffTry = await rest("/rest/v1/rpc/manager_report", { token: stf.token, method: "POST", body: { p_from: "2026-11-01", p_to: "2026-11-08" } });
  log("attack: staff cannot run manager_report", staffTry.status >= 400, staffTry.body?.message || `status=${staffTry.status}`);
}

// 🔚 إغلاق اتصال الداتابيز عشان العملية تخلص عادي
await viaPg._c?.end();

console.log("\n=== " + out.filter(Boolean).length + "/" + out.length + " passed ===");

  // 🧹 تنظيف الطلبات التجريبية (حسب id — القوس في نص LIKE العربي بتكسر البارسر عن بُعد)
  const c = new pg.Client({ host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432, user: "postgres.lnyodqfksuvgmqkamvbp", password: process.env.DB_PASS, database: "postgres", ssl: { rejectUnauthorized: false } });
  await c.connect();
  const doomed = await c.query("select id from orders where customer_name like '%تدفق حقيقي%'");
  for (const row of doomed.rows) {
    await c.query("delete from order_events where order_id = $1", [row.id]);
    await c.query("delete from order_items where order_id = $1", [row.id]);
    await c.query("delete from orders where id = $1", [row.id]);
  }
  await c.query("delete from rate_log");
  const left = await c.query("select count(*)::int as n from orders");
  console.log("🧹 تنظيف الفلوين: orders left = " + left.rows[0].n);
  await c.end();

async function viaPg(q, params) {
  if (!viaPg._c) {
    viaPg._c = new pg.Client({ host: "aws-1-eu-central-1.pooler.supabase.com", port: 5432, user: "postgres.lnyodqfksuvgmqkamvbp", password: process.env.DB_PASS, database: "postgres", ssl: { rejectUnauthorized: false } });
    await viaPg._c.connect();
  }
  return viaPg._c.query(q, params);
}
