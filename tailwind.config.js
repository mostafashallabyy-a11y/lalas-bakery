/** @type {import('tailwindcss').Config} */
// نظام الـ tokens — كل الألوان بتشاور على CSS variables في src/index.css
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        cairo: ["Cairo", "system-ui", "sans-serif"],
        script: ["Brush Script MT", "Segoe Script", "cursive"],
      },
      colors: {
        // الأسماء الدلالية الجديدة
        page: v("--bg"),
        surface: v("--surface"),
        surface2: v("--surface-2"),
        border: v("--border"),
        text: v("--text"),
        muted: v("--text-muted"),
        primary: v("--primary"),
        "primary-strong": v("--primary-strong"),
        accent: v("--accent"),
        "on-primary": v("--on-primary"),
        btnbg: v("--btn-bg"),
        btnfg: v("--btn-fg"),
        ok: v("--ok"),
        warn: v("--warn"),
        danger: v("--danger"),
        info: v("--info"),
        "ok-text": v("--ok-text"),
        "ok-bg": v("--ok-bg"),
        "warn-text": v("--warn-text"),
        "warn-bg": v("--warn-bg"),
        "danger-text": v("--danger-text"),
        "danger-bg": v("--danger-bg"),
        "info-text": v("--info-text"),
        "info-bg": v("--info-bg"),
        badge: v("--badge-bg"),
        "badge-fg": v("--badge-fg"),
        ring: v("--ring"),
        // أسماء brand القديمة — aliases على التوكنز (شبكة أمان)
        brand: {
          50: v("--bg"),
          100: v("--surface-2"),
          200: v("--border"),
          300: v("--border"),
          400: v("--text-muted"),
          500: v("--primary"),
          600: v("--primary-strong"),
          700: v("--primary-strong"),
          800: v("--text"),
          900: v("--text"),
          accent: v("--accent"),
          "accent-deep": v("--badge-bg"),
        },
        mut: v("--text-muted"),
      },
    },
  },
  plugins: [],
};
