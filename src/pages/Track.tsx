import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase, type TrackResult, type OrderStatus } from "../lib/types";
import { STATUS, fmtFull, money } from "../lib/format";
import { Spinner } from "../components/Common";

const STEPS: OrderStatus[] = ["received", "preparing", "done"];

type SavedOrder = {
  order_number: string;
  tracking_key?: string;
  branch_name?: string;
  total?: number;
  date?: string;
  status?: OrderStatus;
};

export default function Track() {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<TrackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trackKey, setTrackKey] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedOrder[]>([]);
  const { search } = useLocation();

  // Load saved orders + URL key
  useEffect(() => {
    const urlParams = new URLSearchParams(search);
    const parsedKey = urlParams.get("k");
    if (parsedKey) setTrackKey(parsedKey);
    try {
      const raw = localStorage.getItem("my_orders");
      if (raw) setSaved(JSON.parse(raw));
    } catch {}
  }, [search]);

  // Fetch live status for saved orders
  useEffect(() => {
    if (!saved.length) return;
    let cancelled = false;
    (async () => {
      const updated = await Promise.all(
        saved.map(async (o) => {
          try {
            if (o.tracking_key) {
              const { data } = await supabase.rpc("track_order_by_key", {
                p_order_number: o.order_number,
                p_tracking_key: o.tracking_key,
              });
              const r = data as TrackResult | null;
              if (r?.ok && r.status) return { ...o, status: r.status };
            } else {
              const { data } = await supabase.rpc("track_order", { p_order_number: o.order_number });
              const r = data as TrackResult | null;
              if (r?.ok && r.status) return { ...o, status: r.status };
            }
          } catch {}
          return o;
        })
      );
      if (!cancelled) setSaved(updated);
    })();
    return () => { cancelled = true; };
  }, [saved.length]); // refresh when count changes / on mount

  // Realtime for all saved order numbers
  useEffect(() => {
    if (!saved.length) return;
    const channels = saved.map((o) =>
      supabase
        .channel(`lb-my-${o.order_number}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "order_status_public", filter: `order_number=eq.${o.order_number}` },
          (payload) => {
            const row = payload.new as { status: OrderStatus } | null;
            if (row?.status) {
              setSaved((prev) => prev.map((p) => (p.order_number === o.order_number ? { ...p, status: row.status } : p)));
            }
          }
        )
        .subscribe()
    );
    return () => { channels.forEach((ch) => supabase.removeChannel(ch)); };
  }, [saved.map((s) => s.order_number).join("|")]);

  const fetchStatus = async (num: string, key?: string | null) => {
    const rpcName = key ? "track_order_by_key" : "track_order";
    const params = key ? { p_order_number: num, p_tracking_key: key } : { p_order_number: num };
    const { data, error: e } = await supabase.rpc(rpcName, params);
    if (e) { setError("حصلت مشكلة في التتبع — جرّب تاني 🥲"); return; }
    const res = data as unknown as TrackResult;
    if (!res?.ok) setError(res?.message || "مش لاقيين الطلب ده، اتأكد من الرقم 💗");
    else setError(null);
    setResult(res);
  };

  const submit = async () => {
    const num = value.trim().toUpperCase();
    if (!num) return;
    setBusy(true); setError(null); setResult(null);
    await fetchStatus(num, trackKey);
    setBusy(false);
  };

  const openSaved = (o: SavedOrder) => {
    setValue(o.order_number);
    setTrackKey(o.tracking_key || null);
    setResult(null); setError(null);
    fetchStatus(o.order_number, o.tracking_key || null);
  };

  // Realtime for manual result
  useEffect(() => {
    const num = result?.ok ? result.order_number : null;
    if (!num) return;
    const ch = supabase
      .channel(`lb-track-${num}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_status_public", filter: `order_number=eq.${num}` },
        (payload) => {
          const row = payload.new as { status: OrderStatus } | null;
          if (row?.status) setResult((prev) => (prev?.ok ? { ...prev, status: row.status, updated_at: new Date().toISOString() } : prev));
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [result?.ok, result?.order_number]);

  const activeIdx = STEPS.indexOf((result?.status ?? "received") as OrderStatus);

  return (
    <div className="space-y-2.5">
      <h2 className="text-[22px] font-bold text-brand-700 mt-1.5 mb-0">طلباتي / تابع طلبك 📍</h2>

      {saved.length > 0 && (
        <div className="card p-3.5">
          <b className="text-brand-900">طلباتي المحفوظة</b>
          <div className="mt-2 space-y-2">
            {saved.map((o) => (
              <div key={o.order_number} className="flex items-center justify-between gap-2 border border-brand-100 rounded-xl p-2.5">
                <div className="min-w-0">
                  <div className="font-bold text-brand-800">{o.order_number}</div>
                  <div className="text-xs text-mut truncate">
                    {[o.branch_name, o.total != null ? money(o.total) : null].filter(Boolean).join(" · ")}
                  </div>
                  {o.status && <div className="text-xs mt-0.5">{STATUS[o.status].emoji} {STATUS[o.status].label}</div>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button className="btn-outline !px-2 !py-1 text-xs" onClick={() => openSaved(o)}>تابع</button>
                  <Link className="btn-primary !px-2 !py-1 text-xs" to={`/order/${o.order_number}${o.tracking_key ? `?k=${o.tracking_key}` : ""}`}>فتح</Link>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-mut mt-2">الطلبات المحفوظة على هذا الجهاز فقط. رابط المتابعة الكامل يحفظ طلبك.</p>
        </div>
      )}

      <div className="card p-3.5">
        <b className="text-brand-900 block mb-1.5">تتبع برقم الطلب</b>
        <input
          className="input"
          placeholder="رقم الطلب مثال LB-1001"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {trackKey && <p className="text-xs text-mut mt-1">مفتاح التتبع محفوظ — هيتم التحقق تلقائيًا.</p>}
        <button className="btn-primary mt-1.5" onClick={submit} disabled={busy}>
          {busy ? "…" : "تابع"}
        </button>
      </div>

      {busy && !result?.ok && <Spinner label="بندور على طلبك… 📍" />}
      {error && <div className="card p-3.5 text-brand-900">{error}</div>}

      {result?.ok && (
        <div className="card p-3.5">
          <div className="flex items-center justify-between text-brand-900">
            <b>{result.order_number}</b>
            <span className="text-mut text-sm">{result.updated_at ? fmtFull(result.updated_at) : ""}</span>
          </div>
          <div className="flex gap-1.5 my-3">
            {STEPS.map((s, i) => (
              <div key={s} className={`st-step ${i <= activeIdx ? "on" : ""}`}>{STATUS[s].label}</div>
            ))}
          </div>
          <div className="msg-box">{STATUS[result.status ?? "received"].msg}</div>
          <p className="m-0 mt-3 text-center">
            <button className="text-xs font-bold underline text-brand-800" onClick={() => fetchStatus(result.order_number!, trackKey)}>تحديث يدوي ↺</button>
          </p>
        </div>
      )}
    </div>
  );
}
