import { useEffect, useMemo, useState, type ComponentType, type SVGProps } from "react";
import { useParams } from "react-router-dom";
import { supabase, type Category, type Product } from "../lib/types";
import { useCart } from "../context/CartContext";
import { money, productEmoji } from "../lib/format";
import { EmptyBox, ProductGridSkeleton, Skeleton } from "../components/Common";
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
  LayoutGrid,
  Plus,
  Minus,
} from "lucide-react";

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

function categoryIcon(name: string): IconCmp {
  const n = name || "";
  if (/ساخن|اسبريسو|امريكان|فرنساوي|تركي|قهوه|قهوة|شاي|هوت/.test(n)) return Coffee;
  if (/بارد|عصير|فرابيه|سموذي|آيس/.test(n)) return CupSoda;
  if (/تسالي|ناتشو|فرايز|سناك/.test(n)) return Popcorn;
  if (/حلو|كيك|حلويات|تشيز|بسبوسة|جاتوه/.test(n)) return CakeSlice;
  if (/مخبوز|كرواسون|فطائر|معجنات|دانش/.test(n)) return Croissant;
  if (/كوكي|كوكيز|بسكويت|ماكرون/.test(n)) return Cookie;
  if (/سندوتش|ساندوتش|ساندويتش|توست/.test(n)) return Sandwich;
  return UtensilsCrossed;
}

export default function BranchPage() {
  const { id: branchId } = useParams<{ id: string }>();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCat, setActiveCat] = useState<string>("all");
  const [bName, setBName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { items, add, inc, dec, branchId: cartBranch, branchName: cartBranchName } = useCart();

  const cart = useMemo(() => Object.fromEntries(items.map((i) => [i.product_id, i.qty])), [items]);

  useEffect(() => {
    if (!branchId) return;
    load();
    // اسم الفرع: من السلة لو هي هي، وإلا نجيبه من قاعدة البيانات
    if (cartBranch === branchId && cartBranchName) setBName(cartBranchName);
    else
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

  useEffect(() => {
    supabase
      .from("categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => setCategories((data as Category[]) ?? []));
  }, []);

  async function load() {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("branch_id", branchId!)
      .eq("is_active", true)
      .order("sort_order");
    if (error) setError("المنيو مش نازل دلوقتي — جرّب تاني بعد قليل");
    else setProducts((data as Product[]) ?? []);
  }

  if (error) return <EmptyBox msg={error} />;

  const shown = products?.filter((p) => activeCat === "all" || p.category_id === activeCat) ?? [];

  return (
    <div className="space-y-3">
      {/* العنوان */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[20px] font-extrabold text-text">{bName || "المنيو"}</h1>
        {!products && <Skeleton className="h-6 w-20 rounded-full" />}
      </div>

      {/* لصقات الأقسام — ثابتة تحت الهيدر */}
      <div
        className="sticky top-16 z-20 -mx-3.5 border-b border-border bg-page/95 px-3.5 py-2 backdrop-blur-md"
        role="group"
        aria-label="أقسام المنيو"
      >
        <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            aria-pressed={activeCat === "all"}
            onClick={() => setActiveCat("all")}
            className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-ring active:scale-95 ${
              activeCat === "all"
                ? "border-btnbg bg-btnbg text-btnfg"
                : "border-border bg-surface text-text hover:bg-surface2"
            }`}
          >
            <LayoutGrid size={17} aria-hidden="true" />
            الكل
          </button>
          {categories.map((c) => {
            const Icon = categoryIcon(c.name);
            const on = activeCat === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => setActiveCat(c.id)}
                className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-ring active:scale-95 ${
                  on
                    ? "border-btnbg bg-btnbg text-btnfg"
                    : "border-border bg-surface text-text hover:bg-surface2"
                }`}
              >
                <Icon size={17} aria-hidden="true" />
                {c.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* المنتجات — جريد عمودين */}
      {!products ? (
        <ProductGridSkeleton count={6} />
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {shown.length === 0 && (
            <div className="card col-span-full p-4 text-center text-sm text-muted">
              القسم ده لسه فاضي في الفرع — شوف باقي الأقسام
            </div>
          )}
          {shown.map((p) => {
            const qty = cart[p.id] || 0;
            const price = Number(p.price);
            const notPriced = !(price > 0); // من غير سعر صحيح العنصر غير متاح للطلب
            const trackStock = p.track_stock === true; // التتبع اختياري — شارة المخزون بتظهر فقط لما يكون مفعّل
            const stockQty = trackStock ? p.stock_qty : Infinity;
            const threshold = trackStock ? p.low_stock_threshold : 0;
            const isOutOfStock = trackStock && stockQty <= 0;
            const stockPercent = trackStock ? Math.min(100, Math.round((stockQty / Math.max(threshold, 1)) * 100)) : 100;
            const unavailable = notPriced || isOutOfStock;

            const stockBadge = () => {
              if (!trackStock) return null; // "بدون تتبع" مش معلومة للزبون — بتتشال تمامًا
              if (stockQty <= 0)
                return (
                  <span className="status-danger rounded-md px-2 py-0.5 text-[11px] font-bold">
                    خلصت النهارده
                  </span>
                );
              if (stockQty <= threshold)
                return (
                  <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-warn-text">
                    باقي {stockQty} 🔥
                    <span className="h-1 w-12 overflow-hidden rounded-full bg-warn-bg">
                      <span className="block h-full bg-warn" style={{ width: `${Math.min(100, stockPercent)}%` }} />
                    </span>
                  </span>
                );
              return (
                <span className="status-ok rounded-md px-2 py-0.5 text-[11px] font-bold">
                  متاح {stockQty}
                </span>
              );
            };

            return (
              <div key={p.id} className="prod-card flex flex-col items-center">
                {p.image_url ? (
                  <img
                    src={p.image_url}
                    alt={p.name}
                    loading="lazy"
                    decoding="async"
                    width={240}
                    height={140}
                    className="mb-1.5 h-[104px] w-full rounded-2xl bg-surface2 object-cover"
                  />
                ) : (
                  <div className="prod-emoji mb-1.5 !px-4 !py-2" aria-hidden="true">
                    {productEmoji(p.name)}
                  </div>
                )}
                <b className="line-clamp-1 text-[13px] leading-5">{p.name}</b>
                {p.note && <div className="clamp-2 min-h-[32px] text-[11px] leading-4 text-muted">{p.note}</div>}
                <div className="mt-auto pt-1 text-[15px] font-extrabold text-primary-strong">{money(price)}</div>
                <div className="mt-0.5 min-h-[20px] text-[11px]">{notPriced ? <span className="status-warn rounded-md px-2 py-0.5 font-bold">لسه مفيش سعر — قريب</span> : stockBadge()}</div>

                {unavailable ? (
                  <p className="mt-1 text-[11px] font-bold text-danger-text">غير متاح حاليًا</p>
                ) : qty > 0 ? (
                  <div className="mt-1 flex items-center gap-2 text-text">
                    <button
                      type="button"
                      className="grid h-11 w-11 place-items-center rounded-full border-[1.5px] border-border bg-surface text-text outline-none transition hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-ring active:scale-90"
                      onClick={() => dec(p.id)}
                      aria-label={`قلل ${p.name} من السلة`}
                    >
                      <Minus size={19} aria-hidden="true" />
                    </button>
                    <b className="min-w-[26px] text-center text-lg" aria-live="polite">
                      {qty}
                    </b>
                    <button
                      type="button"
                      className="grid h-11 w-11 place-items-center rounded-full bg-btnbg text-btnfg outline-none transition focus-visible:ring-2 focus-visible:ring-ring active:scale-90"
                      onClick={() => inc(p.id)}
                      aria-label={`زود ${p.name} في السلة`}
                    >
                      <Plus size={19} aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="mt-1 grid h-11 w-11 place-items-center rounded-full bg-btnbg text-btnfg outline-none transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-95 motion-reduce:transform-none"
                    onClick={() =>
                      add({
                        product_id: p.id,
                        name: p.name,
                        price: Number(p.price),
                        note: p.note || "",
                        image_url: p.image_url || "",
                      })
                    }
                    aria-label={`أضف ${p.name} للسلة`}
                  >
                    <Plus size={22} strokeWidth={2.5} aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* زر الخريطة كامل العرض أسفل المنيو */}
      {branchId && <OpenMapButton branchId={branchId} className="mt-1" />}
    </div>
  );
}
