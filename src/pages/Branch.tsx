import { useEffect, useMemo, useState, type ComponentType, type SVGProps } from "react";
import { useParams } from "react-router-dom";
import { supabase, type Category, type Product } from "../lib/types";
import { useCart } from "../context/CartContext";
import { ProductCard } from "../components/ProductCard";
import { EmptyBox, Skeleton } from "../components/Common";
import { OpenMapButton } from "../components/SocialLinks";
import {
  Coffee,
  CupSoda,
  Popcorn,
  CakeSlice,
  Croissant,
  Cookie,
  Sandwich,
  UtensilsCrossed,
} from "lucide-react";

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

/** بيانات المنيو اللي اتطلبت بدري من index.html (تسخين أول رسم) */
type MenuBoot = {
  branchId: string;
  products?: Promise<Product[] | null>;
  categories?: Promise<Category[] | null>;
  branchName?: Promise<string | null>;
};

declare global {
  interface Window {
    __menuBoot?: MenuBoot;
  }
}

function categoryIcon(name: string): IconCmp {
  const n = name || "";
  if (/ساخن|اسبريسو|امريكان|فرنساوي|تركي|قهوه|قهوة|شاي|هوت/.test(n)) return Coffee;
  if (/بارد|عصير|فرابيه|سموذي|آيس/.test(n)) return CupSoda;
  if (/تسالي|ناتشو|فرايز|سناك/.test(n)) return Popcorn;
  if (/حلو|كيك|حلويات|تشيز|بسبوسة|جاتوه/.test(n)) return CakeSlice;
  if (/مخبوز|كرواسون|فطائر|معجنات|دانش|bakery|lala/i.test(n)) return Croissant;
  if (/كوكي|كوكيز|بسكويت|ماكرون/.test(n)) return Cookie;
  if (/سندوتش|ساندوتش|ساندويتش|توست/.test(n)) return Sandwich;
  return UtensilsCrossed;
}

type Section = { id: string; name: string; items: Product[] };

const BAKERY_RE = /bakery|lala/i;

/** هل السعر صالح للبيع؟ (أي منتج بسعر صفر أو أقل بيتشال من الواجهة) */
const priced = (p: Product) => Number(p.price) > 0;

function MenuSkeleton() {
  return (
    <div className="min-h-[calc(100vh-40px)] space-y-3" aria-hidden="true">
      <div className="skeleton h-[68px] w-full rounded-[20px]" />
      <div className="no-scrollbar flex gap-2.5 overflow-hidden">
        <div className="skeleton h-[116px] w-[290px] shrink-0 rounded-[18px]" />
        <div className="skeleton h-[116px] w-[120px] shrink-0 rounded-[18px]" />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="menu-card">
            <div className="skeleton aspect-[4/3] w-full !rounded-none" />
            <div className="space-y-1.5 p-2.5">
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-3 w-1/2" />
              <div className="skeleton mt-3 h-11 w-full rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BranchPage() {
  const { id: branchId } = useParams<{ id: string }>();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [bName, setBName] = useState("");
  const [activeSection, setActiveSection] = useState<string>("");
  const [salesRank, setSalesRank] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { items, add, inc, dec, branchId: cartBranch, branchName: cartBranchName, bindBranch } = useCart();

  const cart = useMemo(() => Object.fromEntries(items.map((i) => [i.product_id, i.qty])), [items]);

  // لينك مباشر للفرع من غير ما تعدّي على الصفحة الرئيسية:
  // بنربط السلة بالفرع (من غير مسح أي منتج). لو فيه سلة لفرع تاني مش بنلمسها.
  useEffect(() => {
    if (!branchId || !bName) return;
    if (!cartBranch) bindBranch(branchId, bName);
  }, [branchId, bName, cartBranch, bindBranch]);

  useEffect(() => {
    if (!branchId) return;
    load();
    // اسم الفرع: من السلة لو هي هي، وإلا نجيبه من قاعدة البيانات
    if (cartBranch === branchId && cartBranchName) setBName(cartBranchName);
    else if (typeof window !== "undefined" && window.__menuBoot?.branchId === branchId) {
      // الطلب بدأ من index.html بدري — بنستنى نفس النتيجة بدل طلب جديد
      window.__menuBoot.branchName?.then((n) => {
        if (n) setBName(n);
      });
    } else
      supabase
        .from("branches")
        .select("name")
        .eq("id", branchId)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.name) setBName(data.name);
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  async function load() {
    if (!branchId) return;
    const boot = typeof window !== "undefined" && window.__menuBoot?.branchId === branchId
      ? window.__menuBoot
      : undefined;

    // نفس استعلامات supabase-js بالظبط — بس لو الطلب المبكر فشل بنرجّع للطريقة العادية
    const fetchProducts = async (): Promise<Product[] | null> => {
      if (boot?.products) {
        const d = await boot.products;
        if (Array.isArray(d)) return d as Product[];
      }
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("branch_id", branchId)
        .eq("is_active", true)
        .order("sort_order");
      return error ? null : ((data as Product[]) ?? []);
    };
    const fetchCategories = async (): Promise<Category[]> => {
      if (boot?.categories) {
        const d = await boot.categories;
        if (Array.isArray(d)) return d as Category[];
      }
      const { data } = await supabase
        .from("categories")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      return (data as Category[]) ?? [];
    };

    const [prods, cats] = await Promise.all([fetchProducts(), fetchCategories()]);
    if (!prods) {
      setError("المنيو مش نازل دلوقتي — جرّب تاني بعد قليل");
      return;
    }
    setProducts(prods);
    setCategories(cats);
  }

  // بيانات البيع الحقيقية: الزبون المجهول مش مسموح له يقرأ order_items،
  // فبنحسبها بس وانت داخل بحساب فريق. غير كده بنعتمد على اختيارات المدير (featured).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) return;
        const since = new Date(Date.now() - 180 * 864e5).toISOString();
        const { data: rows, error: rankErr } = await supabase
          .from("order_items")
          .select("product_id, qty, orders!inner(is_test, created_at)")
          .gte("orders.created_at", since)
          .eq("orders.is_test", false)
          .not("product_id", "is", null)
          .limit(5000);
        if (!alive || rankErr || !rows) return;
        const agg: Record<string, number> = {};
        for (const r of rows as { product_id: string | null; qty: number | null }[]) {
          if (!r.product_id) continue;
          agg[r.product_id] = (agg[r.product_id] ?? 0) + Number(r.qty ?? 0);
        }
        setSalesRank(agg);
      } catch {
        /* مفيش بيانات بيع — الشريط هيستخدم "مميز" */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const bestSellerIds = useMemo(() => {
    if (!salesRank) return new Set<string>();
    const top = Object.entries(salesRank)
      .filter(([, qty]) => qty > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);
    return new Set(top);
  }, [salesRank]);

  const catName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);

  // الأقسام: ترتيب المدير (sort_order) — Lala's Bakery أول واحد افتراضيًا
  const sections = useMemo<Section[]>(() => {
    const all = (products ?? []).filter(priced);
    const known = new Set(categories.map((c) => c.id));
    const sortItems = (list: Product[]) =>
      [...list].sort((a, b) => {
        const bySales = (salesRank?.[b.id] ?? 0) - (salesRank?.[a.id] ?? 0);
        if (bySales !== 0) return bySales;
        const feat = Number(!!b.featured) - Number(!!a.featured);
        if (feat !== 0) return feat;
        return (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, "ar");
      });

    const ordered = [...categories].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, "ar")
    );
    const out: Section[] = ordered
      .map((c) => ({
        id: c.id,
        name: c.name,
        items: sortItems(all.filter((p) => p.category_id === c.id)),
      }))
      .filter((s) => s.items.length > 0);

    const orphans = all.filter((p) => !known.has(p.category_id));
    if (orphans.length > 0) {
      out.push({ id: "other", name: "أصناف تانية", items: sortItems(orphans) });
    }
    return out;
  }, [products, categories, salesRank]);

  // شريط "الأكثر طلبًا" — بيع حقيقي لو متاح، وإلا اختيارات المدير، والمخبوزات الأول
  const carousel = useMemo<Product[]>(() => {
    const all = (products ?? []).filter(priced);
    let picks: Product[];
    if (salesRank) {
      picks = [...all].sort((a, b) => (salesRank[b.id] ?? 0) - (salesRank[a.id] ?? 0));
    } else {
      picks = all.filter((p) => p.featured);
    }
    const isBakery = (p: Product) => BAKERY_RE.test(catName.get(p.category_id) ?? "");
    picks = [...picks].sort((a, b) => Number(isBakery(b)) - Number(isBakery(a)));
    return picks.slice(0, 8);
  }, [products, salesRank, catName]);

  const sectionKey = sections.map((s) => s.id).join("|");

  // تتبّع القسم الظاهر عشان الـ chip يتفعّل لوحده وانت بتنزل
  useEffect(() => {
    if (!sectionKey) return;
    const ids = sectionKey.split("|");
    let ticking = false;

    const update = () => {
      ticking = false;
      const offset = 130;
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(`sec-${id}`);
        if (!el) continue;
        if (el.getBoundingClientRect().top - offset <= 8) current = id;
      }
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 8) {
        current = ids[ids.length - 1];
      }
      setActiveSection((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [sectionKey]);

  const goToSection = (id: string) => {
    setActiveSection(id);
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onAdd = (p: Product) => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(8);
      } catch {
        /* مش مدعوم */
      }
    }
    add({
      product_id: p.id,
      name: p.name,
      price: Number(p.price),
      note: p.note || "",
      image_url: p.image_url || "",
    });
  };

  if (error) return <EmptyBox msg={error} />;

  const totalShown = (products ?? []).filter(priced).length;

  return (
    <div className="pb-1">
      {/* العنوان */}
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h1 className="truncate text-[19px] font-extrabold text-text">{bName || "المنيو"}</h1>
        {products ? (
          <span className="shrink-0 text-[11px] font-bold text-muted">{totalShown} صنف</span>
        ) : (
          <Skeleton className="h-4 w-14 rounded-full" />
        )}
      </div>

      {!products ? (
        <MenuSkeleton />
      ) : (
        <>
          {/* شريط الترحيب */}
          <div className="menu-hero flex items-center gap-3">
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface2 text-[22px]"
              aria-hidden="true"
            >
              🥐
            </span>
            <div className="min-w-0">
              <p className="text-[15.5px] font-extrabold leading-6 text-text">اختار حاجة حلوة 🥐</p>
              <p className="text-[11.5px] leading-4 text-muted">
                كل حاجة بتتحضّر طازة — دوس «أضف» وكمّل
              </p>
            </div>
          </div>

          {/* الأكثر طلبًا / مميز */}
          {carousel.length > 0 && (
            <section className="mt-3" aria-labelledby="menu-highlights">
              <div className="mb-1.5 flex items-center justify-between">
                <h2
                  id="menu-highlights"
                  className="flex items-center gap-1.5 text-[14.5px] font-extrabold text-text"
                >
                  {salesRank ? "الأكثر طلبًا 🔥" : "مميز ✨"}
                </h2>
                <span className="text-[11px] font-bold text-muted" aria-hidden="true">
                  اسحب →
                </span>
              </div>
              <div className="no-scrollbar -mx-3.5 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-3.5 pb-1">
                {carousel.map((p, i) => (
                  <div key={p.id} className="w-[86%] max-w-[320px] shrink-0 snap-start">
                    <ProductCard
                      product={p}
                      qty={cart[p.id] || 0}
                      variant="carousel"
                      bestSeller={bestSellerIds.has(p.id)}
                      priority={i === 0}
                      onAdd={onAdd}
                      onInc={inc}
                      onDec={dec}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* لصقات الأقسام — ثابتة تحت الهيدر */}
          {sections.length > 0 && (
            <div
              className="menu-chips sticky top-[60px] z-20 -mx-3.5 mt-3 px-3.5 py-2 sm:top-[72px]"
              role="group"
              aria-label="أقسام المنيو"
            >
              <div className="no-scrollbar flex gap-2 overflow-x-auto">
                {sections.map((s) => {
                  const Icon = categoryIcon(s.name);
                  const on = activeSection === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => goToSection(s.id)}
                      className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[13px] font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-ring active:scale-95 ${
                        on
                          ? "border-btnbg bg-btnbg text-btnfg shadow-sm"
                          : "border-border bg-surface text-text hover:bg-surface2"
                      }`}
                    >
                      <Icon size={16} aria-hidden="true" />
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* الأقسام */}
          {sections.length === 0 ? (
            <div className="card mt-3 p-5 text-center text-sm text-muted">
              مفيش أصناف متاحة دلوقتي — جرّب تاني بعد شوية
            </div>
          ) : (
            <div className="mt-3 space-y-5">
              {sections.map((s, sIdx) => {
                const isBakery = BAKERY_RE.test(s.name);
                const heroes = isBakery ? s.items.slice(0, 2) : [];
                const rest = isBakery ? s.items.slice(2) : s.items;
                const Icon = categoryIcon(s.name);

                return (
                  <section
                    key={s.id}
                    id={`sec-${s.id}`}
                    className="menu-section"
                    aria-labelledby={`h-${s.id}`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h2
                        id={`h-${s.id}`}
                        className="flex items-center gap-2 text-[15px] font-extrabold text-text"
                      >
                        <span
                          className="grid h-7 w-7 place-items-center rounded-full bg-surface2 text-primary-strong"
                          aria-hidden="true"
                        >
                          <Icon size={15} />
                        </span>
                        {s.name}
                      </h2>
                      <span className="text-[11px] font-bold text-muted">{s.items.length} صنف</span>
                    </div>

                    {heroes.length > 0 && (
                      <div className="mb-2.5 space-y-2.5">
                        {heroes.map((p, i) => (
                          <ProductCard
                            key={p.id}
                            product={p}
                            qty={cart[p.id] || 0}
                            variant="hero"
                            bestSeller={bestSellerIds.has(p.id)}
                            priority={sIdx === 0 && i === 0}
                            onAdd={onAdd}
                            onInc={inc}
                            onDec={dec}
                          />
                        ))}
                      </div>
                    )}

                    {rest.length > 0 && (
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                        {rest.map((p, i) => (
                          <ProductCard
                            key={p.id}
                            product={p}
                            qty={cart[p.id] || 0}
                            bestSeller={bestSellerIds.has(p.id)}
                            priority={sIdx === 0 && heroes.length === 0 && i < 2}
                            onAdd={onAdd}
                            onInc={inc}
                            onDec={dec}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* زر الخريطة كامل العرض أسفل المنيو */}
      {branchId && <OpenMapButton branchId={branchId} className="mt-4" />}
    </div>
  );
}
