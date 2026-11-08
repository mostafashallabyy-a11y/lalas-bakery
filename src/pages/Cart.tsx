import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { money, DELIVERY_OPTIONS, type DeliveryKey } from "../lib/format";
import { EmptyBox } from "../components/Common";
import { useState } from "react";

export default function CartPage() {
  const { items, inc, dec, remove, subtotal, branchId, branchName, clear } = useCart();
  const [delivery, setDelivery] = useState<DeliveryKey>("pickup");
  const navigate = useNavigate();

  if (!branchId || items.length === 0) {
    return <EmptyBox msg="عربتك فاضية 🥲 — اختار من منيو الفرع الأول" />;
  }

  const fee = DELIVERY_OPTIONS.find((d) => d.key === delivery)?.fee ?? 0;

  return (
    <div className="py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-brand-700">عربة فرع {branchName}</h1>
        <button
          onClick={() => {
            clear();
            navigate("/");
          }}
          className="text-xs font-bold text-brand-800 underline"
        >
          تغيير الفرع (بتمسح العربة)
        </button>
      </div>

      <div className="card divide-y divide-brand-100">
        {items.map((i) => (
          <div key={i.product_id} className="p-3 flex gap-3 items-center">
            {i.image_url && <img src={i.image_url} alt="" className="w-14 h-14 rounded-xl object-cover" />}
            <div className="flex-1 min-w-0">
              <p className="font-extrabold text-brand-900">{i.name}</p>
              <p className="text-xs text-brand-700">{money(i.price)} × {i.qty} = {money(i.price * i.qty)}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => inc(i.product_id)} className="w-8 h-8 rounded-lg bg-brand-100 font-extrabold text-brand-700">+</button>
              <span className="w-6 text-center font-extrabold">{i.qty}</span>
              <button onClick={() => dec(i.product_id)} className="w-8 h-8 rounded-lg bg-brand-100 font-extrabold text-brand-700">−</button>
              <button onClick={() => remove(i.product_id)} className="w-8 h-8 rounded-lg text-rose-500 font-extrabold" title="شيل من العربة">🗑</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-4 space-y-2">
        <h2 className="font-extrabold text-brand-800">عايز تاخده إزاي؟</h2>
        {DELIVERY_OPTIONS.map((d) => (
          <label
            key={d.key}
            className={`block rounded-xl border p-3 cursor-pointer transition ${delivery === d.key ? "border-brand-400 bg-brand-50" : "border-brand-100 bg-white"}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="delivery"
                  checked={delivery === d.key}
                  onChange={() => setDelivery(d.key)}
                  className="accent-brand-500"
                />
                <span className="font-bold text-brand-900">{d.label}</span>
              </div>
            </div>
            <p className="mt-1 pr-6 text-xs text-brand-700">{d.desc}</p>
          </label>
        ))}
      </div>

      <div className="card p-4 space-y-1 text-sm font-bold text-brand-900">
        <div className="flex justify-between"><span>المشروبات والمنتجات</span><span>{money(subtotal)}</span></div>
        <div className="flex justify-between"><span>التوصيل/الاستلام</span><span>{fee === 0 ? "مجانًا 🎉" : "+" + money(fee)}</span></div>
        <div className="flex justify-between text-lg pt-1 border-t border-brand-100"><span>الإجمالي</span><span className="text-brand-600">{money(subtotal + fee)}</span></div>
      </div>

      <button
        className="btn-primary w-full text-lg py-3"
        onClick={() => navigate("/checkout", { state: { delivery } })}
      >
        أكمل الطلب → رقم الطلب قبل الدفع
      </button>

      <p className="text-center text-xs text-brand-700">* العدد والإجمالي بيتحدثوا لحظيًا، والدفع بعد ما نأكد الطلب.</p>
    </div>
  );
}
