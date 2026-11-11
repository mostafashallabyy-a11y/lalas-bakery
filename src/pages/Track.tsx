import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase, withTimeout, type TrackResult, type OrderStatus } from "../lib/types";
import { STATUS, fmtFull, money } from "../lib/format";
import { Spinner } from "../components/Common";

const STEPS: OrderStatus[] = ["received", "preparing", "done"];

type SavedOrder = {
  order_number: string;
  tracking_key: string; // required — never stored without it
  branch_name?: string;
  total?: number;
  date?: string;
  status?: OrderStatus;
};

export default function Track() {
  const [value, setValue] = useState("");
  const [trackKey, setTrackKey] = useState("");
  const [result, setResult] = useState<TrackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedOrder[]>([]);
  const { search } = useLocation();

  // "طلباتي" lists ONLY orders saved on THIS device in localStorage (number + key).
  // It never queries a list of orders from the server.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("my_orders");
      if (raw) {
        const parsed = JSON.parse(raw) as SavedOrder[];
        // keep only entries that have both number and key
        setSaved(
          parsed.filter((o) => o.order_number && o.tracking_key)
        );
      }
    } catch {}
  }, []);

  // URL key prefill (when opening a shared tracking link)
  useEffect(() => {
    const parsedKey = new URLSearchParams(search).get("k");
    if (parsedKey) setTrackKey(parsedKey);
  }, [search]);

  // Refresh status of saved orders via the authorized RPC (per order, needs number + key).
  // Short polling — never subscribes to the whole orders table.
  useEffect(() => {
    if (!saved.length) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      await Promise.all(
        saved.map(async (o) => {
          try {
            const res = await withTimeout<TrackResult>(
              supabase.rpc("track_order_by_key", {
                p_order_number: o.order_number,
                p_tracking_key: o.tracking_key,
              }),
              10000
            );
            const r = res?.data as TrackResult | null;
            if (!cancelled && r?.ok && r.status) {
              setSaved((prev) => prev.map((p) => (p.order_number === o.order_number ? { ...p, status: r.status } : p)));
            }
          } catch {}
        })
      );
    }, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [saved]);

  const fetchStatus = async (num: string, key: string) => {
    if (!num || !key) {
      setError("رقم الطلب ومفتاح التتبع المطلوبان.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await withTimeout<TrackResult>(
      supabase.rpc("track_order_by_key", {
        p_order_number: num,
        p_tracking_key: key,
      }),
      15000
    );
    setBusy(false);
    const resData = res?.data as unknown as TrackResult;
    if (!resData?.ok) {
      setError(resData?.message || "مش لاقيين الطلب ده، تأكد من الرقم ومفتاح المتابعة 💗");
    } else {
      setError(null);
      setResult(resData);
    }
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

  return (
    <div className="space-y-2.5">
      <h2 className="text-[22px] font-bold text-brand-700 mt-1.5 mb-0">طلباتي / تابع طلبك 📍</h2>

      {saved.length > 0 && (
        <div className="card p-3.5">
          <b className="text-brand-900">طلباتي المحفوظة (هذا الجهاز فقط)</b>
          <div className="mt-2 space-y-2">
            {saved.map((o) => (
              <div key={o.order_number} className="flex items-center justify-between gap-2 border border-brand-100 rounded-xl p-2.5">
                <div className="min-w-0">
                  <div className="font-bold text-brand-800" dir="ltr">{o.order_number}</div>
                  <div className="text-xs text-mut truncate">
                    {[o.branch_name, o.total != null ? money(o.total) : null].filter(Boolean).join(" · ")
                    }
                  </div>
                  {o.status && <div className="text-xs mt-0.5">{STATUS[o.status].emoji} {STATUS[o.status].label}</div>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button className="btn-outline !px-2 !py-1 text-xs" onClick={() => openSaved(o)}>
                    تابع
                  </button>
                  <Link
                    className="btn-primary !px-2 !py-1 text-xs"
                    to={`/order/${o.order_number}?k=${o.tracking_key}`}
                  >
                    فتح
                  </Link>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-mut mt-2">
            الطلبات محفوظة على هذا الجهاز فقط (الرقم + مفتاح المتابعة). لا تُجلب قائمة الطلبات من الخادم أبدًا.
          </p>
        </div>
      )}

      <div className="card p-3.5">
        <b className="text-brand-900 block mb-1.5">تتبع برقم الطلب + مفتاح التتبع</b>
        <div className="space-y-2">
          <input
            className="input"
            placeholder="رقم الطلب مثال LB-1001"
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <input
            className="input"
            placeholder="مفتاح التتبع (من رابط الطلب)"
            value={trackKey}
            onChange={(e) => setTrackKey(e.target.value)}
          />
          <button className="btn-primary mt-1.5" disabled={busy || !value || !trackKey} onClick={submit}>
            {busy ? "…" : "تابع"}
          </button>
        </div>
        <p className="text-xs text-mut mt-1">
          الرقم وحده لا يكفي — لازم معاه مفتاح التتبع اللي اتصل مع رقم طلبك.
        </p>
      </div>

      {busy && !result?.ok && <Spinner label="بندور على طلبك… 📍" />}
      {error && <div className="card p-3.5 text-brand-900">{error}</div>}

      {result?.ok && (
        <div className="card p-3.5">
          <div className="flex items-center justify-between text-brand-900">
            <b dir="ltr">{result.order_number}</b>
            <span className="text-mut text-sm">{result.updated_at ? fmtFull(result.updated_at) : ""}</span>
          </div>
          <div className="flex gap-1.5 my-3">
            {STEPS.map((s, i) => (
              <div key={s} className={`st-step ${i <= activeIdx ? "on" : ""}`}>
                {STATUS[s].label}
              </div>
            ))}
          </div>
          <div className="msg-box">{STATUS[result.status ?? "received"].msg}</div>
          <p className="m-0 mt-3 text-center">
            <button className="text-xs font-bold underline text-brand-800" onClick={() => fetchStatus(result.order_number!, trackKey)}>
              تحديث يدوي ↺
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
