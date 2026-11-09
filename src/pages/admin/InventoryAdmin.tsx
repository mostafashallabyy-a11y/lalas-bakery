import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Product, type StockMovement, type LowStockAlert } from "../../lib/types";
import { EmptyBox } from "../../components/Common";

export default function InventoryAdmin() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [movements, setMovements] = useState<StockMovement[] | null>(null);
  const [alerts, setAlerts] = useState<LowStockAlert[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fBranch, setFBranch] = useState<string>("all");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    const [pRes, bRes, mRes, aRes] = await Promise.all([
      supabase.from("products").select("*, categories(name)").order("sort_order"),
      supabase.from("branches").select("id, name").eq("is_active", true).order("sort_order"),
      supabase.from("stock_movements").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("low_stock_alerts").select("*").eq("resolved", false).order("created_at", { ascending: false }),
    ]);
    setBusy(false);
    if (pRes.error) return setErr(pRes.error.message);
    setProducts((pRes.data as Product[]) ?? []);
    if (bRes.error) return setErr(bRes.error.message);
    setBranches((bRes.data as { id: string; name: string }[]) ?? []);
    if (mRes.error) return setErr(mRes.error.message);
    setMovements((mRes.data as StockMovement[]) ?? []);
    if (aRes.error) return setErr(aRes.error.message);
    setAlerts((aRes.data as LowStockAlert[]) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const adjustStock = async (productId: string, delta: number, reason: "restock" | "manual_edit") => {
    setBusy(true);
    try {
      if (reason === "restock") {
        const { error } = await supabase.rpc("increment_stock", { p_product_id: productId, p_qty: delta });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("set_stock", { p_product_id: productId, p_qty: delta });
        if (error) throw error;
      }
      await load();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resolveAlert = async (alertId: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.from("low_stock_alerts").update({ resolved: true }).eq("id", alertId);
      if (error) throw error;
      await load();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const filteredProducts = useMemo(() => {
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

  return (
    <div className="space-y-4 pb-24">
      {err && <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-3 py-2 text-sm font-bold">{err}</div>}

      {/* Low stock alerts */}
      {alerts && alerts.length > 0 && (
        <div className="card p-4 space-y-3 bg-amber-50 border border-amber-200">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-amber-700 font-bold">⚠️ تنبيهات المخزون</span>
            <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded">{alerts.length}</span>
          </div>
          <div className="space-y-1">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 bg-white p-2 rounded border border-amber-100">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-brand-900 truncate">منتج بحاجة لإعادة تعبئة</p>
                  <p className="text-xs text-mut">المخزون: {a.stock_qty} · العتبة: {a.threshold}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    className="btn-outline !py-1 !px-2 text-xs text-amber-700"
                    onClick={() => resolveAlert(a.id)}
                  >
                    تم التعبئة
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-3 text-center">
          <p className="text-xs text-brand-700 font-bold">إجمالي المنتجات</p>
          <p className="text-2xl font-extrabold text-brand-600">{products?.length ?? 0}</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xs text-brand-700 font-bold">منخفض المخزون</p>
          <p className="text-2xl font-extrabold text-amber-700">{lowStockProducts.length}</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xs text-brand-700 font-bold">نفد المخزون</p>
          <p className="text-2xl font-extrabold text-rose-700">{outOfStockProducts.length}</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xs text-brand-700 font-bold">تنبيهات مفتوحة</p>
          <p className="text-2xl font-extrabold text-amber-700">{alerts?.filter((a) => !a.resolved).length ?? 0}</p>
        </div>
      </div>

      {/* Branch filter */}
      <div className="flex gap-2 mb-2">
        <select className="input w-auto" value={fBranch} onChange={(e) => setFBranch(e.target.value || "all")}>
          <option value="all">جميع الفروع</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <button className="btn-primary" onClick={load} disabled={busy}>
          تحديث
        </button>
      </div>

      {/* Inventory table */}
      <div className="card p-4 space-y-2">
        <h3 className="font-extrabold text-brand-800">إدارة المخزون</h3>
        {filteredProducts.length === 0 ? (
          <EmptyBox msg="مفيش منتجات" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-brand-700 border-b border-brand-100">
                <th className="py-1 text-right">المنتج</th>
                <th className="py-1 text-center">المخزون</th>
                <th className="py-1 text-center">العتبة</th>
                <th className="py-1 text-center">تتبع المخزون</th>
                <th className="py-1 text-center">ضبط المخزون</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((p) => (
                <tr key={p.id} className="border-b border-brand-50">
                  <td className="py-1 text-right text-sm">{p.name}</td>
                  <td className="py-1 text-center">{stockBadge(p)}</td>
                  <td className="py-1 text-center">{p.track_stock ? p.low_stock_threshold : "—"}</td>
                  <td className="py-1 text-center">{p.track_stock ? "نعم" : "لا"}</td>
                  <td className="py-1 text-center">
                    <div className="flex gap-1">
                      <button
                        className="btn-outline !py-1 !px-2 text-xs text-green-700"
                        onClick={() => adjustStock(p.id, 1, "restock")}
                        disabled={busy}
                      >
                        +
                      </button>
                      <button
                        className="btn-outline !py-1 !px-2 text-xs text-rose-700"
                        onClick={() => adjustStock(p.id, -1, "manual_edit")}
                        disabled={busy || p.stock_qty <= 0}
                      >
                        −
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Stock movements */}
      <div className="card p-4 space-y-2">
        <h3 className="font-extrabold text-brand-800">حركات المخزون الأخيرة</h3>
        {movements?.length === 0 ? (
          <EmptyBox msg="لا توجد حركات مخزون" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-brand-700 border-b border-brand-100">
                <th className="py-1 text-right">المنتج</th>
                <th className="py-1 text-center">التغيير</th>
                <th className="py-1 text-center">السبب</th>
                <th className="py-1 text-center">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {(movements ?? []).slice(0, 50).map((m) => (
                <tr key={m.id} className="border-b border-brand-50">
                  <td className="py-1 text-right text-sm">{m.product_id.slice(0, 8)}</td>
                  <td className="py-1 text-center">{m.change_qty > 0 ? "+" : ""}{m.change_qty}</td>
                  <td className="py-1 text-center">{m.reason}</td>
                  <td className="py-1 text-center text-xs">{m.created_at.slice(0, 16)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function stockBadge(p: Product) {
  if (!p.track_stock) return <span className="text-xs text-brand-400">بدون تتبع</span>;
  if (p.stock_qty <= 0) return <span className="text-xs font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded">0</span>;
  if (p.stock_qty <= p.low_stock_threshold) return <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded">{p.stock_qty}</span>;
  return <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded">{p.stock_qty}</span>;
}
