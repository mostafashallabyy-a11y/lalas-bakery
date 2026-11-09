import { useEffect, useState } from "react";
import { supabase, type BranchPromo } from "../lib/types";

export default function PromoBanner({ branchId }: { branchId?: string }) {
  const [promos, setPromos] = useState<BranchPromo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      let q = supabase.from("branch_promos").select("*").eq("is_active", true).order("sort_order");
      if (branchId) q = q.eq("branch_id", branchId);
      const { data, error: e } = await q;
      if (e) setError(e.message);
      else setPromos((data as BranchPromo[]) ?? []);
    })();
  }, [branchId]);

  if (error) return <div className="text-sm text-mut">{error}</div>;
  if (!promos.length) return null;

  return (
    <div className="space-y-2">
      <div className="relative h-36 w-full rounded-[20px] overflow-hidden border border-brand-200 bg-brand-50">
        <div className="absolute inset-0 flex items-center justify-between px-4 py-6 text-white shadow-[0_2px_12px_rgba(125,63,80,0.25)]">
          <div>
            <div className="text-[20px] font-extrabold">{promos[0].title}</div>
            <div className="text-sm mt-1 opacity-90">{promos[0].text}</div>
          </div>
          {promos[0].image_url ? (
            <img src={promos[0].image_url} alt="برومو" className="h-32 object-cover rounded-[16px]" />
          ) : null}
        </div>
        {promos.length > 1 && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
            {promos.map((_, i) => (
              <button
                key={i}
                className={`w-2 h-2 rounded-full ${i === 0 ? "bg-brand-700" : "bg-brand-200"}`}
              />
            ))}
          </div>
        )}
      </div>
      <div className="text-center">
        <a
          href={promos[0].link_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block btn-primary text-xs !px-4 !py-2 text-sm"
        >
          {promos[0].button_label} →
        </a>
      </div>
    </div>
  );
}
