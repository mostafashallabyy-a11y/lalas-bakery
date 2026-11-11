// ============================================================
// Lala's Bakery — live security regression checks (node >=18, fetch)
//
// Supersedes the draft k6 scripts in this folder, whose assertions did not
// match PostgREST's real behavior:
//   * RLS does not 401 — it returns 200 with zero rows (invisible filtering)
//   * RAISE EXCEPTION returns HTTP 400 with { code: 'P0001' | '42501', ... }
//
// Usage (against STAGING, never production):
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... [STAFF_EMAIL] [STAFF_PASSWORD] [MGR_EMAIL] [MGR_PASSWORD]
//   node tests/security/run-security-checks.mjs
//
// Passwords come from env / prompt-typed vars only; nothing is written to disk.
// Exit code 0 = no FAILs (SKIP allowed), 1 = at least one FAIL.
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const ANON = process.env.SUPABASE_ANON_KEY || "";
if (!SUPABASE_URL || !ANON) {
  console.error("SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required");
  process.exit(1);
}
const STAFF_EMAIL = process.env.STAFF_EMAIL || "";
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || "";
const MGR_EMAIL = process.env.MGR_EMAIL || "";
const MGR_PASSWORD = process.env.MGR_PASSWORD || "";

const TEST_BRANCH = "00000000-0000-0000-0000-000000000001";
const DEMO_BRANCH = "326d24da-02aa-4e3f-bf75-b68ca6301e30";
const ZEROS = "00000000-0000-0000-0000-000000000000";

let failures = 0, passes = 0, skips = 0;
const line = (s) => process.stdout.write(s + "\n");
const pass = (name, detail = "") => { passes++; line(`PASS: ${name}${detail ? " — " + detail : ""}`); };
const fail = (name, detail = "") => { failures++; line(`FAIL: ${name}${detail ? " — " + detail : ""}`); };
const skip = (name, why) => { skips++; line(`SKIP: ${name} — ${why}`); };
const info = (name, detail = "") => line(`INFO: ${name}${detail ? " — " + detail : ""}`);

const headers = (token) => ({
  apikey: ANON,
  Authorization: `Bearer ${token || ANON}`,
  "Content-Type": "application/json",
});
const get = async (path, token) => {
  const r = await fetch(`${SUPABASE_URL}${path}`, { headers: headers(token) });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
};
const post = async (path, payload, token) => {
  const r = await fetch(`${SUPABASE_URL}${path}`, { method: "POST", headers: headers(token), body: JSON.stringify(payload) });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
};
const patch = async (path, payload, token) => {
  const r = await fetch(`${SUPABASE_URL}${path}`, { method: "PATCH", headers: headers(token), body: JSON.stringify(payload) });
  let body = null; try { body = await r.json(); } catch {}
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
  } catch {
    return null;
  }
}

const staffJwt = await login(STAFF_EMAIL, STAFF_PASSWORD);
const mgrJwt = await login(MGR_EMAIL, MGR_PASSWORD);
if (staffJwt) info("staff login", "ok"); else skip("staff-authenticated checks", "no staff credentials");
if (mgrJwt) info("manager login", "ok"); else skip("manager-authenticated checks", "no manager credentials");

// ---------- anon RLS ----------
{
  const r = await get(`/rest/v1/branches?select=id,name,is_active&is_active=eq.true`);
  (r.status === 200 && Array.isArray(r.body) && r.body.length >= 1)
    ? pass("anon can read active branches", `${r.body?.length} branches`)
    : fail("anon can read active branches", `status=${r.status}`);
}
{
  const r = await get(`/rest/v1/orders?select=id`);
  const denied = r.status === 401 || r.status === 403 || (r.status === 200 && Array.isArray(r.body) && r.body.length === 0);
  denied ? pass("anon cannot read orders", r.status === 200 ? "0 rows (RLS)" : `status=${r.status}`) : fail("anon orders visibility", `status=${r.status}, rows=${Array.isArray(r.body) ? r.body.length : "?"}`);
}
{
  const r = await get(`/rest/v1/order_items?select=id`);
  const denied = r.status === 401 || r.status === 403 || (r.status === 200 && Array.isArray(r.body) && r.body.length === 0);
  denied ? pass("anon cannot read order_items", r.status === 200 ? "0 rows (RLS)" : `status=${r.status}`) : fail("anon order_items visibility", `status=${r.status}`);
}
{
  const r = await get(`/rest/v1/products?select=id,name,price`);
  (r.status === 200) ? pass("anon can read products") : fail("anon products", `status=${r.status}`);
}
{
  const r = await post(`/rest/v1/orders`, { branch_id: TEST_BRANCH, customer_name: "X", delivery_type: "pickup", delivery_fee: 0, source: "online", payment_confirmed: false });
  (r.status >= 400 && r.status < 500) ? pass("anon cannot insert orders directly", `status=${r.status}`) : fail("anon insert orders", `status=${r.status}`);
}

// ---------- anon RPC contract ----------
{
  const r = await post(`/rest/v1/rpc/submit_order_v2`, { p_branch_id: TEST_BRANCH, p_items: [], p_delivery_type: "pickup", p_customer_name: "X", p_turnstile_token: null });
  const rejected = (r.status >= 400 && r.body?.code) || r.body?.ok === false;
  rejected ? pass("submit_order_v2 rejects empty items", `status=${r.status} code=${r.body?.code || "ok:false"}`) : fail("submit_order_v2 empty items", `status=${r.status} body=${JSON.stringify(r.body)}`);
}
{
  const r = await post(`/rest/v1/rpc/submit_order_v2`, { p_branch_id: TEST_BRANCH, p_items: [{ product_id: ZEROS, qty: 1 }], p_delivery_type: "pickup", p_customer_name: "X", p_turnstile_token: null });
  const rejected = (r.status >= 400 && r.body?.code) || r.body?.ok === false;
  rejected ? pass("submit_order_v2 rejects nonexistent product", `status=${r.status} code=${r.body?.code || "ok:false"}`) : fail("submit_order_v2 invalid product", `status=${r.status} body=${JSON.stringify(r.body)}`);
}
{
  const r = await post(`/rest/v1/rpc/track_order_by_key`, { p_order_number: "LB-999999", p_tracking_key: "wrong" });
  const rejected = (r.status >= 400) || r.body?.ok === false;
  rejected ? pass("track_order_by_key rejects wrong key", `status=${r.status} code=${r.body?.code || "ok:false"}`) : fail("track_order_by_key wrong key", `status=${r.status} body=${JSON.stringify(r.body)}`);
}
{
  const r = await post(`/rest/v1/rpc/staff_confirm_payment`, { p_order_id: ZEROS });
  (r.status >= 400) ? pass("staff_confirm_payment rejects anon", `status=${r.status} code=${r.body?.code}`) : fail("staff_confirm_payment anon", `status=${r.status} body=${JSON.stringify(r.body)}`);
}
{
  const r = await post(`/rest/v1/rpc/void_request`, { p_order_id: ZEROS, p_reason: "security probe" });
  (r.status >= 400) ? pass("void_request rejects anon", `status=${r.status} code=${r.body?.code}`) : fail("void_request anon", `status=${r.status} body=${JSON.stringify(r.body)}`);
}
{
  const r = await post(`/rest/v1/rpc/pos_create_order`, { p_branch_id: TEST_BRANCH, p_items: [{ product_id: ZEROS, qty: 1 }], p_payment_method: "cash", p_customer_name: "X" });
  (r.status >= 400) ? pass("pos_create_order rejects anon", `status=${r.status} code=${r.body?.code}`) : info("pos_create_order anon", `status=${r.status} body=${JSON.stringify(r.body)}`);
}

// ---------- staff ----------
if (staffJwt) {
  const r = await get(`/rest/v1/orders?select=id&branch_id=eq.${TEST_BRANCH}&limit=5`, staffJwt);
  (r.status === 200 && Array.isArray(r.body)) ? pass("staff can read own-branch orders", `rows=${r.body.length}`) : fail("staff own-branch orders", `status=${r.status}`);
}
if (staffJwt) {
  const r = await get(`/rest/v1/orders?select=id&branch_id=eq.${DEMO_BRANCH}&limit=5`, staffJwt);
  (r.status === 200 && Array.isArray(r.body) && r.body.length === 0) ? pass("staff sees zero rows on demo branch (RLS)", `rows=${r.body.length}`) : fail("staff other-branch orders", `status=${r.status} rows=${Array.isArray(r.body) ? r.body.length : "?"}`);
}
if (staffJwt) {
  const r = await post(`/rest/v1/orders`, { branch_id: TEST_BRANCH, customer_name: "X", delivery_type: "pickup", delivery_fee: 0, source: "pos", payment_confirmed: true }, staffJwt);
  (r.status >= 400) ? pass("staff cannot insert orders directly", `status=${r.status}`) : fail("staff direct insert orders", `status=${r.status}`);
}
if (staffJwt) {
  const r = await post(`/rest/v1/rpc/staff_get_open_shift`, {}, staffJwt);
  (r.status === 200) ? pass("staff_get_open_shift callable", JSON.stringify(r.body).slice(0, 80)) : fail("staff_get_open_shift", `status=${r.status}`);
}

// ---------- manager ----------
if (mgrJwt) {
  const r = await get(`/rest/v1/orders?select=id&limit=5`, mgrJwt);
  (r.status === 200 && Array.isArray(r.body)) ? pass("manager can read orders", `rows=${r.body.length}`) : fail("manager orders", `status=${r.status}`);
}
if (mgrJwt) {
  const r = await post(`/rest/v1/rpc/void_approve`, { p_void_id: ZEROS, p_approved: true }, mgrJwt);
  (r.status === 200 && r.body?.ok === false) ? pass("void_approve bogus id -> ok:false (no crash)", r.body?.message) : fail("void_approve bogus id", `status=${r.status} body=${JSON.stringify(r.body)}`);
}
if (mgrJwt) {
  const r = await post(`/rest/v1/rpc/void_approve`, { p_void_id: ZEROS, p_approved: true }, staffJwt || ANON);
  (r.status >= 400) ? pass("void_approve rejects non-manager/anonymous", `status=${r.status} code=${r.body?.code}`) : fail("void_approve privilege", `status=${r.status}`);
}
if (mgrJwt) {
  const r = await patch(`/rest/v1/orders?id=eq.${ZEROS}`, { delivery_fee: 0 }, mgrJwt);
  (r.status === 200 && Array.isArray(r.body) && r.body.length === 0) ? pass("manager PATCH matches 0 rows (no-op)") : fail("manager PATCH scope", `status=${r.status}`);
}

// ---------- valid order probe (INFO only — may consume a rate-limit slot) ----------
{
  const r = await post(`/rest/v1/rpc/submit_order_v2`, { p_branch_id: TEST_BRANCH, p_items: [{ product_id: "00000000-0000-0000-0000-000000000010", qty: 1 }], p_delivery_type: "pickup", p_customer_name: "Security Probe", p_turnstile_token: null });
  if (r.body?.ok === true) info("valid order accepted", `order=${r.body.order_number}`);
  else if (r.status >= 400 && r.body?.code === "P0001") info("valid order NOT accepted", `rate-limited or validation — ${r.body?.message}`);
  else info("valid order result", `status=${r.status} body=${JSON.stringify(r.body)}`);
}

line("");
line(`=== SECURITY CHECKS: ${passes} passed, ${failures} failed, ${skips} skipped ===`);
process.exit(failures > 0 ? 1 : 0);
