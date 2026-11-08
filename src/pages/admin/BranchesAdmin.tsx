import { useCallback, useEffect, useState } from "react";
import { supabase, type Branch } from "../../lib/types";
import { Spinner, EmptyBox } from "../../components/Common";

export default function BranchesAdmin() {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // نموذج إضافة/تعديل
  const [editing, setEditing] = useState<Branch | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [servicesText, setServicesText] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    const { data, error } = await supabase.from("branches").select("*").order("sort_order");
    setBusy(false);
    if (error) setErr(error.message);
    else setBranches((data as Branch[]) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (b?: Branch) => {
    if (b) {
      setEditing(b);
      setName(b.name);
      setDescription(b.description);
      setServices(b.services || []);
      setServicesText((b.services || []).join("،"));
      setSortOrder(b.sort_order);
      setIsActive(b.is_active);
    } else {
      setEditing({ id: "", name: "", description: "", services: [], is_active: true, sort_order: 0 });
      setName("");
      setDescription("");
      setServices([]);
      setServicesText("");
      setSortOrder(0);
      setIsActive(true);
    }
  };

  const save = async () => {
    setErr(null);
    const row = {
      name: name.trim(),
      description: description.trim().slice(0, 300),
      services: services.map((s) => s.trim()).filter(Boolean).slice(0, 8),
      sort_order: Number(sortOrder) || 0,
      is_active: isActive,
    };
    if (row.name.length < 2) return setErr("اسم الفرع قصير زيادة (حرفين على الأقل)");
    setBusy(true);
    try {
      if (editing?.id) {
        const { error } = await supabase.from("branches").update(row).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("branches").insert(row);
        if (error) throw error;
      }
      setEditing(null);
      await load();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!branches) return <Spinner />;
  if (busy && !editing) return <Spinner label="بيتم الإجراء…" />;

  return (
    <div className="space-y-4 pb-24">
      {err && <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-3 py-2 text-sm font-bold">{err}</div>}

      {editing ? (
        <div className="card p-4 space-y-3">
          <h2 className="font-extrabold text-brand-800">{editing.id ? "تعديل الفرع" : "إضافة فرع جديد"}</h2>
          <div>
            <label className="label">الاسم</label>
            <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">الوصف القصير</label>
            <textarea className="input" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="label">الخدمات (افصلها بكمّة)</label>
            <input className="input" value={servicesText} onChange={(e) => setServicesText(e.target.value)} placeholder="دليفري، جلسات هادية، واي فاي" />
          </div>
          <div className="flex items-center gap-4">
            <div>
              <label className="label">ترتيب الظهور</label>
              <input className="input w-24" type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
            </div>
            <label className="flex items-center gap-2 pt-5 font-bold text-brand-900 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="accent-brand-500" />
              زيارة العميل للفرع مسموحة (ظاهر)
            </label>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy} onClick={save}>حفظ</button>
            <button className="btn-soft" onClick={() => setEditing(null)}>إلغاء</button>
          </div>
        </div>
      ) : (
        <button className="btn-primary" onClick={() => startEdit()}>+ فرع جديد</button>
      )}

      {branches.length === 0 && <EmptyBox msg="لسه مفيش فروع" />}
      <div className="grid gap-3">
        {branches.map((b) => (
          <div key={b.id} className="card p-4 flex items-start justify-between gap-3">
            <div>
              <p className="font-extrabold text-brand-800">{b.name} {!b.is_active && <span className="pill bg-amber-100 text-amber-800">مخفي</span>}</p>
              <p className="text-xs text-brand-800">{b.description}</p>
              <p className="text-xs text-brand-700 mt-1">{(b.services || []).join(" · ")}</p>
            </div>
            <button className="btn-soft !py-1.5 !px-3 text-xs shrink-0" onClick={() => startEdit(b)}>تعديل</button>
          </div>
        ))}
      </div>
      <p className="text-xs text-brand-700 font-bold">
        ملاحظة أمان: الفرع اللي عليه طلبات مش بيتمسح نهائيًا (تحذير أخطاء) — استخدم "إخفاء" بدلًا من الحذف.
      </p>
    </div>
  );
}
