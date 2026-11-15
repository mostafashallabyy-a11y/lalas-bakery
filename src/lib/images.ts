// أدوات صور المنتجات: نسخ محلية WebP (400/800) + fallback للروابط القديمة
//
// صور المنتجات القديمة مرفوعة JPEG كبيرة (150–320 كيلو). فيه سكربت بيولّد منها
// نسختين WebP صغيرتين في public/img/p/ ويسجّلهم في image-map.json، فبنجيب
// النسخة المحلية (كاش طويل على Cloudflare) بدل الأصل الثقيل.
// أي صورة جديدة بتترفع من لوحة الإدارة بتطلع أصل + <id>-400.webp + <id>-800.webp،
// ودي بتشتغل بالـ srcset العادي من غير ما تحتاج خريطة.

import imageMap from "./image-map.json";

const MAP = imageMap as Record<string, string>;
const BUCKET = /\/storage\/v1\/object\/public\/product-images\/(.+)$/;
const SIZED = /^(.*)-800\.(webp|jpe?g|png)$/i;

export type ImageSources = { src: string; srcSet?: string };

/** يرجّع src + srcSet لو عندنا نسخ مقاسات، وإلا الرابط زي ما هو */
export function imageSources(url?: string | null): ImageSources {
  const src = (url || "").trim();
  if (!src) return { src: "" };

  // 1) صورة قديمة عندها نسخة محلية محسّنة
  const m = src.match(BUCKET);
  if (m) {
    let p = m[1];
    try {
      p = decodeURIComponent(p);
    } catch {
      /* سيبه زي ما هو */
    }
    const hash = MAP[p];
    if (hash) {
      return {
        src: `/img/p/${hash}-800.webp`,
        srcSet: `/img/p/${hash}-400.webp 400w, /img/p/${hash}-800.webp 800w`,
      };
    }
  }

  // 1ب) صورة خارجية (Unsplash) اتعملها نسخة محلية بنفس الطريقة — المفتاح = الرابط الكامل
  const extHash = MAP[src];
  if (extHash) {
    return {
      src: `/img/p/${extHash}-800.webp`,
      srcSet: `/img/p/${extHash}-400.webp 400w, /img/p/${extHash}-800.webp 800w`,
    };
  }

  // 2) صورة مرفوعة بالنظام الجديد: -800.webp وأختها -400.webp في نفس المسار
  const s = src.match(SIZED);
  if (s) return { src, srcSet: `${s[1]}-400.${s[2]} 400w, ${src} 800w` };

  return { src };
}

/** رابط 400px لو متاح (للاستخدام في السلة/الإيصالات الصغيرة) */
export function smallImage(url?: string | null): string {
  const { src, srcSet } = imageSources(url);
  const first = srcSet?.split(",")[0]?.trim().split(" ")[0];
  return first || src;
}
