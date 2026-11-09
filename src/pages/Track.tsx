import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase, type TrackResult, type OrderStatus } from "../lib/types";
import { STATUS, fmtFull } from "../lib/format";
import { Spinner } from "../components/Common";

const STEPS: OrderStatus[] = ["received", "preparing", "done"];

export default function Track() {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<TrackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trackKey, setTrackKey] = useState<string | null>(null);
  const { search } = useLocation();

  // Parse URL for tracking_key param
  useEffect(() => {
    const urlParams = new URLSearchParams(search);
    const parsedKey = urlParams.get("k");
    if (parsedKey) setTrackKey(parsedKey);
  }, [search]);

  const fetchStatus = async (num: string, key?: string | null) => {
    // If we have a key, use the secure RPC; otherwise fall back to legacy (less secure, but works for old orders)
    const rpcName = key ? "track_order_by_key" : "track_order";
    const params = key
      ? { p_order_number: num, p_tracking_key: key }
      : { p_order_number: num };
    const { data, error: e } = await supabase.rpc(rpcName, params);
    if (e) {
      setError("حصلت مشكلة في التتبع — جرّب تاني 🥲");
      return;
    }
    const res = data as unknown as TrackResult;
    if (!res?.ok) setError(res?.message || "مش لاقيين الطلب ده، اتأكد من الرقم 💗");
    else setError(null);
    setResult(res);
  };

  const submit = async () => {
    const num = value.trim().toUpperCase();
    if (!num) return;
    setBusy(true);
    setError(null);
    setResult(null);
    await fetchStatus(num, trackKey);
    setBusy(false);
  };

  // Realtime: نسمع على جدول order_status_public العام لرقم الطلب المحدد
  useEffect(() => {
    const num = result?.ok ? result.order_number : null;
    if (!num) return;
    const ch = supabase
      .channel(`lb-track-${num}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_status_public", filter: `order_number=eq.${num}` },
        (payload) => {
          const row = payload.new as { status: OrderStatus } | null;
          if (row?.status) {
            setResult((prev) =>
              prev?.ok ? { ...prev, status: row.status, updated_at: new Date().toISOString() } : prev
            );
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [result?.ok, result?.order_number]);

  const activeIdx = STEPS.indexOf((result?.status ?? "received") as OrderStatus);

  return (
    <div className="space-y-2.5">
      <h2 className="text-[22px] font-bold text-brand-700 mt-1.5 mb-0">تابع طلبك 📍</h2>

      <div className="card p-3.5">
        <input
          className="input"
          placeholder="رقم الطلب مثال LB-1001"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {trackKey && (
          <p className="text-xs text-mut mt-1">مفتاح التتبع محفوظ — هيتم التحقق تلقائيًا.</p>
        )}
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
            <span className="text-mut text-sm">
              {result.updated_at ? fmtFull(result.updated_at) : ""}
            </span>
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
