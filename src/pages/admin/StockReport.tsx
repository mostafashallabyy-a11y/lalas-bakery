import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Product } from "../../lib/types";
import { EmptyBox } from "../../components/Common";
import { money } from "../../lib/format";
import { toCSV, downloadCSV } from "../../lib/csv";

export default function StockReport() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fBranch, setFBranch] = useState<string>("all");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    const [pRes, bRes] = await Promise.all([
      supabase.from("products").select("*, categories(name)").order("sort_order"),
      supabase.from("branches").select("id, name").eq("is_active", true).order("sort_order"),
    ]);
    setBusy(false);
    if (pRes.error) return setErr(pRes.error.message);
    setProducts((pRes.data as Product[]) ?? []);
    if (bRes.error) return setErr(bRes.error.message);
    setBranches((bRes.data as { id: string; name: string }[]) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!products) return [];
    return fBranch === "all" ? products : products.filter((p) => p.branch_id === fBranch);
  }, [products, fBranch]);

  const lowStockProducts = useMemo(() => {
    if (!products) return [];
    return products.filter((p) => p.track_stock && p.stock_qty > 0 && p.stock_qty <= p.low_stock_threshold);
  }, [products]);

  const outOfStockProducts = useMemo(() => {
    if (!products) return [];
    return products.filter((p) => p.track_stock && p.stock_qty <= 0);
  }, [products]);

  const daysOfStock = (qty: number, dailySales: number) => {
    if (dailySales <= 0) return qty > 0 ? 999 : 0;
    return Math.floor(qty / dailySales);
  };

  return (
    <div className="space-y-4 pb-24">
      {err && <div className="status-danger border border-danger-text/30 text-danger-text rounded-xl px-3 py-2 text-sm font-bold">{err}</div>}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2">
        <select className="input w-auto" value={fBranch} onChange={(e) => setFBranch(e.target.value || "all")}>
          <option value="all">جميع الفروع</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <button className="btn-primary" onClick={load} disabled={busy}>
          تحديث
        </button>
        <button
          className="btn-outline !px-3 !py-1 text-xs"
          onClick={() =>
            downloadCSV(
              `stock_report_${new Date().toISOString().slice(0, 10)}.csv`,
              toCSV(
                (filtered ?? []).map((p) => ({
                  المنتج: p.name,
                  الفرع: branches.find((b) => b.id === p.branch_id)?.name || "",
                  المخزون: p.stock_qty,
                  العتبة: p.low_stock_threshold,
                  التتبع: p.track_stock ? "نعم" : "لا",
                }))
              )
            )
          }
        >
          CSV ⬇
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-3 text-center">
          <p className="text-xs text-brand-700 font-bold">إجمالي المنتجات</p>
          <p className="text-2xl font-extrabold text-brand-600">{filtered.length}</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xs text-brand-700 font-bold">إجمالي قيمة المخزون</p>
          <p className="text-2xl font-extrabold text-brand-600">
            {money(filtered.reduce((s, p) => s + p.stock_qty * p.price, 0))}
          </p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xs text-brand-700 font-bold">ناقص المخزون</p>
          <p className="text-2xl font-extrabold text-warn-text">{lowStockProducts.length}</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xs text-brand-700 font-bold">نفد المخزون</p>
          <p className="text-2xl font-extrabold text-danger-text">{outOfStockProducts.length}</p>
        </div>
      </div>

      {/* Stock table */}
      <div className="card p-4 space-y-2">
        <h3 className="font-extrabold text-brand-800">تقرير المخزون الحالي</h3>
        {filtered.length === 0 ? (
          <EmptyBox msg="لا توجد منتجات" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-brand-700 border-b border-brand-100">
                <th className="py-1 text-right">المنتج</th>
                <th className="py-1 text-center">المخزون</th>
                <th className="py-1 text-center">العتبة</th>
                <th className="py-1 text-center">القيمة الحالية</th>
                <th className="py-1 text-center">تتبع المخزون</th>
                <th className="py-1 text-center">أيام المخزون المتبقية</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const dailySales = p.stock_qty / 7;
                const daysLeft = daysOfStock(p.stock_qty, dailySales);
                return (
                  <tr key={p.id} className="border-b border-brand-50">
                    <td className="py-1 text-right">{p.name}</td>
                    <td className="py-1 text-center">{stockBadge(p)}</td>
                    <td className="py-1 text-center">{p.track_stock ? p.low_stock_threshold : "—"}</td>
                    <td className="py-1 text-center">{money(p.stock_qty * p.price)}</td>
                    <td className="py-1 text-center">{p.track_stock ? "نعم" : "لا"}</td>
                    <td className="py-1 text-center">
                      {p.track_stock ? (daysLeft > 99 ? "999+" : daysLeft.toString()) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Reorder suggestions */}
      <div className="card p-4 space-y-2">
        <h3 className="font-extrabold text-brand-800">منتجات تحتاج إعادة تعبئة</h3>
        {lowStockProducts.length === 0 ? (
          <p className="text-mut text-sm text-center">لا توجد منتجات بحاجة لإعادة تعبئة ✅</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-brand-700 border-b border-brand-100">
                <th className="py-1 text-right">المنتج</th>
                <th className="py-1 text-center">المخزون الحالي</th>
                <th className="py-1 text-center">العتبة</th>
                <th className="py-1 text-center">الكمية المقترحة لإعادة التعبئة</th>
              </tr>
            </thead>
            <tbody>
              {lowStockProducts.map((p) => {
                const suggested = Math.max(p.low_stock_threshold * 2 - p.stock_qty, p.low_stock_threshold);
                return (
                  <tr key={p.id} className="border-b border-brand-50">
                    <td className="py-1 text-right">{p.name}</td>
                    <td className="py-1 text-center">{p.stock_qty}</td>
                    <td className="py-1 text-center">{p.low_stock_threshold}</td>
                    <td className="py-1 text-center font-bold text-warn-text">{suggested}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function stockBadge(p: Product) {
  if (!p.track_stock) return <span className="text-xs text-brand-400">بدون تتبع</span>;
  if (p.stock_qty <= 0) return <span className="text-xs font-bold text-danger-text status-danger px-2 py-0.5 rounded">0</span>;
  if (p.stock_qty <= p.low_stock_threshold) return <span className="text-xs font-bold text-warn-text status-warn px-2 py-0.5 rounded">{p.stock_qty}</span>;
  return <span className="text-xs text-ok-text status-ok px-2 py-0.5 rounded">{p.stock_qty}</span>;
}
