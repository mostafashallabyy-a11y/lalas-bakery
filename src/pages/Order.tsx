import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { supabase, type OrderStatus, type TrackResult } from "../lib/types";
import { money, STATUS } from "../lib/format";
import { CopyButton, ErrorBox, Spinner } from "../components/Common";

type PayInfo = {
  ok: boolean;
  order_number: string;
  total: number;
  status: OrderStatus;
  branch_name: string;
};

export default function OrderPage() {
  const { orderNumber: rawNum } = useParams<{ orderNumber: string }>();
  const orderNumber = (rawNum || "").trim().toUpperCase();
  const { search } = useLocation();
  const trackingKey = new URLSearchParams(search).get("k") || "";

  const [info, setInfo] = useState<PayInfo | null>(null);
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (!orderNumber) return;
    (async () => {
      // Payment info (amount/branch) - public RPC
      const { data } = await supabase.rpc("get_payment_info", { p_order_number: orderNumber });
      if ((data as PayInfo | null)?.ok) setInfo(data as PayInfo);

      // Status via tracking key if available
      if (trackingKey) {
        const { data: t } = await supabase.rpc("track_order_by_key", {
          p_order_number: orderNumber,
          p_tracking_key: trackingKey,
        });
        const tr = t as TrackResult | null;
        if (tr?.ok && tr.status) setStatus(tr.status);
      }
    })();
  }, [orderNumber, trackingKey]);

  // Realtime status
  useEffect(() => {
    if (!orderNumber) return;
    const ch = supabase
      .channel(`lb-order-${orderNumber}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_status_public", filter: `order_number=eq.${orderNumber}` },
        (payload) => {
          const row = payload.new as { status: OrderStatus } | null;
          if (row?.status) setStatus(row.status);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [orderNumber]);

  if (!orderNumber) return <ErrorBox msg="رقم الطلب مش موجود في اللنك 🥲" />;
  if (!info && !error) return <Spinner label="بنجيب تفاصيل طلبك…" />;

  const trackingLink = `${window.location.origin}/order/${orderNumber}${trackingKey ? `?k=${trackingKey}` : ""}`;
  const whatsappText = encodeURIComponent(
    `رقم طلب Lala's Bakery: ${orderNumber}${trackingKey ? `\nرابط المتابعة: ${trackingLink}` : ""}\nاحتفظ برقم الطلب.`
  );

  return (
    <div className="space-y-2.5">
      <div className="card p-4 text-center">
        <div className="text-[40px]">🎉</div>
        <h2 className="text-[22px] font-bold text-brand-700 my-1">رقم طلبك</h2>
        <div className="text-[28px] font-extrabold text-brand-800 tracking-wide my-2">{orderNumber}</div>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <CopyButton text={orderNumber} />
          <button
            className="btn-outline !px-3"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(trackingLink);
                setCopiedLink(true);
                setTimeout(() => setCopiedLink(false), 2000);
              } catch {}
            }}
          >
            {copiedLink ? "تم النسخ ✓" : "نسخ رابط المتابعة"}
          </button>
          <a className="btn-primary !px-3" href={`https://wa.me/?text=${whatsappText}`} target="_blank" rel="noreferrer">
            مشاركة على واتساب
          </a>
        </div>
        <p className="mt-3 font-bold text-brand-700">احتفظ برقم الطلب</p>
        {info && (
          <div className="text-mut text-sm mt-1">
            {info.branch_name} · الإجمالي {money(info.total)}
          </div>
        )}
        {error && <ErrorBox msg={error} />}
      </div>

      {status && (
        <div className="card p-3.5">
          <b className="text-brand-900">حالة الطلب</b>
          <div className="msg-box mt-2">{STATUS[status].msg}</div>
        </div>
      )}

      <p className="m-0">
        <Link to={`/pay/${orderNumber}`} className="btn-primary">الذهاب للدفع</Link>
      </p>
      <p className="m-0">
        <Link to={`/track${trackingKey ? `?k=${trackingKey}` : ""}`} className="btn-outline">تابع طلبك</Link>
      </p>
    </div>
  );
}
