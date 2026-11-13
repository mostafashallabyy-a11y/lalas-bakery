import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/types";
import { fmtDate, num, money } from "../../lib/format";
import { Spinner, EmptyBox } from "../../components/Common";
import { toCSV, downloadCSV } from "../../lib/csv";
import { useAuth } from "../../context/AuthContext";
import { Trash2, ShieldAlert, Download, Eye } from "lucide-react";

function uptoDate(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(d: Date, days: number) { const n = new Date(d); n.setDate(n.getDate() + days); return n; }

type ReportTab = "revenue" | "products" | "staff";

type WipeOptions = {
  deleteOrders: boolean;
  deleteProofs: boolean;
  deleteStockMovements: boolean;
  deleteShifts: boolean;
  resetCustomerStats: boolean;
  onlyTest: boolean;
};

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
  const { profile } = useAuth();
  const isManager = profile?.role === "manager";

  // Part 4 wipe UI
  const [clearOpen, setClearOpen] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [preview, setPreview] = useState<any | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [clearResult, setClearResult] = useState<string | null>(null);
  const [opts, setOpts] = useState<WipeOptions>({
    deleteOrders: true,
    deleteProofs: true,
    deleteStockMovements: true,
    deleteShifts: false,
    resetCustomerStats: false,
    onlyTest: false,
  });

  const presets: { label: string; days: number }[] = [
    { label: "اليوم", days: 0 },
    { label: "الأسبوع", days: 6 },
    { label: "الشهر", days: 29 },
  ];

  const loadBranches = useCallback(async () => {
    const { data } = await supabase.from("branches").select("id, name").eq("is_active", true).order("sort_order");
    setBranches((data as { id: string; name: string }[]) ?? []);
  }, []);

  useEffect(() => { loadBranches(); }, [loadBranches]);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const bid = branchFilter === "all" ? null : branchFilter;
      const [rep, prod, staff] = await Promise.all([
        supabase.rpc("manager_report_enhanced", { p_from: from, p_to: to, p_branch_id: bid }),
        supabase.rpc("manager_product_movement", { p_from: from, p_to: to, p_branch_id: bid }),
        supabase.rpc("manager_staff_performance", { p_from: from, p_to: to, p_branch_id: bid }),
      ]);
      if (rep.error) throw rep.error;
      if (prod.error) throw prod.error;
      if (staff.error) throw staff.error;
      setData({ revenue: rep.data, products: prod.data, staff: staff.data } as Record<string, any>);
    } catch (e: unknown) {
      setErr((e as Error).message || "مش قادرين نجيب التقارير");
    } finally {
      setBusy(false);
    }
  }, [from, to, branchFilter]);

  useEffect(() => { load(); }, [load]);

  const previewWipe = async () => {
    setClearBusy(true); setErr(null); setPreview(null);
    try {
      const { data, error } = await supabase.rpc("manager_wipe_test_data_preview", {
        p_from: from, p_to: to, p_branch_id: branchFilter === "all" ? null : branchFilter,
        p_delete_orders: opts.deleteOrders,
        p_delete_proofs: opts.deleteProofs,
        p_delete_stock_movements: opts.deleteStockMovements,
        p_delete_shifts: opts.deleteShifts,
        p_reset_customer_stats: opts.resetCustomerStats,
        p_only_test: opts.onlyTest,
      });
      if (error) throw error;
      setPreview(data);
    } catch (e: unknown) {
      setErr((e as Error).message || "فشل معاينة بيانات المسح");
    } finally { setClearBusy(false); }
  };

  const downloadBackup = async () => {
    setClearBusy(true); setErr(null);
    try {
      const bid = branchFilter === "all" ? null : branchFilter;
      const f = new Date(from + "T00:00:00+02:00").toISOString();
      const t = new Date(to + "T23:59:59.999+02:00").toISOString();
      let ordersQ = supabase.from("orders").select("*, order_items(*)").gte("created_at", f).lte("created_at", t);
      if (bid) ordersQ = ordersQ.eq("branch_id", bid);
      if (opts.onlyTest) ordersQ = ordersQ.eq("is_test", true);
      const ordersRes = opts.deleteOrders ? await ordersQ : { data: [] as any[], error: null };
      if (ordersRes.error) throw ordersRes.error;
      const orderIds = ((ordersRes.data as any[]) || []).map((o) => o.id);

      let shifts: any[] = [];
      if (opts.deleteShifts) {
        let sq = supabase.from("shifts").select("*").gte("opened_at", f).lte("opened_at", t);
        if (bid) sq = sq.eq("branch_id", bid);
        if (opts.onlyTest) sq = sq.eq("is_test", true);
        const sr = await sq;
        if (sr.error) throw sr.error;
        shifts = (sr.data as any[]) || [];
      }

      let movements: any[] = [];
      if (opts.deleteStockMovements && orderIds.length) {
        const mr = await supabase.from("stock_movements").select("*").in("order_id", orderIds);
        if (mr.error) throw mr.error;
        movements = (mr.data as any[]) || [];
      }

      const backup = {
        exported_at: new Date().toISOString(),
        from, to, branch_id: bid, options: opts,
        orders: ordersRes.data || [],
        shifts,
        stock_movements: movements,
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `backup-test-data-${from}_${to}.json`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);

      // Also CSV for orders summary if present
      const orders = (ordersRes.data as any[]) || [];
      if (orders.length) {
        downloadCSV(`backup-orders-${from}_${to}.csv`, toCSV(orders.map((o) => ({
          order_number: o.order_number, created_at: o.created_at, branch_id: o.branch_id,
          status: o.status, total: o.total, payment_method: o.payment_method, payment_status: o.payment_status,
          is_test: o.is_test, delivery_type: o.delivery_type,
        }))));
      }
    } catch (e: unknown) {
      setErr((e as Error).message || "فشل تصدير النسخة الاحتياطية");
    } finally { setClearBusy(false); }
  };

  const clearTestData = async () => {
    if (confirmText.trim() !== "حذف") return;
    if (!password) { setErr("أدخل كلمة مرور المدير للتأكيد"); return; }
    setClearBusy(true); setErr(null); setClearResult(null);
    try {
      // Re-authenticate manager (password confirmation)
      const email = (profile as any)?.email || (await supabase.auth.getUser()).data.user?.email || "";
      if (!email) throw new Error("تعذر التحقق من حساب المدير");
      const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
      if (authErr) throw new Error("كلمة المرور غير صحيحة أو تعذر التحقق");

      const { data, error } = await supabase.rpc("manager_wipe_test_data", {
        p_from: from, p_to: to, p_branch_id: branchFilter === "all" ? null : branchFilter,
        p_delete_orders: opts.deleteOrders,
        p_delete_proofs: opts.deleteProofs,
        p_delete_stock_movements: opts.deleteStockMovements,
        p_delete_shifts: opts.deleteShifts,
        p_reset_customer_stats: opts.resetCustomerStats,
        p_only_test: opts.onlyTest,
        p_confirm: "حذف",
      });
      if (error) throw error;
      const counts = (data as any)?.counts || {};
      const proofPaths: string[] = ((data as any)?.proof_paths || []) as string[];
      let deletedFiles = 0;
      if (opts.deleteProofs && proofPaths.length) {
        // Best-effort client-side storage deletion (manager session)
        const clean = proofPaths.map((p) => (p || "").replace(/^payment-proofs\//, "")).filter(Boolean);
        if (clean.length) {
          const { error: remErr } = await supabase.storage.from("payment-proofs").remove(clean);
          if (!remErr) deletedFiles = clean.length;
        }
      }

      setClearResult(`تم المسح: ${num(counts.deleted_orders || 0)} طلب، ${num(counts.deleted_shifts || 0)} فترة عمل، ${num(counts.deleted_stock_movements || 0)} حركة مخزون، إثباتات (مرجع/ملفات): ${num(counts.deleted_payment_proofs_refs || 0)}/${num(deletedFiles)}. تم تسجيل العملية في سجل التدقيق.`);
      setConfirmText(""); setPassword(""); setPreview(null);
      await load();
    } catch (e: unknown) {
      setErr((e as Error).message || "فشل مسح بيانات التجربة");
    } finally { setClearBusy(false); }
  };

  if (busy && !data) return <Spinner label="بنحسب الأرقام…" />;

  const revenue = data?.revenue ?? {};
  const products = data?.products ?? {};
  const staff = data?.staff ?? {};

  const css = `
    @page { size: A4; margin: 1cm; }
    @media print { .no-print{display:none!important;} body{-webkit-print-color-adjust:exact;print-color-adjust:exact;} }
    body{direction:rtl;font-family:'Cairo',sans-serif;}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px;}
    th,td{padding:5px;border-bottom:1px solid #ddd;text-align:right;}
  `;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 no-print">
        <div className="flex gap-1">
          {presets.map((p) => (
            <button key={p.label} onClick={() => { setTo(uptoDate(new Date())); setFrom(uptoDate(addDays(new Date(), -p.days))); }} className="btn-outline !px-2 !py-1 text-xs">{p.label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <input type="date" className="input w-auto min-w-0 flex-1 sm:flex-none" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className="input w-auto min-w-0 flex-1 sm:flex-none" value={to} onChange={(e) => setTo(e.target.value)} />
          <select className="input w-auto min-w-0 flex-1 sm:flex-none" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="all">جميع الفروع</option>
            {branches.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
          </select>
          <button className="btn-primary shrink-0" onClick={load} disabled={busy}>{busy ? "…" : "حساب التقرير"}</button>
        </div>
        <div className="flex gap-1 flex-wrap">
          <button className={`btn-outline !px-2 !py-1 text-xs ${tab==='revenue'?'!bg-brand-50':''}`} onClick={() => setTab("revenue")}>الإيرادات</button>
          <button className={`btn-outline !px-2 !py-1 text-xs ${tab==='products'?'!bg-brand-50':''}`} onClick={() => setTab("products")}>المنتجات</button>
          <button className={`btn-outline !px-2 !py-1 text-xs ${tab==='staff'?'!bg-brand-50':''}`} onClick={() => setTab("staff")}>أداء الموظفين</button>
          <button className="btn-primary !px-3 !py-1 text-xs" onClick={() => { setPrintMode(true); window.print(); setPrintMode(false); }}>🖨 طباعة / PDF</button>
        </div>
      </div>

      {err && <div className="status-danger border border-danger-text/30 text-danger-text rounded-xl px-3 py-2 text-sm font-bold">{err}</div>}
      {!data && !busy && <EmptyBox msg="اختار الفترة والفرع واعمل حساب" />}
      {printMode && <style>{css}</style>}

      {!printMode && data && (
        <>
          {tab === "revenue" && (
            <section className="card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-extrabold text-brand-800">الإيرادات والمبيعات</h2>
                <button className="btn-soft !py-1 !px-2 text-xs" onClick={() => downloadCSV(`revenue-${from}_${to}.csv`, toCSV((revenue?.per_day || []).map((r: any) => ({ اليوم: fmtDate(r.day), الطلبات: r.orders_count, الإيرادات: r.revenue }))))}>CSV ⬇</button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="card p-3 text-center"><p className="text-xs text-brand-700 font-bold">عدد الطلبات</p><p className="text-2xl font-extrabold text-brand-600">{num(revenue?.totals?.orders_count ?? 0)}</p></div>
                <div className="card p-3 text-center"><p className="text-xs text-brand-700 font-bold">إجمالي المبيعات (مدفوع)</p><p className="text-2xl font-extrabold text-brand-600">{money(Number(revenue?.totals?.revenue ?? 0))}</p></div>
                <div className="card p-3 text-center"><p className="text-xs text-brand-700 font-bold">طلبات مؤكدة الدفع</p><p className="text-2xl font-extrabold text-brand-600">{num(revenue?.totals?.paid_count ?? 0)}</p></div>
                <div className="card p-3 text-center"><p className="text-xs text-brand-700 font-bold">متوسط الطلب</p><p className="text-2xl font-extrabold text-brand-600">{money(Number(revenue?.totals?.avg_order ?? 0))}</p></div>
              </div>
              {revenue?.cash_summary && (
                <div className="rounded-xl border border-border bg-surface2 p-3 text-sm font-bold">
                  ملخص الكاش: طلبات معلّقة/غير مدفوعة {num(revenue.cash_summary.unpaid_pending_cash_orders ?? 0)} — طلبات ملغاة {num(revenue.cash_summary.cancelled_cash_orders ?? 0)}
                </div>
              )}
              <div className="table-scroll">
                <table className="w-full text-sm"><thead><tr className="text-brand-700 border-b"><th className="py-1 text-right">اليوم</th><th className="py-1">الطلبات</th><th className="py-1">الإيرادات</th></tr></thead>
                <tbody>{(revenue?.per_day || []).map((r:any)=>(<tr key={r.day} className="border-b border-brand-50"><td className="py-1 text-right">{fmtDate(r.day)}</td><td className="py-1 text-center">{num(r.orders_count)}</td><td className="py-1 text-center">{money(Number(r.revenue))}</td></tr>))}</tbody></table>
              </div>
            </section>
          )}

          {tab === "products" && (
            <section className="card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-extrabold text-brand-800">حركة المنتجات</h2>
                <button className="btn-soft !py-1 !px-2 text-xs" onClick={() => downloadCSV(`products-${from}_${to}.csv`, toCSV((products?.products || []).map((r: any) => ({ المنتج: r.product, الكمية: r.qty, المبيعات: r.revenue }))))}>CSV ⬇</button>
              </div>
              {products?.products?.length ? (
                <ol className="text-sm font-bold space-y-1">
                  {products.products.slice(0, 20).map((r: any, i: number) => (
                    <li key={r.product + i} className="flex justify-between border-b border-brand-50 py-1"><span>{i + 1}. {r.product}</span><span className="text-brand-700">{num(r.qty)} • {money(Number(r.revenue))}</span></li>
                  ))}
                </ol>
              ) : <EmptyBox msg="لا توجد بيانات" />}
            </section>
          )}

          {tab === "staff" && (
            <section className="card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-extrabold text-brand-800">أداء الموظفين</h2>
                <button className="btn-soft !py-1 !px-2 text-xs" onClick={() => downloadCSV(`staff-${from}_${to}.csv`, toCSV((staff?.staff || []).map((r: any) => ({ الموظف: r.full_name || r.email, الطلبات: r.orders_handled, متوسط_التحضير: r.avg_prep_minutes, فوق_الهدف: r.orders_over_target, إلغاءات: r.void_requests, نوبات: r.shifts_worked, فرق_الخزنة: r.cash_shift_difference }))))}>CSV ⬇</button>
              </div>
              <p className="text-sm text-muted">الهدف الزمني للتحضير: {staff?.target_prep_minutes ?? 10} دقيقة</p>
              {staff?.staff?.length ? (
                <div className="table-scroll"><table className="w-full text-sm font-bold">
                  <thead><tr className="text-brand-700 border-b border-brand-100"><th className="py-1 text-right">الموظف</th><th className="py-1">طلبات</th><th className="py-1">متوسط التحضير</th><th className="py-1">فوق الهدف</th><th className="py-1">إلغاءات</th><th className="py-1">نوبات</th><th className="py-1">فرق الخزنة</th></tr></thead>
                  <tbody>{staff.staff.map((r: any) => (
                    <tr key={r.email || r.full_name} className="border-b border-brand-50">
                      <td className="py-1 text-right">{r.full_name || r.email}</td>
                      <td className="py-1 text-center">{num(r.orders_handled)}</td>
                      <td className="py-1 text-center">{r.avg_prep_minutes != null ? num(r.avg_prep_minutes) : "—"}</td>
                      <td className="py-1 text-center">{num(r.orders_over_target)}</td>
                      <td className="py-1 text-center">{num(r.void_requests)}</td>
                      <td className="py-1 text-center">{num(r.shifts_worked)}</td>
                      <td className="py-1 text-center">{money(Number(r.cash_shift_difference ?? 0))}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ) : <EmptyBox msg="لا توجد بيانات للموظفين" />}
            </section>
          )}
        </>
      )}

      {isManager && !printMode && (
        <section className="card no-print border border-danger-text/40 p-4 space-y-3" aria-label="منطقة الخطر — تنظيف بيانات التجربة">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-extrabold text-danger-text"><ShieldAlert size={18} aria-hidden="true" />منطقة الخطر — تنظيف بيانات التجربة</h2>
            {!clearOpen && (
              <button type="button" className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-danger-text/50 px-3 text-xs font-bold text-danger-text hover:bg-danger-bg" onClick={() => { setClearOpen(true); setClearResult(null); setErr(null); setPreview(null); }}>
                <Trash2 size={14} aria-hidden="true" />تنظيف بيانات التجربة
              </button>
            )}
          </div>
          <p className="text-xs leading-5 text-muted">
            يحذف نهائيًا بيانات التجربة في النطاق المحدد فقط (الطلبات وعناصرها، إثباتات الدفع/ملفات التخزين، حركات المخزون الناتجة عن تلك الطلبات، فترات العمل والتقارير النقدية عند اختيارها) ويُعيد مخزون المنتجات المحجوز تلقائيًا عند الحاجة. لا يلمس المنتجات أو الفروع أو الأسعار أو الإعدادات أو حسابات الموظفين أو سجلات موافقة العملاء إلا إذا تم تحديد ذلك صراحةً. يتم تسجيل العملية (من/متى/ماذا/الأعداد) في سجل تدقيق غير قابل للحذف.
          </p>

          {clearResult && <div className="status-ok rounded-xl border border-ok-text/30 px-3 py-2 text-sm font-bold" role="status">✓ {clearResult}</div>}

          {clearOpen && (
            <div className="space-y-3 rounded-xl border border-danger-text/40 bg-danger-bg p-3">
              <p className="text-sm font-extrabold text-danger-text">النطاق: من {fmtDate(from)} إلى {fmtDate(to)} • {branchFilter === "all" ? "جميع الفروع" : branches.find((b) => b.id === branchFilter)?.name}</p>

              <div className="grid gap-1.5 text-sm font-bold text-text">
                <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--danger))]" checked={opts.deleteOrders} onChange={(e)=>setOpts(o=>({...o,deleteOrders:e.target.checked}))} />حذف الطلبات التجريبية وعناصرها</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--danger))]" checked={opts.deleteProofs} onChange={(e)=>setOpts(o=>({...o,deleteProofs:e.target.checked}))} />حذف إثباتات الدفع (ملفات التخزين)</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--danger))]" checked={opts.deleteStockMovements} onChange={(e)=>setOpts(o=>({...o,deleteStockMovements:e.target.checked}))} />حذف حركات المخزون الناتجة عن تلك الطلبات</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--danger))]" checked={opts.deleteShifts} onChange={(e)=>setOpts(o=>({...o,deleteShifts:e.target.checked}))} />حذف فترات العمل والتقارير النقدية (الشيفتات)</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--danger))]" checked={opts.resetCustomerStats} onChange={(e)=>setOpts(o=>({...o,resetCustomerStats:e.target.checked}))} />إعادة تعيين إحصائيات العملاء المرتبطة</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--danger))]" checked={opts.onlyTest} onChange={(e)=>setOpts(o=>({...o,onlyTest:e.target.checked}))} />المحدد كـ "طلب تجريبي" فقط (إن وُجد)</label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-outline min-h-[40px] inline-flex items-center gap-1.5 text-sm" disabled={clearBusy} onClick={previewWipe}><Eye size={15}/>معاينة (هيتم حذف…)</button>
                <button type="button" className="btn-outline min-h-[40px] inline-flex items-center gap-1.5 text-sm" disabled={clearBusy} onClick={downloadBackup}><Download size={15}/>تصدير نسخة احتياطية (CSV/JSON)</button>
              </div>

              {preview && (
                <div className="rounded-xl border border-danger-text/30 bg-surface p-3 text-sm font-bold">
                  معاينة: هيتم حذف {num(preview.orders || 0)} طلب، {num(preview.order_items || 0)} عنصر طلب، {num(preview.payment_proofs || 0)} إثبات دفع، {num(preview.stock_movements || 0)} حركة مخزون، {num(preview.shifts || 0)} فترة عمل.
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="wipe-password">كلمة مرور المدير (تأكيد الهوية)</label>
                  <input id="wipe-password" type="password" className="input" value={password} onChange={(e)=>setPassword(e.target.value)} autoComplete="current-password" />
                </div>
                <div>
                  <label className="label" htmlFor="wipe-confirm">اكتب <b>حذف</b> للتأكيد</label>
                  <input id="wipe-confirm" dir="auto" className="input" autoComplete="off" placeholder="حذف" value={confirmText} onChange={(e)=>setConfirmText(e.target.value)} />
                </div>
              </div>

              <div className="flex gap-2">
                <button type="button" className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-danger px-4 font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={clearBusy || confirmText.trim() !== "حذف" || !password} onClick={clearTestData}>
                  <Trash2 size={16} aria-hidden="true" />{clearBusy ? "بيتم التنفيذ…" : "تنفيذ المسح نهائيًا"}
                </button>
                <button type="button" className="btn-outline min-h-[44px]" disabled={clearBusy} onClick={() => { setClearOpen(false); setConfirmText(""); setPassword(""); setPreview(null); }}>إلغاء</button>
              </div>
              <p className="text-[11px] text-danger-text font-bold">تنبيه: يُفضّل تصدير النسخة الاحتياطية قبل التنفيذ. العملية تُنفّذ في معاملة واحدة وتُسجّل في سجل تدقيق غير قابل للحذف.</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
