import { useState, type ReactNode } from "react";

export function Spinner({ label = "لحظة… ⏳" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10">
      <div className="w-9 h-9 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
      <p className="text-sm text-brand-800 font-bold">{label}</p>
    </div>
  );
}

export function OfflineBanner() {
  if (typeof navigator !== "undefined" && navigator.onLine) return null;
  return (
    <div className="bg-amber-100 text-amber-900 text-center text-sm font-bold py-2 px-4 rounded-xl m-3">
      📵 مفيش نت دلوقتي — افتح القهوة واستنى النت يرجع جرب تاني.
    </div>
  );
}

export function ErrorBox({ msg, children }: { msg?: string; children?: ReactNode }) {
  return (
    <div className="bg-rose-50 text-rose-800 border border-rose-200 rounded-xl px-4 py-3 text-sm font-bold">
      {msg || children}
    </div>
  );
}

export function EmptyBox({ msg }: { msg: string }) {
  return (
    <div className="bg-white border border-brand-100 rounded-2xl px-4 py-10 text-center text-brand-800 font-bold">
      {msg}
    </div>
  );
}

export function CopyButton({ text, label = "نسخ" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="btn-soft !py-1.5 !px-3 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
    >
      {ok ? "✅ اتنسخ" : `📋 ${label}`}
    </button>
  );
}
