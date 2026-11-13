import { useState } from "react";
import { Link2, Check } from "lucide-react";

export function SiteShareButton({ className = "", label = "نسخ رابط الموقع", compact = false }: { className?: string; label?: string; compact?: boolean }) {
  const [ok, setOk] = useState(false);
  const copy = async () => {
    const url = window.location.origin || "https://lalasbakery.app";
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = url; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, url.length);
        document.execCommand("copy"); document.body.removeChild(ta);
      } catch { return; }
    }
    setOk(true);
    setTimeout(() => setOk(false), 2500);
  };
  return (
    <button type="button" onClick={copy} className={className} aria-live="polite">
      {ok ? <Check size={compact ? 16 : 18} aria-hidden="true" /> : <Link2 size={compact ? 16 : 18} aria-hidden="true" />}
      <span>{ok ? "تم بنجاح" : label}</span>
    </button>
  );
}
