import { useEffect, useState } from "react";
import { CircleCheck } from "lucide-react";
import { subscribeToasts } from "../lib/toast";

type ToastItem = { id: number; message: string };

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(150px+env(safe-area-inset-bottom,0px))] z-50 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="toast-in flex max-w-[92vw] items-center gap-2 rounded-full bg-brand-800 px-4 py-2.5 text-sm font-bold text-brand-50 shadow-lg dark:bg-brand-100 dark:text-brand-900"
        >
          <CircleCheck size={17} aria-hidden="true" className="shrink-0 text-[#ffd9e4] dark:text-brand-700" />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
