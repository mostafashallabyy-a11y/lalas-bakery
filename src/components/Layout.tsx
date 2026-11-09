import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { useEffect, useState, useMemo } from "react";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { OfflineBanner } from "./Common";
import { money } from "../lib/format";

export default function Layout() {
  const { count, subtotal, branchId } = useCart();
  const { session } = useAuth();
  const { pathname } = useLocation();

  // same style: active (.on) inactive (default)
  const cls = (active: boolean) => `${active ? "btn-dark" : "btn-outline"} shrink-0`;

  // the menu opens from current cart branch, else branches
  const menuTo = branchId ? `/branch/${branchId}` : "/";

  // ---- saved orders from localStorage for "طلباتي" badge ----
  const [myOrders, setMyOrders] = useState<any[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("my_orders");
      if (raw) setMyOrders(JSON.parse(raw));
    } catch {}
  }, []);

  // active orders count (status != 'done')
  const activeOrdersCount = useMemo(() => {
    if (!myOrders.length) return 0;
    return myOrders.filter((o: any) => o && o.order_number).length;
  }, [myOrders]);

  return (
    <div className="min-h-dvh">
      {/* الهيدر: وردي بحدود متقطعة وشعار لالاز 베이كرى في النص زي النموذج */}
      <header className="bg-brand-100 border-b-2 border-dashed border-brand-200 px-3.5 py-3 text-center">
        <Link to="/" className="inline-block">
          <img
            src="/lalas-logo-v2.png"
            alt="Lala's Bakery"
            className="w-auto h-auto max-h-[90px] mx-auto mb-1"
          />
        </Link>
        <div className="mt-2 flex justify-center">
          <NavLink to="/track" end className={({ isActive }) => cls(isActive)}>
            📋 طلباتي{activeOrdersCount > 0 ? ` (${activeOrdersCount})` : ""}
          </NavLink>
        </div>
      </header>

      {/* شريط التنقل: أزرار دويرة بتتحرك أفقيًا */}
      <nav className="sticky top-0 z-30 bg-brand-50 border-b border-brand-200 flex gap-1.5 overflow-x-auto px-2.5 py-2">
        <NavLink to="/" end className={({ isActive }) => cls(isActive)}>
          🏠 الفروع
        </NavLink>
        <NavLink to={menuTo} className={({ isActive }) => cls(isActive)}>
          🍰 المنيو
        </NavLink>
        <NavLink to="/cart" className={({ isActive }) => cls(isActive)}>
          🛒 السلة
        </NavLink>
        <NavLink to="/track" className={({ isActive }) => cls(isActive)}>
          📍 تابع طلبك
        </NavLink>
        <NavLink to="/feedback" className={({ isActive }) => cls(isActive)}>
          💌 رأيك
        </NavLink>
        <NavLink to={session ? "/staff" : "/staff/login"} className={({ isActive }) => cls(isActive)}>
          🔐 الإدارة
        </NavLink>
      </nav>

      <main className="max-w-[720px] w-full mx-auto px-3.5 pt-3.5 pb-[90px]">
        <OfflineBanner />
        <Outlet />
      </main>

      {/* شريط السلة الثابت — يظهر في صفحة المنيو بس زي النموذج */}
      {count > 0 && pathname.startsWith("/branch/") && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-brand-100 border-t-2 border-dashed border-brand-200">
          <div className="max-w-[720px] mx-auto flex items-center justify-between gap-3 px-3.5 py-2.5 pb-[calc(10px+env(safe-area-inset-bottom,0px))]">
            <span className="font-bold">
              🛒 {count} منتج · {money(subtotal)}
            </span>
            <Link to="/cart" className="btn-primary shrink-0">
              السلة
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
