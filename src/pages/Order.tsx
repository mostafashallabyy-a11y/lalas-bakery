import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { supabase, type OrderStatus } from "../lib/types";
import { money, STATUS } from "../lib/format";
import { CopyButton, ErrorBox, Spinner } from "../components/Common";

type OrderItem = { name: string; qty: number; unit_price: number; line_total: number };
type OrderDetails = {
  ok: boolean;
  order_number: string;
  status: OrderStatus;
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
  obour: "دليفري داخل العبور",
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
    if (!orderNumber) return;
    if (!trackingKey) {
      // fallback: basic info only
      const { data } = await supabase.rpc("get_payment_info", { p_order_number: orderNumber });
      const info = data as any;
      if (info?.ok) setDetails({ ok: true, order_number: info.order_number, status: info.status, branch_name: info.branch_name, delivery_type: "", delivery_fee: 0, subtotal: 0, total: info.total, items: [] });
      else setError("مش لاقيين تفاصيل الطلب — افتح من رابط المتابعة الكامل.");
      return;
    }
    const { data } = await supabase.rpc("get_order_details", {
      p_order_number: orderNumber,
      p_tracking_key: trackingKey,
    });
    const d = data as OrderDetails | null;
    if (d?.ok) { setDetails(d); setError(null); }
    else setError(d?.message || "مش لاقيين تفاصيل الطلب.");
  };

  useEffect(() => { load(); }, [orderNumber, trackingKey]);

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
          if (row?.status) setDetails((prev) => (prev ? { ...prev, status: row.status } : prev));
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orderNumber]);

  if (!orderNumber) return <ErrorBox msg="رقم الطلب مش موجود في اللنك 🥲" />;
  if (!details && !error) return <Spinner label="بنجيب تفاصيل طلبك…" />;

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
        {details && (
          <div className="text-mut text-sm mt-1">
            {details.branch_name} · الإجمالي {money(details.total)}
          </div>
        )}
        {error && <ErrorBox msg={error} />}
      </div>

      {details && details.items.length > 0 && (
        <div className="card p-3.5 text-brand-900">
          <b>تفاصيل الطلب</b>
          <div className="mt-2 space-y-1 text-sm">
            {details.items.map((it, i) => (
              <div key={i} className="flex justify-between gap-2">
                <span>{it.name} ×{it.qty}</span>
                <span>{money(it.line_total)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-brand-100 mt-2 pt-2 text-sm space-y-1">
            <div className="flex justify-between"><span>الإجمالي الفرعي</span><span>{money(details.subtotal)}</span></div>
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

      <p className="m-0">
        <Link to={`/pay/${orderNumber}`} className="btn-primary">الذهاب للدفع</Link>
      </p>
      <p className="m-0">
        <Link to={`/track${trackingKey ? `?k=${trackingKey}` : ""}`} className="btn-outline">تابع طلبك</Link>
      </p>
    </div>
  );
}

