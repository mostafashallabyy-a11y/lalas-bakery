import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase, type Category, type Product } from "../lib/types";
import { useCart } from "../context/CartContext";
import { money, productEmoji, categoryEmoji } from "../lib/format";
import { Spinner, EmptyBox } from "../components/Common";

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
    if (error) setError("المنيو مش نازل دلوقتي — جرّب تاني بعد قليل 🥲");
    else setProducts((data as Product[]) ?? []);
  }

  if (error) return <EmptyBox msg={error} />;
  if (!products) return <Spinner label="بنجيبلك المنيو طازة… 🥐" />;

  const shown = products.filter((p) => activeCat === "all" || p.category_id === activeCat);

  return (
    <div className="space-y-2.5">
      <h2 className="text-[22px] font-bold text-brand-700 mt-1.5 mb-0">{bName}</h2>

      {/* لصقات الأقسام بايموجيها زي النموذج */}
      <div className="flex gap-1.5 overflow-x-auto py-1">
        <button
          onClick={() => setActiveCat("all")}
          className={activeCat === "all" ? "btn-dark shrink-0" : "btn-outline shrink-0"}
        >
          🍽 الكل
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            className={activeCat === c.id ? "btn-dark shrink-0" : "btn-outline shrink-0"}
          >
            {categoryEmoji(c.name)} {c.name}
          </button>
        ))}
      </div>

      {/* جريد منتجات متمركزة زي .g في النموذج */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
        {shown.length === 0 && (
          <div className="card p-3.5 text-mut text-sm col-span-full">
            القسم ده لسه فاضي في الفرع — قرب قريب 🥲
          </div>
        )}
        {shown.map((p) => {
          const qty = cart[p.id] || 0;
          return (
            <div key={p.id} className="prod-card">
              {p.image_url ? (
                <img
                  src={p.image_url}
                  alt={p.name}
                  loading="lazy"
                  className="w-full h-[90px] object-cover rounded-[14px] mb-1.5 bg-brand-50"
                />
              ) : (
                <div className="prod-emoji">{productEmoji(p.name)}</div>
              )}
              <b>{p.name}</b>
              {p.note && <div className="text-mut text-sm">{p.note}</div>}
              <div className="text-brand-700 font-bold">{money(p.price)}</div>
              {qty > 0 ? (
                <div className="flex items-center justify-center gap-2 mt-1.5 text-brand-900">
                  <button className="btn-pill !px-3" onClick={() => inc(p.id)}>
                    +
                  </button>
                  <b className="min-w-[20px]">{qty}</b>
                  <button className="btn-outline !px-3" onClick={() => dec(p.id)}>
                    −
                  </button>
                </div>
              ) : (
                <button
                  className="btn-pill mt-1.5"
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
                  Add to cart
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
