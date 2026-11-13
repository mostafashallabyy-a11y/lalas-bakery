// Capture the full screen matrix at 390px, light + dark.
// Usage: node scripts/shots-all.mjs <prefix> [light|dark|both]
// Phase A: live read-only (home, branch, menu, cart, checkout, track, feedback, admin-login)
// Phase B: + RPC stub for the order-submit (cart → checkout → order)
// Phase C: fully stubbed auth + fixtures (staff/admin screens)
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const prefix = process.argv[2] || "after";
const themes = (process.argv[3] || "both") === "both" ? ["light", "dark"] : [process.argv[3] || "light"];
const base = process.env.E2E_BASE || "http://127.0.0.1:4173";
const BRANCH = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const CATEGORY = "33333333-3333-4333-8333-333333333333";
const TRACK_KEY = "d3b07384-d88c-4b88-b05b-798f2c4d5f4b";
const FAKE_UID = "99999999-9999-4999-8999-999999999999";
const FAKE_SESSION = (exp) =>
  JSON.stringify({
    access_token: "stubbed-access-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    refresh_token: "stubbed-refresh",
    user: { id: FAKE_UID, aud: "authenticated", role: "authenticated", email: "manager@lalas.app" },
  });

const branchRow = { id: BRANCH, name: "فرع العبور الرئيسي", description: "قهوة مختصة ومخبوزات طازة", services: ["دليفري"], is_active: true, sort_order: 0, logo: "", cover_image: "", promo_brief: "", cash_enabled: true, cash_max_amount: 500 };
const categoryRow = { id: CATEGORY, name: "مشروبات ساخنة", is_active: true, sort_order: 0 };
const productRow = { id: PRODUCT, branch_id: BRANCH, category_id: CATEGORY, name: "إسبريسو لالة", price: 30, note: "شوت قهوة مركز", image_url: "", is_active: true, sort_order: 0, stock_qty: 5, low_stock_threshold: 2, track_stock: true, categories: { name: "مشروبات ساخنة" } };
const profileRow = { id: FAKE_UID, email: "manager@lalas.app", full_name: "مدير التجربة", role: "manager", is_active: true, created_at: new Date().toISOString() };
const json = (route, data, status = 200) =>
  route.fulfill({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

const stubFonts = async (page) => {
  await page.route("**/fonts.googleapis.com/**", (route) => route.fulfill({ status: 200, headers: { "content-type": "text/css" }, body: "" }));
  await page.route("**/fonts.gstatic.com/**", (route) => route.fulfill({ status: 200, headers: { "content-type": "font/woff2" }, body: "" }));
  await page.route("**/challenges.cloudflare.com/**", (route) => route.fulfill({ status: 200, headers: { "content-type": "application/javascript" }, body: "" }));
};

const browser = await chromium.launch();

for (const theme of themes) {
  const outDir = join(process.cwd(), "docs", "screenshots", prefix, theme);
  mkdirSync(outDir, { recursive: true });

  // ========== Phase A — live, read-only ==========
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ar", colorScheme: theme });
    const page = await ctx.newPage();
    await stubFonts(page);
    const shot = async (name) => {
      try {
        await page.waitForSelector('button:has-text("شوف المنيو"), button:has-text("Add to cart"), button[aria-label^="أضف"], img', { timeout: 20000 });
      } catch {}
      await page.waitForTimeout(1200);
      await page.screenshot({ path: join(outDir, `${name}-390.png`) });
      console.log("okA", theme, name);
    };

    for (const [name, path] of [["home", "/"], ["track", "/track"], ["feedback", "/feedback"], ["admin-login", "/staff/login"], ["cart", "/cart"], ["checkout", "/checkout"]]) {
      await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 40000 });
      await shot(name);
    }
    // branch landing + menu
    await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForTimeout(1800);
    await page.getByRole("button", { name: /شوف المنيو/ }).first().click();
    await page.waitForTimeout(1600);
    await shot("branch-landing");
    const menuPath = new URL(page.url()).pathname.replace(/\/landing$/, "");
    await page.goto(base + menuPath, { waitUntil: "domcontentloaded", timeout: 40000 });
    await shot("menu");
    await ctx.close();
  }

  // ========== Phase B — stub ONLY the order-submit RPCs ==========
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ar", colorScheme: theme });
    const page = await ctx.newPage();
    await stubFonts(page);
    // keep customer data live; stub only the mutating order endpoints + tracking reads
    await page.route("**/rest/v1/rpc/**", (route) => {
      const url = route.request().url();
      if (url.includes("submit_order_v2") || url.includes("get_order_details") || url.includes("get_payment_info") || url.includes("track_order_by_key")) {
        if (url.includes("submit_order_v2")) return json(route, { ok: true, order_number: "LB-1001", order_id: "order-1", tracking_key: TRACK_KEY, total: 110 });
        if (url.includes("get_order_details")) return json(route, { ok: true, order_number: "LB-1001", status: "received", payment_method: "instapay", payment_status: "pending", branch_name: "فرع العبور الرئيسي", delivery_type: "pickup", delivery_fee: 0, subtotal: 110, total: 110, items: [{ name: "إسبريسو لالة", qty: 2, unit_price: 30, line_total: 60 }, { name: "كيك الشوكولاتة", qty: 1, unit_price: 50, line_total: 50 }] });
        if (url.includes("get_payment_info")) return json(route, { ok: true, order_number: "LB-1001", total: 110, status: "received", branch_name: "فرع العبور الرئيسي", payment_method: "instapay", payment_status: "pending" });
        if (url.includes("track_order_by_key")) return json(route, { ok: true, order_number: "LB-1001", status: "received", updated_at: new Date().toISOString() });
      }
      return route.fallback(); // everything else: live
    });

    const shot = async (name) => { await page.waitForTimeout(1400); await page.screenshot({ path: join(outDir, `${name}-390.png`) }); console.log("okB", theme, name); };

    await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForTimeout(1800);
    await page.getByRole("button", { name: /شوف المنيو/ }).first().click();
    await page.waitForTimeout(1600);
    const menuPath = new URL(page.url()).pathname.replace(/\/landing$/, "");
    await page.goto(base + menuPath, { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForTimeout(1200);
    const addBtn = page.getByRole("button", { name: /أضف .+ للسلة/ });
    if (await addBtn.count()) { await addBtn.first().click(); await page.waitForTimeout(400); }
    await page.goto(base + "/cart", { waitUntil: "domcontentloaded", timeout: 40000 });
    await shot("cart"); // NOTE: overwrites Phase A's empty-cart shot with the filled one
    await page.goto(base + "/checkout", { waitUntil: "domcontentloaded", timeout: 40000 });
    await shot("checkout"); // overwrites empty-checkout with filled
    await page.goto(base + "/cart", { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: /تأكيد الطلب/ }).first().click();
    await page.waitForTimeout(900);
    await page.fill("#cstm-name", "زبون تجربة");
    await page.getByRole("button", { name: /تأكيد الطلب/ }).last().click();
    await page.waitForURL(/\/order\//, { timeout: 15000 });
    await shot("order");
    await ctx.close();
  }

  // ========== Phase C — fully stubbed auth + fixtures (staff/admin) ==========
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "ar", colorScheme: theme });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("PAGEERROR", theme, String(e).slice(0, 200)));
    await stubFonts(page);
    await page.route("**/rest/v1/rpc/**", (route) => {
      const url = route.request().url();
      if (url.includes("manager_report_enhanced")) return json(route, { totals: { orders_count: 12, revenue: 2340, paid_count: 9, avg_order: 195 }, per_day: [{ day: "2026-11-10", orders_count: 5, revenue: 950 }, { day: "2026-11-11", orders_count: 7, revenue: 1390 }], per_payment_method: [{ method: "instapay", orders_count: 9, paid_count: 9, revenue: 1800, unpaid_pending_count: 0, cancelled_count: 0 }, { method: "cash", orders_count: 3, paid_count: 0, revenue: 0, unpaid_pending_count: 2, cancelled_count: 1 }], peak_hours: [{ hour: 19, orders_count: 6 }, { hour: 20, orders_count: 4 }], online_vs_pos: { online: { orders_count: 10, revenue: 2000 }, pos: { orders_count: 2, revenue: 340 } }, cash_summary: { unpaid_pending_cash_orders: 2, cancelled_cash_orders: 1 } });
      if (url.includes("manager_product_movement")) return json(route, { products: [{ product: "إسبريسو لالة", qty: 22, revenue: 660 }, { product: "كيك الشوكولاتة", qty: 14, revenue: 700 }], category_share: [{ category: "مشروبات ساخنة", qty: 22, revenue: 660 }], comparison: { current_period_qty: 36, previous_period_qty: 28, current_period_revenue: 1360, previous_period_revenue: 1100 } });
      if (url.includes("manager_staff_performance")) return json(route, { staff: [{ full_name: "مدير التجربة", email: "manager@lalas.app", orders_handled: 12, avg_prep_minutes: 14, median_prep_minutes: 12, orders_over_target: 1, void_requests: 0, shifts_worked: 6, cash_shift_difference: 0 }], target_prep_minutes: 10 });
      if (url.includes("staff_get_open_shift")) return json(route, { ok: true, shift: null });
      if (url.includes("shift_open")) return json(route, { ok: true });
      if (url.includes("expire_stale_cash_orders")) return json(route, { ok: true });
      return json(route, {}, 200);
    });
    await page.route("**/rest/v1/*", (route) => {
      const url = route.request().url();
      if (url.includes("/profiles")) return json(route, [profileRow]);
      if (url.includes("/branches")) return json(route, [branchRow]);
      if (url.includes("/categories")) return json(route, [categoryRow]);
      if (url.includes("/products")) return json(route, [productRow]);
      if (url.includes("/low_stock_alerts")) return json(route, []);
      if (url.includes("/orders")) return json(route, []);
      if (url.includes("/stock_movements")) return json(route, []);
      if (url.includes("/branch_promos")) return json(route, []);
      if (url.includes("/social_links")) return json(route, []);
      if (url.includes("/feedback")) return json(route, []);
      if (url.includes("/settings")) return json(route, [{ key: "instapay_number", value: "01000000000" }]);
      return json(route, []);
    });
    await page.route("**/storage/v1/object/**", (r) => json(r, { Key: "stub/key.jpg" }));

    const exp = Math.floor(Date.now() / 1000) + 3600;
    await ctx.addInitScript((sess) => {
      try { localStorage.setItem("sb-lnyodqfksuvgmqkamvbp-auth-token", sess); } catch {}
      try { sessionStorage.setItem("sb-lnyodqfksuvgmqkamvbp-auth-token", sess); } catch {}
    }, FAKE_SESSION(exp));

    const shot = async (name) => { await page.waitForTimeout(1400); await page.screenshot({ path: join(outDir, `${name}-390.png`) }); console.log("okC", theme, name); };

    await page.goto(base + "/staff/admin", { waitUntil: "domcontentloaded", timeout: 40000 });
    await shot("admin-dashboard");
    await page.goto(base + "/staff/pos", { waitUntil: "domcontentloaded", timeout: 40000 });
    await shot("staff-pos");
    await page.goto(base + "/staff/admin/reports", { waitUntil: "domcontentloaded", timeout: 40000 });
    await shot("reports");
    await ctx.close();
  }
}
await browser.close();
console.log("done", prefix);
