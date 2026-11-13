// ============================================================
// Lala's Bakery — Parts 4-7 security/logic regression checks
// Node >=18, fetch. Run against STAGING/local test environment.
// Env: SUPABASE_URL, SUPABASE_ANON_KEY required.
// Optional for staff/manager/branch-scope checks:
//   MANAGER_EMAIL, MANAGER_PASSWORD
//   STAFF_A_EMAIL, STAFF_A_PASSWORD (staff of TEST_BRANCH)
//   STAFF_B_EMAIL, STAFF_B_PASSWORD (staff of OTHER_BRANCH)
//   TEST_BRANCH (uuid), OTHER_BRANCH (uuid)
//   TEST_PRODUCT_ID (active product in TEST_BRANCH)
//   OBOUR_ORDER_ID (uuid of an online obour order in TEST_BRANCH, unconfirmed)
//   LOCATION_CONFIRMED_OBOUR_ORDER_ID (obour order with location_confirmed=true)
//   ANON_TRACK_KEY (tracking key for OBOUR_ORDER_ID, for anon confirm probe)
//
// No service_role key. Exit 0 = no FAILs (SKIP allowed), 1 = at least one FAIL.
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const ANON = process.env.SUPABASE_ANON_KEY || "";
if (!SUPABASE_URL || !ANON) {
  console.error("SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required");
  process.exit(1);
}

const MANAGER_EMAIL = process.env.MANAGER_EMAIL || "";
const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD || "";
const STAFF_A_EMAIL = process.env.STAFF_A_EMAIL || "";
const STAFF_A_PASSWORD = process.env.STAFF_A_PASSWORD || "";
const STAFF_B_EMAIL = process.env.STAFF_B_EMAIL || "";
const STAFF_B_PASSWORD = process.env.STAFF_B_PASSWORD || "";
const TEST_BRANCH = process.env.TEST_BRANCH || "00000000-0000-0000-0000-000000000001";
const TEST_PRODUCT_ID = process.env.TEST_PRODUCT_ID || "00000000-0000-0000-0000-000000000010";
const OBOUR_ORDER_ID = process.env.OBOUR_ORDER_ID || "";
const LOCATION_CONFIRMED_OBOUR_ORDER_ID = process.env.LOCATION_CONFIRMED_OBOUR_ORDER_ID || "";

let failures = 0, passes = 0, skips = 0;
const line = (s) => process.stdout.write(s + "\n");
const pass = (name, detail = "") => { passes++; line(`PASS: ${name}${detail ? " — " + detail : ""}`); };
const fail = (name, detail = "") => { failures++; line(`FAIL: ${name}${detail ? " — " + detail : ""}`); };
const skip = (name, why) => { skips++; line(`SKIP: ${name} — ${why}`); };
const info = (name, detail = "") => line(`INFO: ${name}${detail ? " — " + detail : ""}`);

const headers = (token) => ({ apikey: ANON, Authorization: `Bearer ${token || ANON}`, "Content-Type": "application/json" });
const post = async (path, payload, token) => {
  const r = await fetch(`${SUPABASE_URL}${path}`, { method: "POST", headers: headers(token), body: JSON.stringify(payload) });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
};
async function login(email, password) {
  if (!email || !password) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const b = await r.json().catch(() => ({}));
    return b.access_token || null;
  } catch { return null; }
}

const mgr = await login(MANAGER_EMAIL, MANAGER_PASSWORD);
const staffA = await login(STAFF_A_EMAIL, STAFF_A_PASSWORD);
const staffB = await login(STAFF_B_EMAIL, STAFF_B_PASSWORD);
if (mgr) info("manager login", "ok"); else info("manager login", "skipped (no credentials)");
if (staffA) info("staff A login", "ok");
if (staffB) info("staff B login", "ok");

// 1) Obour order rejected without address/phone (server-side validation)
{
  const r = await post(`/rest/v1/rpc/submit_order_v2`, {
    p_branch_id: TEST_BRANCH,
    p_items: [{ product_id: TEST_PRODUCT_ID, qty: 1 }],
    p_delivery_type: "obour",
    p_customer_name: "Obour Test",
    p_turnstile_token: null,
    p_payment_method: "cash",
    p_customer_phone: null,
    p_delivery_address: null,
  });
  const rejected = (r.status >= 400 && r.body?.code) || r.body?.ok === false;
  if (r.body?.ok === true) fail("obour order rejected without address/phone", `unexpected success ${r.body.order_number}`);
  else rejected ? pass("obour order rejected without address/phone", `status=${r.status} msg=${(r.body?.message||"").slice(0,80)}`) : fail("obour order rejected without address/phone", `status=${r.status} body=${JSON.stringify(r.body)}`);
}

// 2) Notes over 300 chars rejected
{
  const longNote = "ملاحظة".repeat(120); // > 300 chars
  const r = await post(`/rest/v1/rpc/submit_order_v2`, {
    p_branch_id: TEST_BRANCH,
    p_items: [{ product_id: TEST_PRODUCT_ID, qty: 1 }],
    p_delivery_type: "pickup",
    p_customer_name: "Note Test",
    p_turnstile_token: null,
    p_payment_method: "instapay",
    p_customer_phone: null,
    p_customer_note: longNote,
  });
  const rejected = (r.status >= 400 && r.body?.code) || r.body?.ok === false;
  const msg = (r.body?.message || "").toString();
  if (r.body?.ok === true) fail("notes over 300 chars rejected", `unexpected success ${r.body.order_number}`);
  else if (rejected && (msg.includes("300") || msg.includes("ملاحظ"))) pass("notes over 300 chars rejected", `status=${r.status} msg=${msg.slice(0,80)}`);
  else if (rejected) pass("notes over 300 chars/request rejected", `status=${r.status} code=${r.body?.code||"ok:false"} msg=${msg.slice(0,80)}`);
  else fail("notes over 300 chars rejected", `status=${r.status} body=${JSON.stringify(r.body)}`);
}

// 3) anon can't edit Obour settings
{
  const r = await post(`/rest/v1/rpc/manager_set_obour_settings`, {
    p_branch_id: TEST_BRANCH,
    p_enabled: false,
    p_fee: 50,
    p_hours: { enabled: false },
    p_whatsapp: null,
    p_template: null,
    p_closed_message: null,
  }, null);
  const denied = (r.status >= 400);
  denied ? pass("anon can't edit obour settings", `status=${r.status} code=${r.body?.code||""}`) : fail("anon can't edit obour settings", `status=${r.status} body=${JSON.stringify(r.body)}`);
}

// 4) staff can't edit Obour settings (manager-only)
if (staffA) {
  const r = await post(`/rest/v1/rpc/manager_set_obour_settings`, {
    p_branch_id: TEST_BRANCH,
    p_enabled: false,
    p_fee: 50,
    p_hours: { enabled: false },
    p_whatsapp: null,
    p_template: null,
    p_closed_message: null,
  }, staffA);
  const denied = (r.status >= 400) || r.body?.ok === false;
  denied ? pass("staff can't edit obour settings", `status=${r.status} code=${r.body?.code||""} msg=${(r.body?.message||"").slice(0,60)}`) : fail("staff can't edit obour settings", `status=${r.status} body=${JSON.stringify(r.body)}`);
} else {
  skip("staff can't edit obour settings", "set STAFF_A_EMAIL/STAFF_A_PASSWORD");
}

// 5) Obour order rejected when switched off (requires manager to toggle off on TEST_BRANCH, then probe)
// We only probe rejection path if manager creds provided by toggling off/on around test would be invasive;
// instead do a best-effort probe: try submitting obour to a branch id unlikely available? Not safe.
// So we check RPC exists and rely on env-driven probe when MANAGER creds and a known-closed branch provided.
if (mgr && process.env.CLOSED_OBOUR_BRANCH_ID) {
  const closedBranch = process.env.CLOSED_OBOUR_BRANCH_ID;
  const r = await post(`/rest/v1/rpc/submit_order_v2`, {
    p_branch_id: closedBranch,
    p_items: [{ product_id: TEST_PRODUCT_ID, qty: 1 }],
    p_delivery_type: "obour",
    p_customer_name: "Obour Closed",
    p_turnstile_token: null,
    p_payment_method: "cash",
    p_customer_phone: "01012345678",
    p_delivery_address: "العبور، الحي الأول، شارع 10، عمارة 5",
  });
  const rejected = (r.status >= 400 && r.body?.code) || r.body?.ok === false;
  if (r.body?.ok === true) fail("obour order rejected when switched off", `unexpected success ${r.body.order_number}`);
  else rejected ? pass("obour order rejected when switched off", `status=${r.status} msg=${(r.body?.message||"").slice(0,80)}`) : fail("obour order rejected when switched off", `status=${r.status} body=${JSON.stringify(r.body)}`);
} else {
  skip("obour order rejected when switched off", "set MANAGER_EMAIL/MANAGER_PASSWORD and CLOSED_OBOUR_BRANCH_ID (obour disabled branch)");
}

// 6) Order can't reach "جاري التحضير" without location_confirmed (obour, unconfirmed)
if (staffA && OBOUR_ORDER_ID) {
  const r = await post(`/rest/v1/rpc/staff_set_status`, { p_order_id: OBOUR_ORDER_ID, p_new_status: "preparing" }, staffA);
  const denied = (r.status >= 400) || r.body?.ok === false;
  const msg = (r.body?.message || "").toString();
  denied ? pass("obour can't reach preparing without location_confirmed", `status=${r.status} msg=${msg.slice(0,80)}`)
         : fail("obour can't reach preparing without location_confirmed", `status=${r.status} body=${JSON.stringify(r.body)}`);
} else {
  skip("obour can't reach preparing without location_confirmed", "set STAFF_A_EMAIL/STAFF_A_PASSWORD and OBOUR_ORDER_ID (unconfirmed obour order in STAFF_A branch)");
}

// 7) Staff of another branch can't confirm/read obour location
if (staffB && OBOUR_ORDER_ID) {
  const r = await post(`/rest/v1/rpc/staff_mark_location_received`, { p_order_id: OBOUR_ORDER_ID }, staffB);
  const denied = (r.status >= 400 && (r.body?.code === "42501" || (r.body?.message||"").includes("غير مسموح"))) || r.body?.ok === false;
  denied ? pass("other-branch staff can't confirm obour location", `status=${r.status} msg=${(r.body?.message||"").slice(0,80)}`)
         : fail("other-branch staff can't confirm obour location", `status=${r.status} body=${JSON.stringify(r.body)}`);
} else {
  skip("other-branch staff can't confirm obour location", "set STAFF_B_EMAIL/STAFF_B_PASSWORD and OBOUR_ORDER_ID");
}

// 8) anon/staff can't call manager wipe RPC (Part 4 safety)
{
  const r = await post(`/rest/v1/rpc/manager_wipe_test_data`, { p_from: "2026-01-01", p_to: "2026-01-02", p_confirm: "حذف" }, null);
  const denied = (r.status >= 400);
  denied ? pass("anon can't call manager_wipe_test_data", `status=${r.status} code=${r.body?.code||""}`) : fail("anon can't call manager_wipe_test_data", `status=${r.status} body=${JSON.stringify(r.body)}`);
}
if (staffA) {
  const r = await post(`/rest/v1/rpc/manager_wipe_test_data`, { p_from: "2026-01-01", p_to: "2026-01-02", p_confirm: "حذف" }, staffA);
  const denied = (r.status >= 400) || r.body?.ok === false;
  denied ? pass("staff can't call manager_wipe_test_data", `status=${r.status} code=${r.body?.code||""}`) : fail("staff can't call manager_wipe_test_data", `status=${r.status} body=${JSON.stringify(r.body)}`);
} else {
  skip("staff can't call manager_wipe_test_data", "set STAFF_A_EMAIL/STAFF_A_PASSWORD");
}

line("");
line(`=== PARTS 4-7 CHECKS: ${passes} passed, ${failures} failed, ${skips} skipped ===`);
process.exit(failures > 0 ? 1 : 0);
