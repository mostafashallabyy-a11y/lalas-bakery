import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, type OrderStatus } from "../lib/types";
import { money, STATUS } from "../lib/format";
import { CopyButton, ErrorBox, Spinner } from "../components/Common";

type PayInfo = {
  ok: boolean;
  order_number: string;
  total: number;
  status: OrderStatus;
  branch_name: string;
};

export default function Payment() {
  const { orderNumber: rawNum } = useParams<{ orderNumber: string }>();
  const orderNumber = (rawNum || "").trim().toUpperCase();

  const [instapay, setInstapay] = useState<string | null>(null);
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // الاسم بنخليه في الجلسة فقط (لا يعرض على السيرفر في info RPC) — للنسخ في ملاحظة التحويل
  const customerName = sessionStorage.getItem("lalas_name") || "";

  useEffect(() => {
    (async () => {
      // رقم انستا باي متاح للجميع من settings
      const { data: s } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "instapay_number")
        .maybeSingle();
      setInstapay(s?.value || "");

      // مبلغ الطلب (RPC عام: يرجّع الرقم والمبلغ والحالة واسم الفرع فقط)
      const { data, error: e } = await supabase.rpc("get_payment_info", {
        p_order_number: orderNumber,
      });
      if (e || !data || !data.ok) {
        setError((e as Error)?.message || "رقم الطلب مش موجود — اتأكد منه 🥲");
      } else {
        setInfo(data as unknown as PayInfo);
      }
    })();
  }, [orderNumber]);

  // تحديث لحظي للحالة عبر Supabase Realtime
  useEffect(() => {
    if (!orderNumber) return;
    const ch = supabase
      .channel(`lb-pay-${orderNumber}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_status_public", filter: `order_number=eq.${orderNumber}` },
        (payload) => {
          const row = payload.new as { status: OrderStatus } | null;
          if (row?.status) setInfo((prev) => (prev ? { ...prev, status: row.status } : prev));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [orderNumber]);

  if (!orderNumber) return <ErrorBox msg="رقم الطلب مش موجود في اللنك 🥲" />;
  if (!instapay) return <Spinner label="بنجهزلك صفحة الدفع… 💳" />;

  const noteText = `${orderNumber}${customerName ? " " + customerName : ""}`;

  return (
    <div className="py-4 space-y-4">
      <div className="card p-5 text-center space-y-1">
        <p className="text-sm font-bold text-brand-800">رقم طلبك — احتفظ بيه للتتبع ⬇</p>
        <p className="text-3xl font-extrabold text-brand-600 tracking-widest" dir="ltr">
          {orderNumber}
        </p>
        <p className="pill mx-auto bg-brand-100 text-brand-800">
          الحالة دلوقتي: {STATUS[info?.status ?? "received"].label} {STATUS[info?.status ?? "received"].emoji}
        </p>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-extrabold text-brand-700 text-lg">ادفع على انستا باي 💳</h2>

        {instapay === "" ? (
          <ErrorBox msg="لسه المدير مظبطش رقم انستا باي — كلمنا في الفرع مباشرة ونظبطلك الطلب 🥺" />
        ) : (
          <div className="flex items-center justify-between gap-2 bg-brand-50 rounded-xl px-3 py-3">
            <span className="font-extrabold text-brand-900 text-lg" dir="ltr">
              {instapay}
            </span>
            <CopyButton text={instapay} label="انسخ الرقم" />
          </div>
        )}

        <div className="bg-white border border-brand-100 rounded-xl px-3 py-3 text-sm font-bold text-brand-900">
          <div className="flex items-center justify-between gap-2">
            <div>
              المبلغ المطلوب بالظبط:{" "}
              {info ? (
                <span className="text-brand-600 text-lg" dir="ltr">
                  {money(info.total)}
                </span>
              ) : (
                "…"
              )}
              {info && <span className="block text-xs text-brand-700 font-bold mt-1">فرع {info.branch_name}</span>}
            </div>
            {info && <CopyButton text={String(info.total)} label="انسخ المبلغ" />}
          </div>
        </div>

        <div className="bg-brand-50 border border-brand-100 rounded-xl px-3 py-3 text-sm text-brand-900 space-y-2">
          <p className="font-extrabold">اكتب ده في التعليقات بتاعة التحويل (انسخ والصق):</p>
          <div className="flex items-center justify-between gap-2">
            <code className="font-extrabold text-brand-700 break-all" dir="auto">
              {noteText}
            </code>
            <CopyButton text={noteText} label="انسخ" />
          </div>
        </div>

        {error && <ErrorBox msg={error} />}

        <p className="text-xs text-brand-700 font-bold">
          بعد ما تحوّل، الموظف هيثبّت الدفع والحالة هتتغيّر تلقائيًا هنا ومن صفحة التتبع 🌸
        </p>
        <Link to="/track" className="btn-soft w-full">
          تتبّع الطلب مباشرة ↺
        </Link>
      </div>
    </div>
  );
}
