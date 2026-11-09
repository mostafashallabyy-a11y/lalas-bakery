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
    return <EmptyBox msg="السلة فاضية 🛒 اختار حاجة حلوة من المنيو." />;
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
    <div className="space-y-2.5">
      <h2 className="text-[22px] font-bold text-brand-700 mt-1.5 mb-0">تأكيد طلبك 💗</h2>
      <div className="text-mut text-sm">
        هتاخد رقم طلبك الأول (زي LB-1001) — وبعدين الدفع على انستا باي بالمبلغ بالظبط.
      </div>

      {/* طريقة الاستلام: نفس لصقات السلة */}
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

      {/* اسم صاحب الطلب */}
      <div className="card p-3.5">
        <label htmlFor="cstm-name" className="label">
          اسم صاحب الطلب
        </label>
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

      {/* الإجمالي زي النموذج */}
      <div className="card p-3.5 text-sm text-brand-900">
        <div className="flex justify-between">
          <span>فرع {branchName}</span>
          <span>{money(subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span>{option.label}</span>
          <span>{option.fee === 0 ? "مجانًا 🎉" : "+" + money(option.fee)}</span>
        </div>
        <div className="flex items-center justify-between pt-1 mt-1 border-t border-brand-200">
          <span className="text-base">الإجمالي</span>
          <b className="text-[20px] text-brand-700">{money(subtotal + option.fee)}</b>
        </div>
      </div>

      <Turnstile onChange={setToken} />
      {error && <ErrorBox msg={error} />}

      <p className="m-0">
        <button className="btn-primary w-full text-base" disabled={busy} onClick={submit}>
          {busy ? "بيقفّل طلبك… ⏳" : "تأكيد الطلب والدفع"}
        </button>
      </p>

      <p className="text-center text-xs text-mut m-0">
        عندك طلب من قبل؟{" "}
        <Link to="/track" className="underline font-bold">
          تابعه هنا
        </Link>
      </p>
    </div>
  );
}
