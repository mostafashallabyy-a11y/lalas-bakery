import { NavLink } from "react-router-dom";
import { Link } from "react-router-dom";

export default function AdminNav() {
  const tabs = [
    { to: "/staff/admin/branches", label: "الفروع" },
    { to: "/staff/admin/catalog", label: "التصنيفات والمنتجات" },
    { to: "/staff/admin/settings", label: "الإعدادات" },
    { to: "/staff/admin/staff", label: "الموظفين" },
    { to: "/staff/admin/feedback", label: "آراء العملاء" },
    { to: "/staff/admin/reports", label: "التقارير" },
    { to: "/staff/admin/promos", label: "بروموات الفروع" },
    { to: "/staff/admin/social-links", label: "روابط التواصل" },
    { to: "/staff/admin/inventory", label: "المخزون" },
    { to: "/staff/admin/stock-report", label: "تقرير المخزون" },
  ];

  return (
    <div className="py-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold text-text">👑 لوحة المدير</h1>
        <Link to="/staff" className="pill bg-surface border border-border text-brand-800">
          ← شاشة الطلبات
        </Link>
      </div>
      <nav className="flex gap-1.5 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              `pill shrink-0 ${isActive ? "bg-btnbg text-btnfg" : "bg-surface border border-border text-brand-800"}`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
