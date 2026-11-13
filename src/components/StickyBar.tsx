import type { ReactNode } from "react";
import { money } from "../lib/format";

/** شريط إجمالي ثابت فوق شريط التنقل السفلي — الإجمالي + زر التأكيد */
export default function StickyBar({
  total,
  label,
  icon,
  onClick,
  busy = false,
  busyLabel,
  disabled = false,
}: {
  total: number;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 bottom-[calc(64px+env(safe-area-inset-bottom,0px)+10px)]"
      role="region"
      aria-label="الإجمالي والتأكيد"
    >
      <div className="pointer-events-auto mx-auto flex max-w-[720px] items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-surface/95 py-2 pe-3 ps-4 shadow-[0_8px_30px_rgba(74,42,51,0.20)] backdrop-blur-md">
        <span className="leading-tight">
          <span className="block text-[11px] font-bold text-mut">الإجمالي</span>
          <b className="text-lg text-brand-800">{money(total)}</b>
        </span>
        <button type="button" className="btn-primary !min-h-[48px] shrink-0 !px-5" disabled={busy || disabled} onClick={onClick}>
          {busy ? busyLabel ?? "لحظة…" : label}
          {!busy && icon}
        </button>
      </div>
    </div>
  );
}
