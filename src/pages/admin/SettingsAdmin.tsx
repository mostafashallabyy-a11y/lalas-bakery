import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/types";
import { Spinner } from "../../components/Common";

const FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: "instapay_number", label: "رقم انستا باي", hint: "هيظهر للعملاء في صفحة الدفع — لازم يكون صح" },
  { key: "delivery_fee_table", label: "رسوم التقديم للترابيزة (ج.م)", hint: "الافتراضي 5" },
  { key: "delivery_fee_obour", label: "رسوم دليفري داخل العبور (ج.م)", hint: "الافتراضي 50" },
  { key: "cash_accept_timeout_minutes", label: "مهلة قبول طلب الكاش (دقائق)", hint: "الافتراضي 30 — لو الطلب ما اتقبلش خلال المدة يتم إلغاؤه تلقائيًا وإرجاع المخزون" },
  { key: "turnstile_secret", label: "Turnstile Secret Key", hint: "سر — مش بيتبعت للعملاء أبدًا. من Cloudflare > Turnstile (Secret)" },
];

export default function SettingsAdmin() {
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // المدير يشوف كل المفاتيح عن طريق سياسة settings_read_staff + is_staff (لا يشمل anon)
    const { data, error } = await supabase.from("settings").select("key, value").order("key");
    if (error) setErr(error.message);
    else {
      const map: Record<string, string> = {};
      (data as { key: string; value: string }[]).forEach((r) => (map[r.key] = r.value));
      setValues(map);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!values) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    for (const f of FIELDS) {
      const v = (values[f.key] ?? "").trim();
      const { data: existing } = await supabase.from("settings").select("key").eq("key", f.key).maybeSingle();
      const { error } = existing
        ? await supabase.from("settings").update({ value: v }).eq("key", f.key)
        : await supabase.from("settings").insert({ key: f.key, value: v });
      if (error) {
        setErr(error.message);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setOk("اتحفظ ✅ التغييرات بتشتغل فورًا للعملاء");
  };

  if (!values) return <Spinner label="بنجيب الإعدادات…" />;

  return (
    <div className="card p-4 space-y-3">
      {err && <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-3 py-2 text-sm font-bold">{err}</div>}
      {ok && <div className="bg-green-50 border border-green-200 text-green-800 rounded-xl px-3 py-2 text-sm font-bold">{ok}</div>}
      {FIELDS.map((f) => (
        <div key={f.key}>
          <label className="label" htmlFor={f.key}>{f.label}</label>
          <input
            id={f.key}
            className="input"
            dir={f.key === "instapay_number" || f.key === "turnstile_secret" ? "ltr" : "auto"}
            value={values[f.key] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          />
          {f.hint && <p className="text-xs text-brand-700 mt-1">{f.hint}</p>}
        </div>
      ))}
      <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "بيتحفظ… ⏳" : "حفظ كل الإعدادات"}</button>
    </div>
  );
}
