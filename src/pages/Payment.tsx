import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { supabase, type OrderStatus } from "../lib/types";
import { money, PAYMENT_STATUS_LABEL } from "../lib/format";
import { CopyButton, ErrorBox, Spinner, Logo } from "../components/Common";
import CheckoutStepper from "../components/CheckoutStepper";
import { buildOrderWhatsAppMessage, waMeLink, type ShareOrderDetails } from "../lib/whatsapp";
import { fetchBrandWhatsapp } from "../lib/settings";

type PayDetails = ShareOrderDetails & {
  ok: boolean;
  status?: OrderStatus;
  payment_status?: "pending" | "paid" | "rejected" | "refunded";
  payment_method?: "cash" | "instapay";
  instapay_claimed_at?: string | null;
  message?: string;
};

export default function Payment() {
  const { orderNumber: rawNum } = useParams<{ orderNumber: string }>();
  const orderNumber = (rawNum || "").trim().toUpperCase();
  const { search } = useLocation();
  const trackingKey = new URLSearchParams(search).get("k") || "";

  const [instapay, setInstapay] = useState<string | null>(null);
  const [brandWa, setBrandWa] = useState<string>("");
  const [details, setDetails] = useState<PayDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimMsg, setClaimMsg] = useState<string | null>(null);

  const load = async () => {
    if (!orderNumber || !trackingKey) {
      setError("رابط الدفع ناقص — افتح صفحة الدفع من رابط المتابعة الكامل (يحتوي على ?k=).");
      return;
    }
    const [detailsRes, instapayRes, brandWaRes] = await Promise.all([
      supabase.rpc("get_order_details", { p_order_number: orderNumber, p_tracking_key: trackingKey }),
      supabase.from("settings").select("value").eq("key", "instapay_number").maybeSingle(),
      fetchBrandWhatsapp(),
    ]);
    const d = detailsRes.data as PayDetails | null;
    setInstapay(instapayRes.data?.value || "");
    setBrandWa(brandWaRes);
    if (detailsRes.error || !d?.ok) {
      setError((detailsRes.error as Error)?.message || d?.message || "مش لاقيين الطلب ده، تأكد من الرقم ومفتاح المتابعة 💗");
    } else {
      setDetails(d);
      setError(null);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [orderNumber, trackingKey]);

  useEffect(() => {
    if (!orderNumber || !trackingKey) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      const { data } = await supabase.rpc("get_order_details", {
        p_order_number: orderNumber,
        p_tracking_key: trackingKey,
      });
      const d = data as PayDetails | null;
      if (d?.ok) setDetails(d);
    }, 20000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [orderNumber, trackingKey]);

  const message = useMemo(
    () => (details ? buildOrderWhatsAppMessage(details, "طلب جديد 💗") : ""),
    [details]
  );
  const waLink = waMeLink(brandWa, message);

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
  if (!details && !error) return <Spinner label="بنجهزلك صفحة الدفع… 💳" />;

  const method = details?.payment_method || "instapay";
  const payStatus = details?.payment_status || "pending";
  const claimed = !!details?.instapay_claimed_at;

  return (
    <div className="space-y-3.5">
      <CheckoutStepper step={3} />
      <div className="card p-3.5 text-center">
        <Logo className="mx-auto mb-1 h-20 w-auto" alt="Lala's Bakery" />
        <h1 className="text-[20px] font-extrabold text-brand-800 my-1">طلبك {orderNumber}</h1>
        <div className="text-mut text-sm">
          {[details?.customer_name, details?.branch_name].filter(Boolean).join(" – ") || "\u00a0"}
        </div>
        {details && <div className="mt-1 font-bold text-brand-800">الإجمالي: {money(details.total)}</div>}
        {error && <ErrorBox msg={error} />}
      </div>

      {method === "cash" ? (
        <div className="card p-3.5 text-brand-900">
          <b>طريقة الدفع: كاش عند الاستلام 💵</b>
          <div className="msg-box mt-2">
            تمام! هتدفع كاش وقت الاستلام 💗 جهّز المبلغ: <b>{details ? money(details.total) : "…"}</b>
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
                <>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>رقم انستا باي: <b className="text-brand-700" dir="ltr">{instapay}</b></span>
                    <CopyButton text={instapay || ""} label="نسخ" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>رقم واتساب المحل: <b className="text-brand-700" dir="ltr">{brandWa || "…"}</b></span>
                    {brandWa && <CopyButton text={brandWa} label="نسخ الرقم" />}
                  </div>

                  <div className="rounded-2xl border border-border bg-surface2 p-2.5 text-sm leading-6 whitespace-pre-wrap" dir="rtl">{message}</div>
                  <div className="grid gap-2">
                    <CopyButton text={message} label="📋 نسخ الرسالة" className="btn-primary w-full !px-4 !py-3 text-base" />
                    {waLink ? (
                      <a className="btn-primary w-full !px-4 !py-3 text-base text-center" href={waLink} target="_blank" rel="noopener noreferrer">💬 افتح واتساب وأرسلها</a>
                    ) : (
                      <button type="button" className="btn-primary w-full !px-4 !py-3 text-base opacity-60" disabled>💬 افتح واتساب وأرسلها</button>
                    )}
                  </div>
                  <p className="m-0 text-xs text-muted font-bold">بعد التحويل ابعت الرسالة وصورة التحويل على واتساب 💗</p>
                </>
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
            <Link to="/track" className="btn-primary">تابع طلبك</Link>
          </p>
        </div>
      )}
    </div>
  );
}
