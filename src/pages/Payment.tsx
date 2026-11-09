import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, type OrderStatus } from "../lib/types";
import { money } from "../lib/format";
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

  // الاسم بنخليه في الجلسة فقط — للنسخ في ملاحظة التحويل
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
      if (e || !(data as PayInfo | null)?.ok) {
        setError((e as Error)?.message || "مش لاقيين الطلب ده، اتأكد من الرقم 💗");
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
    <div className="space-y-2.5">
      {/* استقبال الطلب زي النموذج */}
      <div className="card p-3.5 text-center">
        <div className="text-[40px]">🎉</div>
        <h2 className="text-[22px] font-bold text-brand-700 my-1">رقم طلبك {orderNumber}</h2>
        <div className="text-mut text-sm">
          {[customerName, info?.branch_name].filter(Boolean).join(" – ") || "\u00a0"}
        </div>
        {error && <ErrorBox msg={error} />}
      </div>

      {/* خطوات الدفع زي النموذج */}
      <div className="card p-3.5 text-brand-900">
        <b>خطوات الدفع (InstaPay):</b>
        {instapay === "" ? (
          <ErrorBox msg="لسه المدير مظبطش رقم انستا باي — كلمنا في الفرع مباشرة ونظبطلك الطلب 🥺" />
        ) : (
          <ol className="list-decimal pr-5 mt-2 space-y-1.5">
            <li>
              انسخ الرقم:{" "}
              <b className="text-brand-700" dir="ltr">
                {instapay}
              </b>{" "}
              <CopyButton text={instapay} />
            </li>
            <li>
              حوّل <b>{info ? money(info.total) : "…"}</b>
            </li>
            <li>
              اكتب في الملاحظة: <b>{noteText}</b> <CopyButton text={noteText} />
            </li>
          </ol>
        )}
        <div className="text-mut text-sm mt-2">
          بنبدأ التحضير أول ما الدفع يتأكد، وتقدر تتابع طلبك برقمه.
        </div>
        <p className="m-0 mt-3">
          <Link to="/track" className="btn-primary">
            تابع طلبك
          </Link>
        </p>
      </div>
    </div>
  );
}
