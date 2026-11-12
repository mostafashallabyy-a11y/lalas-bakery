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
    <article className="card overflow-hidden text-brand-900">
      {/* صورة الغلاف مع placeholder أنيق لو مش موجودة */}
      <div className="relative h-36 w-full overflow-hidden bg-gradient-to-br from-brand-200 via-brand-100 to-[#f6cdd8] sm:h-40">
        {branch.cover_image ? (
          <img
            src={branch.cover_image}
            alt={`غلاف ${branch.name}`}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <Croissant size={44} strokeWidth={1.5} className="text-brand-500/70" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="p-4 pt-0">
        {/* اللوجو + الاسم */}
        <div className="-mt-7 flex items-end gap-3">
          {branch.logo ? (
            <img
              src={branch.logo}
              alt={`شعار ${branch.name}`}
              loading="lazy"
              decoding="async"
              className="h-16 w-16 shrink-0 rounded-2xl border-2 border-white object-cover shadow-md dark:border-[#332429]"
            />
          ) : (
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border-2 border-white bg-brand-100 shadow-md dark:border-[#332429]">
              <Store size={26} className="text-brand-600" aria-hidden="true" />
            </div>
          )}
          <h3 className="pb-0.5 text-[19px] font-extrabold leading-snug text-brand-800">{branch.name}</h3>
        </div>

        {/* سطر البرومو */}
        {branch.promo_brief && (
          <p className="mt-2 flex items-start gap-1.5 text-[13px] font-bold leading-6 text-brand-600">
            <Sparkles size={14} className="mt-1 shrink-0" aria-hidden="true" />
            <span className="line-clamp-1">{branch.promo_brief}</span>
          </p>
        )}

        {/* الوصف: سطرين مع اقرأ المزيد */}
        {branch.description && (
          <div className="mt-1.5 text-[14px] leading-6 text-mut">
            <span className={expanded ? "" : "clamp-2"}>{branch.description}</span>
            {longText && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="ms-1 font-bold text-brand-600 underline underline-offset-2 outline-none transition hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
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
              <span className="tag cursor-default bg-brand-200/60" title={services.slice(3).join("، ")}>
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
      <section className="relative overflow-hidden rounded-[26px] border border-brand-200 bg-gradient-to-bl from-[#ffe9ee] via-brand-100 to-[#f3cdd8] px-4 pb-6 pt-5 text-center shadow-[0_10px_35px_rgba(125,63,80,0.18)] dark:border-white/10 dark:from-[#4a2a33] dark:via-[#332429] dark:to-[#2b2125]">
        <div aria-hidden="true" className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-white/45 blur-3xl dark:bg-[#e0457b]/10" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-16 -left-12 h-44 w-44 rounded-full bg-[#e0457b]/15 blur-3xl dark:bg-[#e0457b]/10" />

        <div className="relative">
          <Logo
            alt="Lala's Bakery"
            className="mx-auto h-32 w-auto object-contain drop-shadow-[0_6px_14px_rgba(125,63,80,0.30)] sm:h-36"
          />
          <h1 className="mt-2 text-[25px] font-extrabold leading-snug text-brand-800 dark:text-[#ffe3ea]">
            مخبوزات وقهوة منزلية،
            <br />
            تُحضّر بكل حب
          </h1>
          <p className="mx-auto mt-1 max-w-[34ch] text-[14px] leading-6 text-brand-700/90 dark:text-[#ecc9d2]">
            طازة من الفرن… والقهوة مظبوطة زي ما بتحبيها
          </p>
          <button
            type="button"
            onClick={scrollToBranches}
            className="btn-primary mt-4 min-h-[52px] px-9 text-lg shadow-[0_10px_25px_rgba(157,90,108,0.45)]"
          >
            اطلب الآن
            <ArrowDown size={20} strokeWidth={2.4} aria-hidden="true" />
          </button>

          {/* روابط العلامة تحت الهيرو — تظهر فقط لو في روابط */}
          <SocialLinksFollow
            scope="brand"
            size="sm"
            label="تابعنا"
            className="mt-4 border-t border-brand-300/40 pt-3 dark:border-white/10"
          />
        </div>
      </section>

      <PromoBanner />

      {/* ============ قائمة الفروع ============ */}
      <div id="branches" className="scroll-mt-20">
        <div className="mb-2 flex items-end justify-between">
          <h2 className="text-[20px] font-extrabold text-brand-800 dark:text-[#ffe3ea]">فروعنا</h2>
          <span className="text-xs font-bold text-mut">اختار الفرع وابدأ طلبك</span>
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
