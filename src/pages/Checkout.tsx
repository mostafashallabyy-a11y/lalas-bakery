import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { supabase } from "../lib/types";
import { useCart } from "../context/CartContext";
import { money, DELIVERY_OPTIONS, type DeliveryKey } from "../lib/format";
import { ErrorBox, EmptyBox } from "../components/Common";
import { Turnstile } from "../components/Turnstile";

export default function Checkout() {
  const { state } = useLocation() as { state?: { delivery?: DeliveryKey } };
  const { items, subtotal, branchId, branchName, clear } = useCart();
  const [delivery, setDelivery] = useState<DeliveryKey>(state?.delivery ?? "pickup");
  const [name, setName] = useState(() => sessionStorage.getItem("lalas_name") || "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  if (!branchId || items.length === 0) {
    return <EmptyBox msg="عربتك فاضية 🥲 — ارجع لمنيو الفرع واختار حلوياتك الأول" />;
  }

  const option = DELIVERY_OPTIONS.find((d) => d.key === delivery)!;

  const submit = async () => {
    setError(null);
    const clean = name.replace(/\s+/g, " ").trim();
    if (clean.length < 2 || clean.length > 60) {
      setError("اكتب اسمك (من حرفين لـ 60 حرف) عشان نعرف نرجعلك وسط الطلبات 🌸");
      return;
    }
    sessionStorage.setItem("lalas_name", clean);
    setBusy(true);
    // ⚠️ السعر والرسوم بيتحسبوا تاني على السيرفر من أسعار قاعدة البيانات
    const { data, error: rpcError } = await supabase.rpc("submit_order", {
      p_branch_id: branchId,
      p_items: items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
      p_delivery_type: delivery,
      p_customer_name: clean,
      p_turnstile_token: token || null,
    });

    const res = data as
      | { ok: boolean; order_number: string; order_id: string; total: number; message?: string }
      | null;

    try {
      if (rpcError || !res || !res.ok) {
        setError(
          rpcError?.message || res?.message || "حصلت مشكلة في تسجيل الطلب — جرّب تاني بعد لحظات 🥲"
        );
        return;
      }
      sessionStorage.setItem("lalas_last_order", JSON.stringify(res));
      clear();
      navigate(`/pay/${res.order_number}`, { state: { name: clean } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-4 space-y-4">
      <h1 className="text-xl font-extrabold text-brand-700">طلبك تقريبًا جاهز 🎉</h1>
      <p className="text-sm font-bold text-brand-800">
        أول حاجة هتاخد <span className="text-brand-600">رقم الطلب</span> (زي LB-1001) — <span className="underline">قبل</span> أي دفع. بعدين تدفع على انستا باي بمبلغ بالظبط وبس.
      </p>

      <div className="card p-4 space-y-2">
        <h2 className="font-extrabold text-brand-900">اختر طريقة الاستلام</h2>
        {DELIVERY_OPTIONS.map((d) => (
          <label
            key={d.key}
            className={`block rounded-xl border p-3 cursor-pointer transition ${
              delivery === d.key ? "border-brand-400 bg-brand-50" : "border-brand-100 bg-white"
            }`}
          >
            <div className="flex items-center gap-2">
              <input
                type="radio"
                name="d"
                checked={delivery === d.key}
                onChange={() => setDelivery(d.key)}
                className="accent-brand-500"
              />
              <span className="font-bold text-brand-900">{d.label}</span>
            </div>
            <p className="mt-1 pr-6 text-xs text-brand-700">{d.desc}</p>
          </label>
        ))}
      </div>

      <div className="card p-4 space-y-2">
        <label htmlFor="cstm-name" className="label">
          اسمك (مطلوب — بيتكتب في تفاصيل التحويل)
        </label>
        <input
          id="cstm-name"
          className="input"
          placeholder="مثال: مروة أحمد"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
        />
      </div>

      <div className="card p-4 space-y-1 text-sm font-bold text-brand-900">
        <div className="flex justify-between">
          <span>فرع {branchName}</span>
          <span>{money(subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span>{option.label}</span>
          <span>{option.fee === 0 ? "مجانًا 🎉" : "+" + money(option.fee)}</span>
        </div>
        <div className="flex justify-between text-lg pt-1 border-t border-brand-100">
          <span>الإجمالي</span>
          <span className="text-brand-600">{money(subtotal + option.fee)}</span>
        </div>
      </div>

      <Turnstile onChange={setToken} />
      {error && <ErrorBox msg={error} />}

      <button className="btn-primary w-full text-lg py-3" disabled={busy} onClick={submit}>
        {busy ? "بيقفّل طلبك… ⏳" : "تأكيد الطلب ← رقم الطلب"}
      </button>

      <p className="text-center text-xs text-brand-700">
        عندك طلب من قبل؟ <Link to="/track" className="underline font-bold">تتبّعه هنا</Link>
      </p>
    </div>
  );
}
