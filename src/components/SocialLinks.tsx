import { useEffect, useState } from "react";
import type { SocialLink } from "../lib/types";
import { supabase, withTimeout } from "../lib/types";

// ============================================================
// Social media links — shared customer-facing component
// ============================================================

// Every platform maps to a single emoji icon so we never load external icon scripts.
const PLATFORM_ICON: Record<SocialLink["platform"], string> = {
  instagram: "📷",
  facebook: "📘",
  tiktok: "🎵",
  whatsapp: "💬",
  youtube: "▶️",
  x: "X",
  snapchat: "👻",
  telegram: "📩",
  google_maps: "🗺️",
  website: "🔗",
};

const PLATFORM_LABEL: Record<SocialLink["platform"], string> = {
  instagram: "إنستغرام",
  facebook: "فيسبوك",
  tiktok: "تيك توك",
  whatsapp: "واتساب",
  youtube: "يوتيوب",
  x: "إكس (تويتر)",
  snapchat: "سnapchat",
  telegram: "تليجرام",
  google_maps: "خريطة جوجل",
  website: "الموقع الإلكتروني",
};

// ---- client-side link safety helpers ----

// WhatsApp: manager enters a phone number; we build https://wa.me/<digits>.
// Keeps the stored url an https URL (passes the DB check constraint) and never
// renders javascript:/data: links.
export function buildWhatsAppUrl(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits}`;
}

export function isValidHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" && Boolean(u.hostname);
  } catch {
    return false;
  }
}

// Normalize a whatsapp phone input into a stored https url; other platforms stay as typed.
export function normalizeSocialUrl(platform: SocialLink["platform"], value: string): string {
  const v = value.trim();
  if (platform === "whatsapp") return buildWhatsAppUrl(v);
  return v;
}

interface SocialLinkButtonProps {
  link: SocialLink;
  size?: "sm" | "md" | "lg";
}

export function SocialLinkButton({ link, size = "md" }: SocialLinkButtonProps) {
  const url = link.platform === "whatsapp" ? buildWhatsAppUrl(link.url) : link.url;
  const safe =
    link.platform === "whatsapp"
      ? buildWhatsAppUrl(link.url)
      : isValidHttpsUrl(link.url)
        ? link.url
        : "";

  // Never render javascript:/data: links — if it isn't a clean https URL, don't render.
  if (!safe || !/^https:\/\//i.test(safe)) return null;

  const label = link.label || PLATFORM_LABEL[link.platform];
  const icon = PLATFORM_ICON[link.platform];
  const sizeCls =
    size === "sm" ? "w-8 h-8 text-xs" : size === "lg" ? "w-12 h-12 text-xl" : "w-10 h-10 text-sm";

  const ariaLabel = label ? `زيارة ${label}` : `زيارة ${PLATFORM_LABEL[link.platform]}`;

  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center justify-center rounded-full border border-brand-200 bg-white ${sizeCls} font-bold text-brand-700 shadow-sm hover:bg-brand-50 transition`}
      title={ariaLabel}
      aria-label={ariaLabel}
    >
      {icon}
    </a>
  );
}

interface SocialLinksRowProps {
  scope: string; // 'brand' or a branch_id
  size?: "sm" | "md" | "lg";
  className?: string;
}

// Fetches the ACTIVE links for a scope (public RLS allows select on active rows only).
// Hides any platform with no active link.
export function SocialLinksRow({ scope, size = "md", className }: SocialLinksRowProps) {
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    (async () => {
      const res = await withTimeout(
        supabase
          .from("social_links")
          .select("*")
          .eq("scope", scope)
          .eq("is_active", true)
          .order("sort_order", { ascending: true }),
        10000
      );
      if (cancelled) return;
      if (!res) {
        setError("فشل تحميل روابط التواصل — تأكد من اتصالك بالإنترنت");
        return;
      }
      if (res.error) {
        setError(res.error.message);
        return;
      }
      setLinks((res.data as SocialLink[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  if (error) return <div className={className} />;
  if (links.length === 0) return <div className={className} />;

  return (
    <div className={`flex flex-wrap justify-center gap-2 ${className ?? ""}`} role="navigation" aria-label="روابط التواصل">
      {links.map((link) => (
        <SocialLinkButton key={link.id} link={link} size={size} />
      ))}
    </div>
  );
}
