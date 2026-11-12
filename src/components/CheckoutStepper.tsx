import { ShoppingCart, PencilLine, CreditCard, PartyPopper, Check } from "lucide-react";

const STEPS = [
  { label: "السلة", Icon: ShoppingCart },
  { label: "البيانات", Icon: PencilLine },
  { label: "الدفع", Icon: CreditCard },
  { label: "تم", Icon: PartyPopper },
] as const;

/** مؤشر خطوات إتمام الطلب — السلة ← البيانات ← الدفع ← تم */
export default function CheckoutStepper({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <ol className="flex items-center gap-1 py-1" aria-label="خطوات إتمام الطلب">
      {STEPS.map(({ label, Icon }, i) => {
        const n = (i + 1) as 1 | 2 | 3 | 4;
        const done = n < step;
        const current = n === step;
        return (
          <li key={label} className="flex flex-1 items-center gap-1 last:flex-none" aria-current={current ? "step" : undefined}>
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-[11px] font-extrabold transition-all duration-300 ${
                done
                  ? "border-brand-600 bg-brand-600 text-white"
                  : current
                  ? "scale-110 border-brand-700 bg-brand-700 text-white shadow-[0_3px_10px_rgba(125,63,80,0.4)]"
                  : "border-brand-200 bg-white text-mut dark:border-white/15 dark:bg-white/5"
              }`}
            >
              {done ? <Check size={15} strokeWidth={3} aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />}
            </span>
            <span
              className={`text-[11px] font-bold leading-tight ${
                current ? "text-brand-800 dark:text-[#ffe3ea]" : done ? "text-brand-600 dark:text-[#ecc9d2]" : "text-mut"
              }`}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <span aria-hidden="true" className={`mx-0.5 h-[2px] min-w-2 flex-1 rounded-full ${n < step ? "bg-brand-600" : "bg-brand-200 dark:bg-white/15"}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
