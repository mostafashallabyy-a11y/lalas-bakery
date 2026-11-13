// ============================================================
// Official brand glyphs + colors for social platforms,
// plus the shared aria-label helpers. No CDN — everything inline SVG.
// ============================================================
import type { ComponentType, SVGProps } from "react";
import {
  FaInstagram,
  FaFacebookF,
  FaTiktok,
  FaWhatsapp,
  FaYoutube,
  FaSnapchatGhost,
  FaTelegramPlane,
} from "react-icons/fa";
import { FaXTwitter } from "react-icons/fa6";
import { MapPin, Globe, Phone } from "lucide-react";

export type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

export type PlatformKey =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "whatsapp"
  | "youtube"
  | "x"
  | "snapchat"
  | "telegram"
  | "google_maps"
  | "website";

export type PlatformStyle = {
  /** human-readable Arabic label (used as visible label + aria-label base) */
  label: string;
  /** background of the icon chip — official brand color or gradient */
  bg: string;
  /** glyph color */
  fg: string;
  /** focus ring color (visible on light bg) */
  ring: string;
  Icon: IconComponent;
};

const fa = (C: ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>) =>
  C as unknown as IconComponent;

export const PLATFORMS: Record<PlatformKey, PlatformStyle> = {
  instagram: {
    label: "إنستجرام",
    bg: "linear-gradient(45deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%)",
    fg: "#ffffff",
    ring: "#dc2743",
    Icon: fa(FaInstagram),
  },
  facebook: {
    label: "فيسبوك",
    bg: "#1877F2",
    fg: "#ffffff",
    ring: "#1877F2",
    Icon: fa(FaFacebookF),
  },
  tiktok: {
    label: "تيك توك",
    bg: "#010101",
    fg: "#ffffff",
    ring: "#010101",
    Icon: fa(FaTiktok),
  },
  whatsapp: {
    label: "واتساب",
    bg: "#25D366",
    fg: "#ffffff",
    ring: "#1da851",
    Icon: fa(FaWhatsapp),
  },
  youtube: {
    label: "يوتيوب",
    bg: "#FF0000",
    fg: "#ffffff",
    ring: "#FF0000",
    Icon: fa(FaYoutube),
  },
  x: {
    label: "إكس",
    bg: "#000000",
    fg: "#ffffff",
    ring: "#000000",
    Icon: fa(FaXTwitter),
  },
  snapchat: {
    label: "سناب شات",
    bg: "#FFFC00",
    fg: "#000000",
    ring: "#c8c400",
    Icon: fa(FaSnapchatGhost),
  },
  telegram: {
    label: "تليجرام",
    bg: "#229ED9",
    fg: "#ffffff",
    ring: "#229ED9",
    Icon: fa(FaTelegramPlane),
  },
  google_maps: {
    label: "الخريطة",
    bg: "#EA4335",
    fg: "#ffffff",
    ring: "#EA4335",
    Icon: MapPin as unknown as IconComponent,
  },
  website: {
    label: "الموقع",
    bg: "rgb(var(--primary))",
    fg: "rgb(var(--on-primary))",
    ring: "rgb(var(--primary-strong))",
    Icon: Globe as unknown as IconComponent,
  },
};

export const PHONE_ICON = Phone as unknown as IconComponent;

/** aria-label for a social link: “زيارة إنستجرام” */
export function socialAriaLabel(platform: PlatformKey, customLabel?: string | null): string {
  const label = (customLabel && customLabel.trim()) || PLATFORMS[platform].label;
  return `زيارة ${label}`;
}
