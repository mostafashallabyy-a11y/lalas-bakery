import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase, withTimeout, type TrackResult, type OrderStatus } from "../lib/types";
import { STATUS, fmtFull, money } from "../lib/format";
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
  const [trackKey, setTrackKey] = useState("");
  const [result, setResult] = useState<TrackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedOrder[]>([]);
  const { search } = useLocation();

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
    const parsedKey = new URLSearchParams(search).get("k");
    if (parsedKey) setTrackKey(parsedKey);
  }, [search]);

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

  const fetchStatus = async (num: string, key: string) => {
    if (!num || !key) { setError("رقم الطلب ومفتاح التتبع المطلوبان."); return; }
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await withTimeout<TrackResult>(
      supabase.rpc("track_order_by_key", { p_order_number: num, p_tracking_key: key }),
      15000
    );
    setBusy(false);
    const resData = res?.data as unknown as TrackResult;
    if (!resData?.ok) setError(resData?.message || res?.error?.message || "مش لاقيين الطلب ده، تأكد من الرقم ومفتاح المتابعة 💗");
    else { setError(null); setResult(resData); }
  };

  const submit = () => {
    const num = value.trim().toUpperCase();
    const key = trackKey.trim();
    if (!num || !key) return;
    fetchStatus(num, key);
  };

  const openSaved = (o: SavedOrder) => {
    setValue(o.order_number);
    setTrackKey(o.tracking_key);
    setResult(null);
    setError(null);
    fetchStatus(o.order_number, o.tracking_key);
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
                  <button className="btn-outline !px-2 !py-1 text-xs" onClick={() => openSaved(o)}>تابع</button>
                  <Link className="btn-primary !px-2 !py-1 text-xs" to={`/order/${o.order_number}?k=${o.tracking_key}`}>فتح</Link>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">الطلبات محفوظة على هذا الجهاز فقط (الرقم + مفتاح المتابعة). لا تُجلب قائمة الطلبات من الخادم أبدًا.</p>
        </div>
      )}

      <div className="card p-3.5">
        <b className="mb-1.5 block text-text">تتبع برقم الطلب + مفتاح التتبع</b>
        <div className="space-y-2">
          <input className="input" placeholder="رقم الطلب مثال LB-1001" value={value} onChange={(e) => setValue(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && submit()} aria-label="رقم الطلب" />
          <input className="input" placeholder="مفتاح التتبع (من رابط الطلب)" value={trackKey} onChange={(e) => setTrackKey(e.target.value)} aria-label="مفتاح التتبع" />
          <button className="btn-primary mt-1.5" disabled={busy || !value || !trackKey} onClick={submit}>{busy ? "…" : "تابع"}</button>
        </div>
        <p className="mt-1 text-xs text-muted">الرقم وحده لا يكفي — لازم معاه مفتاح التتبع اللي اتصل مع رقم طلبك.</p>
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
          <p className="m-0 mt-3 text-center">
            <button className="rounded text-xs font-bold text-primary-strong underline underline-offset-2 outline-none transition hover:opacity-75 focus-visible:ring-2 focus-visible:ring-ring" onClick={() => fetchStatus(result.order_number!, trackKey)}>تحديث يدوي ↺</button>
          </p>
        </div>
      )}
    </div>
  );
}
