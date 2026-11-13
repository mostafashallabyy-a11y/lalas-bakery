import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type Branch, type SocialLink } from "../../lib/types";
import { useAuth } from "../../context/AuthContext";
import { EmptyBox, ErrorBox } from "../../components/Common";
import {
  SocialLinksRow,
  buildWhatsAppUrl,
  isValidHttpsUrl,
  normalizeSocialUrl,
} from "../../components/SocialLinks";

const PLATFORMS: { value: SocialLink["platform"]; label: string }[] = [
  { value: "instagram", label: "إنستغرام" },
  { value: "facebook", label: "فيسبوك" },
  { value: "tiktok", label: "تيك توك" },
  { value: "whatsapp", label: "واتساب (أدخل رقم الهاتف)" },
  { value: "youtube", label: "يوتيوب" },
  { value: "x", label: "إكس (تويتر)" },
  { value: "snapchat", label: "سnapchat" },
  { value: "telegram", label: "تليجرام" },
  { value: "google_maps", label: "خريطة جوجل" },
  { value: "website", label: "الموقع الإلكتروني" },
];

export default function SocialLinksAdmin() {
  const { profile } = useAuth();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<string>("brand");


  // add/edit form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [platform, setPlatform] = useState<SocialLink["platform"]>("instagram");
  const [urlValue, setUrlValue] = useState("");
  const [label, setLabel] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [sortOrder, setSortOrder] = useState(0);

  const loadBranches = useCallback(async () => {
    const { data } = await supabase
      .from("branches")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order");
    if (data) setBranches((data as Branch[]) ?? []);
  }, []);

  const loadLinks = useCallback(async () => {
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase
      .from("social_links")
      .select("*")
      .eq("scope", scope)
      .order("sort_order", { ascending: true });
    setBusy(false);
    if (error) return setErr(error.message);
    setLinks((data as SocialLink[]) ?? []);
  }, [scope]);

  useEffect(() => {
    loadBranches();
    loadLinks();
  }, [loadBranches, loadLinks]);

  const scopeLabel =
    scope === "brand"
      ? "العلامة التجارية الرئيسية"
      : branches?.find((b) => b.id === scope)?.name || scope;

  const startAdd = () => {
    setEditingId(null);
    setPlatform("instagram");
    setUrlValue("");
    setLabel("");
    setIsActive(true);
    setSortOrder(0);
  };

  const startEdit = (link: SocialLink) => {
    setEditingId(link.id);
    setPlatform(link.platform);
    // For whatsapp the stored url is https://wa.me/<number>; show only the digits in the input.
    const display = link.platform === "whatsapp" ? link.url.replace(/^https:\/\/wa\.me\//, "") : link.url;
    setUrlValue(display);
    setLabel(link.label || "");
    setIsActive(link.is_active);
    setSortOrder(link.sort_order);
  };

  const save = async () => {
    setErr(null);
    setOk(null);
    const storedUrl = normalizeSocialUrl(platform, urlValue);
    if (!storedUrl || !isValidHttpsUrl(storedUrl)) {
      return setErr("الرابط يجب أن يكون رابطًا صالحًا يبدأ بـ https:// (للواتساب أدخل رقم الهاتف)");
    }
    if (label.length > 60) return setErr("العلامة طويلة جدًا (حدها 60 حرف)");

    setBusy(true);
    try {
      const row = {
        scope,
        platform,
        url: storedUrl,
        label: label.trim() || null,
        is_active: isActive,
        sort_order: Number(sortOrder) || 0,
      };
      if (editingId) {
        const { error } = await supabase.from("social_links").update(row).eq("id", editingId);
        if (error) throw error;
        setOk("تم تعديل الرابط ✅");
      } else {
        const { error } = await supabase.from("social_links").insert(row);
        if (error) throw error;
        setOk("تم إضافة الرابط ✅");
      }
      setEditingId(null);
      await loadLinks();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: string) => {
    if (!confirm("متأكد تحذف هذا الرابط؟")) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("social_links").delete().eq("id", id);
      if (error) throw error;
      await loadLinks();
      setOk("تم الحذف ✅");
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (link: SocialLink) => {
    setBusy(true);
    try {
      const { error } = await supabase
        .from("social_links")
        .update({ is_active: !link.is_active })
        .eq("id", link.id);
      if (error) throw error;
      await loadLinks();
      setOk(link.is_active ? "تم إخفاء الرابط" : "تم إظهار الرابط");
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveSort = async (id: string, newSort: number) => {
    const { error } = await supabase.from("social_links").update({ sort_order: newSort }).eq("id", id);
    if (error) setErr(error.message);
    else setOk("تم تحديث الترتيب ✅");
  };

  const testLink = (url: string, plat: SocialLink["platform"]) => {
    const target = plat === "whatsapp" ? buildWhatsAppUrl(url) : url;
    if (!isValidHttpsUrl(target)) return setErr("الرابط غير آمن ولا يمكن فتحه");
    window.open(target, "_blank");
  };

  const linksForScope = useMemo(() => [...links].sort((a, b) => a.sort_order - b.sort_order), [links]);

  // Only managers may manage links. RLS enforces this on the DB too.
  if (!profile || profile.role !== "manager") {
    return (
      <div className="card p-8 text-center text-danger-text font-bold">
        هذه الصفحة للمدير فقط.
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24">
      {err && <ErrorBox msg={err} />}
      {ok && (
        <div className="status-ok border border-ok/40 text-ok-text rounded-xl px-3 py-2 text-sm font-bold">
          {ok}
        </div>
      )}

      <div className="card p-4 space-y-3">
        <h2 className="font-extrabold text-brand-800">روابط التواصل 🔗</h2>
        <p className="text-sm text-mut">
          اختر النطاق الذي تريد إدارة روابطه. الروابط تظهر للعملاء فقط لو كانت نشطة (is_active).
        </p>
        <div className="flex gap-2 items-end">
          <div className="flex-1 min-w-[180px]">
            <label className="label block text-sm mb-1">النطاق</label>
            <select
              className="input w-full"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
              }}
            >
              <option value="brand">العلامة التجارية الرئيسية</option>
              {branches?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-brand-600 ml-2">
            النطاق الحالي: <span className="font-bold">{scopeLabel}</span>
          </p>
        </div>
      </div>

      {/* add / edit form */}
      <div className="card p-4 space-y-3">
        <h3 className="font-bold text-brand-800">
          {editingId ? "تعديل رابط" : "إضافة رابط جديد"}
        </h3>
        <div>
          <label className="label">المنصة</label>
          <select className="input w-full" value={platform} onChange={(e) => setPlatform(e.target.value as SocialLink["platform"])}>
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">
            الرابط / رقم الهاتف {platform === "whatsapp" ? "(فقط أرقام)" : "(يجب أن يبدأ بـ https://)"}
          </label>
          <input
            className="input"
            dir="ltr"
            value={urlValue}
            placeholder={platform === "whatsapp" ? "201000000000" : "https://example.com"}
            onChange={(e) => setUrlValue(e.target.value)}
            maxLength={300}
          />
        </div>
        <div>
          <label className="label">العلامة الظاهرة للعملاء (اختياري)</label>
          <input className="input" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
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
          <button className="btn-primary" disabled={busy} onClick={save}>
            {busy ? "جاري الحفظ…" : editingId ? "تعديل" : "إضافة"}
          </button>
          <button className="btn-soft" onClick={startAdd} disabled={!editingId}>
            إلغاء التعديل
          </button>
        </div>
      </div>

      {/* existing links list */}
      <div className="card p-4 space-y-2">
        <h3 className="font-bold text-brand-800">الروابط الحالية لنطاق «{scopeLabel}»</h3>
        {linksForScope.length === 0 ? (
          <EmptyBox msg="مفيش روابط لهذه النطاق بعد." />
        ) : (
          <div className="grid gap-2">
            {linksForScope.map((link) => (
              <div key={link.id} className="card p-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{PLATFORMS.find((p) => p.value === link.platform)?.label || link.platform}</span>
                  <span className="text-xs text-mut truncate max-w-xs" dir="ltr">
                    {link.platform === "whatsapp" ? link.url.replace(/^https:\/\/wa\.me\//, "") : link.url}
                  </span>
                  {link.label && <span className="text-xs text-brand-600 truncate max-w-xs">— {link.label}</span>}
                </div>
                <div className="flex items-center gap-1">
                  <input
                    className="input w-20 text-xs"
                    type="number"
                    value={link.sort_order}
                    onChange={(e) => saveSort(link.id, Number(e.target.value) || 0)}
                  />
                  <button
                    className={`btn-soft !py-1.5 !px-3 text-xs shrink-0 ${
                      link.is_active ? "text-brand-700" : "text-brand-400"
                    }`}
                    onClick={() => toggleActive(link)}
                  >
                    {link.is_active ? "إخفاء" : "إظهار"}
                  </button>
                  <button
                    className="btn-soft !py-1.5 !px-3 text-xs shrink-0"
                    onClick={() => startEdit(link)}
                  >
                    تعديل
                  </button>
                  <button
                    className="btn-soft !py-1.5 !px-3 text-xs shrink-0"
                    onClick={() => testLink(link.url, link.platform)}
                  >
                    اختبار الرابط
                  </button>
                  <button
                    className="btn-soft !py-1.5 !px-3 text-xs shrink-0 text-red-500"
                    onClick={() => del(link.id)}
                  >
                    حذف
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* live preview */}
      <div className="card p-4">
        <h3 className="font-bold text-brand-800 mb-2">مباشر (ماذا يرى العملاء)</h3>
        <SocialLinksRow scope={scope} size="md" />
      </div>
    </div>
  );
}
