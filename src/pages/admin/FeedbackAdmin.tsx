import { useCallback, useEffect, useState } from "react";
import { supabase, type FeedbackRow } from "../../lib/types";
import { fmtFull } from "../../lib/format";
import { Spinner, EmptyBox } from "../../components/Common";

export default function FeedbackAdmin() {
  const [items, setItems] = useState<FeedbackRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("feedback").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) return setErr(error.message);
    setItems((data as FeedbackRow[]) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleRead = async (f: FeedbackRow) => {
    const { error } = await supabase.from("feedback").update({ is_read: !f.is_read }).eq("id", f.id);
    if (error) return setErr(error.message);
    load();
  };

  if (!items) return <Spinner label="بنجيب الآراء… 💌" />;

  return (
    <div className="space-y-4">
      {err && <div className="status-danger border border-danger-text/30 text-danger-text rounded-xl px-3 py-2 text-sm font-bold">{err}</div>}
      <p className="text-sm font-bold text-brand-800">كل رسايل العملاء بتوصل هنا بأمان — خليك رد على اللي سمّوا نفسهم بجمايلك 🌸</p>
      {items.length === 0 && <EmptyBox msg="لسه مفيش آراء — هيتنور بوجودها 💞" />}
      <div className="grid gap-3">
        {items.map((f) => (
          <div key={f.id} className={`card p-4 ${f.is_read ? "opacity-60" : ""}`}>
            <p className="text-sm text-brand-900">{f.message}</p>
            <p className="text-xs text-brand-700 mt-2">
              {f.name ? `👤 ${f.name}` : "👤 بدون اسم"}
              {f.contact ? ` · 📞 ${f.contact}` : ""} · {fmtFull(f.created_at)}
            </p>
            <button className="btn-soft !py-1 !px-2 text-xs mt-2" onClick={() => toggleRead(f)}>
              {f.is_read ? "معناه مقروءة — علّمها غير مقروءة" : "علّمها مقروءة ✅"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
