import { useCallback, useEffect, useState } from "react";
import { supabase, type Profile } from "../../lib/types";
import { fmtFull } from "../../lib/format";
import { Spinner, EmptyBox } from "../../components/Common";

export default function StaffAdmin() {
  const [staff, setStaff] = useState<Profile[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const { data, error } = await supabase.from("profiles").select("*").order("created_at");
    setBusy(false);
    if (error) return setErr(error.message);
    setStaff((data as Profile[]) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (p: Profile) => {
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ is_active: !p.is_active }).eq("id", p.id);
    setBusy(false);
    if (error) return setErr(error.message);
    load();
  };

  const setRole = async (p: Profile, role: "staff" | "manager") => {
    if (role === "manager" && !confirm("ترقية الزمولة لمدير؟ هياخد كل الصلاحيات بما فيها الأسعار والإعدادات.")) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ role }).eq("id", p.id);
    setBusy(false);
    if (error) return setErr(error.message);
    load();
  };

  const rename = async (p: Profile) => {
    const v = prompt("اسم الزمولة كما سيظهر في السجل:", p.full_name);
    if (v === null) return;
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ full_name: v.trim().slice(0, 60) }).eq("id", p.id);
    setBusy(false);
    if (error) return setErr(error.message);
    load();
  };

  if (!staff) return <Spinner />;
  if (busy) return <Spinner label="بيتنفذ…" />;

  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm text-brand-800 font-bold space-y-2 bg-brand-50">
        <p>لإنشاء حساب زميل جديد (بأمان تام):</p>
        <ol className="list-decimal pr-5 space-y-1">
          <li>من لوحة Supabase: Authentication → Users → <b>Add user</b> (البريد + باسورد مؤقت).</li>
          <li>ارجع هنا → هتلاقيه ظهر باسم "بانتظار التفعيل" → فعّله وزوّد اسمه.</li>
        </ol>
        <p className="text-xs">مفيش دالة إنشاء حسابات من الموقع كله، عشان مفتاح الـ service_role ميتوفرش في المتصفح أبدًا 🔒</p>
      </div>

      {err && <div className="status-danger border border-danger-text/30 text-danger-text rounded-xl px-3 py-2 text-sm font-bold">{err}</div>}
      {staff.length === 0 && <EmptyBox msg="لسه مفيش حسابات موظفين" />}

      <div className="grid gap-3">
        {staff.map((p) => (
          <div key={p.id} className="card p-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-extrabold text-brand-900">
                {p.full_name || "(بدون اسم)"}{" "}
                <span dir="ltr" className="text-xs font-bold text-brand-700">{p.email}</span>
              </p>
              <p className="text-xs text-brand-700">
                {p.role === "manager" ? "👑 مدير" : "🧑‍🍳 موظف"} · انضم {fmtFull(p.created_at)} ·{" "}
                {p.is_active ? "مفعّل ✅" : "بانتظار التفعيل ⏳"}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <button className="btn-soft !py-1 !px-2" onClick={() => rename(p)}>تعديل الاسم</button>
              <button className="btn-soft !py-1 !px-2" onClick={() => toggleActive(p)}>
                {p.is_active ? "إيقاف الحساب" : "تفعيل"}
              </button>
              {p.role === "staff" ? (
                <button className="pill status-warn text-warn-text" onClick={() => setRole(p, "manager")}>ترقية لمدير</button>
              ) : (
                <button className="pill bg-surface border border-border" onClick={() => setRole(p, "staff")}>تخفيض لموظف</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
