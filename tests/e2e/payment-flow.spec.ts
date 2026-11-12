/**
 * Payment-flow smoke test — runs the REAL production build in an iPhone 13 viewport
 * with all Supabase/API calls stubbed (never touches production data).
 *
 * Two scenarios:
 *  1. Normal: branch -> product -> cart -> checkout -> order -> payment page
 *     (payment page must render, never a blank screen)
 *  2. iPhone private-mode simulation: localStorage/sessionStorage throw on every access
 *     (the original crash class) — the flow must still reach the payment page
 *     because of the null-safe storage layer.
 */
import { test, expect, type Page, type Route } from "@playwright/test";

const BRANCH = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const CATEGORY = "33333333-3333-4333-8333-333333333333";
const TRACK_KEY = "d3b07384-d88c-4b88-b05b-798f2c4d5f4b";

const branchRow = {
  id: BRANCH,
  name: "فرع العبور الرئيسي",
  description: "قهوة مختصة ومخبوزات طازة",
  services: ["دليفري"],
  is_active: true,
  sort_order: 0,
  logo: "",
  cover_image: "",
  promo_brief: "",
};

const categoryRow = { id: CATEGORY, name: "مشروبات ساخنة", is_active: true, sort_order: 0 };

const productRow = {
  id: PRODUCT,
  branch_id: BRANCH,
  category_id: CATEGORY,
  name: "إسبريسو لالة",
  price: 30,
  note: "شوت قهوة مركز",
  image_url: "",
  is_active: true,
  sort_order: 0,
  stock_qty: 0,
  low_stock_threshold: 10,
  track_stock: false,
  categories: { name: "مشروبات ساخنة" },
};

const json = (route: Route, data: unknown, status = 200) =>
  route.fulfill({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

async function stubSupabase(page: Page) {
  // Storage (proof upload) — never actually uploaded in a stubbed test
  await page.route("**/storage/v1/object/**", (r) =>
    json(r, { Key: `payment-proofs/LB-1001/${TRACK_KEY}.jpg` })
  );

  await page.route("**/rest/v1/rpc/**", (route) => {
    const url = route.request().url();
    if (url.includes("submit_order_v2")) {
      return json(route, {
        ok: true,
        order_number: "LB-1001",
        order_id: "order-1",
        tracking_key: TRACK_KEY,
        total: 110,
      });
    }
    if (url.includes("get_order_details")) {
      return json(route, {
        ok: true,
        order_number: "LB-1001",
        status: "received",
        branch_name: "فرع العبور الرئيسي",
        delivery_type: "pickup",
        delivery_fee: 0,
        subtotal: 110,
        total: 110,
        items: [
          { name: "إسبريسو لالة", qty: 1, unit_price: 30, line_total: 30 },
        ],
      });
    }
    if (url.includes("get_payment_info")) {
      return json(route, {
        ok: true,
        order_number: "LB-1001",
        total: 110,
        status: "received",
        branch_name: "فرع العبور الرئيسي",
      });
    }
    if (url.includes("track_order_by_key")) {
      return json(route, {
        ok: true,
        order_number: "LB-1001",
        status: "received",
        updated_at: new Date().toISOString(),
      });
    }
    return json(route, { message: "unknown rpc" }, 404);
  });

  await page.route("**/rest/v1/*", (route) => {
    const url = route.request().url();
    if (url.includes("/branches")) return json(route, [branchRow]);
    if (url.includes("/categories")) return json(route, [categoryRow]);
    if (url.includes("/products")) return json(route, [productRow]);
    if (url.includes("/settings")) return json(route, [{ key: "instapay_number", value: "01000000000" }]);
    if (url.includes("/order_status_public")) return json(route, []);
    return json(route, []);
  });

  // Turnstile — never needed in a stubbed run
  await page.route("**/challenges.cloudflare.com/**", (route) =>
    route.fulfill({ status: 200, headers: { "content-type": "application/javascript" }, body: "" })
  );
}

async function runFlow(page: Page) {
  // home -> branch landing -> menu (the real user path)
  await page.goto("/");
  await page.getByRole("button", { name: /شوف المنيو/ }).click();
  await expect(page).toHaveURL(/\/landing/, { timeout: 15000 });
  await page.getByRole("link", { name: /شوف المنيو/ }).or(page.getByRole("button", { name: /شوف المنيو/ })).click();
  await expect(page.getByRole("button", { name: /أضف .+ للسلة/ }).first()).toBeVisible({ timeout: 15000 });

  // add product
  await page.getByRole("button", { name: /أضف .+ للسلة/ }).first().click();

  // cart -> checkout via client-side nav (preserves in-memory cart even with storage blocked)
  await page.getByRole("link", { name: /السلة/ }).first().click();
  await expect(page).toHaveURL(/\/cart/, { timeout: 10000 });
  // CTA on the cart page -> goes to /checkout
  await page.getByRole("button", { name: /تأكيد الطلب والدفع/ }).click();
  await expect(page).toHaveURL(/\/checkout/, { timeout: 10000 });

  await expect(page.locator("#cstm-name")).toBeVisible({ timeout: 10000 });
  await page.fill("#cstm-name", "زبون تجربة");
  await page.getByRole("button", { name: /تأكيد الطلب/ }).click();

  // order page
  await expect(page).toHaveURL(/\/order\/LB-1001\?k=/, { timeout: 10000 });
  await expect(page.getByRole("heading", { name: /طلبك/ })).toBeVisible();
  await expect(page.getByText("LB-1001").first()).toBeVisible();

  // go to payment — THE step that was broken on iPhone
  await page.getByRole("link", { name: /الذهاب/ }).click();
  await expect(page).toHaveURL(/\/pay\/LB-1001\?k=/, { timeout: 10000 });
  await expect(page.getByRole("heading", { name: /طلبك/ })).toBeVisible();
  await expect(page.getByText("خطوات الدفع (InstaPay)")).toBeVisible();
  // never a blank render
  const bodyText = await page.evaluate(() => document.body.innerText.trim().length);
  expect(bodyText).toBeGreaterThan(80);
}

test.describe("order -> payment smoke (stubbed API)", () => {
  test("normal flow reaches the payment page", async ({ page }) => {
    await stubSupabase(page);
    await runFlow(page);
  });

  test("iPhone-private-mode (storage throws) still reaches the payment page", async ({ page }) => {
    await page.addInitScript(() => {
      // every storage access throws — like iPhone Safari Private Mode
      const throwingProxy = <Storage>(() => ({
        getItem: () => { throw new DOMException("QuotaExceededError", "QuotaExceededError"); },
        setItem: () => { throw new DOMException("QuotaExceededError", "QuotaExceededError"); },
        removeItem: () => { throw new DOMException("QuotaExceededError", "QuotaExceededError"); },
        clear: () => { throw new DOMException("QuotaExceededError", "QuotaExceededError"); },
        key: () => { throw new DOMException("QuotaExceededError", "QuotaExceededError"); },
        get length() { throw new DOMException("QuotaExceededError", "QuotaExceededError"); },
      }))();
      Object.defineProperty(window, "localStorage", { get() { return throwingProxy; } });
      Object.defineProperty(window, "sessionStorage", { get() { return throwingProxy; } });
    });
    await stubSupabase(page);
    await runFlow(page);
  });
});
