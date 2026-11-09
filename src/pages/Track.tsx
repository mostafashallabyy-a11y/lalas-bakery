import { useEffect, useState } from "react";
import { supabase, type TrackResult, type OrderStatus } from "../lib/types";
import { STATUS, fmtFull } from "../lib/format";
import { Spinner } from "../components/Common";

const STEPS: OrderStatus[] = ["received", "preparing", "done"];

export default function Track() {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<TrackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchStatus = async (num: string) => {
    const { data, error: e } = await supabase.rpc("track_order", { p_order_number: num });
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
    await fetchStatus(num);
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

          {/* خط الحالة الأفقي: 3 خانات وردية، المفعّل يبقى غامق زي النموذج */}
          <div className="flex gap-1.5 my-3">
            {STEPS.map((s, i) => (
              <div key={s} className={`st-step ${i <= activeIdx ? "on" : ""}`}>
                {STATUS[s].label}
              </div>
            ))}
          </div>

          <div className="msg-box">{STATUS[result.status ?? "received"].msg}</div>

          <p className="m-0 mt-3 text-center">
            <button className="text-xs font-bold underline text-brand-800" onClick={() => fetchStatus(result.order_number!)}>
              تحديث يدوي ↺
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
