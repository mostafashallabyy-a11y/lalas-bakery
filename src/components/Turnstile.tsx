import { useEffect, useRef, useState } from "react";
import { TURNSTILE_SITE_KEY } from "../lib/types";

// Cloudflare Turnstile: invisible ريندير
// لو مفيش site key (بيئة تطوير) بنرجع null عشان السيرفر بيسمح من غير تحقق لحد ما تتظبط
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
    onTurnstileReady?: () => void;
  }
}

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const exists = document.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com"]');
    if (exists) {
      exists.addEventListener("load", () => resolve());
      exists.addEventListener("error", () => reject(new Error("turnstile load error")));
      return;
    }
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile load error"));
    document.head.appendChild(s);
  });
}

export function Turnstile({ onChange }: { onChange: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !ref.current) return;
    let widgetId: string | undefined;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        widgetId = window.turnstile.render(ref.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: "light",
          language: "ar",
          callback: onChange,
          "expired-callback": () => onChange(""),
        });
        setReady(true);
      })
      .catch(() => setReady(false));

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [TURNSTILE_SITE_KEY]);

  if (!TURNSTILE_SITE_KEY) return null;

  return (
    <div className="flex justify-center my-2" dir="ltr">
      {/* الحاوية اللي التيرنستيل بيرندر فيها */}
      <div ref={ref} />
      {!ready && (
        <p className="text-xs text-brand-700">بنجهز الحماية… ثواني ⏳</p>
      )}
    </div>
  );
}
