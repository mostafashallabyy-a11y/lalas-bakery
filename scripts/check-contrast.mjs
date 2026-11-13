// Contrast checker — computes WCAG ratios for every text/background token pair
// in light and dark themes and FAILS below the thresholds.
// Source of truth: the hex values below must match src/index.css (asserted via rgb triplets).
// Thresholds: normal text 4.5:1 · large text/headings 3:1 · UI components (borders/icons) 3:1
// Usage: npm run check:contrast
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// ===== 1) التوكنز (لازم تطابق src/index.css) =====
export const LIGHT = {
  bg: "#fbf3f4",
  surface: "#ffffff",
  surface2: "#f9e8ec",
  border: "#ad7280",
  text: "#3b2229",
  "text-muted": "#7a5a63",
  primary: "#b0687a",
  "primary-strong": "#8f3f58",
  accent: "#e0457b",
  "on-primary": "#ffffff",
  ok: "#4caf7a",
  warn: "#f0b44c",
  danger: "#ef6b6b",
  info: "#6fb3e0",
  "badge-bg": "#c2185b",
  "badge-fg": "#ffffff",
  "ok-text": "#256b43",
  "ok-bg": "#e7f5ec",
  "warn-text": "#7a4e00",
  "warn-bg": "#fdf3df",
  "danger-text": "#a32c2c",
  "danger-bg": "#fdecec",
  "info-text": "#1f5f8b",
  "info-bg": "#e8f2fb",
};

export const DARK = {
  bg: "#1d1216",
  surface: "#2a1b21",
  surface2: "#35232b",
  border: "#946b7b",
  text: "#fbeff2",
  "text-muted": "#d9b8c1",
  primary: "#e8a0b4",
  "primary-strong": "#f4bccb",
  accent: "#ff7aa8",
  "on-primary": "#2a1018",
  ok: "#4caf7a",
  warn: "#f0b44c",
  danger: "#ef6b6b",
  info: "#6fb3e0",
  "badge-bg": "#ff7aa8",
  "badge-fg": "#2a1018",
  "ok-text": "#4caf7a",
  "ok-bg": "#213528",
  "warn-text": "#f0b44c",
  "warn-bg": "#3a2e18",
  "danger-text": "#ef6b6b",
  "danger-bg": "#3d2326",
  "info-text": "#6fb3e0",
  "info-bg": "#213544",
};

// الأزواج: [اللون الأمامي, الخلفية, العتبة, الوصف]
export const PAIRS = [
  ["text", "surface", 4.5, "text on surface"],
  ["text", "surface2", 4.5, "text on surface2"],
  ["text", "bg", 4.5, "text on page bg"],
  // النص الثانوي — مساعد فقط، لكن برضه 4.5
  ["text-muted", "surface", 4.5, "muted on surface"],
  ["text-muted", "surface2", 4.5, "muted on surface2"],
  ["text-muted", "bg", 4.5, "muted on page bg"],
  // شارة ألوان الأزرار تُفحص لكل ثيم على حدة
  ["on-primary", "primary-strong", 4.5, "primary button (btn-bg)"],
  // badges العدادات
  ["badge-fg", "badge-bg", 4.5, "counter badge"],
  // الشارات المخففة (ألوان الحالة)
  ["ok-text", "ok-bg", 4.5, "ok badge"],
  ["warn-text", "warn-bg", 4.5, "warn badge"],
  ["danger-text", "danger-bg", 4.5, "danger badge"],
  ["info-text", "info-bg", 4.5, "info badge"],
  // ألوان الحالة كنص على السطح
  ["ok-text", "surface", 4.5, "ok as text on surface"],
  ["warn-text", "surface", 4.5, "warn as text on surface"],
  ["danger-text", "surface", 4.5, "danger as text on surface"],
  ["info-text", "surface", 4.5, "info as text on surface"],
  // primary كنص صغير لازم يعدي، الأيقونات والعناوين تكتفي بـ 3
  ["primary", "surface", 3, "primary icons/large text"],
  ["primary", "bg", 3, "primary icons on bg"],
  ["primary-strong", "surface", 4.5, "primary-strong text"],
  ["primary-strong", "bg", 4.5, "primary-strong on bg"],
  ["primary-strong", "surface2", 4.5, "primary-strong on surface2"],
  ["accent", "surface", 3, "accent prices/large text"],
  ["accent", "bg", 3, "accent on bg"],
  ["accent", "surface2", 3, "accent on surface2"],
  // معالم الواجهة (حدود + أيقونات) ≥ 3:1
  ["border", "surface", 3, "border on surface"],
  ["border", "bg", 3, "border on bg"],
  ["border", "surface2", 3, "border on surface2"],
  // نص على الخلفيات المخففة
  ["text", "ok-bg", 4.5, "text on ok-tint"],
  ["text", "warn-bg", 4.5, "text on warn-tint"],
  ["text", "danger-bg", 4.5, "text on danger-tint"],
  ["text", "info-bg", 4.5, "text on info-tint"],
];

// أزرار التعبئة: كل ثيم يستخدم btn-bg الخاص به
export const LIGHT_EXTRA = [["on-primary", "primary-strong", 4.5, "primary button (btn-bg)"]];
export const DARK_EXTRA = [["on-primary", "primary", 4.5, "primary button (btn-bg)"]];

// ===== 2) الرياضيات =====
function lin(c) {
  c = c / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function lum(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio(a, b) {
  const la = lum(a), lb = lum(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// ===== 3) تأكيد التطابق مع index.css (rgb triplets) =====
const css = readFileSync(join(root, "src", "index.css"), "utf8").toLowerCase();
const hexToTriplet = (hex) => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)].join(" ");
};
const missing = [];
for (const [theme, table] of Object.entries({ light: LIGHT, dark: DARK })) {
  for (const [k, hex] of Object.entries(table)) {
    if (!css.includes(hexToTriplet(hex))) missing.push(`${theme} ${k} ${hex}`);
  }
}

let fails = 0;
const blocks = [];
for (const themeName of ["light", "dark"]) {
  const T = themeName === "light" ? LIGHT : DARK;
  const themeNameEn = themeName === "light" ? "light" : "dark";
  const rows = [];
  rows.push(`\n=== ${themeName === "light" ? "LIGHT (فاتح)" : "DARK (داكن)"} ===`);
  rows.push("pair                                         ratio  thr  out");
  rows.push("-".repeat(64));
  const allPairs = PAIRS.concat(themeNameEn === "light" ? LIGHT_EXTRA : DARK_EXTRA);
  for (const [fg, bg, threshold, label] of allPairs) {
    const a = T[fg], b = T[bg];
    if (!a || !b) { rows.push(`MISSING ${fg}/${bg}`); fails++; continue; }
    const r = ratio(a, b);
    const ok = r >= threshold;
    if (!ok) fails++;
    rows.push(`${(label + " [" + fg + "/" + bg + "]").padEnd(46)} ${r.toFixed(2).padStart(5)}  ${threshold}  ${ok ? "PASS" : "FAIL"}`);
  }
  blocks.push(rows.join("\n"));
}
console.log(blocks.join("\n"));
if (missing.length) {
  console.log("\nTokens not found in src/index.css:");
  missing.forEach((m) => console.log("  -", m));
}
const good = fails === 0 && missing.length === 0;
console.log(`\n${good ? "ALL PAIRS PASS WCAG AA" : `FAILS: ${fails} pair(s)`}`);
process.exit(good ? 0 : 1);
