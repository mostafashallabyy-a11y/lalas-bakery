import { lazy, Suspense, type ReactNode } from "react";
import { Route, Routes, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { CartProvider } from "./context/CartContext";
import Layout from "./components/Layout";
import ErrorBoundary from "./components/ErrorBoundary";
import Seo from "./components/Seo";
import { Spinner } from "./components/Common";

// كل صفحة في ملف لوحدها — أول فتح للمنيو بينزل كود المنيو بس (أسرع على الموبايل)
const Home = lazy(() => import("./pages/Home"));
const BranchPage = lazy(() => import("./pages/Branch"));
const BranchLanding = lazy(() => import("./pages/BranchLanding"));
const CartPage = lazy(() => import("./pages/Cart"));
const Checkout = lazy(() => import("./pages/Checkout"));
const Payment = lazy(() => import("./pages/Payment"));
const OrderPage = lazy(() => import("./pages/Order"));
const Track = lazy(() => import("./pages/Track"));
const FeedbackPage = lazy(() => import("./pages/Feedback"));

// منطقة الموظفين والإدارة — تُحمّل عند الحاجة فقط (تقليل حجم الحزمة للزبائن)
const StaffLogin = lazy(() => import("./pages/StaffLogin"));
const StaffOrders = lazy(() => import("./pages/StaffOrders"));
const StaffPOS = lazy(() => import("./pages/StaffPOS"));
const StaffLayout = lazy(() => import("./pages/staff/StaffLayout"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const BranchesAdmin = lazy(() => import("./pages/admin/BranchesAdmin"));
const CatalogAdmin = lazy(() => import("./pages/admin/CatalogAdmin"));
const SettingsAdmin = lazy(() => import("./pages/admin/SettingsAdmin"));
const StaffAdmin = lazy(() => import("./pages/admin/StaffAdmin"));
const FeedbackAdmin = lazy(() => import("./pages/admin/FeedbackAdmin"));
const PromosAdmin = lazy(() => import("./pages/admin/PromosAdmin"));
const SocialLinksAdmin = lazy(() => import("./pages/admin/SocialLinksAdmin"));
const InventoryAdmin = lazy(() => import("./pages/admin/InventoryAdmin"));
const StockReport = lazy(() => import("./pages/admin/StockReport"));
const ReportsAdmin = lazy(() => import("./pages/admin/ReportsAdmin"));

export default function App() {
  // الانتظار بياخد ارتفاع الشاشة كلها، فالفوتر مايتحركش لما المحتوى ينزل (CLS = 0)
  const page = (children: ReactNode, label = "لحظة…") => (
    <Suspense
      fallback={
        <div className="grid min-h-[calc(100vh-40px)] place-items-center">
          <Spinner label={label} />
        </div>
      }
    >
      {children}
    </Suspense>
  );
  return (
    <ErrorBoundary>
    <AuthProvider>
      <CartProvider>
        <Seo />
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={page(<Home />, "بنجهّز الفروع…")} />
            <Route path="/branch/:id" element={page(<BranchPage />, "بنجهّز المنيو…")} />
            <Route path="/branch/:id/landing" element={page(<BranchLanding />)} />
            <Route path="/cart" element={page(<CartPage />)} />
            <Route path="/checkout" element={page(<Checkout />)} />
            <Route path="/pay/:orderNumber" element={<ErrorBoundary>{page(<Payment />)}</ErrorBoundary>} />
            <Route path="/order/:orderNumber" element={<ErrorBoundary>{page(<OrderPage />)}</ErrorBoundary>} />
            <Route path="/track" element={<ErrorBoundary>{page(<Track />)}</ErrorBoundary>} />
            <Route path="/feedback" element={page(<FeedbackPage />)} />

            {/* منطقة الموظفين والمدير (تسجيل دخول مطلوب) */}
            <Route path="/staff/login" element={<Suspense fallback={<Spinner label="بنجهز لوحة التحكم…" />}><StaffLogin /></Suspense>} />
            <Route path="/staff/*" element={<Suspense fallback={<Spinner label="بنجهز لوحة التحكم…" />}><StaffLayout /></Suspense>}>
              <Route index element={<StaffOrders />} />
              <Route path="admin" element={<Suspense fallback={<Spinner label="بنجهز لوحة التحكم…" />}><AdminLayout /></Suspense>}>
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
