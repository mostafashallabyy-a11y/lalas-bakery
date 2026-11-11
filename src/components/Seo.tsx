import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trackPageView } from "../lib/analytics";

const SITE = "Lala's Bakery";
const BASE = "https://www.lalasbakery.app";
const DEFAULT_DESC = "مخبوزات وقهوة منزلية تُحضّر بكل حب من لالا. اطلب الآن من Lala's Bakery.";

type Meta = { title: string; description: string; index?: boolean; canonical?: string };

function getMeta(pathname: string): Meta {
  if (pathname === "/") return { title: `${SITE} | مخبوزات وقهوة منزلية`, description: DEFAULT_DESC, index: true, canonical: `${BASE}/` };
  if (/^\/branch\/[^/]+\/landing$/.test(pathname)) return { title: `منيو الفرع | ${SITE}`, description: "شاهد منيو الفرع واطلب مخبوزات وقهوة طازجة من Lala's Bakery.", index: true, canonical: `${BASE}${pathname}` };
  if (/^\/branch\/[^/]+$/.test(pathname)) return { title: `المنيو والطلب | ${SITE}`, description: "تصفح المنتجات وأضف لسلتك واطلب من Lala's Bakery.", index: true, canonical: `${BASE}${pathname}` };
  if (pathname === "/track") return { title: `تابع طلبك | ${SITE}`, description: "تابع حالة طلبك من Lala's Bakery بسهولة.", index: true, canonical: `${BASE}/track` };
  if (pathname === "/feedback") return { title: `رأيك يهمنا | ${SITE}`, description: "شاركنا رأيك واقتراحاتك لتحسين تجربة Lala's Bakery.", index: true, canonical: `${BASE}/feedback` };
  if (pathname === "/cart" || pathname === "/checkout" || pathname.startsWith("/pay/") || pathname.startsWith("/order/") || pathname.startsWith("/staff"))
    return { title: SITE, description: DEFAULT_DESC, index: false };
  return { title: SITE, description: DEFAULT_DESC, index: true, canonical: `${BASE}${pathname}` };
}

function setTag(selector: string, attr: string, value: string, createTag: string, createAttrs: Record<string, string>) {
  let el = document.head.querySelector(selector) as HTMLElement | null;
  if (!el) {
    el = document.createElement(createTag);
    Object.entries(createAttrs).forEach(([k, v]) => el!.setAttribute(k, v));
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

export default function Seo() {
  const { pathname } = useLocation();
  useEffect(() => {
    const meta = getMeta(pathname);
    document.title = meta.title;
    setTag('meta[name="description"]', "content", meta.description, "meta", { name: "description" });
    setTag('meta[name="robots"]', "content", meta.index ? "index,follow,max-image-preview:large" : "noindex,nofollow", "meta", { name: "robots" });
    const canonical = meta.canonical || `${BASE}${pathname}`;
    setTag('link[rel="canonical"]', "href", canonical, "link", { rel: "canonical" });
    setTag('meta[property="og:title"]', "content", meta.title, "meta", { property: "og:title" });
    setTag('meta[property="og:description"]', "content", meta.description, "meta", { property: "og:description" });
    setTag('meta[property="og:url"]', "content", canonical, "meta", { property: "og:url" });
    trackPageView(pathname);
  }, [pathname]);
  return null;
}
