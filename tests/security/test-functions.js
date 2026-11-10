import http from "k6/http";
import { check } from "k6";

// ============================================================
// SECURITY DEFINER FUNCTION SECURITY TESTS
// ============================================================
// Tests that SECURITY DEFINER functions properly validate inputs
// and enforce role checks.
//
// Tests:
//   - submit_order_v2 with invalid items (should reject)
//   - submit_order_v2 with empty items (should reject)
//   - track_order_by_key with wrong key (should reject)
//   - submit_order_v2 as anon (should work - it's grant to anon)
//   - staff_confirm_payment as anon (should reject - auth required)
//   - staff_confirm_payment as staff (should work)
//
// ENV VARS:
//   SUPABASE_URL, SUPABASE_ANON_KEY, STOCK_PRODUCT_ID, BRANCH_ID
//   STAFF_A_JWT, MANAGER_JWT
// ============================================================

export const options = {
  vus: 1,
  iterations: 1,
  tags: {
    test: "rpc-security",
  },
};

const SUPABASE_URL = __ENV.SUPABASE_URL || "https://clzdajzsgacivzfenmyq.supabase.co";
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || "sb_publishable_g5FxMTfLq0HdLZXkMQM_hw_Mk9KUivV";

function rpcAnon(functionName, payload) {
  return http.post(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
}

function rpcAuth(functionName, payload, token) {
  return http.post(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
}

const results = [];

function test(name, condition, detail = "") {
  results.push({ test: name, pass: condition, detail });
  console.log(`${condition ? "PASS" : "FAIL"}: ${name} ${detail ? "- " + detail : ""}`);
}

export default function () {
  const PRODUCT_ID = __ENV.STOCK_PRODUCT_ID || "326d24da-02aa-4e3f-bf75-b68ca6301e30";
  const BRANCH_ID = __ENV.BRANCH_ID || "00000000-0000-0000-0000-000000000001";
  const STAFF_JWT = __ENV.STAFF_A_JWT || "";
  const MANAGER_JWT = __ENV.MANAGER_JWT || "";

  // ============================================================
  // Test 1: submit_order_v2 with empty items (should reject)
  // ============================================================
  const emptyResp = rpcAnon("submit_order_v2", {
    p_branch_id: BRANCH_ID,
    p_items: [],
    p_delivery_type: "pickup",
    p_customer_name: "Test",
    p_turnstile_token: null,
  });
  test("submit_order_v2 rejects empty items", emptyResp.status === 200 && emptyResp.json().ok === false, `status=${emptyResp.status}`);

  // ============================================================
  // Test 2: submit_order_v2 with invalid product_id (should reject)
  // ============================================================
  const badProdResp = rpcAnon("submit_order_v2", {
    p_branch_id: BRANCH_ID,
    p_items: [{ product_id: "00000000-0000-0000-0000-000000000000", qty: 1 }],
    p_delivery_type: "pickup",
    p_customer_name: "Test",
    p_turnstile_token: null,
  });
  test("submit_order_v2 rejects invalid product", badResp.status === 200 && badResp.json().ok === false, `status=${badResp.status}`);

  // ============================================================
  // Test 3: submit_order_v2 with valid data (should succeed)
  // ============================================================
  const validResp = rpcAnon("submit_order_v2", {
    p_branch_id: BRANCH_ID,
    p_items: [{ product_id: PRODUCT_ID, qty: 1 }],
    p_delivery_type: "pickup",
    p_customer_name: "Security Test",
    p_turnstile_token: null,
  });
  test("submit_order_v2 accepts valid order", validResp.status === 200 && validResp.json().ok === true, `status=${validResp.status}`);

  // ============================================================
  // Test 4: track_order_by_key with wrong key (should reject)
  // ============================================================
  const wrongKeyResp = rpcAnon("track_order_by_key", {
    p_order_number: "LB-999999",
    p_tracking_key: "wrong-key",
  });
  test("track_order_by_key rejects wrong key", wrongKeyResp.status === 200 && wrongKeyResp.json().ok === false, `status=${wrongKeyResp.status}`);

  // ============================================================
  // Test 5: staff_confirm_password as anon (should reject - no auth)
  // ============================================================
  const staffResp = rpcAnon("staff_confirm_payment", {
    p_order_id: "00000000-0000-0000-0000-000000000001",
  });
  test("staff_confirm_payment rejects anon", staffResp.status === 401 || staffResp.status === 403, `status=${staffResp.status}`);

  // ============================================================
  // Test 6: void_request as anon (should reject - no auth)
  // ============================================================
  const voidResp = rpcAnon("void_request", {
    p_order_id: "00000000-0000-0000-0000-000000000001",
    p_reason: "Test void",
  });
  test("void_request rejects anon", voidResp.status === 401 || voidResp.status === 403, `status=${voidResp.status}`);

  // ============================================================
  // Test 7: staff_confirm_payment as staff (should work if staff JWT provided)
  // ============================================================
  if (STAFF_JWT) {
    const staffConfirmResp = rpcAuth("staff_confirm_payment", {
      p_order_id: "00000000-0000-0000-0000-000000000001",
    }, STAFF_JWT);
    test("staff_confirm_payment works as staff", staffConfirmResp.status === 200 || staffConfirmResp.status === 400, `status=${staffConfirmResp.status}`);
  } else {
    console.log("SKIP: STAFF_A_JWT not set");
  }

  // ============================================================
  // Test 8: void_approve as manager (should work if manager JWT provided)
  // ============================================================
  if (MANAGER_JWT) {
    const managerResp = rpcAuth("void_approve", {
      p_void_id: "00000000-0000-0000-0000-000000000001",
      p_approved: true,
    }, MANAGER_JWT);
    test("void_approve works as manager", managerResp.status === 200 || managerResp.status === 400, `status=${managerResp.status}`);
  } else {
    console.log("SKIP: MANAGER_JWT not set");
  }

  // Summary
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`\n=== RPC Security Test Results: ${passed}/${total} passed ===`);
  if (passed < total) {
    throw new Error(`${total - passed} security test(s) failed`);
  }
}
