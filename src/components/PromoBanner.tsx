import { useEffect, useRef, useState } from "react";
import { supabase, type BranchPromo } from "../lib/types";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";

// عرض البرومو ككاروسيل: سحب باللمس + نقاط + تنقل تلقائي (يتوقف عند التفاعل)
export default function PromoBanner({ branchId }: { branchId?: string }) {
  const [promos, setPromos] = useState<BranchPromo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const touchX = useRef<number | null>(null);
  const paused = useRef(false);

  useEffect(() => {
    (async () => {
      let q = supabase.from("branch_promos").select("*").eq("is_active", true).order("sort_order");
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error: e } = await q;
      if (e) setError(e.message);
      else setPromos((data as BranchPromo[]) ?? []);
    })();
  }, [branchId]);

  const count = promos.length;
  const go = (dir: 1 | -1) => setIdx((i) => (count ? (i + dir + count) % count : 0));

  // تنقل تلقائي كل 5 ثوانٍ — يتوقف لو المستخدم بيلمس/يمر بالماوس
  useEffect(() => {
    if (count < 2) return;
    const t = window.setInterval(() => {
      if (!paused.current && !document.hidden) setIdx((i) => (i + 1) % count);
    }, 5000);
    return () => window.clearInterval(t);
  }, [count]);

  if (error || count === 0) return null;

  const promo = promos[Math.min(idx, count - 1)];
  const hasImage = Boolean(promo.image_url);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="العروض والبرومو"
      className="relative overflow-hidden rounded-[22px] border border-brand-200 shadow-[0_8px_28px_rgba(125,63,80,0.22)]"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      onTouchStart={(e) => {
        paused.current = true;
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        paused.current = false;
        if (start == null) return;
        const end = e.changedTouches[0]?.clientX ?? start;
        const dx = end - start;
        if (Math.abs(dx) < 40) return;
        // RTL: السحب لليسار = التالي
        go(dx < 0 ? 1 : -1);
      }}
    >
      <div
        key={promo.id}
        className="promo-slide relative flex min-h-[150px] items-stretch overflow-hidden bg-gradient-to-l from-[#7d3f50] via-[#9d5a6c] to-[#c2185b] text-white"
      >
        {/* زخارف ناعمة */}
        <div aria-hidden="true" className="pointer-events-none absolute -left-10 -top-10 h-36 w-36 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-12 right-16 h-36 w-36 rounded-full bg-[#e0457b]/30 blur-2xl" />

        <div className="relative flex flex-1 flex-col justify-center gap-1 p-4 text-start">
          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-bold text-[#ffd9e6] backdrop-blur-sm">
            <Sparkles size={12} aria-hidden="true" /> عرض خاص
          </span>
          <h3 className="text-[20px] font-extrabold leading-snug">{promo.title}</h3>
          {promo.text && <p className="line-clamp-2 text-[13px] leading-6 text-white/90">{promo.text}</p>}
          {promo.link_url && (
            <a
              href={promo.link_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex min-h-[40px] w-fit items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-extrabold text-[#7d3f50] shadow transition hover:bg-[#ffeef3] active:scale-95"
            >
              {promo.button_label || "اعرف المزيد"}
              <ChevronLeft size={15} aria-hidden="true" />
            </a>
          )}
        </div>

        {hasImage && (
          <div className="relative w-[38%] shrink-0">
            <img
              src={promo.image_url}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover [mask-image:linear-gradient(to_left,black_55%,transparent)]"
            />
          </div>
        )}
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="العرض السابق"
            className="absolute right-1 top-1/2 grid h-11 w-9 -translate-y-1/2 place-items-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white active:scale-90"
          >
            <ChevronRight size={22} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="العرض التالي"
            className="absolute left-1 top-1/2 grid h-11 w-9 -translate-y-1/2 place-items-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white active:scale-90"
          >
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
          <div className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 gap-1.5" role="tablist" aria-label="اختيار العرض">
            {promos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={i === idx}
                aria-label={`عرض ${i + 1} من ${count}`}
                onClick={() => setIdx(i)}
                className={`h-2 rounded-full transition-all duration-300 ${i === idx ? "w-5 bg-white" : "w-2 bg-white/45 hover:bg-white/70"}`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
