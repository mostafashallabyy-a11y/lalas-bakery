import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, withTimeout, type Branch } from "../lib/types";
import { useCart } from "../context/CartContext";
import { Spinner, EmptyBox } from "../components/Common";

export default function Home() {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { setBranch } = useCart();

  useEffect(() => {
    withTimeout<Branch[]>(
      supabase
        .from("branches")
        .select("*")
        .eq("is_active", true)
        .order("sort_order")
    ).then((res) => {
      if (!res) setError("الفروع مش نازلة دلوقتي — اتأكد من النت وجرّب تاني 🥲");
      else if (res.error) setError("مش قادرين نجيب الفروع دلوقتي — جرّب تحدّث الصفحة 🥲");
      else setBranches(res.data ?? []);
    });
  }, []);

  if (error) return <EmptyBox msg={error} />;
  if (!branches) return <Spinner label="بنجهزلك قايمة الفروع… ☕" />;

  return (
    <div className="space-y-2.5">
      <h2 className="text-[22px] font-bold text-brand-700 mt-1.5 mb-0">أهلًا بيك في Lala&rsquo;s 💗</h2>
      <div className="text-mut text-sm">اختار فرعك وابدأ طلبك</div>

      {branches.length === 0 && <EmptyBox msg="لسه مفيش فروع متاحة — قرب قريب 🥲" />}

      {branches.map((b) => (
        <div key={b.id} className="card p-3.5 text-brand-900">
          <h3 className="text-[19px] font-bold text-brand-700 mb-1">{b.name}</h3>
          <div className="text-mut text-sm">{b.description}</div>
          <div className="mb-2">
            {(b.services || []).map((s) => (
              <span key={s} className="tag">
                {s}
              </span>
            ))}
          </div>
          <p className="m-0">
            <button
              className="btn-primary"
              onClick={() => {
                setBranch(b.id, b.name);
                navigate(`/branch/${b.id}`);
              }}
            >
              شوف المنيو
            </button>
          </p>
        </div>
      ))}
    </div>
  );
}
