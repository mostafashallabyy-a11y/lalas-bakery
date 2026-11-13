import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { supabase, type OrderStatus } from "../lib/types";
import { money, PAYMENT_STATUS_LABEL } from "../lib/format";
import { CopyButton, ErrorBox, Spinner, Logo } from "../components/Common";
import CheckoutStepper from "../components/CheckoutStepper";
import { storageGet } from "../lib/storage";

type PayInfo = {
  ok: boolean;
  order_id?: string;
  order_number: string;
  total: number;
  status: OrderStatus;
  branch_name: string;
  payment_method?: "cash" | "instapay";
  payment_status?: "pending" | "paid" | "rejected" | "refunded";
  instapay_claimed_at?: string | null;
};

export default function Payment() {
  const { orderNumber: rawNum } = useParams<{ orderNumber: string }>();
  const orderNumber = (rawNum || "").trim().toUpperCase();
  const { search } = useLocation();
  const trackingKey = new URLSearchParams(search).get("k") || "";

  const [instapay, setInstapay] = useState<string | null>(null);
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);

  const customerName = storageGet("session", "lalas_name") || "";

  const load = async () => {
    if (!orderNumber || !trackingKey) {
      setError("رابط الدفع ناقص — افتح صفحة الدفع من رابط المتابعة الكامل (يحتوي على ?k=).");
      return;
    }
    const { data: s } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "instapay_number")
      .maybeSingle();
    setInstapay(s?.value || "");

    const { data, error: e } = await supabase.rpc("get_payment_info", {
      p_order_number: orderNumber,
      p_tracking_key: trackingKey,
    });
    if (e || !(data as PayInfo | null)?.ok) {
      setError((e as Error)?.message || "مش لاقيين الطلب ده، تأكد من الرقم ومفتاح المتابعة 💗");
    } else {
      setInfo(data as unknown as PayInfo);
      setError(null);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [orderNumber, trackingKey]);

  useEffect(() => {
    if (!orderNumber || !trackingKey) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      const { data } = await supabase.rpc("get_payment_info", {
        p_order_number: orderNumber,
        p_tracking_key: trackingKey,
      });
      const r = data as PayInfo | null;
      if (r?.ok) setInfo(r);
    }, 20000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [orderNumber, trackingKey]);

  const claimPaid = async () => {
    setClaimBusy(true);
    setClaimMsg(null);
    try {
      const { data, error } = await supabase.rpc("customer_claim_instapay_payment", {
        p_order_number: orderNumber,
        p_tracking_key: trackingKey,
      });
      if (error || !(data as any)?.ok) throw new Error((data as any)?.message || error?.message || "تعذر تسجيل تأكيد التحويل");
      setClaimMsg("تم إرسال تأكيد التحويل للموظف — في انتظار التأكيد.");
      await load();
    } catch (e) {
      setClaimMsg(e instanceof Error ? e.message : "تعذر تسجيل تأكيد التحويل — جرّب تاني");
    } finally {
      setClaimBusy(false);
    }
  };

  if (!orderNumber) return <ErrorBox msg="رقم الطلب مش موجود في اللنك 🥲" />;
  if (!info && !error) return <Spinner label="بنجهزلك صفحة الدفع… 💳" />;

  const method = info?.payment_method || "instapay";
  const payStatus = info?.payment_status || "pending";
  const claimed = !!info?.instapay_claimed_at;
  const noteText = `${orderNumber}${customerName ? " " + customerName : ""}`;

  return (
    <div className="space-y-3.5">
      <CheckoutStepper step={3} />
      <div className="card p-3.5 text-center">
        <Logo className="mx-auto mb-1 h-20 w-auto" alt="Lala's Bakery" />
        <h1 className="text-[20px] font-extrabold text-brand-800 my-1">طلبك {orderNumber}</h1>
        <div className="text-mut text-sm">
          {[customerName, info?.branch_name].filter(Boolean).join(" – ") || "\u00a0"}
        </div>
        {info && <div className="mt-1 font-bold text-brand-800">الإجمالي: {money(info.total)}</div>}
        {error && <ErrorBox msg={error} />}
      </div>

      {method === "cash" ? (
        <div className="card p-3.5 text-brand-900">
          <b>طريقة الدفع: كاش عند الاستلام 💵</b>
          <div className="msg-box mt-2">
            تمام! هتدفع كاش وقت الاستلام 💗 جهّز المبلغ: <b>{info ? money(info.total) : "…"}</b>
          </div>
          <div className="text-sm mt-2">
            حالة الدفع: <b>{PAYMENT_STATUS_LABEL[payStatus] || payStatus}</b>
            {payStatus === "paid" ? " — تم استلام الكاش ✅" : " — هيتسجّل مدفوع بعد استلام الكاش."}
          </div>
          <p className="m-0 mt-3">
            <Link to={`/order/${orderNumber}?k=${trackingKey}`} className="btn-primary">صفحة الطلب والمتابعة</Link>
          </p>
        </div>
      ) : (
        <div className="card p-3.5 text-brand-900 space-y-2">
          <b>الدفع عبر InstaPay (بدون رفع صورة)</b>

          {payStatus === "paid" ? (
            <div className="msg-box status-ok">تم تأكيد الدفع — شكرًا ليك 💗</div>
          ) : claimed ? (
            <div className="msg-box font-bold">تم الدفع — في انتظار التأكيد الآلي ✅ (تم إرسال رقم الطلب للموظف وسيتم التأكيد سريعًا)</div>
          ) : (
            <>
              {instapay === "" ? (
                <ErrorBox msg="لسه المدير مظبطش رقم انستا باي — كلمنا في الفرع مباشرة ونظبطلك الطلب 🥺" />
              ) : (
                <ol className="list-decimal pr-5 space-y-1.5">
                  <li>انسخ رقم انستا باي: <b className="text-brand-700" dir="ltr">{instapay}</b> {instapay && <CopyButton text={instapay} />}</li>
                  <li>حوّل المبلغ: <b>{info ? money(info.total) : "…"}</b></li>
                  <li>اكتب في ملاحظة التحويل (مهم): <b dir="ltr">{noteText}</b> <CopyButton text={noteText} /></li>
                  <li>بعد إتمام التحويل اضغط الزر بالأسفل لإرسال تأكيد التحويل برقم الطلب (بدون رفع صورة).</li>
                </ol>
              )}
              <button type="button" className="btn-primary w-full mt-1" disabled={claimBusy || !instapay} onClick={claimPaid}>
                {claimBusy ? "جارٍ الإرسال…" : "تم التحويل — أرسل تأكيد الدفع"}
              </button>
            </>
          )}

          {claimMsg && <div className="text-sm font-bold">{claimMsg}</div>}

          <div className="text-sm mt-1">
            حالة الدفع: <b>{payStatus === "paid" ? "مدفوع ✅" : claimed ? "تم الدفع — في انتظار التأكيد الآلي" : (PAYMENT_STATUS_LABEL[payStatus] || payStatus)}</b>
          </div>
          <div className="text-mut text-sm">سيتم تأكيد طلبك بسرعة بمجرّد مراجعة رقم الطلب. تقدر تتابع حالة الطلب من صفحة المتابعة.</div>
          <p className="m-0 mt-2 flex gap-2 justify-center flex-wrap">
            <Link to={`/order/${orderNumber}?k=${trackingKey}`} className="btn-outline">صفحة الطلب</Link>
            <Link to={`/track?k=${trackingKey}`} className="btn-primary">تابع طلبك</Link>
          </p>
        </div>
      )}
    </div>
  );
}
