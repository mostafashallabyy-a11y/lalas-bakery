import { Route, Routes, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { CartProvider } from "./context/CartContext";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import BranchPage from "./pages/Branch";
import CartPage from "./pages/Cart";
import Checkout from "./pages/Checkout";
import Payment from "./pages/Payment";
import Track from "./pages/Track";
import FeedbackPage from "./pages/Feedback";
import StaffLogin from "./pages/StaffLogin";
import StaffOrders from "./pages/StaffOrders";
import StaffLayout from "./pages/staff/StaffLayout";
import AdminLayout from "./pages/admin/AdminLayout";
import BranchesAdmin from "./pages/admin/BranchesAdmin";
import CatalogAdmin from "./pages/admin/CatalogAdmin";
import SettingsAdmin from "./pages/admin/SettingsAdmin";
import StaffAdmin from "./pages/admin/StaffAdmin";
import FeedbackAdmin from "./pages/admin/FeedbackAdmin";
import ReportsAdmin from "./pages/admin/ReportsAdmin";

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/branch/:id" element={<BranchPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/pay/:orderNumber" element={<Payment />} />
            <Route path="/track" element={<Track />} />
            <Route path="/feedback" element={<FeedbackPage />} />

            {/* منطقة الموظفين والمدير (تسجيل دخول مطلوب) */}
            <Route path="/staff/login" element={<StaffLogin />} />
            <Route path="/staff/*" element={<StaffLayout />}>
              <Route index element={<StaffOrders />} />
              <Route path="admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="branches" replace />} />
                <Route path="branches" element={<BranchesAdmin />} />
                <Route path="catalog" element={<CatalogAdmin />} />
                <Route path="settings" element={<SettingsAdmin />} />
                <Route path="staff" element={<StaffAdmin />} />
                <Route path="feedback" element={<FeedbackAdmin />} />
                <Route path="reports" element={<ReportsAdmin />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </CartProvider>
    </AuthProvider>
  );
}
