import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, withTimeout, type TrackResult, type OrderStatus } from "../lib/types";
import { STATUS, fmtFull, money, normalizeEgyptianPhone, isValidEgyptianPhone } from "../lib/format";
import { Spinner } from "../components/Common";

const STEPS: OrderStatus[] = ["received", "preparing", "done"];

type SavedOrder = {
  order_number: string;
  tracking_key: string;
  branch_name?: string;
  total?: number;
  date?: string;
  status?: OrderStatus;
  payment_method?: "cash" | "instapay";
  payment_status?: string;
};

export default function Track() {
  const [value, setValue] = useState("");
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<TrackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedOrder[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("my_orders");
      if (raw) {
        const parsed = JSON.parse(raw) as SavedOrder[];
        setSaved(parsed.filter((o) => o.order_number && o.tracking_key));
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!saved.length) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      await Promise.all(
        saved.map(async (o) => {
          try {
            const res = await withTimeout<TrackResult>(
              supabase.rpc("track_order_by_key", { p_order_number: o.order_number, p_tracking_key: o.tracking_key }),
              10000
            );
            const r = res?.data as TrackResult | null;
            if (!cancelled && r?.ok) {
              setSaved((prev) => prev.map((p) => (p.order_number === o.order_number ? { ...p, status: r.status, payment_method: r.payment_method, payment_status: r.payment_status } : p)));
            }
          } catch {}
        })
      );
    }, 60000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [saved]);

  const fetchSavedStatus = async (o: SavedOrder) => {
    if (!o.order_number || !o.tracking_key) { setError("رقم الطلب مش مكتمل."); return; }
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await withTimeout<TrackResult>(
      supabase.rpc("track_order_by_key", { p_order_number: o.order_number, p_tracking_key: o.tracking_key }),
      15000
    );
    setBusy(false);
    const resData = res?.data as unknown as TrackResult;
    if (!resData?.ok) setError("مش لاقيين الطلب ده — جرّب من جديد");
    else { setError(null); setResult(resData); }
  };

  const fetchByPhone = async () => {
    const num = value.trim().toUpperCase();
    const normalized = normalizeEgyptianPhone(phone);
    if (!num || !isValidEgyptianPhone(normalized)) {
      setError("اكتب رقم الطلب والموبايل الصحيح (01x xxxxxxxx).");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await withTimeout<TrackResult>(
      supabase.rpc("track_order_by_phone", { p_order_number: num, p_phone: normalized }),
      15000
    );
    setBusy(false);
    const resData = res?.data as unknown as TrackResult;
    if (!resData?.ok) setError("مش لاقيين الطلب، راجع الرقم");
    else { setError(null); setResult(resData); }
  };

  const activeIdx = STEPS.indexOf((result?.status ?? "received") as OrderStatus);

  const paymentBadge = (method?: string, status?: string) => {
    if (!method) return null;
    const pending = status !== "paid" && status !== "rejected";
    const rejected = status === "rejected";
    const cls = rejected ? "status-danger" : pending ? "status-warn" : "status-ok";
    const text = rejected
      ? "تم رفض إثبات التحويل — تواصل مع الفرع"
      : method === "cash"
        ? status === "paid"
          ? "تم استلام الكاش ✅"
          : "هتدفع كاش وقت الاستلام 💵"
        : status === "paid"
          ? "تم تأكيد التحويل ✅"
          : "في انتظار تأكيد التحويل 📲";
    return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-bold ${cls}`}>{text}</span>;
  };

  return (
    <div className="space-y-3">
      <h1 className="mt-1.5 text-[21px] font-extrabold text-text">طلباتي / تابع طلبك</h1>

      {saved.length > 0 && (
        <div className="card p-3.5">
          <b className="text-text">طلباتي المحفوظة (هذا الجهاز فقط)</b>
          <div className="mt-2 space-y-2">
            {saved.map((o) => (
              <div key={o.order_number} className="flex items-center justify-between gap-2 rounded-xl border border-border p-2.5">
                <div className="min-w-0">
                  <div className="font-bold text-text" dir="ltr">{o.order_number}</div>
                  <div className="truncate text-xs text-muted">{[o.branch_name, o.total != null ? money(o.total) : null].filter(Boolean).join(" · ")}</div>
                  {o.status && <div className="mt-0.5 text-xs font-bold text-text">{STATUS[o.status].emoji} {STATUS[o.status].label}</div>}
                  {o.payment_method && (
                    <div className="mt-1">{paymentBadge(o.payment_method, o.payment_status)}</div>
                  )}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button className="btn-outline !px-2 !py-1 text-xs" onClick={() => fetchSavedStatus(o)}>تابع</button>
                  <Link className="btn-primary !px-2 !py-1 text-xs" to={`/order/${o.order_number}?k=${o.tracking_key}`}>فتح</Link>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">الطلبات محفوظة على هذا الجهاز فقط. لا تُجلب قائمة الطلبات من الخادم أبدًا.</p>
        </div>
      )}

      <div className="card p-3.5">
        <b className="mb-1.5 block text-text">تتبع طلبك من أي جهاز</b>
        <div className="space-y-2">
          <input className="input" placeholder="رقم الطلب مثال LB-1001" value={value} onChange={(e) => setValue(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && fetchByPhone()} aria-label="رقم الطلب" inputMode="text" autoComplete="off" />
          <input className="input" placeholder="رقم الموبايل اللي طلبت بيه" value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => e.key === "Enter" && fetchByPhone()} aria-label="رقم الموبايل" dir="ltr" inputMode="tel" autoComplete="tel" />
          <button className="btn-primary mt-1.5" disabled={busy || !value || !isValidEgyptianPhone(normalizeEgyptianPhone(phone))} onClick={fetchByPhone}>{busy ? "…" : "تابع"}</button>
        </div>
        <p className="mt-1 text-xs text-muted">رقم الطلب والموبايل اللي طلبت بيه — مفيش أي مفتاح طويل محتاج تكتبه 💗</p>
      </div>

      {busy && !result?.ok && <Spinner label="بندور على طلبك…" />}
      {error && <div className="msg-box">{error}</div>}

      {result?.ok && (
        <div className="card p-3.5">
          <div className="flex items-center justify-between text-text">
            <b dir="ltr">{result.order_number}</b>
            <span className="text-sm text-muted">{result.updated_at ? fmtFull(result.updated_at) : ""}</span>
          </div>
          <div className="my-3 flex gap-1.5" role="list" aria-label="خطوات تحضير الطلب">
            {STEPS.map((s, i) => {
              const done = result.status === "done" || i < activeIdx;
              const current = result.status !== "done" && i === activeIdx;
              return (
                <div key={s} role="listitem" className={`st-step ${done ? "done" : current ? "on" : ""}`}>
                  {STATUS[s].label}
                </div>
              );
            })}
          </div>
          <div className="msg-box">{STATUS[result.status ?? "received"].msg}</div>
          {paymentBadge(result.payment_method, result.payment_status) && (
            <div className="mt-2">{paymentBadge(result.payment_method, result.payment_status)}</div>
          )}
          <p className="m-0 mt-3 text-center text-xs text-muted">تم استلام الطلب ← جاري التحضير ← تم الانتهاء 💗</p>
        </div>
      )}
    </div>
  );
}
