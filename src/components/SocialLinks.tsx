import { useEffect, useMemo, useState } from "react";
import type { SocialLink } from "../lib/types";
import { supabase, withTimeout } from "../lib/types";
import { PLATFORMS, socialAriaLabel, type PlatformKey } from "./icons";
import { MapPin } from "lucide-react";

// ============================================================
// Social media links — shared customer-facing components
// Official brand glyphs + colors, 48px+ touch targets, Arabic labels.
// ============================================================

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

// ---- fetch hook with a tiny in-memory cache (avoids duplicate queries on the same page) ----
const linksCache = new Map<string, { at: number; data: SocialLink[] }>();
const CACHE_TTL = 60_000;

export function useSocialLinks(scope: string) {
  const [links, setLinks] = useState<SocialLink[]>(() => linksCache.get(scope)?.data ?? []);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(() => !linksCache.has(scope));

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    const cached = linksCache.get(scope);
    if (cached && Date.now() - cached.at < CACHE_TTL) {
      setLinks(cached.data);
      setLoading(false);
      return;
    }
    setLoading(true);
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
        setLoading(false);
        return;
      }
      if (res.error) {
        setError(res.error.message);
        setLoading(false);
        return;
      }
      const data = (res.data as SocialLink[]) ?? [];
      linksCache.set(scope, { at: Date.now(), data });
      setLinks(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  return { links, error, loading };
}

// Never render javascript:/data: links — if it isn't a clean https URL, don't render.
export function safeSocialHref(link: SocialLink): string {
  const safe =
    link.platform === "whatsapp" ? buildWhatsAppUrl(link.url) : isValidHttpsUrl(link.url) ? link.url : "";
  return /^https:\/\//i.test(safe) ? safe : "";
}

// ============================================================
// 1) Large labeled icon button (footer / hero / "تابعنا")
// ============================================================
interface SocialIconButtonProps {
  link: SocialLink;
  size?: "sm" | "md" | "lg";
  /** show the Arabic label under the icon (default true) */
  labeled?: boolean;
}

export function SocialIconButton({ link, size = "md", labeled = true }: SocialIconButtonProps) {
  const safe = safeSocialHref(link);
  if (!safe) return null;

  const platform = link.platform as PlatformKey;
  const cfg = PLATFORMS[platform] ?? PLATFORMS.website;
  const label = (link.label && link.label.trim()) || cfg.label;
  const ariaLabel = socialAriaLabel(platform, link.label);

  const chip =
    size === "lg" ? "w-14 h-14 [&_svg]:w-7 [&_svg]:h-7" : size === "sm" ? "w-11 h-11 [&_svg]:w-5 [&_svg]:h-5" : "w-12 h-12 [&_svg]:w-6 [&_svg]:h-6";

  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      title={ariaLabel}
      className="group flex min-w-[48px] min-h-[48px] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-1.5 outline-none transition-transform duration-150 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 active:scale-90 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <span
        aria-hidden="true"
        className={`grid place-items-center rounded-full text-white shadow-[0_2px_8px_rgba(74,42,51,0.28)] ring-2 ring-white/60 transition-shadow duration-150 group-hover:shadow-[0_4px_14px_rgba(74,42,51,0.35)] ${chip}`}
        style={{ background: cfg.bg, color: cfg.fg }}
      >
        <cfg.Icon aria-hidden="true" />
      </span>
      {labeled && (
        <span className="text-[11px] font-bold leading-tight text-brand-800 dark:text-brand-100">{label}</span>
      )}
    </a>
  );
}

// Backwards-compatible alias (قديمة) — same as SocialIconButton
export { SocialIconButton as SocialLinkButton };

interface SocialLinksRowProps {
  scope: string; // 'brand' or a branch_id
  size?: "sm" | "md" | "lg";
  labeled?: boolean;
  className?: string;
  ariaLabel?: string;
}

// Fetches the ACTIVE links for a scope (public RLS allows select on active rows only).
// Hides any platform with no active link. Error/empty renders nothing customer-facing.
export function SocialLinksRow({ scope, size = "md", labeled = true, className, ariaLabel }: SocialLinksRowProps) {
  const { links } = useSocialLinks(scope);

  const visible = useMemo(() => links.filter((l) => safeSocialHref(l)), [links]);
  if (visible.length === 0) return <div className={className} />;

  return (
    <div
      className={`flex flex-wrap items-start justify-center gap-3 ${className ?? ""}`}
      role="navigation"
      aria-label={ariaLabel ?? "روابط التواصل"}
    >
      {visible.map((link) => (
        <SocialIconButton key={link.id} link={link} size={size} labeled={labeled} />
      ))}
    </div>
  );
}

// ============================================================
// "تابعنا" block — يعرض العنوان فقط لو في روابط فعلًا
// ============================================================
export function SocialLinksFollow({ scope = "brand", size = "md", label = "تابعنا", className }: { scope?: string; size?: "sm" | "md" | "lg"; label?: string; className?: string }) {
  const { links } = useSocialLinks(scope);
  const visible = links.filter((l) => safeSocialHref(l));
  if (visible.length === 0) return null;
  return (
    <div className={className}>
      <p className="mb-2 text-[11px] font-extrabold tracking-wide text-brand-700/85 dark:text-[#ecc9d2]/85">{label}</p>
      <SocialLinksRow scope={scope} size={size} ariaLabel="روابط لالا بيكري على وسائل التواصل" />
    </div>
  );
}

// ============================================================
// 2) Labeled pill buttons — branch cards / branch pages
// ============================================================
const PILL_PLATFORMS: PlatformKey[] = ["google_maps", "whatsapp", "instagram"];
const PILL_LABEL: Partial<Record<PlatformKey, string>> = {
  google_maps: "الموقع",
  whatsapp: "واتساب",
  instagram: "إنستجرام",
};

export function BranchPillLinks({ branchId, className }: { branchId: string; className?: string }) {
  const { links } = useSocialLinks(branchId);
  const pills = useMemo(
    () =>
      PILL_PLATFORMS.map((p) => links.find((l) => l.platform === p))
        .filter((l): l is SocialLink => Boolean(l))
        .map((l) => ({ link: l, href: safeSocialHref(l) }))
        .filter(({ href }) => Boolean(href)),
    [links]
  );

  if (pills.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      {pills.map(({ link, href }) => {
        const cfg = PLATFORMS[link.platform as PlatformKey];
        const pillLabel = PILL_LABEL[link.platform as PlatformKey] ?? cfg.label;
        return (
          <a
            key={link.id}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={socialAriaLabel(link.platform as PlatformKey, link.label) + " — في نافذة جديدة"}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-brand-200 bg-white px-3.5 py-2 text-sm font-bold text-brand-800 shadow-sm outline-none transition duration-150 hover:bg-brand-50 hover:shadow focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 active:scale-95 motion-reduce:transition-none dark:border-white/10 dark:bg-white/5 dark:text-brand-100 dark:hover:bg-white/10"
          >
            <span
              aria-hidden="true"
              className="grid h-6 w-6 place-items-center rounded-full"
              style={{ background: cfg.bg, color: cfg.fg }}
            >
              <cfg.Icon size={13} />
            </span>
            {pillLabel}
          </a>
        );
      })}
    </div>
  );
}

// ============================================================
// 3) Prominent full-width "افتح الموقع على الخريطة" button
// ============================================================
export function OpenMapButton({ branchId, className }: { branchId: string; className?: string }) {
  const { links, loading } = useSocialLinks(branchId);
  const mapLink = links.find((l) => l.platform === "google_maps");
  const href = mapLink ? safeSocialHref(mapLink) : "";

  if (loading) {
    return <div className={`h-12 w-full animate-pulse rounded-2xl bg-brand-100 ${className ?? ""}`} aria-hidden="true" />;
  }
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="افتح الموقع على الخريطة — يفتح في نافذة جديدة"
      className={`btn-primary min-h-[52px] w-full text-base ${className ?? ""}`}
    >
      <MapPin size={20} strokeWidth={2.2} aria-hidden="true" />
      افتح الموقع على الخريطة
    </a>
  );
}
