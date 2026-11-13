import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Branch, type Category, type Product } from "../../lib/types";
import { money } from "../../lib/format";
import { Spinner, EmptyBox } from "../../components/Common";
import { compressImage } from "../../lib/image";
import { randomId } from "../../lib/random";

// ===== التصنيفات =====
function CategoriesPanel({ cats, reload, busyFlag, setBusyFlag }: {
  cats: Category[];
  reload: () => Promise<void>;
  busyFlag: boolean;
  setBusyFlag: (b: boolean) => void;
}) {
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    if (newName.trim().length < 2) return setErr("اسم قصير زيادة (حرفين على الأقل)");
    setErr(null);
    setBusyFlag(true);
    const { error } = await supabase.from("categories").insert({ name: newName.trim() });
    setBusyFlag(false);
    if (error) return setErr(error.message);
    setNewName("");
    reload();
  };
  const rename = async (c: Category) => {
    const v = prompt("الاسم الجديد:", c.name);
    if (!v || v.trim().length < 2) return;
    setBusyFlag(true);
    await supabase.from("categories").update({ name: v.trim() }).eq("id", c.id);
    setBusyFlag(false);
    reload();
  };
  const toggle = async (c: Category) => {
    setBusyFlag(true);
    await supabase.from("categories").update({ is_active: !c.is_active }).eq("id", c.id);
    setBusyFlag(false);
    reload();
  };

  return (
    <div className="card p-4 space-y-2">
      <h2 className="font-extrabold text-brand-800">التصنيفات</h2>
      {busyFlag && <p className="text-xs font-bold text-brand-700">بيتم الإجراء…</p>}
      {err && <div className="text-sm font-bold text-danger-text">{err}</div>}
      {cats.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-2">
          <span className="font-bold text-brand-900">
            {c.name} {!c.is_active && <span className="pill status-warn text-warn-text">مخفي</span>}
          </span>
          <span className="flex gap-1">
            <button className="pill bg-brand-100 text-brand-800" onClick={() => rename(c)}>تعديل الاسم</button>
            <button className="pill bg-surface border border-border text-brand-800" onClick={() => toggle(c)}>
              {c.is_active ? "إخفاء" : "إظهار"}
            </button>
          </span>
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <input className="input" placeholder="تصنيف جديد" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn-primary shrink-0" onClick={add}>إضافة</button>
      </div>
    </div>
  );
}

// ===== نموذج المنتج =====
type ProductForm = {
  id?: string;
  branch_id: string;
  category_id: string;
  name: string;
  price: string;
  note: string;
  image_url: string;
  is_active: boolean;
  sort_order: number;
  stock_qty: number;
  low_stock_threshold: number;
  track_stock: boolean;
};

const emptyForm = (branchId: string, categoryId: string): ProductForm => ({
  branch_id: branchId,
  category_id: categoryId,
  name: "",
  price: "",
  note: "",
  image_url: "",
  is_active: true,
  sort_order: 0,
  stock_qty: 0,
  low_stock_threshold: 10,
  track_stock: true,
});

export default function CatalogAdmin() {
  const [cats, setCats] = useState<Category[] | null>(null);
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [busyFlag, setBusyFlag] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [fBranch, setFBranch] = useState<string>("");
  const [fCat, setFCat] = useState<string>("all");
  const [form, setForm] = useState<ProductForm | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const [c, b, p] = await Promise.all([
      supabase.from("categories").select("*").order("sort_order"),
      supabase.from("branches").select("*").order("sort_order"),
      supabase.from("products").select("*, categories(name)").order("sort_order").limit(500),
    ]);
    if (c.error) setErr(c.error.message);
    else setCats((c.data as Category[]) ?? []);
    if (b.error) setErr(b.error.message);
    else {
      const list = (b.data as Branch[]) ?? [];
      setBranches(list);
      setFBranch((f) => f || list[0]?.id || "");
    }
    if (p.error) setErr(p.error.message);
    else setProducts((p.data as unknown as Product[]) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (form && (!form.branch_id || !form.category_id)) {
      setForm((f) =>
        f
          ? { ...f, branch_id: f.branch_id || branches?.[0]?.id || "", category_id: f.category_id || cats?.[0]?.id || "" }
          : f
      );
    }
  }, [form, branches, cats]);

  const shown = useMemo(
    () => (products ?? []).filter((p) => (!fBranch || p.branch_id === fBranch) && (fCat === "all" || p.category_id === fCat)),
    [products, fBranch, fCat]
  );

  const stockBadge = (p: Product) => {
    if (!p.track_stock) return <span className="text-xs text-brand-400">بدون تتبع</span>;
    if (p.stock_qty === 0) return <span className="text-xs font-bold text-danger-text status-danger px-2 py-0.5 rounded">خلصت 💔</span>;
    if (p.stock_qty <= p.low_stock_threshold) return <span className="text-xs font-bold text-warn-text status-warn px-2 py-0.5 rounded">باقي {p.stock_qty} 🔥</span>;
    return <span className="text-xs text-ok-text status-ok px-2 py-0.5 rounded">متاح {p.stock_qty}</span>;
  };

  const openForm = (p?: Product) => {
    setForm(
      p
        ? {
            id: p.id,
            branch_id: p.branch_id,
            category_id: p.category_id,
            name: p.name,
            price: String(p.price),
            note: p.note || "",
            image_url: p.image_url || "",
            is_active: p.is_active,
            sort_order: p.sort_order,
            stock_qty: p.stock_qty,
            low_stock_threshold: p.low_stock_threshold,
            track_stock: p.track_stock,
          }
        : emptyForm(fBranch || branches?.[0]?.id || "", cats?.[0]?.id || "")
    );
  };

  const save = async () => {
    if (!form) return;
    setErr(null);
    const price = Number(form.price);
    const stock = Number(form.stock_qty);
    const threshold = Number(form.low_stock_threshold);
    if (form.name.trim().length < 2) return setErr("اسم المنتج قصير (حرفين على الأقل)");
    if (!Number.isFinite(price) || price <= 0 || price > 100000) return setErr("السعر لازم يكون أكبر من صفر (لحد 100,000) — المنتج من غير سعر مينفعش يتباع");
    if (!Number.isFinite(stock) || stock < 0 || stock > 100000) return setErr("كمية المخزون غير صالحة");
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 10000) return setErr("عتبة المخزون غير صحيحة");
    const row = {
      branch_id: form.branch_id,
      category_id: form.category_id,
      name: form.name.trim(),
      price,
      note: form.note.trim().slice(0, 200),
      image_url: form.image_url.trim().slice(0, 500),
      is_active: form.is_active,
      sort_order: Number(form.sort_order) || 0,
      stock_qty: stock,
      low_stock_threshold: threshold,
      track_stock: form.track_stock,
    };
    setBusyFlag(true);
    try {
      if (form.id) {
        const { error } = await supabase.from("products").update(row).eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("products").insert(row);
        if (error) throw error;
      }
      setForm(null);
      await load();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setBusyFlag(false);
    }
  };

  const del = async (p: Product) => {
    if (!confirm(`متأكد حذف «${p.name}»؟ الطلبات القديمة مش هتتأثر (السعر محفوظ جواها).`)) return;
    setBusyFlag(true);
    const { error } = await supabase.from("products").delete().eq("id", p.id);
    setBusyFlag(false);
    if (error) return setErr(error.message);
    load();
  };

  const uploadImage = async (file: File) => {
    if (!file) return;
    setUploading(true);
    setErr(null);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      if (!["jpg", "jpeg", "png", "webp"].includes(ext)) throw new Error("صيغة الصورة مش مدعومة — استخدم jpg/png/webp");
      if (file.size > 3 * 1024 * 1024) throw new Error("الصورة أكبر من 3 ميجابايت");
      const compressed = await compressImage(file, { maxWidth: 1000, quality: 0.85 });
      const path = `products/${randomId()}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, compressed, { contentType: compressed.type, upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      setForm((f) => (f ? { ...f, image_url: data.publicUrl } : f));
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  if (!cats || !branches) return <Spinner />;

  return (
    <div className="space-y-4">
      {err && <div className="status-danger border border-danger-text/30 text-danger-text rounded-xl px-3 py-2 text-sm font-bold">{err}</div>}

      <CategoriesPanel cats={cats} reload={load} busyFlag={busyFlag} setBusyFlag={setBusyFlag} />

      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-extrabold text-brand-800">المنتجات</h2>
          <select className="input w-auto" value={fBranch} onChange={(e) => setFBranch(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>فرع {b.name}</option>
            ))}
          </select>
          <select className="input w-auto" value={fCat} onChange={(e) => setFCat(e.target.value)}>
            <option value="all">كل التصنيفات</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button className="btn-primary !py-1.5" onClick={() => openForm()}>+ منتج في هذا الفرع</button>
        </div>

        {shown.length === 0 && <EmptyBox msg="لسه مفيش منتجات بالفلتر الحالي" />}
        <div className="grid gap-2">
          {shown.map((p) => (
            <div key={p.id} className="flex items-center gap-3 border border-brand-100 rounded-xl p-2">
              {p.image_url ? (
                <img src={p.image_url} alt="" className="w-12 h-12 rounded-lg object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-brand-50" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-extrabold text-brand-900 truncate">
                  {p.name} {!p.is_active && <span className="pill status-warn text-warn-text">مخفي</span>}
                </p>
                <p className="text-xs text-brand-700">
                  {p.categories?.name} · {money(Number(p.price))}
                  {p.note ? ` · ${p.note}` : ""}
                </p>
                <p className="text-xs">{stockBadge(p)}</p>
              </div>
              <div className="flex flex-col gap-1 text-xs">
                <button className="btn-soft !py-1 !px-2" onClick={() => openForm(p)}>تعديل</button>
                <button className="pill status-danger text-danger-text" onClick={() => del(p)}>حذف</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3" onClick={() => setForm(null)}>
          <div className="card p-4 w-full max-w-md space-y-3 max-h-[85dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-extrabold text-brand-800">{form.id ? "تعديل منتج" : "منتج جديد"}</h3>
            <div>
              <label className="label">الفرع</label>
              <select className="input" value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">التصنيف</label>
              <select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">الاسم</label>
              <input className="input" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="label">السعر (ج.م)</label>
                <input className="input" type="number" min={0.01} step="0.5" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </div>
              <div className="w-24">
                <label className="label">الترتيب</label>
                <input className="input" type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="label">كمية المخزون</label>
                <input className="input" type="number" min={0} step={1} value={String(form.stock_qty)} onChange={(e) => setForm({ ...form, stock_qty: Number(e.target.value) || 0 })} />
              </div>
              <div className="w-32">
                <label className="label">عتبة التنبيه</label>
                <input className="input" type="number" min={0} step={1} value={String(form.low_stock_threshold)} onChange={(e) => setForm({ ...form, low_stock_threshold: Number(e.target.value) || 10 })} />
              </div>
            </div>
            <div>
              <label className="label">ملاحظة (اختياري)</label>
              <input className="input" maxLength={200} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
            <div>
              <label className="label">صورة</label>
              <input className="input" dir="ltr" placeholder="رابط صورة أو ارفع من تحت" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} />
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="file"
                  accept="image/*"
                  className="text-xs"
                  onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])}
                />
                {uploading && <span className="text-xs font-bold text-brand-700">برفع الصورة… ⏳</span>}
              </div>
            </div>
            <label className="flex items-center gap-2 font-bold text-brand-900 text-sm">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="accent-brand-500" />
              متاح للعملاء (ظاهر)
            </label>
            <label className="flex items-center gap-2 font-bold text-brand-900 text-sm">
              <input type="checkbox" checked={form.track_stock} onChange={(e) => setForm({ ...form, track_stock: e.target.checked })} className="accent-brand-500" />
              تتبع المخزون
            </label>
            <div className="flex gap-2">
              <button className="btn-primary" disabled={busyFlag || uploading} onClick={save}>حفظ</button>
              <button className="btn-soft" onClick={() => setForm(null)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
      <div className="h-8" />
    </div>
  );
}
