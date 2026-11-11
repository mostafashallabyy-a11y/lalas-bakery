import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { supabase, withTimeout } from "../lib/types";
import { useCart } from "../context/CartContext";
import { money, DELIVERY_OPTIONS, type DeliveryKey } from "../lib/format";
import { ErrorBox, EmptyBox } from "../components/Common";
import { Turnstile } from "../components/Turnstile";
import { storageGet, storageSet, storageGetJSON, storageSetJSON } from "../lib/storage";

export default function Checkout() {
  const { state } = useLocation() as { state?: { delivery?: DeliveryKey } };
  const { items, subtotal, branchId, branchName, clear } = useCart();
  const [delivery, setDelivery] = useState<DeliveryKey>(state?.delivery ?? "pickup");
  const [name, setName] = useState(() => storageGet("session", "lalas_name") || "");
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
    storageSet("session", "lalas_name", clean);
    setBusy(true);
    // ⚠️ السعر والرسوم Betحسابوا تاني على السيرفر من أسعار قاعدة البيانات
    const res = await withTimeout<{
      ok: boolean;
      order_number: string;
      order_id: string;
      tracking_key: string;
      total: number;
    }>(supabase.rpc("submit_order_v2", {
      p_branch_id: branchId,
      p_items: items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
      p_delivery_type: delivery,
      p_customer_name: clean,
      p_turnstile_token: token || null,
    }), 15000);

    if (!res) {
      setError("المسار اتأخر — المحاولة تاني بعد لحظات 🥲");
      setBusy(false);
      return;
    }

    if (!res.data) {
      setError("حصلت مشكلة في تسجيل الطلب — جرّب تاني بعد لحظات 🥲");
      setBusy(false);
      return;
    }

    const okShape = res.data?.ok && res.data?.order_number && res.data?.tracking_key;
    if (okShape) {
      // Save order to localStorage "my_orders" so it survives cart clear (safe reads/writes)
      const myOrdersStr = storageGetJSON<Array<{ order_number?: string; tracking_key?: string }>>("local", "my_orders", []);
      const orderEntry = {
        order_number: res.data!.order_number,
        tracking_key: res.data!.tracking_key,
        branch_id: branchId,
        branch_name: branchName,
        total: res.data!.total,
        date: new Date().toISOString(),
      };
      // Don't duplicate same order number
      const already = myOrdersStr.find((o) => o.order_number === res.data!.order_number);
      if (!already) {
        myOrdersStr.unshift(orderEntry);
        storageSetJSON("local", "my_orders", myOrdersStr);
      }

      // Save last order for the payment page + error boundary fallback (both storage areas)
      storageSetJSON("session", "lalas_last_order", res.data);
      storageSetJSON("local", "lalas_last_order", res.data);

      clear();
      navigate(`/order/${res.data!.order_number}?k=${res.data!.tracking_key}`, {
        state: { name: clean },
      });
    } else {
      setError("حصلت مشكلة في تسجيل الطلب — جرّب تاني بعد لحظات 🥲");
    }
    setBusy(false);
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
