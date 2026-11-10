import http from "k6/http";
import { check, sleep } from "k6";

// ============================================================
// Stock Concurrency Test
// ============================================================
// Tests that concurrent orders don't oversell stock.
// Requires a product with known stock quantity.
// Uses SECURITY DEFINER RPCs which handle row-level locking.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_ANON_KEY, STOCK_PRODUCT_ID, BRANCH_ID
// ============================================================

export const options = {
  vus: 10,
  iterations: 10,
  tags: {
    test: "stock-concurrency",
    action: "concurrent-order-stock-deduction",
  },
};

export default function () {
  const STOCK_PRODUCT_ID = __ENV.STOCK_PRODUCT_ID || "00000000-0000-0000-0000-000000000010";
  const SUPABASE_URL = __ENV.SUPABASE_URL || "https://clzdajzsgacivzfenmyq.supabase.co";
  const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || "sb_publishable_g5FxMTfLq0HdLZXkMQM_hw_Mk9KUivV";
  const BRANCH_ID = __ENV.BRANCH_ID || "00000000-0000-0000-0000-000000000001";

  // Step 1: Get current stock before ordering
  const beforeResp = http.get(
    `${SUPABASE_URL}/rest/v1/products?id=eq.${STOCK_PRODUCT_ID}&select=stock_qty`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );

  const beforeRespJson = beforeResp.json();
  if (!beforeResp || beforeResp.status !== 200 || !beforeRespJson || beforeRespJson.length === 0) {
    console.log(`VU ${__VU}: Failed to fetch stock: ${beforeResp.status}`);
    return;
  }

  const stockBefore = beforeRespJson[0]?.stock_qty;
  if (!stockBefore || stockBefore <= 0) {
    console.log(`VU ${__VU}: Stock is 0 or null (${stockBefore}), skipping order attempt`);
    return;
  }

  // Step 2: Try to order 1 unit
  const orderResp = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/submit_order_v2`,
    JSON.stringify({
      p_branch_id: BRANCH_ID,
      p_items: [{ product_id: STOCK_PRODUCT_ID, qty: 1 }],
      p_delivery_type: "pickup",
      p_customer_name: `Stock Test VU ${__VU}`,
      p_turnstile_token: null,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );

  const orderOk = orderResp.status === 200 && orderResp.json()?.ok === true;

  console.log(
    `VU ${__VU}: order_ok=${orderOk}, stock_before=${stockBefore}`
  );

  sleep(0.5);
}

export function teardown(data) {
  const SUPABASE_URL = __ENV.SUPABASE_URL || "https://clzdajzsgacivzfenmyq.supabase.co";
  const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY || "sb_publishable_g5FxMTfLq0HdLZXkMQM_hw_Mk9KUivV";
  const STOCK_PRODUCT_ID = __ENV.STOCK_PRODUCT_ID || "00000000-0000-0000-0000-000000000010";

  const finalResp = http.get(
    `${SUPABASE_URL}/rest/v1/products?id=eq.${STOCK_PRODUCT_ID}&select=stock_qty`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );

  const stockFinal = finalResp.json()[0]?.stock_qty;
  console.log(`STOCK_FINAL: ${stockFinal}`);

  if (stockFinal < 0) {
    throw new Error(`CRITICAL: Stock went negative! Final stock: ${stockFinal}`);
  }
}
