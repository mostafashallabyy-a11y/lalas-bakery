import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase, type Category, type Product } from "../lib/types";
import { useCart } from "../context/CartContext";
import { money } from "../lib/format";
import { Spinner, EmptyBox } from "../components/Common";

export default function BranchPage() {
  const { id: branchId } = useParams<{ id: string }>();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCat, setActiveCat] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const { items, add, inc, dec, branchId: cartBranch } = useCart();

  const cart = useMemo(() => Object.fromEntries(items.map((i) => [i.product_id, i.qty])), [items]);

  useEffect(() => {
    if (!branchId) return;
    // المنتجات بتتحمل مرة واحدة عند فتح الصفحة
    load();
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
    if (error) setError("المنيو مش نازل دلوقتي — جرّب تاني بعد قليل 🥲");
    else setProducts((data as Product[]) ?? []);
  }

  if (error) return <EmptyBox msg={error} />;
  if (!products) return <Spinner label="بنجيبلك المنيو طازة… 🥐" />;

  const shown = products.filter((p) => activeCat === "all" || p.category_id === activeCat);

  return (
    <div className="py-4 space-y-4">
      {cartBranch !== branchId && cartBranch && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 text-sm font-bold">
          غيّرت الفرع؟ عربة القديمة هتتصفّر لو حابب تبدأ تانية من هنا.
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveCat("all")}
          className={`pill shrink-0 ${activeCat === "all" ? "bg-brand-500 text-white" : "bg-white border border-brand-200 text-brand-800"}`}
        >
          الكل
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            className={`pill shrink-0 ${activeCat === c.id ? "bg-brand-500 text-white" : "bg-white border border-brand-200 text-brand-800"}`}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="grid gap-3">
        {shown.length === 0 && <EmptyBox msg="القسم ده لسه فاضي في الفرع — قرب قريب 🥲" />}
        {shown.map((p) => {
          const qty = cart[p.id] || 0;
          return (
            <div key={p.id} className="card p-3 flex gap-3 items-stretch">
              {p.image_url && (
                <img
                  src={p.image_url}
                  alt={p.name}
                  loading="lazy"
                  className="w-24 h-24 rounded-xl object-cover bg-brand-50 shrink-0"
                />
              )}
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-extrabold text-brand-900">{p.name}</h3>
                  <span className="font-extrabold text-brand-600 whitespace-nowrap">{money(p.price)}</span>
                </div>
                {p.note && <p className="text-xs text-brand-700/80 mt-1">{p.note}</p>}
                <div className="mt-auto pt-2 flex items-center justify-end gap-2">
                  {qty > 0 ? (
                    <div className="flex items-center gap-2 bg-brand-100 rounded-xl px-2 py-1">
                      <button onClick={() => inc(p.id)} className="w-8 h-8 rounded-lg bg-white font-extrabold text-brand-700 shadow-sm">+</button>
                      <span className="font-extrabold text-brand-800">{qty}</span>
                      <button onClick={() => dec(p.id)} className="w-8 h-8 rounded-lg bg-white font-extrabold text-brand-700 shadow-sm">−</button>
                    </div>
                  ) : (
                    <button
                      className="btn-primary !py-1.5 !px-4 text-sm"
                      onClick={() =>
                        add({
                          product_id: p.id,
                          name: p.name,
                          price: Number(p.price),
                          note: p.note || "",
                          image_url: p.image_url || "",
                        })
                      }
                    >
                      زوّد للعربة +
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-24 flex justify-center">
        <Link to="/cart" className="btn-soft shadow">
          العربة وتأكيد الطلب 🛒
        </Link>
      </div>
    </div>
  );
}
