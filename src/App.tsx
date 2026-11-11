import { Route, Routes, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { CartProvider } from "./context/CartContext";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import Home from "./pages/Home";
import BranchPage from "./pages/Branch";
import BranchLanding from "./pages/BranchLanding";
import CartPage from "./pages/Cart";
import Checkout from "./pages/Checkout";
import Payment from "./pages/Payment";
import OrderPage from "./pages/Order";
import Track from "./pages/Track";
import FeedbackPage from "./pages/Feedback";
import StaffLogin from "./pages/StaffLogin";
import StaffOrders from "./pages/StaffOrders";
import StaffPOS from "./pages/StaffPOS";
import StaffLayout from "./pages/staff/StaffLayout";
import AdminLayout from "./pages/admin/AdminLayout";
import BranchesAdmin from "./pages/admin/BranchesAdmin";
import CatalogAdmin from "./pages/admin/CatalogAdmin";
import SettingsAdmin from "./pages/admin/SettingsAdmin";
import StaffAdmin from "./pages/admin/StaffAdmin";
import FeedbackAdmin from "./pages/admin/FeedbackAdmin";
import PromosAdmin from "./pages/admin/PromosAdmin";
import SocialLinksAdmin from "./pages/admin/SocialLinksAdmin";
import InventoryAdmin from "./pages/admin/InventoryAdmin";
import StockReport from "./pages/admin/StockReport";
import ReportsAdmin from "./pages/admin/ReportsAdmin";

export default function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
      <CartProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/branch/:id" element={<BranchPage />} />
            <Route path="/branch/:id/landing" element={<BranchLanding />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/pay/:orderNumber" element={<ErrorBoundary><Payment /></ErrorBoundary>} />
            <Route path="/order/:orderNumber" element={<ErrorBoundary><OrderPage /></ErrorBoundary>} />
            <Route path="/track" element={<ErrorBoundary><Track /></ErrorBoundary>} />
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
                <Route path="promos" element={<PromosAdmin />} />
                <Route path="social-links" element={<SocialLinksAdmin />} />
                <Route path="inventory" element={<InventoryAdmin />} />
                <Route path="stock-report" element={<StockReport />} />
              </Route>
              <Route path="pos" element={<StaffPOS />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </CartProvider>
    </AuthProvider>
    </ErrorBoundary>
  );
}
