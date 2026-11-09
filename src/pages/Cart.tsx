import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { money, DELIVERY_OPTIONS, type DeliveryKey } from "../lib/format";

export default function CartPage() {
  const { items, inc, dec, subtotal, branchId, branchName } = useCart();
  const [delivery, setDelivery] = useState<DeliveryKey>("pickup");
  const navigate = useNavigate();

  if (!branchId || items.length === 0) {
    return <div className="card p-3.5 text-brand-900">السلة فاضية 🛒 اختار حاجة حلوة من المنيو.</div>;
  }

  const option = DELIVERY_OPTIONS.find((d) => d.key === delivery)!;

  return (
    <div className="space-y-2.5">
      <h2 className="text-[22px] font-bold text-brand-700 mt-1.5 mb-0">سلتك – {branchName}</h2>

      {/* عناصر السلة زي النموذج */}
      <div className="card p-3.5 space-y-2.5">
        {items.map((i) => (
          <div key={i.product_id} className="flex items-center justify-between gap-2 text-brand-900">
            <span>
              {i.name} × {i.qty}
            </span>
            <span className="flex items-center gap-1.5">
              {money(i.price * i.qty)}
              <button className="btn-outline !px-3" onClick={() => dec(i.product_id)}>
                −
              </button>
              <button className="btn-pill !px-3" onClick={() => inc(i.product_id)}>
                +
              </button>
            </span>
          </div>
        ))}
      </div>

      {/* طريقة الاستلام: لصقات زي النموذج + وصفها */}
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

      {/* الإجمالي والتأكيد */}
      <div className="card p-3.5">
        <div className="flex items-center justify-between text-brand-900">
          <span>الإجمالي</span>
          <b className="text-[20px] text-brand-700">{money(subtotal + option.fee)}</b>
        </div>
        <p className="m-0 mt-3">
          <button
            className="btn-primary w-full"
            onClick={() => navigate("/checkout", { state: { delivery } })}
          >
            تأكيد الطلب والدفع
          </button>
        </p>
      </div>
    </div>
  );
}
