import { useCallback, useEffect, useState } from "react";
import { supabase, type Branch } from "../../lib/types";
import { Spinner, EmptyBox } from "../../components/Common";
import { compressImage } from "../../lib/image";

export default function BranchesAdmin() {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // نموذج إضافة/تعديل
  const [editing, setEditing] = useState<Branch | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [promoBrief, setPromoBrief] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [servicesText, setServicesText] = useState("");
  const [logo, setLogo] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [uploading, setUploading] = useState(false);

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
      setPromoBrief(b.promo_brief || "");
      setServices(b.services || []);
      setServicesText((b.services || []).join("،"));
      setLogo(b.logo || "");
      setCoverImage(b.cover_image || "");
      setSortOrder(b.sort_order);
      setIsActive(b.is_active);
    } else {
      setEditing({ id: "", name: "", description: "", services: [], is_active: true, sort_order: 0, logo: "", cover_image: "", promo_brief: "" });
      setName("");
      setDescription("");
      setPromoBrief("");
      setServices([]);
      setServicesText("");
      setLogo("");
      setCoverImage("");
      setSortOrder(0);
      setIsActive(true);
    }
  };

  const uploadBranchImage = async (file: File, bucket: "product-images" | "branch-images") => {
    if (!file) return "";
    setUploading(true);
    setErr(null);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      if (!["jpg", "jpeg", "png", "webp"].includes(ext)) throw new Error("صيغة الصورة مش مدعومة — استخدم jpg/png/webp");
      if (file.size > 3 * 1024 * 1024) throw new Error("الصورة أكبر من 3 ميجابايت");
      const compressed = await compressImage(file, { maxWidth: 1000, quality: 0.85 });
      const path = `${bucket}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(bucket).upload(path, compressed, { contentType: compressed.type, upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      return data.publicUrl;
    } catch (e: unknown) {
      setErr((e as Error).message);
      return "";
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setErr(null);
    const row = {
      name: name.trim(),
      description: description.trim().slice(0, 300),
      promo_brief: promoBrief.trim().slice(0, 200),
      services: services.map((s) => s.trim()).filter(Boolean).slice(0, 8),
      sort_order: Number(sortOrder) || 0,
      is_active: isActive,
      logo: logo.trim(),
      cover_image: coverImage.trim(),
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
            <label className="label">الوصفة القصيرة (Promo Brief)</label>
            <input className="input" maxLength={200} value={promoBrief} onChange={(e) => setPromoBrief(e.target.value)} placeholder=" up to 200 chars" />
          </div>
          <div>
            <label className="label">الخدمات (افصلها بكمّة)</label>
            <input className="input" value={servicesText} onChange={(e) => setServicesText(e.target.value)} placeholder="دليفري، جلسات هادية، واي فاي" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">شعار الفرع</label>
              <div className="flex items-center gap-2 mt-1">
                {logo ? (
                  <img src={logo} alt="الشعار" className="w-16 h-16 object-cover rounded border border-brand-200" />
                ) : (
                  <div className="w-16 h-16 rounded bg-brand-50 border border-brand-200 flex items-center justify-center text-xs text-brand-400">شعار</div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="text-xs"
                  onChange={(e) => e.target.files?.[0] && uploadBranchImage(e.target.files[0], "branch-images").then((url) => setLogo(url))}
                />
                {uploading && <span className="text-xs font-bold text-brand-700">برفع…</span>}
              </div>
            </div>
            <div>
              <label className="label">صورة الغلاف</label>
              <div className="flex items-center gap-2 mt-1">
                {coverImage ? (
                  <img src={coverImage} alt="الغلاف" className="w-16 h-16 object-cover rounded border border-brand-200" />
                ) : (
                  <div className="w-16 h-16 rounded bg-brand-50 border border-brand-200 flex items-center justify-center text-xs text-brand-400">غلاف</div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="text-xs"
                  onChange={(e) => e.target.files?.[0] && uploadBranchImage(e.target.files[0], "branch-images").then((url) => setCoverImage(url))}
                />
                {uploading && <span className="text-xs font-bold text-brand-700">برفع…</span>}
              </div>
            </div>
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
            <div className="flex items-center gap-3">
              {b.logo ? (
                <img src={b.logo} alt="الشعار" className="w-10 h-10 object-cover rounded" />
              ) : (
                <div className="w-10 h-10 rounded bg-brand-50 flex items-center justify-center text-[10px] text-brand-400">🏪</div>
              )}
              <div>
                <p className="font-extrabold text-brand-800">{b.name} {!b.is_active && <span className="pill bg-amber-100 text-amber-800 ml-1">مخفي</span>}</p>
                <p className="text-xs text-brand-800">{b.description}</p>
                {b.promo_brief && <p className="text-xs text-brand-700 mt-1">"{b.promo_brief}"</p>}
                <p className="text-xs text-brand-700 mt-1">{(b.services || []).join(" · ")}</p>
              </div>
            </div>
            <button className="btn-soft !py-1.5 !px-3 text-xs shrink-0" onClick={() => startEdit(b)}>تعديل</button>
          </div>
        ))}
      </div>
      <p className="text-xs text-brand-700 font-bold">
        ملاحظة أمان: الفرع اللي عليه طلبات مش بيتمسح نهائيًا — استخدم "إخفاء" بدلًا من الحذف.
      </p>
    </div>
  );
}
