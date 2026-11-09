import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase, type Branch } from "../lib/types";
import { Spinner, EmptyBox } from "../components/Common";
import PromoBanner from "../components/PromoBanner";

export default function BranchLanding() {
  const { id: branchId } = useParams<{ id: string }>();
  const [branch, setBranch] = useState<Branch | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  if (error) return <EmptyBox msg="مش قادرين نجيب بيانات الفرع — جرّب تاني 🥲" />;
  if (!branch) return <Spinner label="بنجيب بيانات الفرع… ☕" />;
  if (!branch.is_active) return <EmptyBox msg="هذا الفرع غير متاح حاليًا" />;

  return (
    <div className="space-y-2.5">
      {/* صورة الغلاف */}
      {branch.cover_image && (
        <div className="relative h-48 w-full rounded-xl overflow-hidden border border-brand-200 bg-brand-50">
          <img src={branch.cover_image} alt={branch.name} className="w-full h-full object-cover" />
        </div>
      )}
      <PromoBanner branchId={branchId} />
      <div className="text-center">
        {/* شعار الفرع */}
        {branch.logo ? (
          <img src={branch.logo} alt={branch.name} className="w-20 h-20 rounded-full mx-auto border-4 border-brand-100" />
        ) : (
          <div className="w-20 h-20 rounded-full mx-auto bg-brand-50 border-4 border-brand-200 flex items-center justify-center text-2xl">🏪</div>
        )}
        <h2 className="text-[22px] font-extrabold text-brand-700 mt-3 mb-1">{branch.name}</h2>
        {branch.promo_brief && <p className="text-mut text-sm mt-1 italic">"{branch.promo_brief}"</p>}
        <p className="text-brand-800 text-sm mt-2">{branch.description}</p>
        <div className="flex flex-wrap justify-center gap-1.5 mt-3">
          {(branch.services || []).map((s) => (
            <span key={s} className="tag">{s}</span>
          ))}
        </div>
      </div>

      <div className="card p-4 text-center mt-4">
        <p className="text-mut text-sm mb-3">اختار التصنيف وابدأ طلبك من هذا الفرع</p>
        <a href={`/branch/${branch.id}`} className="btn-primary w-full text-base">
          🍰 شوف المنيو
        </a>
      </div>
    </div>
  );
}
