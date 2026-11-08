import { Navigate, Outlet, useLocation } from "react-router-dom";
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
  return <Outlet />;
}
