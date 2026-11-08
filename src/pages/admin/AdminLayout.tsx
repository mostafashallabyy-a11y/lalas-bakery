import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Spinner } from "../../components/Common";
import AdminNav from "./AdminNav";

// حاجز: المدير فقط
export default function AdminLayout() {
  const { profile, loading } = useAuth();
  if (loading) return <div className="py-10"><Spinner /></div>;
  if (profile?.role !== "manager") return <Navigate to="/staff" replace />;
  return (
    <div>
      <AdminNav />
      <Outlet />
    </div>
  );
}
