import { useState, type ReactNode } from "react";

export function Spinner({ label = "لحظة… ⏳" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10">
      <div className="w-9 h-9 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
      <p className="text-sm text-mut font-bold">{label}</p>
    </div>
  );
}

export function OfflineBanner() {
  if (typeof navigator !== "undefined" && navigator.onLine) return null;
  return (
    <div className="bg-brand-100 text-brand-700 text-center text-sm font-bold py-2 px-4 rounded-[14px] mb-2.5">
      📵 مفيش نت دلوقتي — افتح القهوة واستنى النت يرجع جرب تاني.
    </div>
  );
}

export function ErrorBox({ msg, children }: { msg?: string; children?: ReactNode }) {
  return (
    <div className="msg-box text-sm mt-2.5">{msg || children}</div>
  );
}

export function EmptyBox({ msg }: { msg: string }) {
  return (
    <div className="card p-6 text-center text-mut font-bold">{msg}</div>
  );
}

export function CopyButton({ text, label = "نسخ" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className={`!px-3 !py-1 ${ok ? "btn-dark" : "btn-outline"}`}
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
      {ok ? "✔ تم النسخ" : label}
    </button>
  );
}
