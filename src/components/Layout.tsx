import { NavLink, Outlet, Link } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { OfflineBanner } from "./Common";
import { money } from "../lib/format";

export default function Layout() {
  const { count, subtotal, branchName } = useCart();
  const { profile, signOut, session } = useAuth();

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-40 backdrop-blur bg-brand-50/90 border-b border-brand-100">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <Link to="/" className="flex items-center gap-2 font-extrabold text-brand-700 text-lg">
            <span aria-hidden>🥐</span> Lala's Bakery
          </Link>

          <nav className="flex items-center gap-1 text-sm font-bold">
            <NavLink to="/track" className={({ isActive }) => `px-2.5 py-1.5 rounded-lg ${isActive ? "bg-brand-500 text-white" : "text-brand-800 hover:bg-brand-100"}`}>
              تتبع طلبك
            </NavLink>
            <NavLink to="/feedback" className={({ isActive }) => `px-2.5 py-1.5 rounded-lg ${isActive ? "bg-brand-500 text-white" : "text-brand-800 hover:bg-brand-100"}`}>
              رأيك يوصلنا
            </NavLink>
          </nav>

          <div className="flex items-center gap-2">
            {session && profile ? (
              <>
                <Link
                  to="/staff"
                  className="pill bg-brand-100 text-brand-800 hover:bg-brand-200"
                >
                  {profile.is_active ? (profile.role === "manager" ? "👑 لوحة المدير" : "🧑‍🍳 شاشة الموظف") : "بانتظار التفعيل"}
                </Link>
                <button onClick={signOut} className="pill bg-white border border-brand-200 text-brand-800">
                  خروج
                </button>
              </>
            ) : (
              <Link to="/staff/login" className="pill bg-white border border-brand-200 text-brand-800 hover:bg-brand-100">
                للموظفين
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 pb-28">
        <OfflineBanner />
        <Outlet />
      </main>

      {/* شريط العربة */}
      {count > 0 && (
        <Link
          to="/cart"
          className="fixed bottom-4 inset-x-4 max-w-2xl mx-auto bg-brand-500 text-white rounded-2xl shadow-lg px-5 py-3.5 flex items-center justify-between font-bold hover:bg-brand-600 transition"
        >
          <span className="flex items-center gap-2">
            <span className="bg-white/20 rounded-full px-2.5 py-0.5 text-sm">{count}</span>
            عربة {branchName ? `فرع ${branchName}` : ""}
          </span>
          <span>{money(subtotal)} 👀</span>
        </Link>
      )}

      <footer className="bg-brand-100/60 border-t border-brand-100 py-6 text-center text-xs text-brand-800">
        <p className="font-bold">Lala's Bakery 💞 — القهوة اللي بتدفي القلب</p>
        <p className="mt-1">اتعمل بحب وقهوة كتير — الشكاوى والاقتراحات بترفع من <Link to="/feedback" className="underline">هنا</Link></p>
      </footer>
    </div>
  );
}
