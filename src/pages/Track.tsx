import { useEffect, useState } from "react";
import { supabase, type TrackResult, type OrderStatus } from "../lib/types";
import { STATUS, fmtFull } from "../lib/format";
import { ErrorBox } from "../components/Common";

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
    setResult(res);
    if (!res?.ok) setError(res?.message || "مش لاقيين رقم الطلب ده");
    if (res?.ok) setError(null);
  };

  const submit = async () => {
    const num = value.trim().toUpperCase();
    if (!/^LB-\d+$/i.test(num)) {
      setError("اكتب رقم الطلب بالظبط زي: LB-1001");
      return;
    }
    setBusy(true);
    setError(null);
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
    <div className="py-4 space-y-4">
      <h1 className="text-xl font-extrabold text-brand-700 text-center">وين الطلب؟ 👀</h1>
      <div className="flex gap-2">
        <input
          className="input"
          placeholder="LB-1001"
          dir="ltr"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button className="btn-primary shrink-0" onClick={submit} disabled={busy}>
          {busy ? "…" : "تتبّع 🔍"}
        </button>
      </div>
      {error && <ErrorBox msg={error} />}

      {result?.ok && (
        <div className="card p-5 space-y-3">
          <p className="text-center font-extrabold text-brand-600 text-xl" dir="ltr">
            {result.order_number}
          </p>
          <p className="text-center text-xs text-brand-700">
            آخر تحديث: {result.updated_at ? fmtFull(result.updated_at) : "الآن"}
          </p>
          <ol className="relative space-y-4 border-r-2 border-brand-200 pr-5 pt-1">
            {STEPS.map((s, i) => {
              const active = i <= activeIdx;
              const meta = STATUS[s];
              return (
                <li key={s} className="relative">
                  <span
                    className={`absolute -right-[27px] w-9 h-9 rounded-full flex items-center justify-center text-lg border-2 ${
                      active ? "bg-brand-500 text-white border-brand-500" : "bg-white border-brand-200 text-brand-300"
                    }`}
                  >
                    {meta.emoji}
                  </span>
                  <p className={`font-extrabold ${active ? "text-brand-700" : "text-brand-400"}`}>{meta.label}</p>
                  {i === activeIdx && <p className="text-sm text-brand-800 mt-1">{meta.msg}</p>}
                </li>
              );
            })}
          </ol>
          <button
            className="text-xs font-bold text-brand-800 underline mx-auto block"
            onClick={() => fetchStatus(result.order_number!)}
          >
            تحديث يدوي ↺
          </button>
        </div>
      )}
    </div>
  );
}
