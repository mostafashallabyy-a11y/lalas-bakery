import { useCallback, useEffect, useState } from "react";
import { supabase, type Branch } from "../../lib/types";
import { Spinner, EmptyBox } from "../../components/Common";
import { compressImage } from "../../lib/image";
import { randomId } from "../../lib/random";

const DEFAULT_FLOORS = ["الأرضي", "1", "2", "3", "4", "5"];

export default function BranchesAdmin() {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState<Branch | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [promoBrief, setPromoBrief] = useState("");
  const [servicesText, setServicesText] = useState("");
  const [logo, setLogo] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [cashEnabled, setCashEnabled] = useState(true);
  const [cashMaxAmount, setCashMaxAmount] = useState(500);
  const [deliveryFloorsText, setDeliveryFloorsText] = useState(DEFAULT_FLOORS.join("، "));
  // Part 5: Obour controls
  const [obourEnabled, setObourEnabled] = useState(true);
  const [obourFee, setObourFee] = useState(50);
  const [obourHoursEnabled, setObourHoursEnabled] = useState(false);
  const [obourFrom, setObourFrom] = useState("09:00");
  const [obourTo, setObourTo] = useState("22:00");
  const [obourWhatsapp, setObourWhatsapp] = useState("");
  const [obourTemplate, setObourTemplate] = useState("مرحبًا، أنا {name}. رقم الطلب: {order_number}\nالعنوان: {address}\nهبعت اللوكيشن دلوقتي 📍");
  const [obourClosedMsg, setObourClosedMsg] = useState("التوصيل داخل العبور غير متاح حاليًا 💗 تقدر تستلم من الفرع أو نوصّلك لحد مكانك جوه الفرع");
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const { data, error } = await supabase.from("branches").select("*").order("sort_order");
    setBusy(false);
    if (error) setErr(error.message);
    else setBranches((data as Branch[]) ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (b?: Branch) => {
    if (b) {
      setEditing(b);
      setName(b.name);
      setDescription(b.description || "");
      setPromoBrief(b.promo_brief || "");
      setServicesText((b.services || []).join("،"));
      setLogo(b.logo || "");
      setCoverImage(b.cover_image || "");
      setSortOrder(b.sort_order || 0);
      setIsActive(b.is_active !== false);
      setCashEnabled(b.cash_enabled !== false);
      setCashMaxAmount(Number(b.cash_max_amount ?? 500));
      const floors = Array.isArray(b.delivery_floors) && b.delivery_floors.length ? b.delivery_floors : DEFAULT_FLOORS;
      setDeliveryFloorsText(floors.join("، "));
      setObourEnabled(b.obour_enabled !== false);
      setObourFee(Number(b.obour_fee ?? 50));
      setObourHoursEnabled(!!(b.obour_hours as any)?.enabled);
      setObourFrom(((b.obour_hours as any)?.from) || "09:00");
      setObourTo(((b.obour_hours as any)?.to) || "22:00");
      setObourWhatsapp(b.obour_whatsapp || "");
      setObourTemplate(b.obour_whatsapp_template || "مرحبًا، أنا {name}. رقم الطلب: {order_number}\nالعنوان: {address}\nهبعت اللوكيشن دلوقتي 📍");
      setObourClosedMsg(b.obour_closed_message || "التوصيل داخل العبور غير متاح حاليًا 💗 تقدر تستلم من الفرع أو نوصّلك لحد مكانك جوه الفرع");
    } else {
      setEditing({ id: "", name: "", description: "", services: [], is_active: true, sort_order: 0, logo: "", cover_image: "", promo_brief: "" } as any);
      setName(""); setDescription(""); setPromoBrief(""); setServicesText(""); setLogo(""); setCoverImage("");
      setSortOrder(0); setIsActive(true); setCashEnabled(true); setCashMaxAmount(500);
      setDeliveryFloorsText(DEFAULT_FLOORS.join("، "));
      setObourEnabled(true); setObourFee(50); setObourHoursEnabled(false); setObourFrom("09:00"); setObourTo("22:00");
      setObourWhatsapp(""); setObourTemplate("مرحبًا، أنا {name}. رقم الطلب: {order_number}\nالعنوان: {address}\nهبعت اللوكيشن دلوقتي 📍");
      setObourClosedMsg("التوصيل داخل العبور غير متاح حاليًا 💗 تقدر تستلم من الفرع أو نوصّلك لحد مكانك جوه الفرع");
    }
  };

  const uploadBranchImage = async (file: File, bucket: "product-images" | "branch-images") => {
    if (!file) return "";
    setUploading(true); setErr(null);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      if (!["jpg", "jpeg", "png", "webp"].includes(ext)) throw new Error("صيغة الصورة مش مدعومة — استخدم jpg/png/webp");
      if (file.size > 3 * 1024 * 1024) throw new Error("الصورة أكبر من 3 ميجابايت");
      const compressed = await compressImage(file, { maxWidth: 1000, quality: 0.85 });
      const path = `${bucket}/${randomId()}.${ext}`;
      const { error } = await supabase.storage.from(bucket).upload(path, compressed, { contentType: compressed.type, upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      return data.publicUrl;
    } catch (e: unknown) { setErr((e as Error).message); return ""; }
    finally { setUploading(false); }
  };

  const save = async () => {
    setErr(null);
    const floors = deliveryFloorsText.split(/[،,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 30);
    const finalFloors = floors.length ? floors : DEFAULT_FLOORS;
    const row: any = {
      name: name.trim(), description: description.trim().slice(0, 300), promo_brief: promoBrief.trim().slice(0, 200),
      services: servicesText.split(/[،,]/).map((s) => s.trim()).filter(Boolean).slice(0, 8),
      sort_order: Number(sortOrder) || 0, is_active: isActive, logo: logo.trim(), cover_image: coverImage.trim(),
      cash_enabled: !!cashEnabled, cash_max_amount: Math.max(0, Number(cashMaxAmount) || 0),
      delivery_floors: finalFloors,
    };
    if (row.name.length < 2) return setErr("اسم الفرع قصير زيادة (حرفين على الأقل)");
    setBusy(true);
    try {
      let branchId = editing?.id || "";
      if (branchId) {
        const { error } = await supabase.from("branches").update(row).eq("id", branchId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("branches").insert(row).select("id").single();
        if (error) throw error;
        branchId = (data as any)?.id || "";
      }

      // Part 5: audited obour settings update (manager-only RPC)
      if (branchId) {
        const hours = { enabled: !!obourHoursEnabled, from: obourFrom, to: obourTo };
        const { error: obErr } = await supabase.rpc("manager_set_obour_settings", {
          p_branch_id: branchId,
          p_enabled: !!obourEnabled,
          p_fee: Number(obourFee) || 0,
          p_hours: hours,
          p_whatsapp: obourWhatsapp || null,
          p_template: obourTemplate || null,
          p_closed_message: obourClosedMsg || null,
        });
        if (obErr) throw obErr;
      }

      setEditing(null);
      await load();
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const quickToggleObour = async (b: Branch) => {
    setBusy(true); setErr(null);
    try {
      const { error } = await supabase.rpc("manager_set_obour_settings", {
        p_branch_id: b.id,
        p_enabled: !(b.obour_enabled !== false),
        p_fee: Number(b.obour_fee ?? 50),
        p_hours: b.obour_hours || { enabled: false },
        p_whatsapp: b.obour_whatsapp || null,
        p_template: b.obour_whatsapp_template || null,
        p_closed_message: b.obour_closed_message || null,
      });
      if (error) throw error;
      await load();
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  if (!branches) return <Spinner />;
  if (busy && !editing) return <Spinner label="بيتم الإجراء…" />;

  return (
    <div className="space-y-4 pb-24">
      {err && <div className="status-danger border border-danger-text/30 text-danger-text rounded-xl px-3 py-2 text-sm font-bold">{err}</div>}

      {editing ? (
        <div className="card p-4 space-y-3">
          <h2 className="font-extrabold text-brand-800">{editing.id ? "تعديل الفرع" : "إضافة فرع جديد"}</h2>
          <div><label className="label">الاسم</label><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="label">الوصف القصير</label><textarea className="input" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} /></div>
          <div><label className="label">الوصفة القصيرة (Promo Brief)</label><input className="input" maxLength={200} value={promoBrief} onChange={(e) => setPromoBrief(e.target.value)} placeholder="حتى 200 حرف" /></div>
          <div><label className="label">الخدمات (افصلها بفاصلة)</label><input className="input" value={servicesText} onChange={(e) => setServicesText(e.target.value)} placeholder="دليفري، جلسات هادية، واي فاي" /></div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">شعار الفرع</label>
              <div className="flex items-center gap-2 mt-1">
                {logo ? <img src={logo} alt="الشعار" className="w-16 h-16 object-cover rounded border border-brand-200" /> : <div className="w-16 h-16 rounded bg-brand-50 border border-brand-200 flex items-center justify-center text-xs text-brand-400">شعار</div>}
                <input type="file" accept="image/*" className="text-xs" onChange={(e) => e.target.files?.[0] && uploadBranchImage(e.target.files[0], "branch-images").then((url) => url && setLogo(url))} />
              </div>
            </div>
            <div>
              <label className="label">صورة الغلاف</label>
              <div className="flex items-center gap-2 mt-1">
                {coverImage ? <img src={coverImage} alt="الغلاف" className="w-16 h-16 object-cover rounded border border-brand-200" /> : <div className="w-16 h-16 rounded bg-brand-50 border border-brand-200 flex items-center justify-center text-xs text-brand-400">غلاف</div>}
                <input type="file" accept="image/*" className="text-xs" onChange={(e) => e.target.files?.[0] && uploadBranchImage(e.target.files[0], "branch-images").then((url) => url && setCoverImage(url))} />
              </div>
            </div>
          </div>
          {uploading && <span className="text-xs font-bold text-brand-700">برفع…</span>}

          <div className="flex flex-wrap items-end gap-4">
            <div><label className="label">ترتيب الظهور</label><input className="input w-24" type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} /></div>
            <label className="flex items-center gap-2 pt-5 font-bold text-brand-900 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="accent-brand-500" />الفرع ظاهر للعميل</label>
          </div>

          <div className="border-t border-brand-100 pt-3 space-y-2">
            <p className="font-bold text-brand-800 text-sm">إعدادات الدفع الكاش</p>
            <label className="flex items-center gap-2 font-bold text-brand-900 text-sm"><input type="checkbox" checked={cashEnabled} onChange={(e) => setCashEnabled(e.target.checked)} className="accent-brand-500" />تفعيل الدفع كاش في هذا الفرع</label>
            <div><label className="label">الحد الأقصى لطلب الكاش (ج.م)</label><input className="input w-40" type="number" min={0} step="1" value={cashMaxAmount} onChange={(e) => setCashMaxAmount(Number(e.target.value))} /></div>
          </div>

          <div className="border-t border-brand-100 pt-3 space-y-2">
            <p className="font-bold text-brand-800 text-sm">التوصيل داخل الفرع — قائمة الأدوار</p>
            <textarea className="input min-h-[72px]" value={deliveryFloorsText} onChange={(e) => setDeliveryFloorsText(e.target.value)} placeholder="الأرضي، 1، 2، 3، 4، 5" />
          </div>

          <div className="border-t border-brand-100 pt-3 space-y-2">
            <p className="font-bold text-brand-800 text-sm">التوصيل داخل نطاق العبور (إعدادات المدير)</p>
            <label className="flex items-center gap-2 font-bold text-brand-900 text-sm"><input type="checkbox" checked={obourEnabled} onChange={(e) => setObourEnabled(e.target.checked)} className="accent-brand-500" />التوصيل داخل العبور متاح</label>
            <div className="grid gap-2 sm:grid-cols-2">
              <div><label className="label">رسوم التوصيل (ج.م)</label><input className="input" type="number" min={0} step="1" value={obourFee} onChange={(e) => setObourFee(Number(e.target.value))} /></div>
              <div><label className="label">رقم واتساب لاستقبال اللوكيشن</label><input className="input" dir="ltr" placeholder="01xxxxxxxxx" value={obourWhatsapp} onChange={(e) => setObourWhatsapp(e.target.value)} /></div>
            </div>
            <label className="flex items-center gap-2 font-bold text-brand-900 text-sm"><input type="checkbox" checked={obourHoursEnabled} onChange={(e) => setObourHoursEnabled(e.target.checked)} className="accent-brand-500" />تفعيل ساعات عمل للتوصيل</label>
            {obourHoursEnabled && (
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">من (HH:MM)</label><input className="input" type="time" value={obourFrom} onChange={(e) => setObourFrom(e.target.value)} /></div>
                <div><label className="label">إلى (HH:MM)</label><input className="input" type="time" value={obourTo} onChange={(e) => setObourTo(e.target.value)} /></div>
              </div>
            )}
            <div><label className="label">قالب رسالة واتساب (متغيرات: {"{order_number}"}, {"{name}"}, {"{address}"})</label><textarea className="input min-h-[80px]" value={obourTemplate} onChange={(e) => setObourTemplate(e.target.value)} /></div>
            <div><label className="label">رسالة الإغلاق/عدم التوفر</label><textarea className="input min-h-[64px]" value={obourClosedMsg} onChange={(e) => setObourClosedMsg(e.target.value)} /></div>
            <p className="text-xs text-brand-700">يتم حفظ إعدادات العبور عبر إجراء مدير آمن مع تسجيل كل تغيير في سجل تدقيق.</p>
          </div>

          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy || uploading} onClick={save}>حفظ</button>
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
            <div className="flex items-center gap-3 min-w-0">
              {b.logo ? <img src={b.logo} alt="الشعار" className="w-10 h-10 object-cover rounded" /> : <div className="w-10 h-10 rounded bg-brand-50 flex items-center justify-center text-[10px] text-brand-400">🏪</div>}
              <div className="min-w-0">
                <p className="font-extrabold text-brand-800">{b.name} {!b.is_active && <span className="pill status-warn text-warn-text ml-1">مخفي</span>}</p>
                <p className="text-xs text-brand-800 line-clamp-2">{b.description}</p>
                <p className="text-xs text-brand-700 mt-1">كاش: {b.cash_enabled === false ? "مغلق" : `مفعل (حد أقصى ${b.cash_max_amount ?? 500} ج)`}</p>
                <p className="text-xs text-brand-700 mt-1">أدوار داخل الفرع: {Array.isArray(b.delivery_floors) && b.delivery_floors.length ? b.delivery_floors.join("، ") : DEFAULT_FLOORS.join("، ")}</p>
                <p className="text-xs text-brand-700 mt-1">توصيل العبور: {b.obour_enabled === false ? "غير متاح" : `متاح (${b.obour_fee ?? 50} ج)`}</p>
              </div>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <button className="btn-soft !py-1.5 !px-3 text-xs" onClick={() => startEdit(b)}>تعديل</button>
              <button className="btn-outline !py-1.5 !px-3 text-xs" onClick={() => quickToggleObour(b)}>{b.obour_enabled === false ? "تفعيل العبور" : "إيقاف العبور"}</button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-brand-700 font-bold">ملاحظة أمان: الفرع اللي عليه طلبات مش بيتمسح نهائيًا — استخدم "إخفاء" بدلًا من الحذف.</p>
    </div>
  );
}
