import { useEffect, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { supabase, withTimeout } from "../lib/types";
import { useCart } from "../context/CartContext";
import { money, DELIVERY_OPTIONS, type DeliveryKey, isValidEgyptianPhone } from "../lib/format";
import { ErrorBox, EmptyBox } from "../components/Common";
import { Turnstile } from "../components/Turnstile";
import { storageGet, storageSet, storageGetJSON, storageSetJSON } from "../lib/storage";

type PaymentMethod = "cash" | "instapay";

export default function Checkout() {
  const { state } = useLocation() as { state?: { delivery?: DeliveryKey } };
  const { items, subtotal, branchId, branchName, clear } = useCart();
  const [delivery, setDelivery] = useState<DeliveryKey>(state?.delivery ?? "pickup");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("instapay");
  const [name, setName] = useState(() => storageGet("session", "lalas_name") || "");
  const [phone, setPhone] = useState(() => storageGet("session", "lalas_phone") || "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cashEnabled, setCashEnabled] = useState<boolean>(true);
  const [cashMaxAmount, setCashMaxAmount] = useState<number>(500);
  const navigate = useNavigate();

  useEffect(() => {
    if (!branchId) return;
    (async () => {
      const { data } = await supabase
        .from("branches")
        .select("cash_enabled, cash_max_amount")
        .eq("id", branchId)
        .maybeSingle();
      const enabled = (data as any)?.cash_enabled !== false;
      setCashEnabled(enabled);
      if ((data as any)?.cash_max_amount != null) setCashMaxAmount(Number((data as any).cash_max_amount));
      if (!enabled) setPaymentMethod("instapay");
    })();
  }, [branchId]);

  if (!branchId || items.length === 0) {
    return <EmptyBox msg="السلة فاضية 🛒 اختار حاجة حلوة من المنيو." />;
  }

  const option = DELIVERY_OPTIONS.find((d) => d.key === delivery)!;
  const total = subtotal + option.fee;
  const cashAllowedByAmount = total <= cashMaxAmount;
  const canUseCash = cashEnabled && cashAllowedByAmount;

  useEffect(() => {
    if (paymentMethod === "cash" && !canUseCash) setPaymentMethod("instapay");
  }, [paymentMethod, canUseCash]);

  const submit = async () => {
    setError(null);
    const clean = name.replace(/\s+/g, " ").trim();
    const cleanPhone = phone.replace(/\s+/g, "").trim();
    if (clean.length < 2 || clean.length > 60) {
      setError("اكتب اسمك (من حرفين لـ 60 حرف) عشان نعرف نرجعلك وسط الطلبات 🌸");
      return;
    }
    if (paymentMethod === "cash") {
      if (!canUseCash) {
        setError(cashEnabled ? `حد أقصى لطلبات الكاش ${money(cashMaxAmount)} — لو طلبك أكبر اختار الدفع بانستا باي` : "الدفع كاش غير متاح حاليًا في هذا الفرع");
        return;
      }
      if (!isValidEgyptianPhone(cleanPhone)) {
        setError("اكتب رقم موبايل مصري صحيح (11 رقم يبدأ بـ 010 أو 011 أو 012 أو 015) عشان نقدر نتواصل معاك لو لزم الأمر 📱");
        return;
      }
    }

    storageSet("session", "lalas_name", clean);
    if (cleanPhone) storageSet("session", "lalas_phone", cleanPhone);
    setBusy(true);
    // ⚠️ السعر والرسوم Betحسابوا تاني على السيرفر من أسعار قاعدة البيانات
    const res = await withTimeout<{
      ok: boolean;
      order_number: string;
      order_id: string;
      tracking_key: string;
      total: number;
      payment_method?: "cash" | "instapay";
      payment_status?: string;
      message?: string;
    }>(supabase.rpc("submit_order_v2", {
      p_branch_id: branchId,
      p_items: items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
      p_delivery_type: delivery,
      p_customer_name: clean,
      p_turnstile_token: token || null,
      p_payment_method: paymentMethod,
      p_customer_phone: paymentMethod === "cash" ? cleanPhone : (cleanPhone || null),
    }), 15000);

    if (!res) {
      setError("المسار اتأخر — المحاولة تاني بعد لحظات 🥲");
      setBusy(false);
      return;
    }

    const data: any = res.data;
    if (res.error || !data?.ok || !data?.order_number || !data?.tracking_key) {
      setError(res.error?.message || data?.message || "حصلت مشكلة في تسجيل الطلب — جرّب تاني بعد لحظات 🥲");
      setBusy(false);
      return;
    }

    const orderEntry = {
      order_number: data.order_number,
      tracking_key: data.tracking_key,
      branch_id: branchId,
      branch_name: branchName,
      total: data.total,
      date: new Date().toISOString(),
      payment_method: data.payment_method || paymentMethod,
      payment_status: data.payment_status || "pending",
    };
    const myOrdersStr = storageGetJSON<Array<{ order_number?: string }>>("local", "my_orders", []);
    if (!myOrdersStr.find((o) => o.order_number === data.order_number)) {
      myOrdersStr.unshift(orderEntry);
      storageSetJSON("local", "my_orders", myOrdersStr);
    }
    storageSetJSON("session", "lalas_last_order", data);
    storageSetJSON("local", "lalas_last_order", data);

    clear();
    // Cash: go to order page (no instapay proof flow). InstaPay: keep current flow via order page/payment link.
    navigate(`/order/${data.order_number}?k=${data.tracking_key}`, { state: { name: clean } });
    setBusy(false);
  };

  return (
    <div className="space-y-2.5">
      <h2 className="text-[22px] font-bold text-brand-700 mt-1.5 mb-0">تأكيد طلبك 💗</h2>
      <div className="text-mut text-sm">
        اختار طريقة الاستلام والدفع، وهنسجّل طلبك ونبعتلك رقم المتابعة.
      </div>

      <div className="card p-3.5 text-brand-900">
        <b>طريقة الاستلام</b>
        <div className="flex flex-wrap gap-2 mt-2">
          {DELIVERY_OPTIONS.map((d) => (
            <button
              key={d.key}
              className={`!px-3 ${delivery === d.key ? "btn-dark" : "btn-outline"}`}
              onClick={() => setDelivery(d.key)}
            >
              {d.label}
            </button>
          ))}
        </div>
        {option.desc && <div className="msg-box mt-2">{option.desc}</div>}
      </div>

      <div className="card p-3.5 text-brand-900">
        <b>طريقة الدفع</b>
        <div className="grid gap-2 mt-2">
          <button
            type="button"
            className={`text-right p-3 rounded-xl border ${paymentMethod === "cash" ? "border-brand-600 bg-brand-50" : "border-brand-200 bg-white"} ${!canUseCash ? "opacity-60" : ""}`}
            onClick={() => canUseCash && setPaymentMethod("cash")}
            disabled={!canUseCash}
          >
            <div className="font-bold">💵 كاش (ادفع عند الاستلام / لما الطلب يوصلك)</div>
            <div className="text-sm text-mut mt-1">مفيش تحويل ولا صورة — الدفع وقت الاستلام.</div>
            {!cashEnabled && <div className="text-xs text-rose-700 mt-1 font-bold">الدفع كاش غير متاح حاليًا في هذا الفرع.</div>}
            {cashEnabled && !cashAllowedByAmount && <div className="text-xs text-rose-700 mt-1 font-bold">حد أقصى لطلبات الكاش {money(cashMaxAmount)} — اختار انستا باي للطلبات الأكبر.</div>}
          </button>
          <button
            type="button"
            className={`text-right p-3 rounded-xl border ${paymentMethod === "instapay" ? "border-brand-600 bg-brand-50" : "border-brand-200 bg-white"}`}
            onClick={() => setPaymentMethod("instapay")}
          >
            <div className="font-bold">📲 InstaPay (تحويل + إرفاق صورة التحويل)</div>
            <div className="text-sm text-mut mt-1">حوّل على انستا باي وارفع صورة التحويل لتأكيد الطلب.</div>
          </button>
        </div>

        {paymentMethod === "cash" && (
          <div className="msg-box mt-3 text-sm">
            تمام! هتدفع كاش وقت الاستلام 💗 جهّز المبلغ: <b>{money(total)}</b>
            {delivery === "obour" && (
              <div className="mt-1">للتوصيل داخل نطاق العبور: المبلغ بيتدفع كاش لمندوب التوصيل عند الاستلام.</div>
            )}
          </div>
        )}
      </div>

      <div className="card p-3.5 space-y-2">
        <div>
          <label htmlFor="cstm-name" className="label">اسم صاحب الطلب</label>
          <input
            id="cstm-name"
            className="input"
            placeholder="اسم صاحب الطلب"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </div>
        <div>
          <label htmlFor="cstm-phone" className="label">
            رقم الموبايل {paymentMethod === "cash" ? <span className="text-rose-700">(مطلوب للكاش)</span> : <span className="text-mut">(اختياري)</span>}
          </label>
          <input
            id="cstm-phone"
            className="input"
            dir="ltr"
            inputMode="tel"
            placeholder="01xxxxxxxxx"
            maxLength={15}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
          />
          {paymentMethod === "cash" && (
            <p className="text-xs text-mut mt-1">مطلوب رقم مصري صحيح (11 رقم) عشان نقدر نتواصل معاك لتأكيد الطلب لو لزم الأمر.</p>
          )}
        </div>
      </div>

      <div className="card p-3.5 text-sm text-brand-900">
        <div className="flex justify-between">
          <span>فرع {branchName}</span>
          <span>{money(subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span>{option.label}</span>
          <span>{option.fee === 0 ? "مجانًا 🎉" : "+" + money(option.fee)}</span>
        </div>
        <div className="flex justify-between">
          <span>طريقة الدفع</span>
          <span>{paymentMethod === "cash" ? "💵 كاش عند الاستلام" : "📲 InstaPay"}</span>
        </div>
        <div className="flex items-center justify-between pt-1 mt-1 border-t border-brand-200">
          <span className="text-base">الإجمالي</span>
          <b className="text-[20px] text-brand-700">{money(total)}</b>
        </div>
      </div>

      <Turnstile onChange={setToken} />
      {error && <ErrorBox msg={error} />}

      <p className="m-0">
        <button className="btn-primary w-full text-base" disabled={busy} onClick={submit}>
          {busy ? "بيقفّل طلبك… ⏳" : (paymentMethod === "cash" ? "تأكيد طلب الكاش" : "تأكيد الطلب والمتابعة للدفع")}
        </button>
      </p>

      <p className="text-center text-xs text-mut m-0">
        عندك طلب من قبل؟ <Link to="/track" className="underline font-bold">تابعه هنا</Link>
      </p>
    </div>
  );
}
