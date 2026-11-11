import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Branch, type BranchPromo } from "../../lib/types";
import { EmptyBox } from "../../components/Common";
import { compressImage } from "../../lib/image";
import { randomId } from "../../lib/random";

export default function PromosAdmin() {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [promos, setPromos] = useState<BranchPromo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<BranchPromo | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [buttonLabel, setButtonLabel] = useState("زور صفحة الفرع");
  const [isActive, setIsActive] = useState(true);
  const [sortOrder, setSortOrder] = useState(0);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    const [bRes, pRes] = await Promise.all([
      supabase.from("branches").select("id, name").eq("is_active", true).order("sort_order"),
      supabase.from("branch_promos").select("*").order("sort_order"),
    ]);
    setBusy(false);
    if (bRes.error) return setErr(bRes.error.message);
    setBranches((bRes.data as Branch[]) ?? []);
    if (pRes.error) return setErr(pRes.error.message);
    setPromos((pRes.data as BranchPromo[]) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (p?: BranchPromo) => {
    if (p) {
      setEditing(p);
      setTitle(p.title);
      setText(p.text);
      setImageUrl(p.image_url);
      setLinkUrl(p.link_url);
      setButtonLabel(p.button_label);
      setIsActive(p.is_active);
      setSortOrder(p.sort_order);
      setSelectedBranch(p.branch_id);
    } else {
      setEditing(null);
      setTitle("");
      setText("");
      setImageUrl("");
      setLinkUrl("");
      setButtonLabel("زور صفحة الفرع");
      setIsActive(true);
      setSortOrder(0);
      setSelectedBranch(branches?.[0]?.id || null);
    }
  };

  const uploadPromoImage = async (file: File) => {
    if (!file) return "";
    setUploading(true);
    setErr(null);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      if (!["jpg", "jpeg", "png", "webp"].includes(ext)) throw new Error("صيغة الصورة مش مدعومة — استخدم jpg/png/webp");
      if (file.size > 3 * 1024 * 1024) throw new Error("الصورة أكبر من 3 ميجابايت");
      const compressed = await compressImage(file, { maxWidth: 1200, quality: 0.85 });
      const path = `branch-images/${randomId()}.${ext}`;
      const { error } = await supabase.storage.from("branch-images").upload(path, compressed, { contentType: compressed.type, upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("branch-images").getPublicUrl(path);
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
    if (!title.trim()) return setErr("العنوان مطلوب");
    if (!text.trim()) return setErr("النص مطلوب");
    if (!linkUrl.trim()) return setErr("الرابط مطلوب");
    if (!/^https:\/\//.test(linkUrl.trim())) return setErr("الرابط يجب أن يبدأ بـ https://");
    if (!selectedBranch) return setErr("اختر الفرع");
    setBusy(true);
    try {
      const row = {
        branch_id: selectedBranch,
        title: title.trim(),
        text: text.trim(),
        image_url: imageUrl.trim(),
        link_url: linkUrl.trim(),
        button_label: buttonLabel.trim() || "زور صفحة الفرع",
        isActive,
        sort_order: Number(sortOrder) || 0,
      };
      if (editing?.id) {
        const { error } = await supabase.from("branch_promos").update(row).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("branch_promos").insert(row);
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

  const del = async (id: string) => {
    if (!confirm("متأكد تحذف هذا البرومو؟")) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("branch_promos").delete().eq("id", id);
      if (error) throw error;
      await load();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (p: BranchPromo) => {
    setBusy(true);
    try {
      const { error } = await supabase.from("branch_promos").update({ is_active: !p.is_active }).eq("id", p.id);
      if (error) throw error;
      await load();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const promosForBranch = useMemo(() => {
    if (!promos) return [];
    return promos.filter((p) => p.is_active).sort((a, b) => a.sort_order - b.sort_order);
  }, [promos]);

  return (
    <div className="space-y-4 pb-24">
      {err && <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-3 py-2 text-sm font-bold">{err}</div>}

      {editing ? (
        <div className="card p-4 space-y-3">
          <h2 className="font-extrabold text-brand-800">{editing.id ? "تعديل برومو" : "برومو جديد"}</h2>
          <div>
            <label className="label">اختر الفرع</label>
            <select className="input w-full" value={selectedBranch || ""} onChange={(e) => setSelectedBranch(e.target.value || null)}>
              <option value="">اختر فرعًا</option>
              {branches?.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">العنوان</label>
            <input className="input" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="label">النص (حتى ٢٠٠ حرف)</label>
            <textarea className="input" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <div>
            <label className="label">صورة البرومو</label>
            <div className="flex items-center gap-2 mt-1">
              {imageUrl ? (
                <img src={imageUrl} alt="برومو" className="w-20 h-20 object-cover rounded border border-brand-200" />
              ) : (
                <div className="w-20 h-20 rounded bg-brand-50 border border-brand-200 flex items-center justify-center text-xs text-brand-400">صورة</div>
              )}
              <input
                type="file"
                accept="image/*"
                className="text-xs"
                onChange={(e) => e.target.files?.[0] && uploadPromoImage(e.target.files[0]).then((url) => setImageUrl(url))}
              />
              {uploading && <span className="text-xs font-bold text-brand-700">برفع…</span>}
            </div>
          </div>
          <div>
            <label className="label">رابط الارتباط (يجب أن يبدأ بـ https://)</label>
            <input className="input" dir="ltr" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://example.com" />
          </div>
          <div>
            <label className="label">نص الزر</label>
            <input className="input" maxLength={60} value={buttonLabel} onChange={(e) => setButtonLabel(e.target.value)} />
          </div>
          <div className="flex items-center gap-4">
            <div>
              <label className="label">ترتيب الظهور</label>
              <input className="input w-24" type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value) || 0)} />
            </div>
            <label className="flex items-center gap-2 pt-5 font-bold text-brand-900 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="accent-brand-500" />
              نشط (يظهر للعملاء)
            </label>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy || uploading} onClick={save}>حفظ</button>
            <button className="btn-soft" onClick={() => setEditing(null)}>إلغاء</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={() => startEdit()}>+ برومو جديد</button>
        </div>
      )}

      <div className="grid gap-3">
        {promosForBranch.length === 0 ? (
          <EmptyBox msg="مفيش بروموات نشطة حالياً" />
        ) : (
          promosForBranch.map((p) => (
            <div key={p.id} className="card p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {p.image_url ? (
                  <img src={p.image_url} alt="برومو" className="w-16 h-16 object-cover rounded border border-brand-200" />
                ) : (
                  <div className="w-16 h-16 rounded bg-brand-50 border border-brand-200 flex items-center justify-center text-xs text-brand-400">صورة</div>
                )}
                <div className="min-w-0">
                  <p className="font-extrabold text-brand-800 truncate">{p.title}</p>
                  <p className="text-xs text-brand-800 truncate">{p.text}</p>
                  <p className="text-xs text-mut mt-1">{p.link_url}</p>
                </div>
              </div>
              <div className="flex gap-1">
                <button className="btn-soft !py-1.5 !px-3 text-xs shrink-0" onClick={() => startEdit(p)}>تعديل</button>
                <button
                  className={`btn-soft !py-1.5 !px-3 text-xs shrink-0 ${p.is_active ? "text-brand-700" : "text-brand-400"}`}
                  onClick={() => toggleActive(p)}
                >
                  {p.is_active ? "إخفاء" : "إظهار"}
                </button>
                <button className="btn-soft !py-1.5 !px-3 text-xs shrink-0 text-red-500" onClick={() => del(p.id)}>حذف</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
