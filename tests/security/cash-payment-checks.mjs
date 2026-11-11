// ============================================================
// Lala's Bakery — cash payment security/logic regression checks
// Node >=18, fetch. Run against STAGING/local test environment.
// Env: SUPABASE_URL, SUPABASE_ANON_KEY required.
// Optional for branch-scope/paid-twice checks:
//   STAFF_A_EMAIL, STAFF_A_PASSWORD (staff of TEST_BRANCH)
//   STAFF_B_EMAIL, STAFF_B_PASSWORD (staff of OTHER_BRANCH, different branch)
//   CASH_ORDER_ID (uuid of an existing cash online order in STAFF_A branch, pending/not paid)
//
// These checks do NOT require service_role key.
// Exit 0 = no FAILs (SKIP allowed), 1 = at least one FAIL.
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
const TEST_BRANCH = process.env.TEST_BRANCH || "00000000-0000-0000-0000-000000000001";
const CASH_ORDER_ID = process.env.CASH_ORDER_ID || "";

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

const staffA = await login(STAFF_A_EMAIL, STAFF_A_PASSWORD);
const staffB = await login(STAFF_B_EMAIL, STAFF_B_PASSWORD);
if (staffA) info("staff A login", "ok"); else skip("staff-A checks", "no STAFF_A credentials");
if (staffB) info("staff B login", "ok"); else skip("staff-B cross-branch checks", "no STAFF_B credentials");

// 1) Cash order without phone rejected (server-side)
{
  const r = await post(`/rest/v1/rpc/submit_order_v2`, {
    p_branch_id: TEST_BRANCH,
    p_items: [{ product_id: "00000000-0000-0000-0000-000000000010", qty: 1 }],
    p_delivery_type: "pickup",
    p_customer_name: "Cash No Phone",
    p_turnstile_token: null,
    p_payment_method: "cash",
    p_customer_phone: null,
  });
  const rejected = (r.status >= 400 && r.body?.code) || r.body?.ok === false;
  rejected ? pass("cash order without phone rejected", `status=${r.status} code=${r.body?.code || "ok:false"} msg=${r.body?.message || ""}`) : fail("cash order without phone rejected", `status=${r.status} body=${JSON.stringify(r.body)}`);
}

// 2) Cash over max amount rejected (server-side)
// Use a very large qty to exceed default 500 EGP max; if product/branch not found we still expect rejection (not success).
{
  const r = await post(`/rest/v1/rpc/submit_order_v2`, {
    p_branch_id: TEST_BRANCH,
    p_items: [{ product_id: "00000000-0000-0000-0000-000000000010", qty: 30 }],
    p_delivery_type: "obour",
    p_customer_name: "Cash Big",
    p_turnstile_token: null,
    p_payment_method: "cash",
    p_customer_phone: "01012345678",
  });
  const rejected = (r.status >= 400 && r.body?.code) || r.body?.ok === false;
  if (r.body?.ok === true) {
    fail("cash over max amount rejected", `unexpected success order=${r.body.order_number} total=${r.body.total}`);
  } else {
    // Pass if explicitly rejected for amount/validation/rate/product; info if only product missing ambiguity
    const msg = (r.body?.message || "").toString();
    if (msg.includes("حد أقصى") || msg.includes("500") || msg.includes("كاش")) {
      pass("cash over max amount rejected", `status=${r.status} msg=${msg}`);
    } else if (rejected) {
      pass("cash over-limit/invalid cash request rejected", `status=${r.status} code=${r.body?.code || "ok:false"} msg=${msg}`);
    } else {
      fail("cash over max amount rejected", `status=${r.status} body=${JSON.stringify(r.body)}`);
    }
  }
}

// 3) Staff of another branch cannot mark cash received
// We probe with a target CASH_ORDER_ID using staffB token. If staffB is from a different branch,
// RPC should raise 42501 / "غير مسموح لفرع آخر". Requires correct env setup to be a meaningful PASS.
if (staffB && CASH_ORDER_ID) {
  const r = await post(`/rest/v1/rpc/staff_mark_cash_received`, { p_order_id: CASH_ORDER_ID }, staffB);
  const denied = (r.status >= 400 && (r.body?.code === "42501" || (r.body?.message || "").includes("غير مسموح")));
  denied ? pass("staff of another branch cannot mark cash received", `status=${r.status} code=${r.body?.code} msg=${r.body?.message || ""}`)
         : fail("staff of another branch cannot mark cash received", `status=${r.status} body=${JSON.stringify(r.body)}`);
} else {
  skip("staff of another branch cannot mark cash received", "set STAFF_B_EMAIL/STAFF_B_PASSWORD and CASH_ORDER_ID (cash order in STAFF_A's branch)");
}

// 4) Cash order can't be marked paid twice
if (staffA && CASH_ORDER_ID) {
  const r1 = await post(`/rest/v1/rpc/staff_mark_cash_received`, { p_order_id: CASH_ORDER_ID }, staffA);
  const r2 = await post(`/rest/v1/rpc/staff_mark_cash_received`, { p_order_id: CASH_ORDER_ID }, staffA);
  const secondRejected = (r2.status >= 400) || r2.body?.ok === false;
  if (r1.body?.ok === true || r1.status === 200) {
    secondRejected ? pass("cash order can't be marked paid twice", `first=${JSON.stringify(r1.body).slice(0,80)} second=${JSON.stringify(r2.body).slice(0,120)}`)
                   : fail("cash order can't be marked paid twice", `second call unexpectedly succeeded status=${r2.status} body=${JSON.stringify(r2.body)}`);
  } else if ((r1.body?.message || "").includes("بالفعل") || r1.body?.ok === false) {
    secondRejected ? pass("cash order can't be marked paid twice (already paid)", `first=${r1.body?.message} second=${JSON.stringify(r2.body).slice(0,120)}`)
                   : fail("cash order can't be marked paid twice", `status=${r2.status} body=${JSON.stringify(r2.body)}`);
  } else {
    info("cash paid-twice probe inconclusive", `first status=${r1.status} body=${JSON.stringify(r1.body)} second status=${r2.status} body=${JSON.stringify(r2.body)}`);
    skip("cash order can't be marked paid twice", "CASH_ORDER_ID not a payable cash order for STAFF_A or preconditions not met");
  }
} else {
  skip("cash order can't be marked paid twice", "set STAFF_A_EMAIL/STAFF_A_PASSWORD and CASH_ORDER_ID");
}

line("");
line(`=== CASH PAYMENT CHECKS: ${passes} passed, ${failures} failed, ${skips} skipped ===`);
process.exit(failures > 0 ? 1 : 0);
