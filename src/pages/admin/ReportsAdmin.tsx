import { useCallback, useEffect, useState } from "react";
import { supabase, type ReportData } from "../../lib/types";
import { fmtDate, num, money } from "../../lib/format";
import { Spinner, EmptyBox } from "../../components/Common";
import { toCSV, downloadCSV } from "../../lib/csv";

function uptoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function ReportsAdmin() {
  const [from, setFrom] = useState(uptoDate(new Date(Date.now() - 6 * 86400e3)));
  const [to, setTo] = useState(uptoDate(new Date()));
  const [data, setData] = useState<ReportData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    const { data: d, error } = await supabase.rpc("manager_report", {
      p_from: from,
      p_to: to,
    });
    setBusy(false);
    if (error) return setErr(error.message || "مش قادرين نجيب التقرير");
    setData((d as unknown as ReportData) ?? null);
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data && busy) return <Spinner label="بنحسب الأرقام… 📊" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label">من</label>
          <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">إلى</label>
          <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={load} disabled={busy}>{busy ? "…" : "حساب"}</button>
      </div>

      {err && <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-3 py-2 text-sm font-bold">{err}</div>}
      {!data && <EmptyBox msg="اختر الفترة واعمل حساب" />}

      {data && (
        <>
          {/* اللي يبان فوق */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="card p-3 text-center">
              <p className="text-xs text-brand-700 font-bold">عدد الطلبات</p>
              <p className="text-2xl font-extrabold text-brand-600">{num(data.totals.orders_count)}</p>
            </div>
            <div className="card p-3 text-center">
              <p className="text-xs text-brand-700 font-bold">إجمالي المبيعات</p>
              <p className="text-2xl font-extrabold text-brand-600">{money(Number(data.totals.revenue))}</p>
            </div>
            <div className="card p-3 text-center">
              <p className="text-xs text-brand-700 font-bold">طلبات مدفوعة أكدناها</p>
              <p className="text-2xl font-extrabold text-brand-600">{num(data.totals.paid_count)}</p>
            </div>
            <div className="card p-3 text-center">
              <p className="text-xs text-brand-700 font-bold">متوسط الطلب</p>
              <p className="text-2xl font-extrabold text-brand-600">{money(Number(data.totals.avg_order))}</p>
            </div>
          </div>

          {/* لكل يوم */}
          <section className="card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-extrabold text-brand-800">الطلبات لكل يوم</h2>
              <button
                className="btn-soft !py-1 !px-2 text-xs"
                onClick={() =>
                  downloadCSV(
                    `orders-per-day-${from}_${to}.csv`,
                    toCSV(data.per_day.map((r) => ({ اليوم: fmtDate(r.day), "عدد الطلبات": r.orders_count, المبيعات: r.revenue })))
                  )
                }
              >
                CSV ⬇
              </button>
            </div>
            {data.per_day.length === 0 ? <EmptyBox msg="مفيش طلبات في الفترة دي" /> : (
              <table className="w-full text-sm font-bold">
                <thead><tr className="text-brand-700 border-b border-brand-100"><th className="text-right py-1">اليوم</th><th className="py-1">الطلبات</th><th className="py-1">المبيعات</th></tr></thead>
                <tbody>
                  {data.per_day.map((r) => (
                    <tr key={r.day} className="border-b border-brand-50">
                      <td className="py-1.5 text-right">{fmtDate(r.day)}</td>
                      <td className="text-center">{num(r.orders_count)}</td>
                      <td className="text-center">{money(Number(r.revenue))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* لكل فرع */}
          <section className="card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-extrabold text-brand-800">لكل فرع</h2>
              <button className="btn-soft !py-1 !px-2 text-xs" onClick={() => downloadCSV(`orders-per-branch-${from}_${to}.csv`, toCSV(data.per_branch.map((r) => ({ الفرع: r.branch, "عدد الطلبات": r.orders_count, المبيعات: r.revenue }))))}>CSV ⬇</button>
            </div>
            {data.per_branch.map((r) => (
              <div key={r.branch} className="flex justify-between text-sm font-bold border-b border-brand-50 py-1.5">
                <span>{r.branch}</span>
                <span>{num(r.orders_count)} طلب · {money(Number(r.revenue))}</span>
              </div>
            ))}
          </section>

          {/* لكل موظف */}
          <section className="card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-extrabold text-brand-800">أداء الموظفين</h2>
              <button className="btn-soft !py-1 !px-2 text-xs" onClick={() => downloadCSV(`staff-perf-${from}_${to}.csv`, toCSV(data.per_staff.map((r) => ({ الموظف: r.full_name || r.email, "طلبات اتشيلت": r.orders_handled, "متوسط وقت التحضير (دقيقة)": r.avg_prep_minutes ?? "" }))))}>CSV ⬇</button>
            </div>
            {data.per_staff.length === 0 ? <EmptyBox msg="لسه مفيش حركات موظفين — خليهم يشغلوا 😉" /> : (
              <table className="w-full text-sm font-bold">
                <thead><tr className="text-brand-700 border-b border-brand-100"><th className="text-right py-1">الموظف</th><th className="py-1">طلبات اتعاملت</th><th className="py-1">متوسط التحضير</th></tr></thead>
                <tbody>
                  {data.per_staff.map((r, i) => (
                    <tr key={r.email + i} className="border-b border-brand-50">
                      <td className="py-1.5 text-right">{r.full_name || r.email}</td>
                      <td className="text-center">{num(r.orders_handled)}</td>
                      <td className="text-center">{r.avg_prep_minutes != null ? `${num(r.avg_prep_minutes)} دقيقة` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-xs text-brand-700">طلبات اتعاملت = تغييرات حالة سجلها الموظف. متوسط التحضير = من أول استلام لحد «تم الانتهاء».</p>
          </section>

          {/* فوق كل ده: الأكثر مبيعًا */}
          <section className="card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-extrabold text-brand-800">الأكثر مبيعًا (Top 10)</h2>
              <button className="btn-soft !py-1 !px-2 text-xs" onClick={() => downloadCSV(`top-products-${from}_${to}.csv`, toCSV(data.top_products.map((r) => ({ المنتج: r.product, الكمية: r.qty, المبيعات: r.revenue }))))}>CSV ⬇</button>
            </div>
            {data.top_products.length === 0 ? <EmptyBox msg="لسه مفيش مبيعات في الفترة" /> : (
              <ol className="text-sm font-bold space-y-1">
                {data.top_products.map((r, i) => (
                  <li key={r.product + i} className="flex justify-between border-b border-brand-50 py-1">
                    <span>{i + 1}. {r.product}</span>
                    <span className="text-brand-700">{num(r.qty)} · {money(Number(r.revenue))}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}
