import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { money, DELIVERY_OPTIONS, productEmoji, type DeliveryKey } from "../lib/format";
import CheckoutStepper from "../components/CheckoutStepper";
import StickyBar from "../components/StickyBar";
import { ShoppingBasket, Store, UtensilsCrossed, Bike, Minus, Plus, Trash2, Croissant } from "lucide-react";

const DELIVERY_ICON = {
  pickup: Store,
  table: UtensilsCrossed,
  obour: Bike,
} as const;

export default function CartPage() {
  const { items, inc, dec, remove, subtotal, branchId, branchName } = useCart();
  const [delivery, setDelivery] = useState<DeliveryKey>("pickup");
  const navigate = useNavigate();

  const menuLink = branchId ? `/branch/${branchId}` : "/";

  // ===== حالة السلة الفاضية =====
  if (!branchId || items.length === 0) {
    return (
      <div className="space-y-4 pt-6 text-center">
        <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-brand-100 dark:bg-white/5">
          <ShoppingBasket size={44} strokeWidth={1.6} className="text-brand-500 dark:text-[#ecc9d2]" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-[21px] font-extrabold text-brand-800 dark:text-[#ffe3ea]">سلتك فاضية</h1>
          <p className="mt-1 text-sm text-mut">اختار حاجة حلوة من المنيو ونجهزهالك على طول</p>
        </div>
        <Link to={menuLink} className="btn-primary min-h-[52px] !px-8 text-base">
          <Croissant size={20} aria-hidden="true" />
          شوف المنيو
        </Link>
      </div>
    );
  }

  const option = DELIVERY_OPTIONS.find((d) => d.key === delivery)!;
  const total = subtotal + option.fee;

  return (
    <div className="space-y-3.5 pb-24">
      <CheckoutStepper step={1} />

      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[20px] font-extrabold text-brand-800 dark:text-[#ffe3ea]">سلتك — {branchName}</h1>
        <span className="pill">{items.length} صنف</span>
      </div>

      {/* عناصر السلة */}
      <div className="card divide-y divide-brand-100 overflow-hidden dark:divide-white/5">
        {items.map((i) => (
          <div key={i.product_id} className="flex items-center gap-3 p-3">
            {i.image_url ? (
              <img
                src={i.image_url}
                alt={i.name}
                loading="lazy"
                decoding="async"
                width={64}
                height={64}
                className="h-16 w-16 shrink-0 rounded-2xl bg-brand-50 object-cover dark:bg-white/5"
              />
            ) : (
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-brand-100 text-[30px] dark:bg-white/5" aria-hidden="true">
                {productEmoji(i.name)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <b className="block truncate text-[14px] text-brand-900 dark:text-brand-100">{i.name}</b>
              <span className="text-[13px] font-bold text-brand-600 dark:text-[#ecc9d2]">{money(i.price * i.qty)}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-full border-[1.5px] border-brand-300 text-brand-800 outline-none transition hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500 active:scale-90 dark:border-white/20 dark:text-[#f3d3dc] dark:hover:bg-white/10"
                onClick={() => dec(i.product_id)}
                aria-label={`قلل ${i.name}`}
              >
                <Minus size={17} aria-hidden="true" />
              </button>
              <b className="w-7 text-center text-[15px]" aria-live="polite">
                {i.qty}
              </b>
              <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-full bg-brand-600 text-white outline-none transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 active:scale-90"
                onClick={() => inc(i.product_id)}
                aria-label={`زود ${i.name}`}
              >
                <Plus size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-full text-rose-700 outline-none transition hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-rose-400 active:scale-90 dark:text-rose-300 dark:hover:bg-rose-950/40"
                onClick={() => remove(i.product_id)}
                aria-label={`شيل ${i.name} من السلة`}
              >
                <Trash2 size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
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
                <input
                  type="radio"
                  name="delivery"
                  value={d.key}
                  checked={on}
                  onChange={() => setDelivery(d.key)}
                  className="sr-only"
                />
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

      {/* الإجمالي + زر التأكيد — ثابت فوق شريط التنقل */}
      <StickyBar
        total={total}
        label="تأكيد الطلب والدفع"
        icon={<Croissant size={18} aria-hidden="true" />}
        onClick={() => navigate("/checkout", { state: { delivery } })}
      />
    </div>
  );
}
