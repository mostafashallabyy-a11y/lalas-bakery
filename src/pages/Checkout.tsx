import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { supabase, withTimeout, type Branch } from "../lib/types";
import { useCart } from "../context/CartContext";
import { money, DELIVERY_OPTIONS, type DeliveryKey, isValidEgyptianPhone } from "../lib/format";
import { ErrorBox, EmptyBox } from "../components/Common";
import { Turnstile } from "../components/Turnstile";
import { storageGet, storageSet, storageGetJSON, storageSetJSON } from "../lib/storage";
import { trackEvent } from "../lib/analytics";
import CheckoutStepper from "../components/CheckoutStepper";
import StickyBar from "../components/StickyBar";
import { Store, UtensilsCrossed, Bike, Banknote, Smartphone, Check } from "lucide-react";

type PaymentMethod = "cash" | "instapay";

const DELIVERY_ICON = { pickup: Store, table: UtensilsCrossed, obour: Bike } as const;
const DEFAULT_FLOORS = ["الأرضي", "1", "2", "3", "4", "5"];

function cairoMinutesNow(): number {
  try {
    const d = new Date();
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
    const hh = Number(parts.find(p => p.type === "hour")?.value ?? "0");
    const mm = Number(parts.find(p => p.type === "minute")?.value ?? "0");
    return hh * 60 + mm;
  } catch { const d = new Date(); return (d.getUTCHours() * 60 + d.getUTCMinutes() + 120) % 1440; }
}
function parseHM(s?: string | null): number | null {
  if (!s) return null; const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
  if (!m) return null; return Number(m[1]) * 60 + Number(m[2]);
}
function isObourAvailableClient(b: Branch | null): boolean {
  if (!b) return true;
  if (b.obour_enabled === false) return false;
  const h = b.obour_hours || null;
  if (h?.enabled) {
    const from = parseHM(h.from), to = parseHM(h.to);
    if (from == null || to == null) return true;
    const now = cairoMinutesNow();
    if (from <= to) return now >= from && now <= to;
    return now >= from || now <= to;
  }
  return true;
}

export default function Checkout() {
  const { state } = useLocation() as { state?: { delivery?: DeliveryKey } };
  const { items, subtotal, branchId, branchName, clear } = useCart();
  const navigate = useNavigate();

  const [branch, setBranch] = useState<Branch | null>(null);
  const [delivery, setDelivery] = useState<DeliveryKey>(state?.delivery ?? "pickup");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("instapay");
  const [name, setName] = useState(storageGet("session", "lalas_name") || "");
  const [phone, setPhone] = useState(storageGet("session", "lalas_phone") || "");
  const [deliveryFloor, setDeliveryFloor] = useState("");
  const [deliverySpot, setDeliverySpot] = useState("");
  const [floorOther, setFloorOther] = useState(false);
  const [obourAddress, setObourAddress] = useState("");
  const [obourLandmark, setObourLandmark] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState("");

  useEffect(() => { trackEvent("begin_checkout", { currency: "EGP", value: subtotal }); }, []); // eslint-disable-line

  const fetchBranch = async (id: string, cancelledRef?: { v: boolean }) => {
    const { data } = await supabase.from("branches").select("*").eq("id", id).maybeSingle();
    if ((!cancelledRef || !cancelledRef.v) && data) setBranch(data as Branch);
  };

  useEffect(() => {
    if (!branchId) return;
    const cancelled = { v: false };
    fetchBranch(branchId, cancelled);
    const poll = setInterval(() => fetchBranch(branchId, cancelled), 15000);
    const ch = supabase.channel(`branch-${branchId}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "branches", filter: `id=eq.${branchId}` }, () => fetchBranch(branchId, cancelled)).subscribe();
    return () => { cancelled.v = true; clearInterval(poll); supabase.removeChannel(ch); };
  }, [branchId]);

  const obourAvailable = isObourAvailableClient(branch);
  const obourFee = Number(branch?.obour_fee ?? 50);
  const obourClosedMsg = branch?.obour_closed_message || "التوصيل داخل العبور غير متاح حاليًا 💗 تقدر تستلم من الفرع أو نوصّلك لحد مكانك جوه الفرع";

  const options = useMemo(() => DELIVERY_OPTIONS.map((d) => d.key === "obour" ? { ...d, fee: obourFee, desc: obourAvailable ? d.desc : obourClosedMsg } : d), [obourFee, obourAvailable, obourClosedMsg]);
  const option = options.find((d) => d.key === delivery)!;
  const total = subtotal + option.fee;

  const cashEnabled = branch?.cash_enabled !== false;
  const cashMaxAmount = Number(branch?.cash_max_amount ?? 500);
  const cashAllowedByAmount = total <= cashMaxAmount;
  const canUseCash = cashEnabled && cashAllowedByAmount;

  const floorOptions: string[] = Array.isArray(branch?.delivery_floors) && (branch!.delivery_floors as string[]).length ? (branch!.delivery_floors as string[]) : DEFAULT_FLOORS;

  useEffect(() => { if (paymentMethod === "cash" && !canUseCash) setPaymentMethod("instapay"); }, [paymentMethod, canUseCash]);
  useEffect(() => { if (!obourAvailable && delivery === "obour") setDelivery("pickup"); }, [obourAvailable, delivery]);
  useEffect(() => { if (delivery !== "table") { setDeliveryFloor(""); setDeliverySpot(""); setFloorOther(false); } }, [delivery]);
  useEffect(() => { if (delivery !== "obour") { setObourAddress(""); setObourLandmark(""); } }, [delivery]);

  if (!branchId || items.length === 0) return <EmptyBox msg="السلة فاضية — اختار حاجة حلوة من المنيو." />;

  const cleanName = name.replace(/\s+/g, " ").trim();
  const cleanPhone = phone.replace(/\s+/g, "").trim();
  const cleanFloor = deliveryFloor.replace(/\s+/g, " ").trim();
  const cleanSpot = deliverySpot.replace(/\s+/g, " ").trim();
  const cleanAddress = obourAddress.replace(/\s+/g, " ").trim();
  const cleanLandmark = obourLandmark.replace(/\s+/g, " ").trim();
  const cleanNote = customerNote.replace(/\s+/g, " ").trim();

  const floorValid = delivery !== "table" || cleanFloor.length > 0;
  const obourFieldsValid = delivery !== "obour" || (cleanName.length >= 2 && isValidEgyptianPhone(cleanPhone) && cleanAddress.length >= 10 && cleanAddress.length <= 300 && cleanLandmark.length <= 120);
  const noteValid = cleanNote.length <= 300;
  const canSubmit = !busy && floorValid && obourFieldsValid && noteValid && (delivery !== "obour" || obourAvailable);

  const submit = async () => {
    setError(null);
    if (cleanName.length < 2 || cleanName.length > 60) { setError("اكتب اسمك (من حرفين لـ 60 حرف) عشان نعرف نناديك وقت الاستلام"); return; }
    if (delivery === "table") {
      if (!cleanFloor) { setError("اختار رقم الدور عشان الموظفة توصلك بسرعة 💗"); return; }
      if (cleanFloor.length > 60) { setError("رقم الدور طويل — اختصره شوية"); return; }
      if (cleanSpot.length > 120) { setError("مكان الجلوس/الغرفة طويل — اختصره شوية"); return; }
    }
    if (delivery === "obour") {
      if (!obourAvailable) { setError(obourClosedMsg); return; }
      if (!isValidEgyptianPhone(cleanPhone)) { setError("اكتب رقم موبايل مصري صحيح (11 رقم يبدأ بـ 010 أو 011 أو 012 أو 015)"); return; }
      if (cleanAddress.length < 10) { setError("اكتب العنوان بالتفصيل (الحي/المنطقة، الشارع، رقم العمارة/الدور/الشقة)"); return; }
      if (cleanAddress.length > 300) { setError("العنوان طويل — اختصره شوية"); return; }
    }
    if (paymentMethod === "cash") {
      if (!canUseCash) { setError(cashEnabled ? `حد أقصى لطلبات الكاش ${money(cashMaxAmount)} — لو طلبك أكبر اختار الدفع بانستا باي` : "الدفع كاش غير متاح حاليًا في هذا الفرع"); return; }
      if (!isValidEgyptianPhone(cleanPhone)) { setError("اكتب رقم موبايل مصري صحيح (11 رقم يبدأ بـ 010 أو 011 أو 012 أو 015)"); return; }
    }
    if (cleanNote.length > 300) { setError("ملاحظات الطلب طويلة — الحد الأقصى 300 حرف"); return; }

    storageSet("session", "lalas_name", cleanName);
    if (cleanPhone) storageSet("session", "lalas_phone", cleanPhone);
    setBusy(true);

    const res = await withTimeout<any>(supabase.rpc("submit_order_v2", {
      p_branch_id: branchId,
      p_items: items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
      p_delivery_type: delivery,
      p_customer_name: cleanName,
      p_turnstile_token: token || null,
      p_payment_method: paymentMethod,
      p_customer_phone: (paymentMethod === "cash" || delivery === "obour") ? cleanPhone : (cleanPhone || null),
      p_delivery_floor: delivery === "table" ? cleanFloor : null,
      p_delivery_spot: delivery === "table" ? (cleanSpot || null) : null,
      p_delivery_address: delivery === "obour" ? cleanAddress : null,
      p_delivery_landmark: delivery === "obour" ? (cleanLandmark || null) : null,
      p_customer_note: cleanNote || null,
    }), 15000);

    if (!res) { setError("المسافة أخدت وقت أطول من اللازم — جرّب تأكيد الطلب تاني"); setBusy(false); return; }
    const data: any = res.data;
    if (res.error || !data?.ok || !data?.order_number || !data?.tracking_key) {
      setError(res.error?.message || data?.message || "حصلت مشكلة في تسجيل الطلب — جرّب تاني بعد لحظات");
      setBusy(false); return;
    }

    const orderEntry = { order_number: data.order_number, tracking_key: data.tracking_key, branch_id: branchId, branch_name: branchName, total: data.total, date: new Date().toISOString(), payment_method: data.payment_method || paymentMethod, payment_status: data.payment_status || "pending" };
    const myOrders = storageGetJSON<Array<{ order_number?: string }>>("local", "my_orders", []);
    if (!myOrders.find((o) => o.order_number === data.order_number)) { myOrders.unshift(orderEntry); storageSetJSON("local", "my_orders", myOrders); }
    storageSetJSON("session", "lalas_last_order", data);
    storageSetJSON("local", "lalas_last_order", data);
    clear();
    navigate(`/order/${data.order_number}?k=${data.tracking_key}`, { state: { name: cleanName } });
    setBusy(false);
  };

  return (
    <div className="space-y-3.5 pb-24">
      <CheckoutStepper step={2} />
      <div>
        <h1 className="text-[20px] font-extrabold text-brand-800">تأكيد طلبك</h1>
        <p className="text-[13px] text-mut">اختار طريقة الاستلام والدفع، وهنسجّل طلبك على طول</p>
      </div>

      <fieldset className="card p-3.5 text-brand-900">
        <legend className="sr-only">طريقة الاستلام</legend>
        <b className="text-[15px]">طريقة الاستلام</b>
        <div className="mt-2 grid gap-2">
          {options.map((d) => {
            const Icon = DELIVERY_ICON[d.key as DeliveryKey];
            const on = delivery === d.key;
            const disabled = d.key === "obour" && !obourAvailable;
            return (
              <label key={d.key} className={`flex items-center gap-3 rounded-2xl border-[1.5px] p-3 transition ${disabled ? "cursor-not-allowed opacity-60 border-brand-200 bg-surface2" : "cursor-pointer"} ${on && !disabled ? "border-brand-600 bg-brand-50 ring-2 ring-brand-200" : !disabled ? "border-brand-200 bg-surface hover:border-brand-400" : ""}`}>
                <input type="radio" name="delivery" value={d.key} checked={on} disabled={disabled} onChange={() => !disabled && setDelivery(d.key as DeliveryKey)} className="sr-only" />
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${on && !disabled ? "bg-btnbg text-btnfg" : "bg-brand-100 text-brand-700"}`}><Icon size={20} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold leading-5">{d.key === "obour" ? `توصيل داخل نطاق العبور (+${obourFee} ج)` : d.label}</span>
                  <span className="text-[11px] font-bold text-mut">{d.fee === 0 ? "مجانًا" : `+${money(d.fee)}`}</span>
                  {disabled && <span className="mt-1 block text-[12px] font-bold text-danger-text leading-5">{obourClosedMsg}</span>}
                </span>
                <span aria-hidden="true" className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${on && !disabled ? "border-brand-600 bg-btnbg text-btnfg" : "border-brand-200"}`}>
                  {on && !disabled && (<svg viewBox="0 0 12 12" className="h-3.5 w-3.5" fill="none"><path d="M2 6.5L4.8 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>)}
                </span>
              </label>
            );
          })}
        </div>
        {option.desc && !(delivery === "obour" && !obourAvailable) && <div className="msg-box mt-2 text-[13px]">{option.desc}</div>}

        {delivery === "table" && (
          <div className="mt-3 space-y-3 rounded-2xl border border-brand-200 bg-brand-50/40 p-3">
            <div>
              <div className="mb-1"><label className="text-[14px] font-extrabold text-brand-900">رقم الدور <span className="text-danger-text">*</span></label></div>
              <div className="flex flex-wrap gap-2">
                {floorOptions.map((f) => {
                  const on = !floorOther && deliveryFloor === f;
                  return <button key={f} type="button" onClick={() => { setFloorOther(false); setDeliveryFloor(f); }} className={`min-h-[44px] min-w-[44px] rounded-xl border-[1.5px] px-3 py-2 text-[14px] font-extrabold transition active:scale-[0.97] ${on ? "border-brand-600 bg-btnbg text-btnfg ring-2 ring-brand-200" : "border-brand-200 bg-surface text-brand-900 hover:border-brand-400"}`}>{f}</button>;
                })}
                <button type="button" onClick={() => { setFloorOther(true); setDeliveryFloor(""); }} className={`min-h-[44px] rounded-xl border-[1.5px] px-3 py-2 text-[14px] font-extrabold transition active:scale-[0.97] ${floorOther ? "border-brand-600 bg-btnbg text-btnfg ring-2 ring-brand-200" : "border-brand-200 bg-surface text-brand-900 hover:border-brand-400"}`}>أخرى</button>
              </div>
              {floorOther && <input className="input mt-2" placeholder="اكتب رقم/اسم الدور" maxLength={60} value={deliveryFloor} onChange={(e) => setDeliveryFloor(e.target.value)} />}
              <p className="mt-1 text-[12px] font-bold text-mut">عشان الموظفة توصلك بسرعة 💗</p>
            </div>
            <div>
              <label htmlFor="delivery-spot" className="label">مكان الجلوس / رقم الغرفة أو الملعب <span className="text-mut">(اختياري)</span></label>
              <input id="delivery-spot" className="input" placeholder="مثال: ملعب الاسكواش، غرفة 2..." maxLength={120} value={deliverySpot} onChange={(e) => setDeliverySpot(e.target.value)} />
            </div>
          </div>
        )}

        {delivery === "obour" && obourAvailable && (
          <div className="mt-3 space-y-2 rounded-2xl border border-brand-200 bg-brand-50/40 p-3">
            <p className="text-[14px] font-extrabold text-brand-900">بيانات التوصيل داخل العبور <span className="text-danger-text">*</span></p>
            <div>
              <label htmlFor="obour-address" className="label">العنوان بالتفصيل <span className="text-danger-text">*</span></label>
              <textarea id="obour-address" className="input min-h-[88px]" maxLength={300} placeholder="الحي/المنطقة، الشارع، رقم العمارة/الدور/الشقة" value={obourAddress} onChange={(e) => setObourAddress(e.target.value)} />
              <p className="mt-1 text-[11px] text-mut">اكتب العنوان بالتفصيل (10 أحرف على الأقل).</p>
            </div>
            <div>
              <label htmlFor="obour-landmark" className="label">علامة مميزة <span className="text-mut">(اختياري)</span></label>
              <input id="obour-landmark" className="input" maxLength={120} placeholder="مثال: جنب مسجد..." value={obourLandmark} onChange={(e) => setObourLandmark(e.target.value)} />
            </div>
            <p className="text-[12px] font-bold text-brand-800">بعد تأكيد الطلب هتظهر لك خطوة إرسال اللوكيشن على واتساب برقم الطلب.</p>
          </div>
        )}
      </fieldset>

      <fieldset className="card p-3.5 text-brand-900">
        <legend className="sr-only">طريقة الدفع</legend>
        <b className="text-[15px]">طريقة الدفع</b>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" role="radio" aria-checked={paymentMethod === "cash"} disabled={!canUseCash} onClick={() => canUseCash && setPaymentMethod("cash")} className={`relative flex min-h-[132px] flex-col items-center justify-center gap-1.5 rounded-2xl border-[1.5px] p-3 text-center transition active:scale-[0.97] ${paymentMethod === "cash" ? "border-brand-600 bg-brand-50 ring-2 ring-brand-200" : "border-brand-200 bg-surface hover:border-brand-400"} ${!canUseCash ? "cursor-not-allowed opacity-55" : ""}`}>
            <Banknote size={34} strokeWidth={1.8} className="text-ok-text" aria-hidden="true" />
            <span className="text-[17px] font-extrabold">كاش</span>
            <span className="text-[11px] font-bold leading-4 text-mut">الدفع عند الاستلام</span>
            {paymentMethod === "cash" && <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-btnbg text-btnfg"><Check size={14} strokeWidth={3} /></span>}
          </button>
          <button type="button" role="radio" aria-checked={paymentMethod === "instapay"} onClick={() => setPaymentMethod("instapay")} className={`relative flex min-h-[132px] flex-col items-center justify-center gap-1.5 rounded-2xl border-[1.5px] p-3 text-center transition active:scale-[0.97] ${paymentMethod === "instapay" ? "border-brand-600 bg-brand-50 ring-2 ring-brand-200" : "border-brand-200 bg-surface hover:border-brand-400"}`}>
            <Smartphone size={34} strokeWidth={1.8} className="text-violet-700" aria-hidden="true" />
            <span className="text-[17px] font-extrabold">InstaPay</span>
            <span className="text-[11px] font-bold leading-4 text-mut">تحويل + رفع صورة التحويل</span>
            {paymentMethod === "instapay" && <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-btnbg text-btnfg"><Check size={14} strokeWidth={3} /></span>}
          </button>
        </div>
        {!cashEnabled && <p className="mt-2 text-[11px] font-bold text-danger-text">الدفع كاش غير متاح حاليًا في هذا الفرع.</p>}
        {cashEnabled && !cashAllowedByAmount && <p className="mt-2 text-[11px] font-bold text-danger-text">حد أقصى لطلبات الكاش {money(cashMaxAmount)} — اختار انستا باي للطلبات الأكبر.</p>}
      </fieldset>

      <div className="card space-y-2 p-3.5">
        <div>
          <label htmlFor="cstm-name" className="label">اسم صاحب الطلب <span className="text-danger-text">*</span></label>
          <input id="cstm-name" className="input" placeholder="الاسم" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
        <div>
          <label htmlFor="cstm-phone" className="label">رقم الموبايل {(paymentMethod === "cash" || delivery === "obour") ? <span className="text-danger-text">*</span> : <span className="text-mut">(اختياري)</span>}</label>
          <input id="cstm-phone" className="input" dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx" maxLength={15} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          {(paymentMethod === "cash" || delivery === "obour") && <p className="mt-1 text-[11px] text-mut">رقم مصري صحيح (11 رقم يبدأ بـ 010/011/012/015).</p>}
        </div>
      </div>

      {/* Part 7: ملاحظات على الطلب (اختياري) قبل تأكيد الدفع */}
      <div className="card space-y-1.5 p-3.5">
        <label htmlFor="customer-note" className="label">ملاحظات على الطلب <span className="text-mut">(اختياري)</span></label>
        <textarea id="customer-note" className="input min-h-[88px]" maxLength={300} placeholder="مثال: من غير سكر، التغليف هدية..." value={customerNote} onChange={(e) => setCustomerNote(e.target.value)} />
        <div className="flex justify-between text-[11px] font-bold">
          <span className="text-mut">تظهر للموظف على كارت الطلب</span>
          <span className={cleanNote.length > 280 ? "text-danger-text" : "text-mut"}>{cleanNote.length}/300</span>
        </div>
      </div>

      <div className="card p-3.5 text-[13px] text-text">
        <div className="flex justify-between gap-2"><span>فرع {branchName}</span><span>{money(subtotal)}</span></div>
        <div className="flex justify-between gap-2"><span>{delivery === "obour" ? `توصيل داخل نطاق العبور (+${obourFee} ج)` : option.label}</span><span>{option.fee === 0 ? "مجانًا" : `+${money(option.fee)}`}</span></div>
        {delivery === "table" && cleanFloor && <div className="flex justify-between gap-2"><span>التوصيل داخل الفرع</span><span className="font-bold">الدور {cleanFloor}{cleanSpot ? ` – ${cleanSpot}` : ""}</span></div>}
        <div className="flex justify-between gap-2"><span>طريقة الدفع</span><span>{paymentMethod === "cash" ? "كاش عند الاستلام" : "InstaPay"}</span></div>
        {cleanNote && <div className="mt-1 rounded-lg border border-brand-200 bg-brand-50/50 p-2 text-[12px]"><b>ملاحظة:</b> {cleanNote}</div>}
        <div className="mt-1 flex items-center justify-between border-t border-border pt-1.5"><span className="text-base font-bold">الإجمالي</span><b className="text-[19px] font-extrabold text-primary-strong">{money(total)}</b></div>
      </div>

      <Turnstile onChange={setToken} />
      {error && <ErrorBox msg={error} />}

      <StickyBar total={total} busy={busy} busyLabel="بنأكّد طلبك…" label={paymentMethod === "cash" ? "تأكيد طلب الكاش" : "تأكيد الطلب والمتابعة للدفع"} onClick={submit} disabled={!canSubmit} />

      <p className="m-0 text-center text-xs text-mut">عندك طلب من قبل؟ <Link to="/track" className="font-bold underline underline-offset-2">تابع هنا</Link></p>
    </div>
  );
}
