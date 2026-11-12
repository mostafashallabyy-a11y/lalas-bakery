import { useState, type ReactNode } from "react";

/** الشعار بخلفيته الشفافة — webp مع fallback للـ png */
export function Logo({ className, alt = "Lala's Bakery" }: { className?: string; alt?: string }) {
  return (
    <picture>
      <source srcSet="/lalas-logo.webp" type="image/webp" />
      <img
        src="/lalas-logo.png"
        alt={alt}
        width={631}
        height={480}
        decoding="async"
        className={className}
      />
    </picture>
  );
}

export function Spinner({ label = "لحظة…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10" role="status" aria-label={label}>
      <div className="h-9 w-9 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600 motion-reduce:animate-none" />
      <p className="text-sm font-bold text-mut">{label}</p>
    </div>
  );
}

/** عظمة تحميل (skeleton) — للشبكات والكروت */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className ?? ""}`} />;
}

export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-2.5" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-3">
          <div className="skeleton mb-2 h-[110px] w-full" />
          <div className="skeleton mb-1.5 h-4 w-3/4" />
          <div className="skeleton mb-2 h-4 w-1/3" />
          <div className="skeleton mx-auto h-9 w-24 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function BranchListSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card overflow-hidden">
          <div className="skeleton h-40 w-full !rounded-none" />
          <div className="p-4">
            <div className="skeleton mb-2 h-6 w-1/2" />
            <div className="skeleton mb-2 h-4 w-full" />
            <div className="skeleton mb-3 h-4 w-2/3" />
            <div className="skeleton h-11 w-full rounded-full" />
          </div>
        </div>
      ))}
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
