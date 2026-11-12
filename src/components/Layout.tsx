import { NavLink, Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState, useMemo } from "react";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { OfflineBanner, Logo } from "./Common";
import { money } from "../lib/format";
import { SocialLinksFollow } from "./SocialLinks";
import { Toaster } from "./Toast";
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
} from "lucide-react";

const HIDDEN_CART_BAR = ["/cart", "/checkout", "/pay", "/order"];

export default function Layout() {
  const { count, subtotal, branchId } = useCart();
  const { session } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
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
    // focus the sheet for keyboard users
    const t = window.setTimeout(() => sheetRef.current?.focus(), 30);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [moreOpen]);

  const showCartBar = count > 0 && !HIDDEN_CART_BAR.some((p) => pathname.startsWith(p));

  const cartBadge = count > 0 && (
    <span className="absolute -top-1.5 -end-1.5 grid h-5 min-w-[20px] place-items-center rounded-full bg-brand-accent-deep px-1 text-[10px] font-extrabold text-white ring-2 ring-brand-50 dark:ring-[#241a1d]">
      {count > 99 ? "+99" : count}
    </span>
  );

  const navItem = (active: boolean) =>
    `relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-2 pt-1 pb-[max(4px,env(safe-area-inset-bottom))] text-[11px] font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${
      active ? "text-brand-700 dark:text-brand-100" : "text-mut dark:text-[#cbb3b9]"
    }`;

  const NavIcon = ({ active, children }: { active: boolean; children: React.ReactNode }) => (
    <span
      className={`grid h-8 w-14 place-items-center rounded-full transition-all duration-200 ${
        active ? "bg-brand-100 text-brand-700 dark:bg-white/10 dark:text-brand-100" : "text-current"
      }`}
    >
      {children}
    </span>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      {/* ============ الهيدر: مدمج، 64px كحد أقصى ============ */}
      <header className="sticky top-0 z-30 h-16 border-b border-brand-200/70 bg-brand-50/90 backdrop-blur-md dark:border-white/10 dark:bg-[#241a1d]/85">
        <div className="mx-auto flex h-full max-w-[720px] items-center justify-between gap-2 px-3">
          <Link
            to="/"
            aria-label="Lala's Bakery — الرئيسية"
            className="shrink-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            <Logo
              alt="Lala's Bakery — كوفي ومخبوزات منزلية"
              className="h-12 w-auto object-contain"
            />
          </Link>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigate("/track")}
              aria-label={myOrdersCount > 0 ? `طلباتي — ${myOrdersCount} طلب` : "طلباتي"}
              className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-bold text-brand-800 outline-none transition hover:bg-brand-100 focus-visible:ring-2 focus-visible:ring-brand-500 active:scale-95 dark:text-brand-100 dark:hover:bg-white/10"
            >
              <ClipboardList size={19} strokeWidth={2} aria-hidden="true" />
              <span>طلباتي</span>
              {myOrdersCount > 0 && (
                <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-brand-100 px-1 text-[10px] font-extrabold text-brand-700 dark:bg-white/10 dark:text-brand-100">
                  {myOrdersCount}
                </span>
              )}
            </button>

            <Link
              to="/cart"
              aria-label={count > 0 ? `السلة — ${count} منتج` : "السلة"}
              className="relative grid h-11 w-11 place-items-center rounded-full text-brand-800 outline-none transition hover:bg-brand-100 focus-visible:ring-2 focus-visible:ring-brand-500 active:scale-95 dark:text-brand-100 dark:hover:bg-white/10"
            >
              <ShoppingCart size={22} strokeWidth={2} aria-hidden="true" />
              {cartBadge}
            </Link>
          </div>
        </div>
      </header>

      {/* ============ شريط الروابط العلوي (ديسكتوب) ============ */}
      <div className="hidden border-b border-brand-200/60 bg-brand-50 dark:border-white/10 dark:bg-[#241a1d] md:block">
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
                className={`inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  active
                    ? "bg-brand-700 text-brand-50"
                    : "text-brand-800 hover:bg-brand-100 dark:text-brand-100 dark:hover:bg-white/10"
                }`}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </NavLink>
            );
          })}
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
          className="pointer-events-none fixed inset-x-0 z-40 bottom-[calc(64px+env(safe-area-inset-bottom,0px)+10px)]"
          role="status"
          aria-live="polite"
        >
          <div className="pointer-events-auto mx-auto flex max-w-[720px] items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-white/95 px-3 py-2 shadow-[0_8px_30px_rgba(74,42,51,0.18)] backdrop-blur-md dark:border-white/10 dark:bg-[#332429]/95">
            <span className="flex items-center gap-2 text-sm font-bold text-brand-900 dark:text-brand-100">
              <ShoppingCart size={18} aria-hidden="true" className="text-brand-600 dark:text-brand-200" />
              <span>{count} {count === 1 ? "منتج" : "منتجات"}</span>
              <span className="text-brand-500 dark:text-brand-200">·</span>
              <span className="text-brand-700 dark:text-[#f3d3dc]">{money(subtotal)}</span>
            </span>
            <Link to="/cart" className="btn-primary !min-h-[44px] shrink-0 !px-5 text-sm">
              السلة
              <ChevronLeft size={17} aria-hidden="true" className="rtl:rotate-0" />
            </Link>
          </div>
        </div>
      )}

      {/* ============ شريط التنقل السفلي (موبايل) ============ */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-brand-200/80 bg-brand-50/95 backdrop-blur-md dark:border-white/10 dark:bg-[#241a1d]/92 md:hidden"
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

      {/* ============ قائمة"المزيد" ============ */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="المزيد">
          <button
            type="button"
            aria-label="إغلاق القائمة"
            className="sheet-overlay absolute inset-0 bg-[#2a161c]/55 backdrop-blur-[2px]"
            onClick={() => setMoreOpen(false)}
          />
          <div
            ref={sheetRef}
            id="more-sheet"
            tabIndex={-1}
            className="sheet-panel absolute inset-x-0 bottom-0 rounded-t-[24px] border-t border-brand-200 bg-brand-50 p-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))] outline-none dark:border-white/10 dark:bg-[#2b2125]"
          >
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-brand-200 dark:bg-white/15" aria-hidden="true" />
            <div className="mb-2 flex items-center justify-between">
              <b className="text-lg text-brand-800 dark:text-brand-100">المزيد</b>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="إغلاق"
                className="grid h-11 w-11 place-items-center rounded-full text-brand-800 outline-none transition hover:bg-brand-100 focus-visible:ring-2 focus-visible:ring-brand-500 active:scale-95 dark:text-brand-100 dark:hover:bg-white/10"
              >
                <X size={22} aria-hidden="true" />
              </button>
            </div>

            <div className="grid gap-2">
              <Link
                to="/feedback"
                className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-brand-200 bg-white px-4 text-brand-900 outline-none transition hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500 active:scale-[0.98] dark:border-white/10 dark:bg-white/5 dark:text-brand-100 dark:hover:bg-white/10"
              >
                <MessageCircleHeart size={22} className="text-brand-600 dark:text-brand-200" aria-hidden="true" />
                <span className="font-bold">رأيك يهمنا</span>
                <ChevronLeft size={18} aria-hidden="true" className="ms-auto text-mut" />
              </Link>
              <Link
                to={session ? "/staff" : "/staff/login"}
                className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-brand-200 bg-white px-4 text-brand-900 outline-none transition hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500 active:scale-[0.98] dark:border-white/10 dark:bg-white/5 dark:text-brand-100 dark:hover:bg-white/10"
              >
                <ShieldCheck size={22} className="text-brand-600 dark:text-brand-200" aria-hidden="true" />
                <span className="font-bold">{session ? "لوحة الإدارة" : "دخول الإدارة"}</span>
                <ChevronLeft size={18} aria-hidden="true" className="ms-auto text-mut" />
              </Link>
            </div>

            <SocialLinksFollow scope="brand" size="md" label="تابعنا — كل الروابط" className="mt-4 border-t border-brand-200/70 pt-3 dark:border-white/10" />
          </div>
        </div>
      )}

      {/* ============ تذييل الصفحة ============ */}
      <footer className="border-t border-brand-200/70 bg-brand-50 px-3.5 pb-[calc(84px+env(safe-area-inset-bottom,0px))] pt-6 text-center dark:border-white/10 dark:bg-[#241a1d] md:pb-8">
        <div className="mx-auto max-w-[720px] text-center">
          <SocialLinksFollow scope="brand" size="md" label="تابعنا" />
          <p className="mt-2 text-xs text-mut dark:text-brand-100/60">Lala&apos;s Bakery — مخبوزات وقهوة منزلية تُحضّر بكل حب</p>
        </div>
      </footer>

      <Toaster />
    </div>
  );
}
