import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Branch, type Category, type Product } from "../../lib/types";
import { money } from "../../lib/format";
import { Spinner, EmptyBox } from "../../components/Common";
import { compressImage } from "../../lib/image";
import { randomId } from "../../lib/random";
import { ArrowDown, ArrowUp, GripVertical, Star } from "lucide-react";

// ===== التصنيفات =====
function CategoriesPanel({ cats, reload, busyFlag, setBusyFlag, setErr }: {
  cats: Category[];
  reload: () => Promise<void>;
  busyFlag: boolean;
  setBusyFlag: (b: boolean) => void;
  setErr: (m: string | null) => void;
}) {
  const [newName, setNewName] = useState("");
  const [err, setErrLocal] = useState<string | null>(null);

  const add = async () => {
    if (newName.trim().length < 2) return setErrLocal("اسم قصير زيادة (حرفين على الأقل)");
    setErrLocal(null);
    setBusyFlag(true);
    const { error } = await supabase.from("categories").insert({ name: newName.trim() });
    setBusyFlag(false);
    if (error) return setErrLocal(error.message);
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

  // ترتيب الأقسام: بيحدد ترتيب السكاشن في المنيو (Lala's Bakery أولًا افتراضيًا)
  const move = async (c: Category, dir: -1 | 1) => {
    const list = [...cats].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const i = list.findIndex((x) => x.id === c.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setBusyFlag(true);
    try {
      for (let k = 0; k < list.length; k++) {
        const { error } = await supabase.from("categories").update({ sort_order: k }).eq("id", list[k].id);
        if (error) throw error;
      }
      await reload();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setBusyFlag(false);
    }
  };

  return (
    <div className="card p-4 space-y-2">
      <h2 className="font-extrabold text-brand-800">التصنيفات</h2>
      <p className="text-xs text-brand-700">الترتيب هنا هو ترتيب الأقسام في منيو الزبون — أول قسم بيظهر أول واحد.</p>
      {busyFlag && <p className="text-xs font-bold text-brand-700">بيتم الإجراء…</p>}
      {err && <div className="text-sm font-bold text-danger-text">{err}</div>}
      {[...cats]
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((c, idx, arr) => (
          <div key={c.id} className="flex items-center justify-between gap-2">
            <span className="font-bold text-brand-900">
              {c.name} {!c.is_active && <span className="pill status-warn text-warn-text">مخفي</span>}
            </span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                className="pill bg-surface border border-border text-brand-800 disabled:opacity-40"
                onClick={() => move(c, -1)}
                disabled={idx === 0 || busyFlag}
                aria-label={`حرّك ${c.name} لفوق`}
              >
                <ArrowUp size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="pill bg-surface border border-border text-brand-800 disabled:opacity-40"
                onClick={() => move(c, 1)}
                disabled={idx === arr.length - 1 || busyFlag}
                aria-label={`حرّك ${c.name} لتحت`}
              >
                <ArrowDown size={14} aria-hidden="true" />
              </button>
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
  featured: boolean;
  is_new: boolean;
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
  featured: false,
  is_new: false,
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
            featured: !!p.featured,
            is_new: !!p.is_new,
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
      featured: form.featured,
      is_new: form.is_new,
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
      if (file.size > 8 * 1024 * 1024) throw new Error("الصورة أكبر من 8 ميجابايت");
      const bucket = supabase.storage.from("product-images");
      const base = randomId();

      // 1) نحتفظ بالأصل زي ما هو
      const originalPath = `products/${base}-original.${ext === "jpeg" ? "jpg" : ext}`;
      const original = await bucket.upload(originalPath, file, {
        contentType: file.type || undefined,
        upsert: false,
      });
      if (original.error) throw original.error;

      // 2) نولّد نسختين WebP: 400px و 800px (srcset)
      const asWebp = async (maxWidth: number) => {
        const out = await compressImage(file, { maxWidth, quality: 0.82, type: "image/webp" });
        if (out.type !== "image/webp")
          throw new Error("المتصفح ده مش بيدعم تحويل WebP — جرّب من متصفح حديث أو ارفع صورة WebP");
        return out;
      };
      const [small, big] = await Promise.all([asWebp(400), asWebp(800)]);
      const p400 = `products/${base}-400.webp`;
      const p800 = `products/${base}-800.webp`;
      const [r400, r800] = await Promise.all([
        bucket.upload(p400, small, { contentType: "image/webp", upsert: false }),
        bucket.upload(p800, big, { contentType: "image/webp", upsert: false }),
      ]);
      if (r400.error) throw r400.error;
      if (r800.error) throw r800.error;

      // 3) الرابط الأساسي = نسخة 800 (والـ srcset بيجيب 400 للموبايل)
      const { data } = bucket.getPublicUrl(p800);
      setForm((f) => (f ? { ...f, image_url: data.publicUrl } : f));
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  // ترتيب المنتجات: كتابة sort_order بالترتيب الظاهر (10, 20, 30…)
  const persistOrder = async (list: Product[]) => {
    setBusyFlag(true);
    setErr(null);
    try {
      for (let k = 0; k < list.length; k++) {
        const { error } = await supabase.from("products").update({ sort_order: (k + 1) * 10 }).eq("id", list[k].id);
        if (error) throw error;
      }
      await load();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setBusyFlag(false);
    }
  };

  /** نفس الفرع + نفس التصنيف — الترتيب بيتم جواهم بس */
  const groupOf = (p: Product) =>
    shown
      .filter((x) => x.branch_id === p.branch_id && x.category_id === p.category_id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const moveProduct = async (p: Product, dir: -1 | 1) => {
    const list = groupOf(p);
    const i = list.findIndex((x) => x.id === p.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await persistOrder(list);
  };

  const [dragId, setDragId] = useState<string | null>(null);

  const dropProduct = async (target: Product) => {
    if (!dragId || dragId === target.id) return;
    const dragged = shown.find((x) => x.id === dragId);
    setDragId(null);
    if (!dragged) return;
    if (dragged.branch_id !== target.branch_id || dragged.category_id !== target.category_id) {
      setErr("الترتيب بيتم جوه نفس التصنيف بس — انقل المنتج لنفس القسم الأول");
      return;
    }
    const list = groupOf(target).filter((x) => x.id !== dragId);
    const at = list.findIndex((x) => x.id === target.id);
    list.splice(at < 0 ? list.length : at, 0, dragged);
    await persistOrder(list);
  };

  const toggleFlag = async (p: Product, key: "featured" | "is_new") => {
    setBusyFlag(true);
    const { error } = await supabase
      .from("products")
      .update({ [key]: !p[key] })
      .eq("id", p.id);
    setBusyFlag(false);
    if (error) return setErr(error.message);
    setProducts((prev) => (prev ? prev.map((x) => (x.id === p.id ? { ...x, [key]: !p[key] } : x)) : prev));
  };

  if (!cats || !branches) return <Spinner />;

  return (
    <div className="space-y-4">
      {err && <div className="status-danger border border-danger-text/30 text-danger-text rounded-xl px-3 py-2 text-sm font-bold">{err}</div>}

      <CategoriesPanel cats={cats} reload={load} busyFlag={busyFlag} setBusyFlag={setBusyFlag} setErr={setErr} />

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
        <p className="text-xs text-brand-700">
          اسحب المنتج من المقبض لتغيير ترتيبه (جوه نفس التصنيف)، أو استخدم الأسهم. ⭐ = مميز، و«جديد» = شارة جديد.
        </p>
        <div className="grid gap-2">
          {[...shown]
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            .map((p, _, arr) => {
              const group = arr.filter((x) => x.branch_id === p.branch_id && x.category_id === p.category_id);
              const gIdx = group.findIndex((x) => x.id === p.id);
              return (
                <div
                  key={p.id}
                  draggable
                  onDragStart={() => setDragId(p.id)}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => {
                    if (dragId) e.preventDefault();
                  }}
                  onDrop={() => dropProduct(p)}
                  className={`flex items-center gap-2 border rounded-xl p-2 transition ${
                    dragId === p.id ? "border-brand-500 bg-brand-50/60 opacity-70" : "border-brand-100"
                  }`}
                >
                  <span className="text-brand-400 cursor-grab" aria-hidden="true">
                    <GripVertical size={16} />
                  </span>
                  {p.image_url ? (
                    <img src={p.image_url} alt="" loading="lazy" className="w-12 h-12 rounded-lg object-cover" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-brand-50" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-extrabold text-brand-900 truncate">
                      {p.name} {!p.is_active && <span className="pill status-warn text-warn-text">مخفي</span>}
                      {p.featured && <span className="pill status-info ms-1">⭐ مميز</span>}
                      {p.is_new && <span className="pill status-ok ms-1">جديد</span>}
                    </p>
                    <p className="text-xs text-brand-700">
                      {p.categories?.name} · {money(Number(p.price))}
                      {p.note ? ` · ${p.note}` : ""}
                    </p>
                    <p className="text-xs">{stockBadge(p)}</p>
                  </div>
                  <div className="flex flex-col gap-1 text-xs">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="pill bg-surface border border-border text-brand-800 disabled:opacity-40"
                        onClick={() => moveProduct(p, -1)}
                        disabled={gIdx <= 0 || busyFlag}
                        aria-label={`حرّك ${p.name} لفوق`}
                      >
                        <ArrowUp size={13} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="pill bg-surface border border-border text-brand-800 disabled:opacity-40"
                        onClick={() => moveProduct(p, 1)}
                        disabled={gIdx < 0 || gIdx >= group.length - 1 || busyFlag}
                        aria-label={`حرّك ${p.name} لتحت`}
                      >
                        <ArrowDown size={13} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={`pill border ${p.featured ? "bg-badge text-badge-fg border-transparent" : "bg-surface border-border text-brand-800"}`}
                        onClick={() => toggleFlag(p, "featured")}
                        aria-pressed={!!p.featured}
                        aria-label={p.featured ? `شيل ${p.name} من المميز` : `خلي ${p.name} مميز`}
                      >
                        <Star size={13} aria-hidden="true" />
                      </button>
                    </div>
                    <div className="flex gap-1">
                      <button className="btn-soft !py-1 !px-2" onClick={() => openForm(p)}>تعديل</button>
                      <button className="pill status-danger text-danger-text" onClick={() => del(p)}>حذف</button>
                    </div>
                  </div>
                </div>
              );
            })}
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
              <p className="mt-1 text-[11px] text-brand-700">
                بنحتفظ بالصورة الأصلية، وبنولّد نسختين WebP (400 و 800px) عشان المنيو يفتح بسرعة.
              </p>
            </div>
            <label className="flex items-center gap-2 font-bold text-brand-900 text-sm">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="accent-brand-500" />
              متاح للعملاء (ظاهر)
            </label>
            <label className="flex items-center gap-2 font-bold text-brand-900 text-sm">
              <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} className="accent-brand-500" />
              ⭐ مميز — يظهر في شريط «مميز» أعلى المنيو
            </label>
            <label className="flex items-center gap-2 font-bold text-brand-900 text-sm">
              <input type="checkbox" checked={form.is_new} onChange={(e) => setForm({ ...form, is_new: e.target.checked })} className="accent-brand-500" />
              ✨ جديد — شارة «جديد» على الكارت
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
