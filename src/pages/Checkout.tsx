import { useEffect, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { supabase, withTimeout } from "../lib/types";
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

const DELIVERY_ICON = {
  pickup: Store,
  table: UtensilsCrossed,
  obour: Bike,
} as const;

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

  useEffect(() => {
    if (items.length) trackEvent("begin_checkout", { currency: "EGP", value: subtotal, item_count: items.length });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const option = DELIVERY_OPTIONS.find((d) => d.key === delivery)!;
  const total = subtotal + option.fee;
  const cashAllowedByAmount = total <= cashMaxAmount;
  const canUseCash = cashEnabled && cashAllowedByAmount;

  useEffect(() => {
    if (paymentMethod === "cash" && !canUseCash) setPaymentMethod("instapay");
  }, [paymentMethod, canUseCash]);

  if (!branchId || items.length === 0) {
    return <EmptyBox msg="السلة فاضية — اختار حاجة حلوة من المنيو." />;
  }

  const submit = async () => {
    setError(null);
    const clean = name.replace(/\s+/g, " ").trim();
    const cleanPhone = phone.replace(/\s+/g, "").trim();
    if (clean.length < 2 || clean.length > 60) {
      setError("اكتب اسمك (من حرفين لـ 60 حرف) عشان نعرف نرجعلك وسط الطلبات");
      return;
    }
    if (paymentMethod === "cash") {
      if (!canUseCash) {
        setError(cashEnabled ? `حد أقصى لطلبات الكاش ${money(cashMaxAmount)} — لو طلبك أكبر اختار الدفع بانستا باي` : "الدفع كاش غير متاح حاليًا في هذا الفرع");
        return;
      }
      if (!isValidEgyptianPhone(cleanPhone)) {
        setError("اكتب رقم موبايل مصري صحيح (11 رقم يبدأ بـ 010 أو 011 أو 012 أو 015) عشان نقدر نتواصل معاك لو لزم الأمر");
        return;
      }
    }

    storageSet("session", "lalas_name", clean);
    if (cleanPhone) storageSet("session", "lalas_phone", cleanPhone);
    setBusy(true);
    // ⚠️ السعر والرسوم بيتحسبوا تاني على السيرفر من أسعار قاعدة البيانات
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
      setError("المسار اتأخر — المحاولة تاني بعد لحظات");
      setBusy(false);
      return;
    }

    const data: any = res.data;
    if (res.error || !data?.ok || !data?.order_number || !data?.tracking_key) {
      setError(res.error?.message || data?.message || "حصلت مشكلة في تسجيل الطلب — جرّب تاني بعد لحظات");
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
    <div className="space-y-3.5 pb-24">
      <CheckoutStepper step={2} />

      <div>
        <h1 className="text-[20px] font-extrabold text-brand-800 dark:text-[#ffe3ea]">تأكيد طلبك</h1>
        <p className="text-[13px] text-mut">اختار طريقة الاستلام والدفع، وهنسجّل طلبك على طول</p>
      </div>

      {/* طريقة الاستلام */}
      <fieldset className="card p-3.5 text-brand-900 dark:text-brand-100">
        <legend className="sr-only">طريقة الاستلام</legend>
        <b className="text-[15px]">طريقة الاستلام</b>
        <div className="mt-2 grid gap-2">
          {DELIVERY_OPTIONS.map((d) => {
            const Icon = DELIVERY_ICON[d.key as DeliveryKey];
            const on = delivery === d.key;
            return (
              <label
                key={d.key}
                className={`flex cursor-pointer items-center gap-3 rounded-2xl border-[1.5px] p-3 outline-none transition ${
                  on
                    ? "border-brand-600 bg-brand-50 ring-2 ring-brand-200 dark:border-[#e8b4c4] dark:bg-white/10 dark:ring-white/10"
                    : "border-brand-200 bg-white hover:border-brand-400 dark:border-white/12 dark:bg-white/5"
                }`}
              >
                <input type="radio" name="delivery" value={d.key} checked={on} onChange={() => setDelivery(d.key)} className="sr-only" />
                <span
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${
                    on ? "bg-brand-600 text-white" : "bg-brand-100 text-brand-700 dark:bg-white/10 dark:text-[#ecc9d2]"
                  }`}
                >
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold leading-5">{d.label}</span>
                  <span className="text-[11px] font-bold text-mut">{d.fee === 0 ? "مجانًا" : `+${money(d.fee)}`}</span>
                </span>
                <span
                  aria-hidden="true"
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
                    on ? "border-brand-600 bg-brand-600 text-white" : "border-brand-200"
                  }`}
                >
                  {on && (
                    <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" fill="none">
                      <path d="M2 6.5L4.8 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        {option.desc && <div className="msg-box mt-2 text-[13px]">{option.desc}</div>}
      </fieldset>

      {/* طريقة الدفع — كروت كبيرة */}
      <fieldset className="card p-3.5 text-brand-900 dark:text-brand-100">
        <legend className="sr-only">طريقة الدفع</legend>
        <b className="text-[15px]">طريقة الدفع</b>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {/* كاش */}
          <button
            type="button"
            role="radio"
            aria-checked={paymentMethod === "cash"}
            disabled={!canUseCash}
            onClick={() => canUseCash && setPaymentMethod("cash")}
            className={`relative flex min-h-[132px] flex-col items-center justify-center gap-1.5 rounded-2xl border-[1.5px] p-3 text-center outline-none transition focus-visible:ring-2 focus-visible:ring-brand-500 active:scale-[0.97] ${
              paymentMethod === "cash"
                ? "border-brand-600 bg-brand-50 ring-2 ring-brand-200 dark:border-[#e8b4c4] dark:bg-white/10 dark:ring-white/10"
                : "border-brand-200 bg-white hover:border-brand-400 dark:border-white/12 dark:bg-white/5"
            } ${!canUseCash ? "cursor-not-allowed opacity-55" : ""}`}
          >
            <Banknote size={34} strokeWidth={1.8} className="text-green-700 dark:text-green-400" aria-hidden="true" />
            <span className="text-[17px] font-extrabold">كاش</span>
            <span className="text-[11px] font-bold leading-4 text-mut">الدفع عند الاستلام</span>
            {paymentMethod === "cash" && (
              <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-white" aria-hidden="true">
                <Check size={14} strokeWidth={3} />
              </span>
            )}
          </button>

          {/* انستا باي */}
          <button
            type="button"
            role="radio"
            aria-checked={paymentMethod === "instapay"}
            onClick={() => setPaymentMethod("instapay")}
            className={`relative flex min-h-[132px] flex-col items-center justify-center gap-1.5 rounded-2xl border-[1.5px] p-3 text-center outline-none transition focus-visible:ring-2 focus-visible:ring-brand-500 active:scale-[0.97] ${
              paymentMethod === "instapay"
                ? "border-brand-600 bg-brand-50 ring-2 ring-brand-200 dark:border-[#e8b4c4] dark:bg-white/10 dark:ring-white/10"
                : "border-brand-200 bg-white hover:border-brand-400 dark:border-white/12 dark:bg-white/5"
            }`}
          >
            <Smartphone size={34} strokeWidth={1.8} className="text-violet-700 dark:text-violet-300" aria-hidden="true" />
            <span className="text-[17px] font-extrabold">InstaPay</span>
            <span className="text-[11px] font-bold leading-4 text-mut">تحويل + رفع صورة التحويل</span>
            {paymentMethod === "instapay" && (
              <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-white" aria-hidden="true">
                <Check size={14} strokeWidth={3} />
              </span>
            )}
          </button>
        </div>

        {!cashEnabled && (
          <p className="mt-2 text-[11px] font-bold text-rose-700 dark:text-rose-300">الدفع كاش غير متاح حاليًا في هذا الفرع.</p>
        )}
        {cashEnabled && !cashAllowedByAmount && (
          <p className="mt-2 text-[11px] font-bold text-rose-700 dark:text-rose-300">
            حد أقصى لطلبات الكاش {money(cashMaxAmount)} — اختار انستا باي للطلبات الأكبر.
          </p>
        )}

        {paymentMethod === "cash" && (
          <div className="msg-box mt-2 text-[13px]">
            تمام! هتدفع كاش وقت الاستلام — جهّز المبلغ: <b>{money(total)}</b>
            {delivery === "obour" && (
              <div className="mt-1">للتوصيل داخل نطاق العبور: المبلغ بيتدفع كاش لمندوب التوصيل عند الاستلام.</div>
            )}
          </div>
        )}
      </fieldset>

      {/* بيانات العميل */}
      <div className="card space-y-2 p-3.5">
        <div>
          <label htmlFor="cstm-name" className="label">اسم صاحب الطلب</label>
          <input
            id="cstm-name"
            className="input"
            placeholder="الاسم"
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
            <p className="mt-1 text-[11px] text-mut">رقم مصري صحيح (11 رقم) عشان نتواصل معاك لتأكيد الطلب لو لزم الأمر.</p>
          )}
        </div>
      </div>

      {/* ملخص الفاتورة */}
      <div className="card p-3.5 text-[13px] text-brand-900 dark:text-brand-100">
        <div className="flex justify-between gap-2">
          <span>فرع {branchName}</span>
          <span>{money(subtotal)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>{option.label}</span>
          <span>{option.fee === 0 ? "مجانًا" : `+${money(option.fee)}`}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>طريقة الدفع</span>
          <span>{paymentMethod === "cash" ? "كاش عند الاستلام" : "InstaPay"}</span>
        </div>
        <div className="mt-1 flex items-center justify-between border-t border-brand-200 pt-1.5 dark:border-white/10">
          <span className="text-base">الإجمالي</span>
          <b className="text-[19px] text-brand-800 dark:text-[#ffe3ea]">{money(total)}</b>
        </div>
      </div>

      <Turnstile onChange={setToken} />
      {error && <ErrorBox msg={error} />}

      {/* زر التأكيد ثابت فوق شريط التنقل */}
      <StickyBar
        total={total}
        busy={busy}
        busyLabel="بيقفّل طلبك…"
        label={paymentMethod === "cash" ? "تأكيد طلب الكاش" : "تأكيد الطلب والمتابعة للدفع"}
        onClick={submit}
      />

      <p className="m-0 text-center text-xs text-mut">
        عندك طلب من قبل؟{" "}
        <Link to="/track" className="font-bold underline underline-offset-2">
          تابعه هنا
        </Link>
      </p>
    </div>
  );
}
