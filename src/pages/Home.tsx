import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, withTimeout, type Branch } from "../lib/types";
import { useCart } from "../context/CartContext";
import { EmptyBox, BranchListSkeleton, Logo } from "../components/Common";
import PromoBanner from "../components/PromoBanner";
import { SocialLinksFollow, BranchPillLinks } from "../components/SocialLinks";
import { ArrowDown, Croissant, Store, Sparkles } from "lucide-react";

function BranchCard({ branch }: { branch: Branch }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const { setBranch } = useCart();

  const services = branch.services ?? [];
  const shown = services.slice(0, 3);
  const extra = services.length - shown.length;
  const longText = (branch.description ?? "").length > 90;

  return (
    <article className="card overflow-hidden text-text">
      {/* صورة الغلاف مع placeholder أنيق لو مش موجودة */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-gradient-to-br from-surface2 via-surface2 to-border/25 sm:aspect-[16/10]">
        {branch.cover_image ? (
          <img
            src={branch.cover_image}
            alt={`غلاف ${branch.name}`}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover object-center"
          />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <Croissant size={44} strokeWidth={1.5} className="text-primary" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="p-4 pt-3">
        {/* اللوجو + الاسم */}
        <div className="flex items-center gap-3">
          {branch.logo ? (
            <img
              src={branch.logo}
              alt={`شعار ${branch.name}`}
              loading="lazy"
              decoding="async"
              className="h-16 w-16 shrink-0 rounded-2xl border-2 border-surface bg-surface object-cover shadow-md ring-2 ring-surface/80"
            />
          ) : (
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border-2 border-surface bg-surface2 shadow-md ring-2 ring-surface/80">
              <Store size={26} className="text-primary-strong" aria-hidden="true" />
            </div>
          )}
          <h3 className="pb-0.5 text-[19px] font-extrabold leading-snug text-text">{branch.name}</h3>
        </div>

        {/* سطر البرومو */}
        {branch.promo_brief && (
          <p className="mt-2 flex items-start gap-1.5 text-[13px] font-bold leading-6 text-primary-strong">
            <Sparkles size={14} className="mt-1 shrink-0" aria-hidden="true" />
            <span className="line-clamp-1">{branch.promo_brief}</span>
          </p>
        )}

        {/* الوصف: سطرين مع اقرأ المزيد */}
        {branch.description && (
          <div className="mt-1.5 text-[14px] leading-6 text-muted">
            <span className={expanded ? "" : "clamp-2"}>{branch.description}</span>
            {longText && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="ms-1 rounded font-bold text-primary-strong underline underline-offset-2 outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={expanded}
              >
                {expanded ? "اقرأ أقل" : "اقرأ المزيد"}
              </button>
            )}
          </div>
        )}

        {/* الخدمات: 3 لصقات بحد أقصى + عداد الباقي */}
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

        {/* الأزرار */}
        <div className="mt-3">
          <button
            type="button"
            className="btn-primary min-h-[48px] w-full text-base"
            onClick={() => {
              setBranch(branch.id, branch.name);
              navigate(`/branch/${branch.id}/landing`);
            }}
          >
            شوف المنيو
          </button>
          <BranchPillLinks branchId={branch.id} className="mt-2" />
        </div>
      </div>
    </article>
  );
}

export default function Home() {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { branchId } = useCart();

  useEffect(() => {
    withTimeout<Branch[]>(
      supabase
        .from("branches")
        .select("*")
        .eq("is_active", true)
        .order("sort_order")
    ).then((res) => {
      if (!res) setError("الفروع مش نازلة دلوقتي — اتأكد من النت وجرّب تاني");
      else if (res.error) setError("مش قادرين نجيب الفروع دلوقتي — جرّب تحدّث الصفحة");
      else setBranches(res.data ?? []);
    });
  }, []);

  const scrollToBranches = () => {
    if (branchId) {
      navigate(`/branch/${branchId}`);
      return;
    }
    document.getElementById("branches")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-4">
      {/* ============ الهيرو ============ */}
      <section className="relative overflow-hidden rounded-[26px] border border-border bg-gradient-to-bl from-surface2 via-surface2 to-page px-4 pb-6 pt-5 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
        <div aria-hidden="true" className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-btnbg/10 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-16 -left-12 h-44 w-44 rounded-full bg-accent/10 blur-3xl" />

        <div className="relative">
          <Logo
            alt="Lala's Bakery"
            className="mx-auto h-32 w-auto object-contain drop-shadow-[0_6px_14px_rgb(0_0_0/0.25)] sm:h-36"
          />
          <h1 className="mt-2 text-[25px] font-extrabold leading-snug text-text">
            مخبوزات وقهوة منزلية،
            <br />
            تُحضّر بكل حب
          </h1>
          <p className="mx-auto mt-1 max-w-[34ch] text-[14px] leading-6 text-muted">
            طازة من الفرن… والقهوة مظبوطة زي ما بتحبيها
          </p>
          <button
            type="button"
            onClick={scrollToBranches}
            className="btn-primary mt-4 min-h-[52px] px-9 text-lg"
            style={{ boxShadow: "var(--shadow-pop)" }}
          >
            اطلب الآن
            <ArrowDown size={20} strokeWidth={2.4} aria-hidden="true" />
          </button>

          {/* روابط العلامة تحت الهيرو — تظهر فقط لو في روابط */}
          <SocialLinksFollow
            scope="brand"
            size="sm"
            label="تابعنا"
            className="mt-4 border-t border-border pt-3"
          />
        </div>
      </section>

      <PromoBanner />

      {/* ============ قائمة الفروع ============ */}
      <div id="branches" className="scroll-mt-20">
        <div className="mb-2 flex items-end justify-between">
          <h2 className="text-[20px] font-extrabold text-text">فروعنا</h2>
          <span className="text-xs font-bold text-muted">اختار الفرع وابدأ طلبك</span>
        </div>

        {error && <EmptyBox msg={error} />}
        {!error && !branches && <BranchListSkeleton count={2} />}
        {!error && branches && branches.length === 0 && <EmptyBox msg="لسه مفيش فروع متاحة — قريب جدًا" />}
        <div className="space-y-3.5">
          {!error && branches?.map((b) => <BranchCard key={b.id} branch={b} />)}
        </div>
      </div>
    </div>
  );
}
