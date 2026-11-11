import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { supabase, withTimeout, type OrderStatus } from "../lib/types";
import { money, STATUS, PAYMENT_STATUS_LABEL } from "../lib/format";
import { CopyButton, ErrorBox, Spinner } from "../components/Common";
import { trackEvent } from "../lib/analytics";

type OrderItem = { name: string; qty: number; unit_price: number; line_total: number };
type OrderDetails = {
  ok: boolean;
  order_number: string;
  status: OrderStatus;
  payment_method?: "cash" | "instapay";
  payment_status?: "pending" | "paid" | "rejected" | "refunded";
  branch_name: string;
  delivery_type: string;
  delivery_fee: number;
  subtotal: number;
  total: number;
  items: OrderItem[];
  message?: string;
};

const DELIVERY_LABEL: Record<string, string> = {
  pickup: "استلام من الفرع",
  table: "توصيل للترابيزة",
  obour: "توصيل داخل نطاق العبور",
};

export default function OrderPage() {
  const { orderNumber: rawNum } = useParams<{ orderNumber: string }>();
  const orderNumber = (rawNum || "").trim().toUpperCase();
  const { search } = useLocation();
  const trackingKey = new URLSearchParams(search).get("k") || "";

  const [details, setDetails] = useState<OrderDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const load = async () => {
    if (!orderNumber || !trackingKey) {
      setError("رابط المتابعة ناقص — افتح اللينك من رابط المتابعة الكامل الذي وصلك بعد تأكيد الطلب.");
      return;
    }
    setError(null);
    const res = await withTimeout<OrderDetails>(
      supabase.rpc("get_order_details", { p_order_number: orderNumber, p_tracking_key: trackingKey }),
      15000
    );
    const d = res?.data as OrderDetails | null;
    if (d?.ok) setDetails(d);
    else setError((d as any)?.message || res?.error?.message || "مش لاقيين الطلب — تأكد من رقم الطلب ومفتاح المتابعة.");
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [orderNumber, trackingKey]);

  useEffect(() => {
    if (details?.ok && details.order_number && details.total != null) {
      const key = details.order_number;
      const set = (window as any).__lala_tracked_purchases || ((window as any).__lala_tracked_purchases = new Set<string>());
      if (!set.has(key)) {
        set.add(key);
        trackEvent("purchase", { currency: "EGP", value: details.total, transaction_id: details.order_number });
      }
    }
  }, [details?.ok, details?.order_number, details?.total]);

  useEffect(() => {
    if (!orderNumber || !trackingKey) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      const res = await withTimeout<OrderDetails>(
        supabase.rpc("get_order_details", { p_order_number: orderNumber, p_tracking_key: trackingKey }),
        10000
      );
      const d = res?.data as OrderDetails | null;
      if (d?.ok) setDetails(d);
    }, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [orderNumber, trackingKey]);

  if (!orderNumber) return <ErrorBox msg="رقم الطلب مش موجود 🥲" />;
  if (!trackingKey) {
    return (
      <div className="card p-6 text-center text-brand-900">
        <b className="text-brand-800">مفتاح المتابعة مفقود</b>
        <p className="text-mut text-sm mt-2">لا يمكن فتح طلب برقم فقط — افتح رابط المتابعة الكامل الذي وصلك بعد تأكيد الطلب (يحتوي على ?k=).</p>
      </div>
    );
  }
  if (!details && !error) return <Spinner label="بنجيب تفاصيل طلبك… 📋" />;

  const trackingLink = `${window.location.origin}/order/${orderNumber}?k=${trackingKey}`;
  const whatsappText = encodeURIComponent(`طلب طلب Lala's Bakery: ${orderNumber}\nرابط المتابعة: ${trackingLink}\nاحتفظ برقم الطلب ومفتاح المتابعة.`);

  const method = details?.payment_method || "instapay";
  const payStatus = details?.payment_status || "pending";

  return (
    <div className="space-y-2.5">
      <div className="card p-4 text-center">
        <img src="/lalas-logo-pink.png" alt="Lala's Bakery" className="mx-auto mb-2 max-h-[90px] w-auto" />
        <h2 className="text-[22px] font-bold text-brand-700 my-1">طلبك</h2>
        <div className="text-[28px] font-extrabold text-brand-800 tracking-wide my-2">{orderNumber}</div>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <CopyButton text={orderNumber} />
          <button
            className="btn-outline !px-3"
            onClick={async () => { try { await navigator.clipboard.writeText(trackingLink); setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000); } catch {} }}
          >
            {copiedLink ? "تم النسخ ✅" : "نسخ رابط المتابعة"}
          </button>
          <a className="btn-primary !px-3" href={`https://wa.me/?text=${whatsappText}`} target="_blank" rel="noopener noreferrer">مشاركة على واتساب</a>
        </div>
        <p className="mt-3 font-bold text-brand-700">احتفظ برقم الطلب ومفتاح المتابعة</p>
        {details && <div className="text-mut text-sm mt-1">{details.branch_name} • الإجمالي {money(details.total)}</div>}
        {error && <ErrorBox msg={error} />}
      </div>

      {details && (
        <div className="card p-3.5 text-brand-900 space-y-2">
          <b>الدفع</b>
          <div className="text-sm">
            الطريقة: <b>{method === "cash" ? "💵 كاش عند الاستلام" : "📲 InstaPay (تحويل)"}</b>
          </div>
          <div className="text-sm">
            حالة الدفع: <b>{PAYMENT_STATUS_LABEL[payStatus] || payStatus}</b>
          </div>
          <div className="msg-box text-sm">
            {method === "cash"
              ? (payStatus === "paid"
                  ? "تم استلام الكاش — شكرًا ليك 💗"
                  : "هتدفع كاش وقت الاستلام 💵")
              : (payStatus === "paid"
                  ? "تم تأكيد التحويل — شكرًا ليك 💗"
                  : payStatus === "rejected"
                    ? "في مشكلة في إثبات التحويل — تواصل مع الفرع أو ارفع صورة أوضح."
                    : "في انتظار تأكيد التحويل 📲")}
          </div>
          {method === "instapay" && payStatus !== "paid" && (
            <p className="m-0"><Link to={`/pay/${orderNumber}?k=${trackingKey}`} className="btn-primary">الذهاب لصفحة الدفع / رفع إثبات التحويل</Link></p>
          )}
          {method === "cash" && (
            <p className="m-0 text-sm">تمام! جهّز المبلغ: <b>{money(details.total)}</b> {details.delivery_type === "obour" ? "(بيتدفع كاش لمندوب التوصيل عند الاستلام)" : "وقت الاستلام"}.</p>
          )}
        </div>
      )}

      {details && details.items.length > 0 && (
        <div className="card p-3.5 text-brand-900">
          <b>تفاصيل الطلب</b>
          <div className="mt-2 space-y-1 text-sm">
            {details.items.map((it, i) => (
              <div key={i} className="flex justify-between gap-2"><span>{it.name} ×{it.qty}</span><span>{money(it.line_total)}</span></div>
            ))}
          </div>
          <div className="border-t border-brand-100 mt-2 pt-2 text-sm space-y-1">
            <div className="flex justify-between"><span>المجموع الفرعي</span><span>{money(details.subtotal)}</span></div>
            <div className="flex justify-between"><span>{DELIVERY_LABEL[details.delivery_type] || "الاستلام"}</span><span>{details.delivery_fee ? `+${money(details.delivery_fee)}` : "مجانًا"}</span></div>
            <div className="flex justify-between font-bold"><span>الإجمالي</span><span>{money(details.total)}</span></div>
          </div>
        </div>
      )}

      {details?.status && (
        <div className="card p-3.5">
          <b className="text-brand-900">حالة الطلب {details.status === "preparing" ? "(جاري التحضير)" : ""}</b>
          <div className="msg-box mt-2">{STATUS[details.status].msg}</div>
        </div>
      )}

      <p className="m-0"><Link to={`/track?k=${trackingKey}`} className="btn-outline">تابع طلبك</Link></p>
    </div>
  );
}
