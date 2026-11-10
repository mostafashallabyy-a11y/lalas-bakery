import { check, sleep } from "k6";
import http from "k6/http";

// ============================================================
// Lala's Bakery - Load Test Scenarios
// ============================================================
// Supabase project configuration - SET THESE ENV VARS BEFORE RUNNING:
//   export SUPABASE_URL="https://your-project.supabase.co"
//   export SUPABASE_ANON_KEY="sb_publishable_your_key"
//   export STOCK_PRODUCT_ID="your-product-uuid"
//   export BRANCH_ID="your-branch-uuid"
// ============================================================

const SUPABASE_URL = __ENV.SUPABASE_URL || "https://clzdajzsgacivzfenmyq.supabase.co";
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || "sb_publishable_g5FxMTfLq0HdLZXkMQM_hw_Mk9KUivV";
const STOCK_PRODUCT_ID = __ENV.STOCK_PRODUCT_ID || "326d24da-02aa-4e3f-bf75-b68ca6301e30";
const BRANCH_ID = __ENV.BRANCH_ID || "00000000-0000-0000-0000-000000000001";

// ============================================================
// Helper Functions
// ============================================================

function supabaseFetch(path) {
  return http.get(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
}

function supabaseRpc(functionName, payload) {
  return http.post(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
}

function checkResponse(res, expectedStatus = 200) {
  return check(res, {
    [`${res.method} ${res.url} status ${expectedStatus}`]: (r) => r.status === expectedStatus,
  });
}

// ============================================================
// Test Scenarios
// ============================================================

export function browseAndOrder() {
  // Step 1: Browse branches (public read)
  const branchesResp = supabaseFetch("/rest/v1/branches?select=*&is_active=eq.true&order=sort_order");
  check(branchesResp, {
    "branches loaded": (r) => r.status === 200,
    "branches has data": (r) => r.json().length > 0,
  });

  sleep(1);

  // Step 2: Get products for first branch
  const branches = branchesResp.json();
  const branch = branches[0];
  const productsResp = supabaseFetch(`/rest/v1/products?select=*&branch_id=eq.${branch.id}&is_active=eq.true&order=sort_order`);
  check(productsResp, {
    "products loaded": (r) => r.status === 200,
    "products has data": (r) => r.json().length > 0,
  });

  sleep(1);

  // Step 3: Create order via RPC
  const items = productsResp.json().slice(0, 2).map(p => ({
    product_id: p.id,
    qty: 1,
  }));

  const orderResp = supabaseRpc("submit_order_v2", {
    p_branch_id: branch.id,
    p_items: items,
    p_delivery_type: "pickup",
    p_customer_name: "Load Test Customer",
    p_turnstile_token: null,
  });

  const orderOk = check(orderResp, {
    "order created": (r) => r.status === 200,
    "order has number": (r) => r.json().ok === true,
    "order has number field": (r) => !!r.json().order_number,
  });

  if (!orderOk) {
    return;
  }

  const orderNumber = orderResp.json().order_number;

  sleep(1);

  // Step 4: Track order
  const trackResp = supabaseRpc("track_order", {
    p_order_number: orderNumber,
  });

  check(trackResp, {
    "order tracked": (r) => r.status === 200,
    "order status received": (r) => r.json().status === "received",
  });

  sleep(1);

  // Step 5: Get payment info
  const payResp = supabaseRpc("get_payment_info", {
    p_order_number: orderNumber,
  });

  check(payResp, {
    "payment info fetched": (r) => r.status === 200,
  });
}
