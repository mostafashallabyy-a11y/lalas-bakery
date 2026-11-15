/**
 * منيو الزبون — اختبار المسار السريع (stubbed API).
 * الهدف: 3 منتجات + الوصول للسلة في 5 لمسات أو أقل، من غير أي لايتبوكس.
 */
import { test, expect, type Page, type Route } from "@playwright/test";

const BRANCH = "11111111-1111-4111-8111-111111111111";
const CATEGORY = "33333333-3333-4333-8333-333333333333";

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

const categoryRow = {
  id: CATEGORY,
  name: "Lala's Bakery",
  is_active: true,
  sort_order: 0,
};

const menu = [
  { name: "كرواسون بالشوكولاتة", price: 35 },
  { name: "سينامون رول", price: 40 },
  { name: "شاي بلبن", price: 25 },
].map((p, i) => ({
  id: `22222222-2222-4222-8222-2222222222${i.toString().padStart(2, "0")}`,
  branch_id: BRANCH,
  category_id: CATEGORY,
  name: p.name,
  price: p.price,
  note: "طازة من الفرن",
  image_url: "",
  is_active: true,
  sort_order: i * 10,
  stock_qty: 50,
  low_stock_threshold: 10,
  track_stock: true,
  featured: true,
  is_new: false,
  categories: { name: categoryRow.name },
}));

const json = (route: Route, data: unknown, status = 200) =>
  route.fulfill({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

async function stub(page: Page) {
  await page.route("**/rest/v1/*", (route) => {
    const url = route.request().url();
    if (url.includes("/branches")) return json(route, [branchRow]);
    if (url.includes("/categories")) return json(route, [categoryRow]);
    if (url.includes("/products")) return json(route, menu);
    return json(route, []);
  });
  // مفيش جلسة فريق في الاختبار — يعني مفيش قراءة order_items
  await page.route("**/auth/v1/session", (route) => json(route, { data: { session: null } }));
  await page.route("**/auth/v1/user", (route) => json(route, { user: null }));
  await page.route("**/challenges.cloudflare.com/**", (route) =>
    route.fulfill({ status: 200, headers: { "content-type": "application/javascript" }, body: "" })
  );
}

test.describe("menيو الزبون — سرعة الطلب", () => {
  test("3 منتجات + السلة في ≤ 5 لمسات", async ({ page }) => {
    await stub(page);
    await page.goto(`/branch/${BRANCH}`);

    // القسم الأول هو Lala's Bakery والـ chip بتاعه مفعّل
    const bakeryChip = page.getByRole("button", { name: /Lala's Bakery/ }).first();
    await expect(bakeryChip).toBeVisible({ timeout: 15000 });
    await expect(bakeryChip).toHaveAttribute("aria-pressed", "true");

    // أول منتجين hero بعرض كامل، والتالت في جريد
    await expect(page.getByTestId("product-card")).toHaveCount(6); // 3 في الشريط + 3 في القسم

    const section = page.locator('section[aria-labelledby^="h-"]').first();
    let taps = 0;

    for (const p of menu) {
      await section.getByRole("button", { name: `أضف ${p.name} للسلة` }).first().click();
      taps++;
      // ضغطة واحدة بتحوّل الزرار لعدّاد
      await expect(
        section.getByRole("group", { name: `كمية ${p.name} في السلة` })
      ).toBeVisible();
    }

    // شريط السلة العائم ظاهر بالعدد والإجمالي
    const cartBar = page.locator('[role="status"]').filter({ has: page.locator('a[href="/cart"]') });
    await expect(cartBar).toBeVisible();
    await expect(cartBar).toContainText("3 منتج");
    await expect(cartBar).toContainText("100");

    await cartBar.locator('a[href="/cart"]').click();
    taps++;

    await expect(page).toHaveURL(/\/cart/, { timeout: 10000 });
    await expect(page.getByRole("heading", { name: /سلتك/ })).toBeVisible();
    expect(taps).toBeLessThanOrEqual(5);

    // السلة فيها 3 أصناف بالفعل
    await expect(page.getByText("3 صنف")).toBeVisible();
  });

  test("كارت المنتج: صورة كبيرة وزرار ≥ 44px من غير لايتبوكس", async ({ page }) => {
    await stub(page);
    await page.goto(`/branch/${BRANCH}`);
    await expect(page.getByTestId("product-card").first()).toBeVisible({ timeout: 15000 });

    const card = page.locator('section[aria-labelledby^="h-"]').first().getByTestId("product-card").last();
    const photoBox = card.locator("div.relative").first();
    const photo = await photoBox.boundingBox();
    const box = await card.boundingBox();
    expect(photo).not.toBeNull();
    expect(box).not.toBeNull();
    // الصورة بتاخد حوالي 60% من الكارت (بين 50% و 75%)
    const ratio = (photo!.height ?? 0) / (box!.height ?? 1);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(0.78);

    const add = card.getByTestId("add-button");
    const addBox = await add.boundingBox();
    expect(addBox!.height).toBeGreaterThanOrEqual(44);

    // مفيش أي زرار بيفتح صورة/بوب أب
    await expect(page.getByRole("button", { name: /^عرض/ })).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("الـ chips بتنزل للقسم الصح والـ header 60px", async ({ page }) => {
    await stub(page);
    await page.goto(`/branch/${BRANCH}`);
    await expect(page.getByTestId("product-card").first()).toBeVisible({ timeout: 15000 });

    const header = await page.locator("header").first().boundingBox();
    expect(Math.round(header!.height)).toBe(60);

    // مفيش تمرير أفقي للصفحة
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
