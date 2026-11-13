import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Branch, type Product } from "../lib/types";
import { money } from "../lib/format";
import { Spinner, EmptyBox, ErrorBox } from "../components/Common";
import { useAuth } from "../context/AuthContext";

type CartItem = { product_id: string; name: string; price: number; qty: number; line_total: number };
type PosDelivery = "pickup" | "table";

const DEFAULT_FLOORS = ["الأرضي", "1", "2", "3", "4", "5"];

export default function StaffPOS() {
  const { profile } = useAuth();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [deliveryType, setDeliveryType] = useState<PosDelivery>("pickup");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "instapay">("cash");
  const [customerName, setCustomerName] = useState("");
  const [staffNote, setStaffNote] = useState("");
  const [deliveryFloor, setDeliveryFloor] = useState("");
  const [deliverySpot, setDeliverySpot] = useState("");
  const [floorOther, setFloorOther] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ order_number: string; total: number } | null>(null);
  const [shiftOpen, setShiftOpen] = useState<boolean | null>(null);
  const [countedCash, setCountedCash] = useState("");
  const [shiftCloseNote, setShiftCloseNote] = useState("");

  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.line_total, 0), [cart]);
  const deliveryFee = deliveryType === "table" ? 5 : 0;
  const total = subtotal + deliveryFee;

  const floorOptions: string[] = Array.isArray(selectedBranch?.delivery_floors) && (selectedBranch!.delivery_floors as string[]).length
    ? (selectedBranch!.delivery_floors as string[])
    : DEFAULT_FLOORS;

  useEffect(() => {
    (async () => {
      const { data: b } = await supabase.from("branches").select("*").eq("is_active", true).order("sort_order");
      setBranches((b as Branch[]) ?? []);
      const { data: s } = await supabase.rpc("staff_get_open_shift");
      setShiftOpen((s as any)?.ok ?? false);
    })();
  }, []);

  const loadProducts = useCallback(async () => {
    if (!selectedBranch) return;
    const { data } = await supabase
      .from("products")
      .select("*, categories(name)")
      .eq("branch_id", selectedBranch.id)
      .eq("is_active", true)
      .order("sort_order");
    setProducts((data as Product[]) ?? []);
  }, [selectedBranch]);

  useEffect(() => {
    loadProducts();
  }, [selectedBranch, loadProducts]);

  useEffect(() => {
    if (deliveryType !== "table") {
      setDeliveryFloor("");
      setDeliverySpot("");
      setFloorOther(false);
    }
  }, [deliveryType]);

  const addToCart = (p: Product) => {
    setCart((prev) => {
      const found = prev.find((i) => i.product_id === p.id);
      if (found) return prev.map((i) => i.product_id === p.id ? { ...i, qty: i.qty + 1, line_total: i.price * (i.qty + 1) } : i);
      return [...prev, { product_id: p.id, name: p.name, price: Number(p.price), qty: 1, line_total: Number(p.price) }];
    });
  };

  const changeQty = (pid: string, delta: number) => {
    setCart((prev) => prev.map((i) => i.product_id === pid ? { ...i, qty: Math.max(0, i.qty + delta), line_total: i.price * Math.max(0, i.qty + delta) } : i).filter((i) => i.qty > 0));
  };

  const removeItem = (pid: string) => {
    setCart((prev) => prev.filter((i) => i.product_id !== pid));
  };

  const openShift = async () => {
    if (!selectedBranch) return setError("اختار الفرع أولًا");
    setBusy(true);
    const { error: e } = await supabase.rpc("shift_open", { p_branch_id: selectedBranch.id, p_opening_cash: 0 });
    setBusy(false);
    if (e) return setError(e.message);
    setShiftOpen(true);
    setSuccess(null);
  };

  const closeShift = async () => {
    if (!shiftOpen) return setError("لا توجد فترة عمل مفتوحة");
    setBusy(true);
    setError(null);
    try {
      const { data: shiftData, error: shiftErr } = await supabase.rpc("staff_get_open_shift");
      if (shiftErr) throw shiftErr;
      const shiftId = (shiftData as any)?.shift_id;
      if (!shiftId) throw new Error("لا توجد فترة عمل مفتوحة");
      const { data, error: e } = await supabase.rpc("shift_close", {
        p_shift_id: shiftId,
        p_counted_cash: Number(countedCash) || 0,
        p_note: shiftCloseNote.trim() || null,
      });
      if (e) throw e;
      setShiftOpen(false);
      setCountedCash("");
      setShiftCloseNote("");
      setSuccess({ order_number: "إغلاق فترة العمل", total: Number((data as any)?.expected_cash) || 0 });
    } catch (e: unknown) {
      setError((e as Error).message || "حصلت مشكلة في إغلاق فترة العمل");
    } finally {
      setBusy(false);
    }
  };

  const submitOrder = async () => {
    if (!selectedBranch) return setError("اختار الفرع أولًا");
    if (cart.length === 0) return setError("السلة فاضية");
    if (!shiftOpen) return setError("لازم تفتح فترة عمل أولًا");
    if (deliveryType === "table" && !deliveryFloor.trim()) return setError("اكتب/اختار رقم الدور لطلب التوصيل داخل الفرع");

    setBusy(true);
    setError(null);
    try {
      const { data, error: e } = await supabase.rpc("pos_create_order", {
        p_branch_id: selectedBranch.id,
        p_items: cart.map((i) => ({ product_id: i.product_id, qty: i.qty })),
        p_delivery_type: deliveryType,
        p_customer_name: customerName.trim() || null,
        p_payment_method: paymentMethod,
        p_staff_note: staffNote.trim() || null,
        p_delivery_floor: deliveryType === "table" ? deliveryFloor.trim() : null,
        p_delivery_spot: deliveryType === "table" ? (deliverySpot.trim() || null) : null,
        p_customer_note: staffNote.trim() || null,
      });
      if (e) throw e;
      const d = data as any;
      setSuccess({ order_number: d.order_number, total: d.total });
      setCart([]);
      setCustomerName("");
      setStaffNote("");
      setDeliveryType("pickup");
      setDeliveryFloor("");
      setDeliverySpot("");
      setFloorOther(false);
    } catch (e: unknown) {
      // Part 3 will refine; for now show friendly Arabic, log technical
      console.error("POS submit error:", e);
      const msg = (e as any)?.message || "حصلت مشكلة في تسجيل الطلب — جرّب تاني";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  if (!profile) return <Spinner label="بنحمّل بيانات الموظف…" />;
  if (!branches) return <Spinner label="بنحمّل الفروع…" />;

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-extrabold text-text">تسجيل طلب من الفرع (POS)</h1>

      {error && <ErrorBox msg={error} />}
      {success && (
        <div className="bg-brand-50 border border-brand-200 rounded-xl p-3 text-brand-900 text-sm font-bold text-center">
          تم تسجيل الطلب: {success.order_number} • الإجمالي {money(success.total)}
        </div>
      )}

      <div className="card p-4 space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="label">اختار الفرع</label>
            <select className="input w-full" value={selectedBranch?.id || ""} onChange={(e) => setSelectedBranch(branches.find((b) => b.id === e.target.value) || null)}>
              <option value="">اختار فرعًا</option>
              {branches.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
            </select>
          </div>
          <div>
            <label className="label">طريقة الدفع</label>
            <div className="flex gap-2">
              <button type="button" className={`flex-1 px-3 py-2 rounded-lg border ${paymentMethod === "cash" ? "bg-btnbg text-btnfg border-brand-700" : "bg-surface border-brand-200 text-brand-900"}`} onClick={() => setPaymentMethod("cash")}>كاش</button>
              <button type="button" className={`flex-1 px-3 py-2 rounded-lg border ${paymentMethod === "instapay" ? "bg-btnbg text-btnfg border-brand-700" : "bg-surface border-brand-200 text-brand-900"}`} onClick={() => setPaymentMethod("instapay")}>انستا باي</button>
            </div>
          </div>
        </div>

        <div>
          <label className="label">نوع الطلب</label>
          <div className="flex gap-2 flex-wrap">
            <button type="button" className={`px-3 py-2 rounded-lg border font-bold ${deliveryType === "pickup" ? "bg-btnbg text-btnfg border-brand-700" : "bg-surface border-brand-200 text-brand-900"}`} onClick={() => setDeliveryType("pickup")}>استلام من الفرع</button>
            <button type="button" className={`px-3 py-2 rounded-lg border font-bold ${deliveryType === "table" ? "bg-btnbg text-btnfg border-brand-700" : "bg-surface border-brand-200 text-brand-900"}`} onClick={() => setDeliveryType("table")}>توصيل داخل الفرع (+5 ج)</button>
          </div>
        </div>

        {deliveryType === "table" && (
          <div className="space-y-2 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
            <div>
              <label className="label">رقم الدور <span className="text-danger-text">*</span></label>
              <div className="flex flex-wrap gap-2">
                {floorOptions.map((f) => {
                  const on = !floorOther && deliveryFloor === f;
                  return (
                    <button key={f} type="button" onClick={() => { setFloorOther(false); setDeliveryFloor(f); }} className={`min-h-[40px] min-w-[40px] rounded-lg border px-3 py-1.5 text-sm font-extrabold ${on ? "bg-btnbg text-btnfg border-brand-700" : "bg-surface border-brand-200 text-brand-900"}`}>{f}</button>
                  );
                })}
                <button type="button" onClick={() => { setFloorOther(true); setDeliveryFloor(""); }} className={`min-h-[40px] rounded-lg border px-3 py-1.5 text-sm font-extrabold ${floorOther ? "bg-btnbg text-btnfg border-brand-700" : "bg-surface border-brand-200 text-brand-900"}`}>أخرى</button>
              </div>
              {floorOther && <input className="input mt-2" placeholder="اكتب رقم/اسم الدور" maxLength={60} value={deliveryFloor} onChange={(e) => setDeliveryFloor(e.target.value)} />}
              <p className="mt-1 text-[12px] font-bold text-mut">عشان الموظفة توصلك بسرعة 💗</p>
            </div>
            <div>
              <label className="label">مكان الجلوس / رقم الغرفة أو الملعب <span className="text-mut">(اختياري)</span></label>
              <input className="input" placeholder="مثال: ملعب الاسكواش" maxLength={120} value={deliverySpot} onChange={(e) => setDeliverySpot(e.target.value)} />
            </div>
          </div>
        )}

        <div>
          <label className="label">اسم العميل (اختياري)</label>
          <input className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={60} placeholder="اسم العميل" />
        </div>
        <div>
          <label className="label">ملاحظات على الطلب (اختياري)</label>
          <textarea className="input min-h-[72px]" value={staffNote} onChange={(e) => setStaffNote(e.target.value.slice(0, 300))} maxLength={300} placeholder="مثال: من غير سكر، التغليف هدية..." />
          <div className="mt-1 text-[11px] font-bold text-mut text-left" dir="ltr">{staffNote.trim().length}/300</div>
        </div>

        {!shiftOpen && (
          <button className="btn-primary w-full" disabled={busy || !selectedBranch} onClick={openShift}>
            {busy ? "بنفتح…" : "فتح فترة عمل"}
          </button>
        )}
        {shiftOpen && <p className="text-xs font-bold text-brand-700">فترة العمل مفتوحة ✅</p>}
      </div>

      {selectedBranch && (
        <div className="card p-4 space-y-3">
          <h2 className="font-extrabold text-brand-800">منتجات فرع {selectedBranch.name}</h2>
          {products.length === 0 && <EmptyBox msg="لسه مفيش منتجات في هذا الفرع" />}
          <div className="grid gap-2">
            {products.map((p) => (
              <div key={p.id} className="border border-brand-100 rounded-xl p-2 flex items-center gap-2">
                {p.image_url ? <img src={p.image_url} alt={p.name} className="w-10 h-10 object-cover rounded-lg" /> : <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center text-[12px]">{p.name[0]}</div>}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-brand-900 text-sm truncate">{p.name}</p>
                  <p className="text-xs text-brand-700">{money(Number(p.price))}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" className="pill bg-brand-100 text-brand-800 text-xs" onClick={() => changeQty(p.id, -1)}>−</button>
                  <span className="w-6 text-center text-xs font-bold">{cart.find((i) => i.product_id === p.id)?.qty || 0}</span>
                  <button type="button" className="pill bg-btnbg text-btnfg text-xs" onClick={() => addToCart(p)}>+</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {cart.length > 0 && (
        <div className="card p-4 space-y-2">
          <h3 className="font-extrabold text-brand-800">السلة ({cart.reduce((s, i) => s + i.qty, 0)} منتج)</h3>
          <div className="space-y-1">
            {cart.map((i) => (
              <div key={i.product_id} className="flex items-center justify-between gap-2">
                <span className="text-sm text-brand-900">{i.name} ×{i.qty}</span>
                <div className="flex items-center gap-1">
                  <button type="button" className="pill bg-surface border border-border text-brand-900 text-xs" onClick={() => changeQty(i.product_id, -1)}>−</button>
                  <span className="w-6 text-center text-xs font-bold">{i.qty}</span>
                  <button type="button" className="pill bg-brand-100 text-brand-800 text-xs" onClick={() => changeQty(i.product_id, 1)}>+</button>
                </div>
                <span className="text-sm font-bold text-brand-700">{money(i.line_total)}</span>
                <button type="button" className="text-xs text-red-500" onClick={() => removeItem(i.product_id)}>حذف</button>
              </div>
            ))}
          </div>
          <div className="border-t border-brand-100 pt-2 space-y-1 text-sm">
            <div className="flex justify-between"><span>المجموع الفرعي</span><span>{money(subtotal)}</span></div>
            <div className="flex justify-between"><span>{deliveryType === "table" ? "توصيل داخل الفرع" : "استلام من الفرع"}</span><span>{deliveryFee ? `+${money(deliveryFee)}` : "مجانًا"}</span></div>
            {deliveryType === "table" && deliveryFloor.trim() && (
              <div className="flex justify-between"><span>الدور</span><span className="font-extrabold">{deliveryFloor.trim()}{deliverySpot.trim() ? ` – ${deliverySpot.trim()}` : ""}</span></div>
            )}
            <div className="flex justify-between font-extrabold text-base"><span>الإجمالي</span><span>{money(total)}</span></div>
            <button className="btn-primary w-full mt-1" disabled={busy || !shiftOpen || (deliveryType === "table" && !deliveryFloor.trim())} onClick={submitOrder}>
              {busy ? "بيتم التسجيل…" : `تسجيل الطلب (${paymentMethod === "cash" ? "كاش" : "انستا باي"})`}
            </button>
          </div>
        </div>
      )}

      {shiftOpen && cart.length === 0 && (
        <div className="card p-4 space-y-2">
          <h3 className="font-extrabold text-brand-800">إغلاق فترة العمل</h3>
          <div>
            <label className="label">المبلغ اللي تم عده (ج.م)</label>
            <input className="input" type="number" step="0.1" value={countedCash} onChange={(e) => setCountedCash(e.target.value)} placeholder="أدخل المبلغ المعدود" />
          </div>
          <div>
            <label className="label">ملاحظة (اختياري)</label>
            <input className="input" value={shiftCloseNote} onChange={(e) => setShiftCloseNote(e.target.value)} maxLength={300} placeholder="ملاحظة" />
          </div>
          <button className="btn-primary w-full" disabled={busy || !countedCash} onClick={closeShift}>
            {busy ? "بيتم الإغلاق…" : "إغلاق فترة العمل"}
          </button>
        </div>
      )}
    </div>
  );
}
