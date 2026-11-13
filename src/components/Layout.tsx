import { NavLink, Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState, useMemo } from "react";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { OfflineBanner, Logo } from "./Common";
import { money } from "../lib/format";
import { SocialLinksFollow } from "./SocialLinks";
import { Toaster } from "./Toast";
import { currentTheme, toggleTheme, type ThemePref } from "../lib/theme";
import {
  Home,
  Croissant,
  ShoppingCart,
  ClipboardList,
  Menu as MenuIcon,
  X,
  MessageCircleHeart,
  ShieldCheck,
  ChevronLeft,
  Sun,
  Moon,
} from "lucide-react";

const HIDDEN_CART_BAR = ["/cart", "/checkout", "/pay", "/order"];

export default function Layout() {
  const { count, subtotal, branchId } = useCart();
  const { session } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(() => (typeof document !== "undefined" ? currentTheme() : "light"));
  const sheetRef = useRef<HTMLDivElement>(null);

  // the menu opens from current cart branch, else branches list
  const menuTo = branchId ? `/branch/${branchId}` : "/";

  // ---- saved orders from localStorage for "طلباتي" badge ----
  const [myOrders, setMyOrders] = useState<any[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("my_orders");
      if (raw) setMyOrders(JSON.parse(raw));
    } catch {}
  }, [pathname]);

  const myOrdersCount = useMemo(
    () => (myOrders ?? []).filter((o: any) => o && o.order_number).length,
    [myOrders]
  );

  // close the "المزيد" sheet on navigation + lock body scroll + Escape handling
  useEffect(() => {
    setMoreOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => sheetRef.current?.focus(), 30);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [moreOpen]);

  // مزامنة أيقونة المفتاح مع الوضع الحالي (لو اتغير من مكان تاني)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(currentTheme());
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const showCartBar = count > 0 && !HIDDEN_CART_BAR.some((p) => pathname.startsWith(p));

  const cartBadge = count > 0 && (
    <span className="absolute -top-1.5 -end-1.5 grid h-5 min-w-[20px] place-items-center rounded-full bg-badge px-1 text-[10px] font-extrabold text-badge-fg">
      {count > 99 ? "+99" : count}
    </span>
  );

  const navItem = (active: boolean) =>
    `relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-2 pt-1 pb-[max(4px,env(safe-area-inset-bottom))] text-[11px] font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
      active ? "text-primary-strong" : "text-muted"
    }`;

  const NavIcon = ({ active, children }: { active: boolean; children: React.ReactNode }) => (
    <span
      className={`grid h-8 w-14 place-items-center rounded-full transition-all duration-200 ${
        active ? "bg-surface text-primary-strong" : "text-current"
      }`}
    >
      {children}
    </span>
  );

  const themeToggle = (
    <button
      type="button"
      role="switch"
      aria-checked={theme === "dark"}
      aria-label={theme === "dark" ? "الوضع الفاتح — اضغط للتبديل" : "الوضع الداكن — اضغط للتبديل"}
      onClick={() => setTheme(toggleTheme())}
      className="relative grid h-11 w-11 place-items-center rounded-full text-text outline-none transition hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
    >
      {theme === "dark" ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
    </button>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      {/* ============ الهيدر: نفس الشكل في كل الصفحات ============ */}
      <header className="print-hidden sticky top-0 z-30 h-[72px] border-b border-border bg-surface">
        <div className="mx-auto flex h-full max-w-[720px] items-center justify-between gap-2 px-3">
          <Link
            to="/"
            aria-label="Lala's Bakery — الرئيسية"
            className="shrink-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Logo
              alt="Lala's Bakery — كوفي ومخبوزات منزلية"
              className="h-[56px] w-auto max-w-[200px] object-contain py-0.5 sm:h-[60px] sm:max-w-[220px]"
            />
          </Link>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigate("/track")}
              aria-label={myOrdersCount > 0 ? `طلباتي — ${myOrdersCount} طلب` : "طلباتي"}
              className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-bold text-text outline-none transition hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
            >
              <ClipboardList size={19} strokeWidth={2} aria-hidden="true" />
              <span>طلباتي</span>
              {myOrdersCount > 0 && (
                <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-surface2 px-1 text-[10px] font-extrabold text-primary-strong">
                  {myOrdersCount}
                </span>
              )}
            </button>

            <Link
              to="/cart"
              aria-label={count > 0 ? `السلة — ${count} منتج` : "السلة"}
              className="relative grid h-11 w-11 place-items-center rounded-full text-text outline-none transition hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
            >
              <ShoppingCart size={22} strokeWidth={2} aria-hidden="true" />
              {cartBadge}
            </Link>
          </div>
        </div>
      </header>

      {/* ============ شريط الروابط العلوي (ديسكتوب) ============ */}
      <div className="print-hidden hidden border-b border-border bg-surface md:block">
        <nav className="mx-auto flex max-w-[720px] items-center gap-2 px-3 py-2" aria-label="التنقل الرئيسي">
          {[
            { to: "/", end: true, label: "الفروع", icon: Home, activeWhen: () => pathname === "/" },
            { to: menuTo, end: false, label: "المنيو", icon: Croissant, activeWhen: () => pathname.startsWith("/branch") },
            { to: "/track", end: false, label: "تابع طلبك", icon: ClipboardList, activeWhen: () => pathname.startsWith("/track") },
            { to: "/feedback", end: false, label: "رأيك", icon: MessageCircleHeart, activeWhen: () => pathname.startsWith("/feedback") },
            { to: session ? "/staff" : "/staff/login", end: false, label: "الإدارة", icon: ShieldCheck, activeWhen: () => pathname.startsWith("/staff") },
          ].map(({ to, end, label, icon: Icon, activeWhen }) => {
            const active = activeWhen();
            return (
              <NavLink
                key={label}
                to={to}
                end={end}
                aria-current={active ? "page" : undefined}
                className={`inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-ring ${
                  active ? "bg-btnbg text-btnfg" : "text-text hover:bg-surface2"
                }`}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </NavLink>
            );
          })}
          <span className="ms-auto">{themeToggle}</span>
        </nav>
      </div>

      {/* ============ محتوى الصفحة مع انتقال ناعم ============ */}
      <main key={pathname} className="page-enter mx-auto w-full max-w-[720px] flex-1 px-3.5 pt-3 pb-[calc(84px+env(safe-area-inset-bottom,0px))] md:pb-10">
        <OfflineBanner />
        <Outlet />
      </main>

      {/* ============ شريط السلة العائم فوق شريط التنقل ============ */}
      {showCartBar && (
        <div
          className="print-hidden pointer-events-none fixed inset-x-0 z-40 bottom-[calc(64px+env(safe-area-inset-bottom,0px)+10px)]"
          role="status"
          aria-live="polite"
        >
          <div className="pointer-events-auto mx-auto flex max-w-[720px] items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-3 py-2" style={{ boxShadow: "var(--shadow-pop)" }}>
            <span className="flex items-center gap-2 text-sm font-bold text-text">
              <ShoppingCart size={18} aria-hidden="true" className="text-primary-strong" />
              <span>{count} {count === 1 ? "منتج" : "منتجات"}</span>
              <span className="text-muted">·</span>
              <span className="text-primary-strong">{money(subtotal)}</span>
            </span>
            <Link to="/cart" className="btn-primary !min-h-[44px] shrink-0 !px-5 text-sm">
              السلة
              <ChevronLeft size={17} aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}

      {/* ============ شريط التنقل السفلي (موبايل) — surface-2 ============ */}
      <nav
        className="print-hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface2 md:hidden"
        aria-label="التنقل الرئيسي"
      >
        <div className="grid grid-cols-5">
          <NavLink to="/" end className={({ isActive }) => navItem(isActive)} aria-label="الرئيسية">
            {({ isActive }) => (
              <>
                <NavIcon active={isActive}><Home size={20} strokeWidth={2} aria-hidden="true" /></NavIcon>
                الرئيسية
              </>
            )}
          </NavLink>
          <NavLink to={menuTo} className={({ isActive }) => navItem(isActive && pathname.startsWith("/branch"))} aria-label="المنيو">
            {({ isActive }) => (
              <>
                <NavIcon active={isActive && pathname.startsWith("/branch")}><Croissant size={20} strokeWidth={2} aria-hidden="true" /></NavIcon>
                المنيو
              </>
            )}
          </NavLink>
          <NavLink to="/cart" className={({ isActive }) => navItem(isActive)} aria-label={count > 0 ? `السلة — ${count} منتج` : "السلة"}>
            {({ isActive }) => (
              <>
                <span className="relative">
                  <NavIcon active={isActive}><ShoppingCart size={20} strokeWidth={2} aria-hidden="true" /></NavIcon>
                  {cartBadge}
                </span>
                السلة
              </>
            )}
          </NavLink>
          <NavLink to="/track" className={({ isActive }) => navItem(isActive)} aria-label="طلباتي — تابع طلبك">
            {({ isActive }) => (
              <>
                <NavIcon active={isActive}><ClipboardList size={20} strokeWidth={2} aria-hidden="true" /></NavIcon>
                طلباتي
              </>
            )}
          </NavLink>
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={navItem(moreOpen)}
            aria-expanded={moreOpen}
            aria-controls="more-sheet"
            aria-label="المزيد — رأيك، الإدارة، الروابط"
          >
            <NavIcon active={moreOpen}><MenuIcon size={20} strokeWidth={2} aria-hidden="true" /></NavIcon>
            المزيد
          </button>
        </div>
      </nav>

      {/* ============ قائمة "المزيد" ============ */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="المزيد">
          <button
            type="button"
            aria-label="إغلاق القائمة"
            className="sheet-overlay absolute inset-0 bg-[rgb(10_5_8/0.62)]"
            onClick={() => setMoreOpen(false)}
          />
          <div
            ref={sheetRef}
            id="more-sheet"
            tabIndex={-1}
            className="sheet-panel absolute inset-x-0 bottom-0 rounded-t-[24px] border-t border-border bg-surface p-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))] outline-none"
          >
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-border" aria-hidden="true" />
            <div className="mb-2 flex items-center justify-between">
              <b className="text-lg text-text">المزيد</b>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="إغلاق"
                className="grid h-11 w-11 place-items-center rounded-full text-text outline-none transition hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
              >
                <X size={22} aria-hidden="true" />
              </button>
            </div>

            {/* مفتاح الوضع الليلي/النهاري */}
            <button
              type="button"
              role="switch"
              aria-checked={theme === "dark"}
              onClick={() => setTheme(toggleTheme())}
              className="flex min-h-[56px] w-full items-center gap-3 rounded-2xl border border-border bg-surface px-4 text-text outline-none transition hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
            >
              <span className="grid h-9 w-9 place-items-center rounded-full bg-surface2 text-primary-strong" aria-hidden="true">
                {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
              </span>
              <span className="font-bold">{theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن"}</span>
              <span
                aria-hidden="true"
                className={`ms-auto grid h-7 w-12 items-center rounded-full border-2 border-border px-0.5 transition-colors ${theme === "dark" ? "justify-end bg-btnbg" : "justify-start bg-surface2"}`}
              >
                <span className="h-4 w-4 rounded-full bg-surface shadow" />
              </span>
            </button>

            <div className="mt-2 grid gap-2">
              <Link
                to="/feedback"
                className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-border bg-surface px-4 text-text outline-none transition hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
              >
                <MessageCircleHeart size={22} className="text-primary-strong" aria-hidden="true" />
                <span className="font-bold">رأيك يهمنا</span>
                <ChevronLeft size={18} aria-hidden="true" className="ms-auto text-muted" />
              </Link>
              <Link
                to={session ? "/staff" : "/staff/login"}
                className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-border bg-surface px-4 text-text outline-none transition hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
              >
                <ShieldCheck size={22} className="text-primary-strong" aria-hidden="true" />
                <span className="font-bold">{session ? "لوحة الإدارة" : "دخول الإدارة"}</span>
                <ChevronLeft size={18} aria-hidden="true" className="ms-auto text-muted" />
              </Link>
            </div>

            <SocialLinksFollow scope="brand" size="md" label="تابعنا — كل الروابط" className="mt-4 border-t border-border pt-3" />
          </div>
        </div>
      )}

      {/* ============ تذييل الصفحة ============ */}
      <footer className="print-hidden border-t border-border bg-surface px-3.5 pb-[calc(84px+env(safe-area-inset-bottom,0px))] pt-6 text-center md:pb-8">
        <div className="mx-auto max-w-[720px] text-center">
          <SocialLinksFollow scope="brand" size="md" label="تابعنا" />
          <p className="mt-2 text-xs text-muted">Lala&apos;s Bakery — مخبوزات وقهوة منزلية تُحضّر بكل حب</p>
        </div>
      </footer>

      <Toaster />
    </div>
  );
}
