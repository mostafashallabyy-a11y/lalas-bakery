declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

const GA_ID = (import.meta.env.VITE_GA_MEASUREMENT_ID || "").trim();
const META_PIXEL_ID = (import.meta.env.VITE_META_PIXEL_ID || "").trim();

let inited = false;

function loadScript(src: string, id: string) {
  if (document.getElementById(id)) return;
  const s = document.createElement("script");
  s.async = true;
  s.src = src;
  s.id = id;
  document.head.appendChild(s);
}

export function initAnalytics() {
  if (inited || typeof window === "undefined") return;
  inited = true;

  if (GA_ID) {
    loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`, "ga4-script");
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag(...args: unknown[]) {
      window.dataLayer!.push(args);
    };
    window.gtag("js", new Date());
    window.gtag("config", GA_ID, { send_page_view: false });
  }

  if (META_PIXEL_ID) {
    if (!window.fbq) {
      const fbq: any = function (...args: unknown[]) {
        if (fbq.callMethod) fbq.callMethod(...args);
        else fbq.queue.push(args);
      };
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = "2.0";
      fbq.queue = [];
      window.fbq = fbq;
    }
    loadScript("https://connect.facebook.net/en_US/fbevents.js", "meta-pixel-script");
    window.fbq!("init", META_PIXEL_ID);
  }
}

export function trackPageView(path?: string) {
  const page_path = path || window.location.pathname + window.location.search;
  if (GA_ID && window.gtag) window.gtag("event", "page_view", { page_path });
  if (META_PIXEL_ID && window.fbq) window.fbq("track", "PageView");
}

export function trackEvent(name: string, params: Record<string, unknown> = {}) {
  if (GA_ID && window.gtag) window.gtag("event", name, params);
  // Map common ecommerce events to Meta standard events
  if (META_PIXEL_ID && window.fbq) {
    const map: Record<string, string> = {
      view_item: "ViewContent",
      add_to_cart: "AddToCart",
      begin_checkout: "InitiateCheckout",
      purchase: "Purchase",
    };
    const fb = map[name] || "CustomEvent";
    if (map[name]) window.fbq("track", fb, params);
    else window.fbq("trackCustom", name, params);
  }
}
