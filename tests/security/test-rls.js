// @deprecated DRAFT — assertions below do not match PostgREST behavior
// (RLS returns 200 with zero rows or 401; function errors come back as HTTP 400 + code).
// Use tests/security/run-security-checks.mjs instead (verified 11/11 anon PASS on 2026-11-10).
import http from "k6/http";
import { check } from "k6";

// ============================================================
// RLS Security Tests
// ============================================================
// Tests that RLS policies properly restrict access based on user role.
// Tests run as different user roles:
//   - anon (no auth): should only read public data
//   - staff (branch A): should only see own branch data
//   - staff (branch B): should NOT see branch A data
//   - manager: should see all data
//
// ENV VARS:
//   SUPABASE_URL, SUPABASE_ANON_KEY
//   STAFF_A_JWT, STAFF_B_JWT, MANAGER_JWT (JWT tokens for auth)
// ============================================================

export const options = {
  vus: 1,
  iterations: 1,
  tags: {
    test: "rls-security",
  },
};

const SUPABASE_URL = __ENV.SUPABASE_URL || "https://clzdajzsgacivzfenmyq.supabase.co";
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || "sb_publishable_g5FxMTfLq0HdLZXkMQM_hw_Mk9KUivV";

// Helper: make authenticated request
function authedRequest(method, url, token, body = null) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
  };
  if (body) {
    headers["Content-Type"] = "application/json";
    return http.request(method, url, JSON.stringify(body), { headers });
  }
  return http.request(method, url, null, { headers });
}

// Helper: anon request (no auth)
function anonRequest(method, url, body = null) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
  };
  if (body) {
    headers["Content-Type"] = "application/json";
    return http.request(method, url, JSON.stringify(body), { headers });
  }
  return http.request(method, url, null, { headers });
}

// Test results
const results = [];

function test(name, condition, detail = "") {
  results.push({ test: name, pass: condition, detail });
  console.log(`${condition ? "PASS" : "FAIL"}: ${name} ${detail ? "- " + detail : ""}`);
}

export default function () {
  const PRODUCT_ID = __ENV.STOCK_PRODUCT_ID || "326d24da-02aa-4e3f-bf75-b68ca6301e30";
  const BRANCH_ID = __ENV.BRANCH_ID || "00000000-0000-0000-0000-000000000001";

  // Get JWT tokens from env (set these in your environment)
  const STAFF_A_JWT = __ENV.STAFF_A_JWT || "";
  const STAFF_B_JWT = __ENV.STAFF_B_JWT || "";
  const MANAGER_JWT = __ENV.MANAGER_JWT || "";

  // ============================================================
  // Test 1: Anon can read branches (public read)
  // ============================================================
  const branchesResp = anonRequest("GET", `${SUPABASE_URL}/rest/v1/branches?select=*&is_active=eq.true`);
  test("Anon can read branches", branchesResp.status === 200, `status=${branchesResp.status}`);

  // ============================================================
  // Test 2: Anon CANNOT read orders (should be denied)
  // ============================================================
  const ordersResp = anonRequest("GET", `${SUPABASE_URL}/rest/v1/orders?select=*`);
  test("Anon cannot read orders", ordersResp.status === 401 || ordersResp.status === 403, `status=${ordersResp.status}`);

  // ============================================================
  // Test 3: Anon cannot read order_items
  // ============================================================
  const itemsResp = anonRequest("GET", `${SUPABASE_URL}/rest/v1/order_items?select=*`);
  test("Anon cannot read order_items", itemsResp.status === 401 || itemsResp.status === 403, `status=${itemsResp.status}`);

  // ============================================================
  // Test 4: Anon cannot write to orders
  // ============================================================
  const ordersInsertResp = anonRequest("POST", `${SUPABASE_URL}/rest/v1/orders`, {
    branch_id: BRANCH_ID,
    customer_name: "Test",
    delivery_type: "pickup",
    delivery_fee: 0,
    source: "online",
    payment_confirmed: false,
  });
  test("Anon cannot insert orders", ordersInsertResp.status === 401 || ordersInsertResp.status === 403, `status=${ordersInsertResp.status}`);

  // ============================================================
  // Test 5: Staff can read orders from their own branch
  // ============================================================
  if (STAFF_A_JWT) {
    const staffOrdersResp = authedRequest("GET", `${SUPABASE_URL}/rest/v1/orders?select=*&branch_id=eq.${BRANCH_ID}`, STAFF_A_JWT);
    test("Staff can read own branch orders", staffOrdersResp.status === 200, `status=${staffOrdersResp.status}`);
  } else {
    console.log("SKIP: STAFF_A_JWT not set");
  }

  // ============================================================
  // Test 6: Staff CANNOT read orders from another branch
  // ============================================================
  if (STAFF_A_JWT) {
    const otherBranchId = "00000000-0000-0000-0000-000000000002"; // Different branch
    const staffOtherResp = authedRequest("GET", `${SUPABASE_URL}/rest/v1/orders?select=*&branch_id=eq.${otherBranchId}`, STAFF_A_JWT);
    test("Staff cannot read other branch orders", staffOtherResp.status === 200 && staffOrdersResp.json().length === 0, `status=${staffOrdersResp.status}, count=${staffOrdersResp.json().length}`);
  }

  // ============================================================
  // Test 7: Manager can read all orders
  // ============================================================
  if (MANAGER_JWT) {
    const managerResp = authedRequest("GET", `${SUPABASE_URL}/rest/v1/orders?select=*`, MANAGER_JWT);
    test("Manager can read all orders", managerResp.status === 200, `status=${managerResp.status}`);
  } else {
    console.log("SKIP: MANAGER_JWT not set");
  }

  // ============================================================
  // Test 8: Staff cannot insert orders directly (should use RPC)
  // ============================================================
  if (STAFF_A_JWT) {
    const staffInsertResp = authedRequest("POST", `${SUPABASE_URL}/rest/v1/orders`, {
      branch_id: BRANCH_ID,
      customer_name: "Staff Test",
      delivery_type: "pickup",
      delivery_fee: 0,
      source: "pos",
      payment_confirmed: true,
    }, STAFF_A_JWT);
    test("Staff cannot insert orders directly", staffInsertResp.status === 401 || staffInsertResp.status === 403, `status=${staffInsertResp.status}`);
  }

  // ============================================================
  // Test 9: Staff cannot update orders directly
  // ============================================================
  if (STAFF_A_JWT) {
    const staffUpdateResp = authedRequest("PATCH", `${SUPABASE_URL}/rest/v1/orders?id=eq.${PRODUCT_ID}`, {
      payment_confirmed: true,
    }, STAFF_A_JWT);
    test("Staff cannot update orders directly", staffUpdateResp.status === 401 || staffUpdateResp.status === 403, `status=${staffUpdateResp.status}`);
  }

  // ============================================================
  // Test 10: Manager can update orders
  // ============================================================
  if (MANAGER_JWT) {
    const managerUpdateResp = authedRequest("PATCH", `${SUPABASE_URL}/rest/v1/orders?id=eq.${PRODUCT_ID}`, {
      payment_confirmed: true,
    }, MANAGER_JWT);
    test("Manager can update orders", managerUpdateResp.status === 200, `status=${managerUpdateResp.status}`);
  }

  // Summary
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`\n=== RLS Security Test Results: ${passed}/${total} passed ===`);
  if (passed < total) {
    throw new Error(`${total - passed} security test(s) failed`);
  }
}
