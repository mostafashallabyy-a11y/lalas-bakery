import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, type Branch } from "../lib/types";
import { useCart } from "../context/CartContext";
import { Spinner, EmptyBox } from "../components/Common";

export default function Home() {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { setBranch } = useCart();

  useEffect(() => {
    supabase
      .from("branches")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) setError("مش قادرين نجيب الفروع دلوقتي — جرّب تحدّث الصفحة 🥲");
        else setBranches((data as Branch[]) ?? []);
      });
  }, []);

  if (error) return <EmptyBox msg={error} />;
  if (!branches) return <Spinner label="بنجهزلك قايمة الفروع… ☕" />;

  return (
    <div className="py-5 space-y-5">
      <section className="text-center space-y-2">
        <h1 className="text-3xl font-extrabold text-brand-700">أهلًا بيكي في لالة 💞</h1>
        <p className="text-brand-800 font-bold">قهوة مختصة ومخبوزات طازة من فرننا… اختار الفرع الأقرب ليك وابدأ طلبك هنا 💞</p>
        <h2 className="text-xl font-extrabold text-brand-800 pt-2">فروعنا</h2>
      </section>

      <div className="grid gap-4">
        {branches.length === 0 && <EmptyBox msg="لسه مفيش فروع متاحة — للأسف، رجّع قريب 🥲" />}
        {branches.map((b) => (
          <button
            key={b.id}
            onClick={() => {
              setBranch(b.id, b.name);
              navigate(`/branch/${b.id}`);
            }}
            className="card text-right p-5 hover:shadow-md hover:border-brand-300 transition text-brand-900"
          >
            <h3 className="text-lg font-extrabold text-brand-700">{b.name}</h3>
            <p className="mt-1 text-sm text-brand-800">{b.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(b.services || []).map((s) => (
                <span key={s} className="pill bg-brand-100 text-brand-800">
                  {s}
                </span>
              ))}
            </div>
            <span className="mt-4 inline-block text-sm font-bold text-brand-600 hover:underline">
              افتح المنيو ↙
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
