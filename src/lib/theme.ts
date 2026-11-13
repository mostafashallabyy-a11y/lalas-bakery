// Manual light/dark override — stored in localStorage ("lalas_theme").
// Without a stored preference, prefers-color-scheme decides (see index.css).
export type ThemePref = "light" | "dark";
const KEY = "lalas_theme";

export function currentTheme(): ThemePref {
  try {
    const t = document.documentElement.getAttribute("data-theme");
    if (t === "light" || t === "dark") return t;
  } catch {}
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function setTheme(pref: ThemePref): void {
  try {
    document.documentElement.setAttribute("data-theme", pref);
  } catch {}
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* private mode — يتطبق على السيشن الحالي بس */
  }
}

export function toggleTheme(): ThemePref {
  const next: ThemePref = currentTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}
