import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, type Branch } from "../lib/types";
import { Skeleton, EmptyBox } from "../components/Common";
import PromoBanner from "../components/PromoBanner";
import { SocialLinksRow, BranchPillLinks, OpenMapButton } from "../components/SocialLinks";
import { Croissant, Store, Sparkles, ChevronLeft } from "lucide-react";

export default function BranchLanding() {
  const { id: branchId } = useParams<{ id: string }>();
  const [branch, setBranch] = useState<Branch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!branchId) return;
    (async () => {
      const { data, error: e } = await supabase
        .from("branches")
        .select("*")
        .eq("id", branchId)
        .eq("is_active", true)
        .maybeSingle();
      if (e) setError(e.message);
      else setBranch((data as Branch | null) ?? null);
    })();
  }, [branchId]);

  if (!branchId) return <EmptyBox msg="الفرع غير محدد" />;
  if (error) return <EmptyBox msg="مش قادرين نجيب بيانات الفرع — جرّب تاني" />;
  if (!branch)
    return (
      <div className="space-y-3" aria-hidden="true">
        <Skeleton className="aspect-[4/3] w-full rounded-[22px] sm:aspect-[16/10]" />
        <Skeleton className="mx-auto h-36 w-full rounded-[22px]" />
      </div>
    );
  if (!branch.is_active) return <EmptyBox msg="هذا الفرع غير متاح حاليًا" />;

  const services = branch.services ?? [];
  const shown = services.slice(0, 3);
  const extra = services.length - shown.length;
  const longText = (branch.description ?? "").length > 90;

  return (
    <div className="space-y-3.5">
      {/* صورة الغلاف */}
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[22px] border border-border bg-gradient-to-br from-surface2 via-surface2 to-page sm:aspect-[16/10]">
        {branch.cover_image ? (
          <img
            src={branch.cover_image}
            alt={`غلاف ${branch.name}`}
            loading="eager"
            decoding="async"
            className="h-full w-full object-cover object-center"
          />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <Croissant size={52} strokeWidth={1.5} className="text-primary" aria-hidden="true" />
          </div>
        )}
      </div>

      <PromoBanner branchId={branchId} />

      {/* بيانات الفرع */}
      <div className="card overflow-hidden">
        <div className="p-4 pt-3">
          <div className="flex items-center gap-3">
            {branch.logo ? (
              <img
                src={branch.logo}
                alt={`شعار ${branch.name}`}
                decoding="async"
                className="h-20 w-20 shrink-0 rounded-2xl border-2 border-surface bg-surface object-cover shadow-md ring-2 ring-surface/80"
              />
            ) : (
              <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border-2 border-surface bg-surface2 shadow-md ring-2 ring-surface/80">
                <Store size={30} className="text-primary-strong" aria-hidden="true" />
              </div>
            )}
            <h1 className="pb-1 text-[21px] font-extrabold leading-snug text-text">{branch.name}</h1>
          </div>

          {branch.promo_brief && (
            <p className="mt-2 flex items-start gap-1.5 text-[13px] font-bold leading-6 text-primary-strong">
              <Sparkles size={14} className="mt-1 shrink-0" aria-hidden="true" />
              <span>{branch.promo_brief}</span>
            </p>
          )}

          {branch.description && (
            <div className="mt-1.5 text-[14px] leading-7 text-muted">
              <span className={expanded ? "" : "clamp-2"}>{branch.description}</span>
              {longText && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="ms-1 rounded font-bold text-primary-strong underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-expanded={expanded}
                >
                  {expanded ? "اقرأ أقل" : "اقرأ المزيد"}
                </button>
              )}
            </div>
          )}

          {services.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {shown.map((s) => (
                <span key={s} className="tag">
                  {s}
                </span>
              ))}
              {extra > 0 && (
                <span className="tag cursor-default" title={services.slice(3).join("، ")}>
                  +{extra}
                </span>
              )}
            </div>
          )}

          {/* الموقع + واتساب + إنستجرام — لصقات واضحة */}
          <BranchPillLinks branchId={branch.id} className="mt-3" />
        </div>
      </div>

      {/* الزر الرئيسي + زر الخريطة الكامل */}
      <div className="card space-y-2.5 p-4 text-center">
        <p className="text-sm text-muted">جاهز تطلب؟ اختار التصنيف وابدأ من المنيو</p>
        <Link to={`/branch/${branch.id}`} className="btn-primary min-h-[52px] w-full text-base">
          <Croissant size={20} aria-hidden="true" />
          شوف المنيو
          <ChevronLeft size={18} aria-hidden="true" />
        </Link>
        <OpenMapButton branchId={branch.id} />
      </div>

      {/* روابط الفرع */}
      <div className="pb-1">
        <SocialLinksRow scope={branch.id} size="md" ariaLabel={`روابط فرع ${branch.name}`} />
      </div>
    </div>
  );
}
