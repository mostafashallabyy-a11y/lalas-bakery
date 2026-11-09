import { Navigate, Outlet, useLocation } from "react-router-dom";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Spinner } from "../../components/Common";

// حاجز: موظف أو مدير مفعّل فقط
export default function StaffLayout() {
  const { session, profile, loading } = useAuth();
  const { state } = useLocation() as { state?: { from?: string } };

  if (loading) return <div className="py-10"><Spinner /></div>;
  if (!session) return <Navigate to="/staff/login" state={{ from: state?.from || location.pathname }} replace />;
  if (!profile?.is_active) {
    return (
      <div className="py-10 text-center space-y-3">
        <p className="text-2xl">⏳</p>
        <h2 className="text-lg font-extrabold text-brand-800">حسابك لسه مش مفعّل</h2>
        <p className="text-sm text-brand-800 font-bold">كلم المدير يفعّلك لاحقًا، وبعد التفعيل حاول تدخل تاني.</p>
      </div>
    );
  }
  return (
    <div className="min-h-dvh">
      <nav className="sticky top-0 z-30 bg-brand-50 border-b border-brand-200 flex gap-1.5 overflow-x-auto px-2.5 py-2">
        <NavLink to="/staff" className={({ isActive }) => `${isActive ? "btn-dark" : "btn-outline"} shrink-0`}>
          🧾 الطلبات
        </NavLink>
        <NavLink to="/staff/pos" className={({ isActive }) => `${isActive ? "btn-dark" : "btn-outline"} shrink-0`}>
          💰 كاشير الفرع (POS)
        </NavLink>
        {profile.role === "manager" && (
          <NavLink to="/staff/admin" className={({ isActive }) => `${isActive ? "btn-dark" : "btn-outline"} shrink-0`}>
            👑 لوحة الإدارة
          </NavLink>
        )}
      </nav>
      <main className="max-w-[720px] w-full mx-auto px-3.5 pt-3.5 pb-20">
        <Outlet />
      </main>
    </div>
  );
}
