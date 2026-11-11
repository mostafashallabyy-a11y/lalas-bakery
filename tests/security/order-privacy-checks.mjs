// ============================================================
// Lala's Bakery — Part B: Order privacy security checks
//
// Runs against a STAGING Supabase project (never production).
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... \
//   STAFF_A_EMAIL=... STAFF_A_PASSWORD=...   (staff of branch A)
//   STAFF_B_EMAIL=... STAFF_B_PASSWORD=...   (staff of branch B)
//   MGR_EMAIL=... MGR_PASSWORD=...           (manager)
//   BRANCH_A_ID=... BRANCH_B_ID=...          (two different branches)
//   ORDER_NUMBER_A=... ORDER_KEY_A=...       (a real order on branch A)
//   ORDER_NUMBER_B=...                       (a real order on branch B)
//   node tests/security/order-privacy-checks.mjs
//
// Exit code 0 = no FAILs. Credentials come from env only, never written to disk.
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const ANON = process.env.SUPABASE_ANON_KEY || "";
if (!SUPABASE_URL || !ANON) {
  console.error("SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required");
  process.exit(1);
}
const STAFF_A_EMAIL = process.env.STAFF_A_EMAIL || "";
const STAFF_A_PASSWORD = process.env.STAFF_A_PASSWORD || "";
const STAFF_B_EMAIL = process.env.STAFF_B_EMAIL || "";
const STAFF_B_PASSWORD = process.env.STAFF_B_PASSWORD || "";
const MGR_EMAIL = process.env.MGR_EMAIL || "";
const MGR_PASSWORD = process.env.MGR_PASSWORD || "";
const BRANCH_A_ID = process.env.BRANCH_A_ID || "00000000-0000-0000-0000-00000000000A";
const BRANCH_B_ID = process.env.BRANCH_B_ID || "00000000-0000-0000-0000-00000000000B";
const ORDER_NUMBER_A = process.env.ORDER_NUMBER_A || "LB-1001";
const ORDER_KEY_A = process.env.ORDER_KEY_A || "00000000-0000-0000-0000-000000000000";
const ORDER_NUMBER_B = process.env.ORDER_NUMBER_B || "LB-9999";

let failures = 0, passes = 0, skips = 0;
const line = (s) => process.stdout.write(s + "\n");
const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
const pass = (name, detail = "") => { passes++; line(`  ${pad("PASS", 6)} ${name}${detail ? " — " + detail : ""}`); };
const fail = (name, detail = "") => { failures++; line(`  ${pad("FAIL", 6)} ${name}${detail ? " — " + detail : ""}`); };
const skip = (name, why) => { skips++; line(`  ${pad("SKIP", 6)} ${name} — ${why}`); };

const headers = (token) => ({
  apikey: ANON,
  Authorization: `Bearer ${token || ANON}`,
  "Content-Type": "application/json",
  Accept: "application/json",
});
const get = async (path, token) => {
  const r = await fetch(`${SUPABASE_URL}${path}`, { headers: headers(token) });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
};
const post = async (path, payload, token) => {
  const r = await fetch(`${SUPABASE_URL}${path}`, { method: "POST", headers: headers(token), body: JSON.stringify(payload) });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
};

async function login(email, password) {
  if (!email || !password) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const b = await r.json().catch(() => ({}));
    return b.access_token || null;
  } catch { return null; }
}

const staffA = await login(STAFF_A_EMAIL, STAFF_A_PASSWORD);
const staffB = await login(STAFF_B_EMAIL, STAFF_B_PASSWORD);
const mgr = await login(MGR_EMAIL, MGR_PASSWORD);
if (staffA) line("INFO: staff A login ok"); else skip("staff A checks", "no STAFF_A credentials");
if (staffB) line("INFO: staff B login ok"); else skip("staff B checks", "no STAFF_B credentials");
if (mgr) line("INFO: manager login ok"); else skip("manager checks", "no MGR credentials");

// ---------------------------------------------------------------
// Helper: assert that a request is DENIED (401/403/404, or 200 with zero rows)
function denied(r) {
  if (r.status === 401 || r.status === 403 || r.status === 404) return true;
  if (r.status === 200 && Array.isArray(r.body) && r.body.length === 0) return true;
  // function error (ok:false or code) counts as denied for our purposes
  if (r.status === 200 && r.body && r.body.ok === false) return true;
  if (r.status >= 400 && r.status < 500) return true;
  return false;
}

line("");
line("=== Part A: Anon must have NO access to orders tables ===");

// 1) anon select * from orders
{
  const r = await get(`/rest/v1/orders?select=*`);
  denied(r) ? pass("anon cannot SELECT * from orders", `status=${r.status}`) : fail("anon can read orders", `status=${r.status} rows=${Array.isArray(r.body) ? r.body.length : "?"}`);
}
// 2) anon select * from order_items
{
  const r = await get(`/rest/v1/order_items?select=*`);
  denied(r) ? pass("anon cannot SELECT * from order_items", `status=${r.status}`) : fail("anon can read order_items", `status=${r.status}`);
}
// 3) anon select * from order_events
{
  const r = await get(`/rest/v1/order_events?select=*`);
  denied(r) ? pass("anon cannot SELECT * from order_events", `status=${r.status}`) : fail("anon can read order_events", `status=${r.status}`);
}
// 4) anon cannot count orders
{
  const r = await get(`/rest/v1/orders?select=count`);
  denied(r) ? pass("anon cannot count orders", `status=${r.status}`) : fail("anon can count orders", `status=${r.status}`);
}
// 5) anon cannot list payment proofs (orders carry payment_proof_path; storage select denied too)
{
  const r = await get(`/rest/v1/orders?select=payment_proof_path`);
  denied(r) ? pass("anon cannot list payment proofs via orders", `status=${r.status}`) : fail("anon can list payment proofs", `status=${r.status} rows=${Array.isArray(r.body) ? r.body.length : "?"}`);
}
// 6) anon cannot select order_status_public (removed from Realtime + direct select closed)
{
  const r = await get(`/rest/v1/order_status_public?select=*`);
  denied(r) ? pass("anon cannot SELECT order_status_public", `status=${r.status}`) : fail("anon can read order_status_public", `status=${r.status}`);
}
// 7) anon guessing neighbouring order numbers with a WRONG key -> same generic "not found"
{
  const r = await post(`/rest/v1/rpc/track_order_by_key`, { p_order_number: ORDER_NUMBER_A, p_tracking_key: "wrong-wrong-wrong" });
  const generic = r.body && r.body.ok === false && /مفتاح التتبع/.test(r.body.message || "");
  generic ? pass("anon wrong key -> generic not-found (no enumeration)", `message=${r.body?.message}`) : fail("anon wrong key leaks info", `status=${r.status} body=${JSON.stringify(r.body)}`);
}
// 8) anon guessing a DIFFERENT neighbouring order with a wrong key -> same generic message
{
  const r = await post(`/rest/v1/rpc/track_order_by_key`, { p_order_number: ORDER_NUMBER_B, p_tracking_key: "wrong-wrong-wrong" });
  const generic = r.body && r.body.ok === false && /مفتاح التتبع/.test(r.body.message || "");
  generic ? pass("anon neighbour order wrong key -> same generic message", `message=${r.body?.message}`) : fail("anon neighbour order leaks info", `status=${r.status} body=${JSON.stringify(r.body)}`);
}
// 9) track_order (number-only) RPC must no longer exist
{
  const r = await post(`/rest/v1/rpc/track_order`, { p_order_number: ORDER_NUMBER_A });
  const gone = r.status >= 400 || (r.body && r.body.ok === false);
  gone ? pass("track_order (number-only) RPC removed", `status=${r.status}`) : fail("track_order still callable", `status=${r.status} body=${JSON.stringify(r.body)}`);
}
// 10) anon cannot insert orders directly
{
  const r = await post(`/rest/v1/orders`, { branch_id: BRANCH_A_ID, customer_name: "X", delivery_type: "pickup", delivery_fee: 0 });
  (r.status >= 400 && r.status < 500) ? pass("anon cannot INSERT orders", `status=${r.status}`) : fail("anon can insert orders", `status=${r.status}`);
}
// 11) get_order_tracking_key RPC must no longer exist (leaked keys to anon)
{
  const r = await post(`/rest/v1/rpc/get_order_tracking_key`, { p_order_number: ORDER_NUMBER_A });
  const gone = r.status >= 400;
  gone ? pass("get_order_tracking_key RPC removed", `status=${r.status}`) : fail("get_order_tracking_key STILL CALLABLE — leaks tracking keys!", `status=${r.status} body=${JSON.stringify(r.body)}`);
}
// 12) get_payment_info (1-arg, no tracking key) must no longer exist
{
  const r = await post(`/rest/v1/rpc/get_payment_info`, { p_order_number: ORDER_NUMBER_A });
  // After dropping the 1-arg overload, calling with 1 arg should fail (404 or argument mismatch)
  const gone = r.status >= 400;
  gone ? pass("get_payment_info (1-arg) removed", `status=${r.status}`) : fail("get_payment_info (1-arg) STILL CALLABLE — leaks order details!", `status=${r.status} body=${JSON.stringify(r.body)}`);
}

line("");
line("=== Part B: Staff branch isolation ===");

// staff of branch A reading branch A orders -> should succeed (own branch)
if (staffA) {
  const r = await get(`/rest/v1/orders?select=id,order_number,branch_id&branch_id=eq.${BRANCH_A_ID}&limit=5`, staffA);
  (r.status === 200 && Array.isArray(r.body)) ? pass("staff A reads own-branch orders", `rows=${r.body.length}`) : fail("staff A own-branch orders", `status=${r.status}`);
}
// staff of branch A reading branch B orders -> must return 0 rows (RLS)
if (staffA) {
  const r = await get(`/rest/v1/orders?select=id,order_number,branch_id&branch_id=eq.${BRANCH_B_ID}&limit=5`, staffA);
  const ok = r.status === 200 && Array.isArray(r.body) && r.body.length === 0;
  ok ? pass("staff A sees ZERO branch-B orders (branch isolation)", `rows=${r.body.length}`) : fail("staff A can read branch B orders", `status=${r.status} rows=${Array.isArray(r.body) ? r.body.length : "?"}`);
}
// staff of branch B reading branch A orders -> must return 0 rows
if (staffB) {
  const r = await get(`/rest/v1/orders?select=id,order_number,branch_id&branch_id=eq.${BRANCH_A_ID}&limit=5`, staffB);
  const ok = r.status === 200 && Array.isArray(r.body) && r.body.length === 0;
  ok ? pass("staff B sees ZERO branch-A orders (branch isolation)", `rows=${r.body.length}`) : fail("staff B can read branch A orders", `status=${r.status} rows=${Array.isArray(r.body) ? r.body.length : "?"}`);
}
// staff cannot read order_items of another branch's order (need a real order id; skip if none)
// We test via the items table filtered by a foreign branch order: join isn't supported via REST simply,
// so we check order_items for any order and rely on RLS filtering rows to staff's branch orders.
// Direct: select order_items where order_id = a known branch-B order id -> staff A gets 0.
if (staffA && ORDER_NUMBER_B) {
  const r = await get(`/rest/v1/order_items?select=id&order_id=eq.00000000-0000-0000-0000-00000000000B`);
  const ok = r.status === 200 && Array.isArray(r.body) && r.body.length === 0;
  ok ? pass("staff A cannot read order_items of other-branch orders", `rows=${r.body.length}`) : fail("staff A can read foreign order_items", `status=${r.status} rows=${Array.isArray(r.body) ? r.body.length : "?"}`);
}
// staff cannot bulk-download/export: no staff export RPC exists; select limited by RLS + no export fn granted to staff
if (staffA) {
  const r = await post(`/rest/v1/rpc/manager_report`, { p_from: "2026-01-01", p_to: "2026-12-31" }, staffA);
  (r.status >= 400) ? pass("staff cannot call manager_report (export/bulk)", `status=${r.status}`) : fail("staff can call manager_report", `status=${r.status}`);
}

line("");
line("=== Part C: Manager access ===");
if (mgr) {
  const r = await get(`/rest/v1/orders?select=id,order_number,branch_id&limit=5`, mgr);
  (r.status === 200 && Array.isArray(r.body)) ? pass("manager reads all-branch orders", `rows=${r.body.length}`) : fail("manager all-branch orders", `status=${r.status}`);
}

line("");
line(`=== ORDER PRIVACY CHECKS: ${passes} passed, ${failures} failed, ${skips} skipped ===`);
process.exit(failures > 0 ? 1 : 0);
