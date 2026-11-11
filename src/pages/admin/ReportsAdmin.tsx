import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/types";
import { fmtDate, num, money } from "../../lib/format";
import { Spinner, EmptyBox } from "../../components/Common";
import { toCSV, downloadCSV } from "../../lib/csv";

function uptoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number) {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
}

type ReportTab = "revenue" | "products" | "staff";

export default function ReportsAdmin() {
  const [from, setFrom] = useState(uptoDate(addDays(new Date(), -6)));
  const [to, setTo] = useState(uptoDate(new Date()));
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<ReportTab>("revenue");
  const [printMode, setPrintMode] = useState(false);

  const presets: { label: string; days: number }[] = [
    { label: "اليوم", days: 0 },
    { label: "الأسبوع", days: 6 },
    { label: "الشهر", days: 29 },
  ];

  const loadBranches = useCallback(async () => {
    const { data } = await supabase.from("branches").select("id, name").eq("is_active", true).order("sort_order");
    setBranches((data as { id: string; name: string }[]) ?? []);
  }, []);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const [rep, prod, staff] = await Promise.all([
        supabase.rpc("manager_report_enhanced", { p_from: from, p_to: to, p_branch_id: branchFilter === "all" ? null : branchFilter }),
        supabase.rpc("manager_product_movement", { p_from: from, p_to: to, p_branch_id: branchFilter === "all" ? null : branchFilter }),
        supabase.rpc("manager_staff_performance", { p_from: from, p_to: to, p_branch_id: branchFilter === "all" ? null : branchFilter }),
      ]);
      if (rep.error) throw rep.error;
      if (prod.error) throw prod.error;
      if (staff.error) throw staff.error;
      setData({
        revenue: rep.data,
        products: prod.data,
        staff: staff.data,
      } as Record<string, any>);
    } catch (e: unknown) {
      setErr((e as Error).message || "مش قادرين نجيب التقرير");
    } finally {
      setBusy(false);
    }
  }, [from, to, branchFilter, loadBranches]);

  useEffect(() => {
    load();
  }, [load]);

  if (busy && !data) return <Spinner label="بنحسب الأرقام… 📊" />;

  const revenue = data?.revenue ?? {};
  const products = data?.products ?? {};
  const staff = data?.staff ?? {};

  const css = `
    @page { size: A4; margin: 1cm; }
    @media print {
      .no-print { display: none !important; }
      .print-hide { display: none !important; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    body { direction: rtl; font-family: 'Cairo', sans-serif; }
    .report-title { text-align: center; font-size: 24px; font-weight: 800; color: #7d3f50; margin-bottom: 8px; }
    .report-subtitle { text-align: center; font-size: 14px; color: #6b5b6b; margin-bottom: 16px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
    .kpi-card { border: 1px solid #f9dfe5; border-radius: 12px; padding: 10px; text-align: center; background: #fbf3f4; }
    .kpi-label { font-size: 11px; color: #b0687a; font-weight: bold; }
    .kpi-value { font-size: 20px; font-weight: 800; color: #7d3f50; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px; }
    th { background: #f9dfe5; color: #7d3f50; font-weight: 800; padding: 6px; text-align: right; border-bottom: 2px solid #b0687a; }
    td { padding: 5px; border-bottom: 1px solid #f1d4dd; text-align: right; }
    .section { page-break-inside: avoid; margin-bottom: 20px; }
    .section-title { font-size: 16px; font-weight: 800; color: #7d3f50; margin-bottom: 8px; border-bottom: 2px solid #b0687a; padding-bottom: 4px; }
    .chart-placeholder { border: 1px dashed #b0687a; border-radius: 8px; padding: 20px; text-align: center; color: #b0687a; font-size: 13px; margin-bottom: 12px; }
    .insight-box { background: #fbf3f4; border: 1px solid #f9dfe5; border-radius: 12px; padding: 12px; font-size: 13px; line-height: 1.6; margin-bottom: 16px; }
  `;

  const printContent = (
    <div className="no-print">
      <style>{css}</style>
      <div className="report-container">
        <div className="report-title">تقرير المدير — {branchFilter === "all" ? "جميع الفروع" : branches.find((b) => b.id === branchFilter)?.name}</div>
        <div className="report-subtitle">
          {fmtDate(from)} إلى {fmtDate(to)} · تم الإنشاء: {new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })}
        </div>

        {/* Revenue tab */}
        <div className="section">
          <div className="section-title">الإيرادات والمبيعات</div>
          <div className="kpi-grid">
            <div className="kpi-card"><div className="kpi-label">عدد الطلبات</div><div className="kpi-value">{num(revenue?.totals?.orders_count ?? 0)}</div></div>
            <div className="kpi-card"><div className="kpi-label">إجمالي المبيعات</div><div className="kpi-value">{money(Number(revenue?.totals?.revenue ?? 0))}</div></div>
            <div className="kpi-card"><div className="kpi-label">طلبات مؤكدة الدفع</div><div className="kpi-value">{num(revenue?.totals?.paid_count ?? 0)}</div></div>
            <div className="kpi-card"><div className="kpi-label">متوسط الطلب</div><div className="kpi-value">{money(Number(revenue?.totals?.avg_order ?? 0))}</div></div>
          </div>
          <div className="chart-subtitle">الطلبات لكل يوم:</div>
          <table>
            <thead><tr><th>اليوم</th><th>الطلبات</th><th>المبيعات</th></tr></thead>
            <tbody>
              {revenue?.per_day?.map((r: any) => (
                <tr key={r.day}><td>{fmtDate(r.day)}</td><td>{num(r.orders_count)}</td><td>{money(Number(r.revenue))}</td></tr>
              )) || <tr><td colSpan={3}>لا توجد بيانات</td></tr>}
            </tbody>
          </table>
          <div className="chart-placeholder">رسم بياني: المبيعات حسب اليوم</div>
          <table>
            <thead><tr><th>طريقة الدفع</th><th>الطلبات</th><th>مدفوعة</th><th>الإيراد (مدفوع فقط)</th><th>كاش معلّق</th><th>كاش ملغي</th></tr></thead>
            <tbody>
              {revenue?.per_payment_method?.map((r: any) => (
                <tr key={r.method}>
                  <td>{r.method === 'cash' ? '💵 كاش' : r.method === 'instapay' ? '📲 InstaPay' : r.method}</td>
                  <td>{num(r.orders_count)}</td>
                  <td>{num(r.paid_count ?? 0)}</td>
                  <td>{money(Number(r.revenue ?? 0))}</td>
                  <td>{num(r.unpaid_pending_count ?? 0)}</td>
                  <td>{num(r.cancelled_count ?? 0)}</td>
                </tr>
              )) || <tr><td colSpan={6}>لا توجد بيانات</td></tr>}
            </tbody>
          </table>
          {revenue?.cash_summary && (
            <div className="insight-box">
              <strong>ملخص الكاش:</strong> طلبات كاش معلّقة/غير مدفوعة: {num(revenue.cash_summary.unpaid_pending_cash_orders ?? 0)} — طلبات كاش ملغاة: {num(revenue.cash_summary.cancelled_cash_orders ?? 0)}
            </div>
          )}
          <div className="chart-placeholder">رسم بياني: الطلبات حسب الساعة (خريطة حرارية)</div>
          <table>
            <thead><tr><th>الساعة</th><th>الطلبات</th></tr></thead>
            <tbody>
              {revenue?.peak_hours?.map((r: any) => (
                <tr key={r.hour}><td>{r.hour}:00</td><td>{num(r.orders_count)}</td></tr>
              )) || <tr><td colSpan={2}>لا توجد بيانات</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Products tab */}
        <div className="section">
          <div className="section-title">حركة المنتجات</div>
          <table>
            <thead><tr><th>المنتج</th><th>الكمية</th><th>المبيعات</th></tr></thead>
            <tbody>
              {products?.products?.map((r: any) => (
                <tr key={r.product}><td>{r.product}</td><td>{num(r.qty)}</td><td>{money(Number(r.revenue))}</td></tr>
              )) || <tr><td colSpan={3}>لا توجد بيانات</td></tr>}
            </tbody>
          </table>
          <table>
            <thead><tr><th>القسم</th><th>الكمية</th><th>مبيعات القسم</th></tr></thead>
            <tbody>
              {products?.category_share?.map((r: any) => (
                <tr key={r.category}><td>{r.category}</td><td>{num(r.qty)}</td><td>{money(Number(r.revenue))}</td></tr>
              )) || <tr><td colSpan={3}>لا توجد بيانات</td></tr>}
            </tbody>
          </table>
          <div className="insight-box">
            <strong>المقارنة مع الفترة السابقة:</strong>{" "}
            {products?.comparison?.current_period_qty > 0
              ? `الكمية: ${products.comparison.current_period_qty} (السابقة: ${products.comparison.previous_period_qty}) · الإيرادات: ${money(Number(products.comparison.current_period_revenue))} (السابقة: ${money(Number(products.comparison.previous_period_revenue))})`
              : "لا توجد بيانات للمقارنة"}
          </div>
        </div>

        {/* Staff tab */}
        <div className="section">
          <div className="section-title">أداء الموظفين</div>
          <p className="text-sm text-muted">الهدف الزمني للتحضير: {staff?.target_prep_minutes ?? 10} دقيقة</p>
          <table>
            <thead><tr><th>الموظف</th><th>طلبات اتُعيلت</th><th>متوسط التحضير (دقيقة)</th><th>ال Median</th><th>فوق الهدف</th><th>طلبات إلغاء</th><th>نوبات عمل</th><th>فرق الخزنة</th></tr></thead>
            <tbody>
              {staff?.staff?.map((r: any) => (
                <tr key={r.email || r.full_name}>
                  <td>{r.full_name || r.email}</td>
                  <td>{num(r.orders_handled)}</td>
                  <td>{r.avg_prep_minutes != null ? num(r.avg_prep_minutes) : "—"}</td>
                  <td>{r.median_prep_minutes != null ? num(r.median_prep_minutes) : "—"}</td>
                  <td>{num(r.orders_over_target)}</td>
                  <td>{num(r.void_requests)}</td>
                  <td>{num(r.shifts_worked)}</td>
                  <td>{money(Number(r.cash_shift_difference ?? 0))}</td>
                </tr>
              )) || <tr><td colSpan={8}>لا توجد بيانات</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 no-print">
        <div className="flex gap-1">
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => {
                setTo(uptoDate(new Date()));
                setFrom(uptoDate(addDays(new Date(), -p.days)));
              }}
              className="btn-outline !px-2 !py-1 text-xs"
            >
              {p.label}
            </button>
          ))}
          <button onClick={() => setFrom(uptoDate(addDays(new Date(), -90)))} className="btn-outline !px-2 !py-1 text-xs">مخصص</button>
        </div>
        <div className="flex gap-1">
          <label className="label hidden">من</label>
          <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
          <label className="label hidden">إلى</label>
          <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
          <select className="input w-auto" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="all">جميع الفروع</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button className="btn-primary" onClick={load} disabled={busy}>
            {busy ? "…" : "حساب التقرير"}
          </button>
        </div>
        <div className="flex gap-1">
          <button className="btn-outline !px-2 !py-1 text-xs no-print" onClick={() => setTab("revenue")}>
            الإيرادات
          </button>
          <button className="btn-outline !px-2 !py-1 text-xs no-print" onClick={() => setTab("products")}>
            المنتجات
          </button>
          <button className="btn-outline !px-2 !py-1 text-xs no-print" onClick={() => setTab("staff")}>
            أداء الموظفين
          </button>
          <button
            className="btn-primary !px-3 !py-1 text-xs no-print"
            onClick={() => {
              setPrintMode(true);
              window.print();
              setPrintMode(false);
            }}
          >
            🖨 طباعة / PDF
          </button>
        </div>
      </div>

      {err && <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-3 py-2 text-sm font-bold">{err}</div>}
      {!data && !busy && <EmptyBox msg="اختر الفترة والفرع واعمل حساب" />}
      {printMode && printContent}

      {!printMode && data && (
        <>
          {/* Revenue */}
          {tab === "revenue" && (
            <section className="card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-extrabold text-brand-800">الإيرادات والمبيعات</h2>
                <button className="btn-soft !py-1 !px-2 text-xs" onClick={() => downloadCSV(`revenue-${from}_${to}.csv`, toCSV(revenue?.per_day?.map((r: any) => ({ اليوم: fmtDate(r.day), "عدد الطلبات": r.orders_count, "المبيعات": r.revenue })) || []))}>CSV ⬇</button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="card p-3 text-center">
                  <p className="text-xs text-brand-700 font-bold">عدد الطلبات</p>
                  <p className="text-2xl font-extrabold text-brand-600">{num(revenue?.totals?.orders_count ?? 0)}</p>
                </div>
                <div className="card p-3 text-center">
                  <p className="text-xs text-brand-700 font-bold">إجمالي المبيعات</p>
                  <p className="text-2xl font-extrabold text-brand-600">{money(Number(revenue?.totals?.revenue ?? 0))}</p>
                </div>
                <div className="card p-3 text-center">
                  <p className="text-xs text-brand-700 font-bold">طلبات مؤكدة الدفع</p>
                  <p className="text-2xl font-extrabold text-brand-600">{num(revenue?.totals?.paid_count ?? 0)}</p>
                </div>
                <div className="card p-3 text-center">
                  <p className="text-xs text-brand-700 font-bold">متوسط الطلب</p>
                  <p className="text-2xl font-extrabold text-brand-600">{money(Number(revenue?.totals?.avg_order ?? 0))}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="card p-3">
                  <h3 className="font-bold text-brand-900 text-sm mb-2">الطلبات لكل يوم</h3>
                  {revenue?.per_day?.length === 0 ? <EmptyBox msg="مفيش طلبات" /> : (
                    <table className="w-full text-sm">
                      <thead><tr className="text-brand-700 border-b"><th className="py-1 text-right">اليوم</th><th className="py-1">الطلبات</th><th className="py-1">المبيعات</th></tr></thead>
                      <tbody>
                        {revenue.per_day.map((r: any) => (
                          <tr key={r.day} className="border-b border-brand-50">
                            <td className="py-1 text-right">{fmtDate(r.day)}</td>
                            <td className="py-1 text-center">{num(r.orders_count)}</td>
                            <td className="py-1 text-center">{money(Number(r.revenue))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="card p-3">
                  <h3 className="font-bold text-brand-900 text-sm mb-2">الطلبات لكل طريقة دفع</h3>
                  {revenue?.per_payment_method?.length === 0 ? <EmptyBox msg="لا توجد بيانات" /> : (
                    <table className="w-full text-sm">
                      <thead><tr className="text-brand-700 border-b"><th className="py-1 text-right">الطريقة</th><th className="py-1">الطلبات</th><th className="py-1">المبيعات</th></tr></thead>
                      <tbody>
                        {revenue.per_payment_method.map((r: any) => (
                          <tr key={r.method} className="border-b border-brand-50">
                            <td className="py-1 text-right">{r.method}</td>
                            <td className="py-1 text-center">{num(r.orders_count)}</td>
                            <td className="py-1 text-center">{money(Number(r.revenue))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="mt-3">
                    <h4 className="font-bold text-brand-900 text-sm">أونلاين مقابل كاشير الفرع</h4>
                    <table className="w-full text-sm">
                      <tbody>
                        <tr className="border-b border-brand-50"><td className="py-1 text-right">أونلاين</td><td className="py-1 text-center">{revenue?.online_vs_pos?.online?.orders_count ?? 0} طلب · {money(Number(revenue?.online_vs_pos?.online?.revenue ?? 0))}</td></tr>
                        <tr className="border-b border-brand-50"><td className="py-1 text-right">كاشير الفرع</td><td className="py-1 text-center">{revenue?.online_vs_pos?.pos?.orders_count ?? 0} طلب · {money(Number(revenue?.online_vs_pos?.pos?.revenue ?? 0))}</td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div className="card p-3">
                <h3 className="font-bold text-brand-900 text-sm mb-2">ذروة الساعات (خريطة حرارية)</h3>
                <table className="w-full text-sm">
                  <thead><tr className="text-brand-700 border-b"><th className="py-1 text-right">الساعة</th><th className="py-1">الطلبات</th></tr></thead>
                  <tbody>
                    {revenue?.peak_hours?.map((r: any) => (
                      <tr key={r.hour} className="border-b border-brand-50">
                        <td className="py-1 text-right">{r.hour}:00</td>
                        <td className="py-1 text-center">{num(r.orders_count)}</td>
                      </tr>
                    )) || <tr><td colSpan={2}>لا توجد بيانات</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Products */}
          {tab === "products" && (
            <section className="card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-extrabold text-brand-800">حركة المنتجات</h2>
                <button className="btn-soft !py-1 !px-2 text-xs" onClick={() => downloadCSV(`products-${from}_${to}.csv`, toCSV(products?.products?.map((r: any) => ({ المنتج: r.product, "الكمية": r.qty, "المبيعات": r.revenue })) || []))}>CSV ⬇</button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="card p-3">
                  <h3 className="font-bold text-brand-900 text-sm mb-2">الأكثر مبيعًا</h3>
                  {products?.products?.length === 0 ? <EmptyBox msg="لا توجد بيانات" /> : (
                    <ol className="text-sm font-bold space-y-1">
                      {products.products.slice(0, 10).map((r: any, i: number) => (
                        <li key={r.product + i} className="flex justify-between border-b border-brand-50 py-1">
                          <span>{i + 1}. {r.product}</span>
                          <span className="text-brand-700">{num(r.qty)} · {money(Number(r.revenue))}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <div className="card p-3">
                  <h3 className="font-bold text-brand-900 text-sm mb-2">مشاركة الأقسام</h3>
                  {products?.category_share?.length === 0 ? <EmptyBox msg="لا توجد بيانات" /> : (
                    <table className="w-full text-sm">
                      <thead><tr className="text-brand-700 border-b"><th className="py-1 text-right">القسم</th><th className="py-1">الكمية</th><th className="py-1">المبيعات</th></tr></thead>
                      <tbody>
                        {products.category_share.map((r: any) => (
                          <tr key={r.category} className="border-b border-brand-50">
                            <td className="py-1 text-right">{r.category}</td>
                            <td className="py-1 text-center">{num(r.qty)}</td>
                            <td className="py-1 text-center">{money(Number(r.revenue))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
              <div className="card p-3 mt-3">
                <h3 className="font-bold text-brand-900 text-sm mb-2">المقارنة مع الفترة السابقة</h3>
                {products?.comparison ? (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between"><span>الكمية الحالية:</span> <span>{num(products.comparison.current_period_qty)}</span></div>
                    <div className="flex justify-between"><span>الكمية السابقة:</span> <span>{num(products.comparison.previous_period_qty)}</span></div>
                    <div className="flex justify-between"><span>الإيرادات الحالية:</span> <span>{money(Number(products.comparison.current_period_revenue))}</span></div>
                    <div className="flex justify-between"><span>الإيرادات السابقة:</span> <span>{money(Number(products.comparison.previous_period_revenue))}</span></div>
                  </div>
                ) : <EmptyBox msg="لا توجد بيانات للمقارنة" />}
              </div>
            </section>
          )}

          {/* Staff */}
          {tab === "staff" && (
            <section className="card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-extrabold text-brand-800">أداء الموظفين</h2>
                <button className="btn-soft !py-1 !px-2 text-xs" onClick={() => downloadCSV(`staff-${from}_${to}.csv`, toCSV(staff?.staff?.map((r: any) => ({ الموظف: r.full_name || r.email, "طلبات": r.orders_handled, "متوسط_تحضير": r.avg_prep_minutes, "فوق_الهدف": r.orders_over_target, "إلغاءات": r.void_requests, "نوبات": r.shifts_worked, "فرق_خزنة": r.cash_shift_difference })) || []))}>CSV ⬇</button>
              </div>
              <p className="text-sm text-muted mb-3">الهدف الزمني للتحضير: {staff?.target_prep_minutes ?? 10} دقيقة</p>
              {staff?.staff?.length === 0 ? <EmptyBox msg="لا توجد بيانات للموظفين" /> : (
                <table className="w-full text-sm font-bold">
                  <thead><tr className="text-brand-700 border-b border-brand-100">
                    <th className="py-1 text-right">الموظف</th><th className="py-1">طلبات اتُعيلت</th><th className="py-1">متوسط التحضير</th><th className="py-1">الوسيط</th><th className="py-1">فوق الهدف</th><th className="py-1">إلغاءات</th><th className="py-1">نوبات عمل</th><th className="py-1">فرق الخزنة</th>
                  </tr></thead>
                  <tbody>
                    {staff.staff.map((r: any) => (
                      <tr key={r.email || r.full_name} className="border-b border-brand-50">
                        <td className="py-1 text-right">{r.full_name || r.email}</td>
                        <td className="py-1 text-center">{num(r.orders_handled)}</td>
                        <td className="py-1 text-center">{r.avg_prep_minutes != null ? num(r.avg_prep_minutes) : "—"}</td>
                        <td className="py-1 text-center">{r.median_prep_minutes != null ? num(r.median_prep_minutes) : "—"}</td>
                        <td className="py-1 text-center">{num(r.orders_over_target)}</td>
                        <td className="py-1 text-center">{num(r.void_requests)}</td>
                        <td className="py-1 text-center">{num(r.shifts_worked)}</td>
                        <td className="py-1 text-center">{money(Number(r.cash_shift_difference ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="text-xs text-brand-700 mt-2">متوسط التحضير = من تأكيد الدفع (أو إنشاء طلب الكاشير) لحد «تم الانتهاء» من أحداث الطلب.</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
