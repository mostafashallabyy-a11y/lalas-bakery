import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { supabase, withTimeout, type OrderStatus } from "../lib/types";
import { money, STATUS, PAYMENT_STATUS_LABEL } from "../lib/format";
import { CopyButton, ErrorBox, Spinner, Logo } from "../components/Common";
import CheckoutStepper from "../components/CheckoutStepper";
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
  delivery_floor?: string | null;
  delivery_spot?: string | null;
  delivery_address?: string | null;
  delivery_landmark?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  location_confirmed?: boolean;
  location_confirmed_at?: string | null;
  branch_obour_whatsapp?: string | null;
  branch_obour_whatsapp_template?: string | null;
  obour_location_reminder_minutes?: number;
  obour_location_cancel_minutes?: number;
  customer_note?: string | null;
  subtotal: number;
  total: number;
  items: OrderItem[];
  created_at?: string;
  message?: string;
};

const DELIVERY_LABEL: Record<string, string> = {
  pickup: "استلام من الفرع",
  table: "توصيل داخل الفرع",
  obour: "توصيل داخل نطاق العبور",
};

function normalizeWaNumber(raw: string): string {
  const d = (raw || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d.slice(1);
  if (d.startsWith("00")) return d.slice(2);
  if (/^01[0125]\d{8}$/.test(d)) return "2" + d; // Egypt local -> international
  return d;
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy"); document.body.removeChild(ta); return ok;
  } catch { return false; }
}

export default function OrderPage() {
  const { orderNumber: rawNum } = useParams<{ orderNumber: string }>();
  const orderNumber = (rawNum || "").trim().toUpperCase();
  const { search } = useLocation();
  const trackingKey = new URLSearchParams(search).get("k") || "";

  const [details, setDetails] = useState<OrderDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedWa, setCopiedWa] = useState(false);
  const [locChecked, setLocChecked] = useState(false);
  const [locBusy, setLocBusy] = useState(false);
  const [locMsg, setLocMsg] = useState<string | null>(null);

  const load = async () => {
    if (!orderNumber || !trackingKey) {
      setError("رابط المتابعة ناقص — افتح اللينك من رابط المتابعة الكامل الذي وصلك بعد تأكيد الطلب.");
      return;
    }
    setError(null);
    const res = await withTimeout<OrderDetails>(supabase.rpc("get_order_details", { p_order_number: orderNumber, p_tracking_key: trackingKey }), 15000);
    const d = res?.data as OrderDetails | null;
    if (d?.ok) setDetails(d);
    else setError((d as any)?.message || res?.error?.message || "مش لاقيين الطلب — تأكد من رقم الطلب ومفتاح المتابعة.");
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [orderNumber, trackingKey]);

  useEffect(() => {
    if (details?.ok && details.order_number && details.total != null) {
      const key = details.order_number;
      const set = (window as any).__lala_tracked_purchases || ((window as any).__lala_tracked_purchases = new Set<string>());
      if (!set.has(key)) { set.add(key); trackEvent("purchase", { currency: "EGP", value: details.total, transaction_id: details.order_number }); }
    }
  }, [details?.ok, details?.order_number, details?.total]);

  useEffect(() => {
    if (!orderNumber || !trackingKey) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      const res = await withTimeout<OrderDetails>(supabase.rpc("get_order_details", { p_order_number: orderNumber, p_tracking_key: trackingKey }), 10000);
      const d = res?.data as OrderDetails | null;
      if (d?.ok) setDetails(d);
    }, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [orderNumber, trackingKey]);

  const isObour = details?.delivery_type === "obour";
  const needsLocation = isObour && !details?.location_confirmed;
  const reminderMins = Number(details?.obour_location_reminder_minutes ?? 20);
  const cancelMins = Number(details?.obour_location_cancel_minutes ?? 45);
  const createdMs = details?.created_at ? new Date(details.created_at).getTime() : 0;
  const minsSince = createdMs ? (Date.now() - createdMs) / 60000 : 0;
  const showReminder = needsLocation && minsSince >= reminderMins;

  const waNumber = details?.branch_obour_whatsapp || "";
  const waText = useMemo(() => {
    const tpl = details?.branch_obour_whatsapp_template || "مرحبًا، أنا {name}. رقم الطلب: {order_number}\nالعنوان: {address}\nهبعت اللوكيشن دلوقتي 📍";
    const addr = [details?.delivery_address, details?.delivery_landmark ? `علامة مميزة: ${details.delivery_landmark}` : ""].filter(Boolean).join(" - ");
    return tpl
      .replace(/\{order_number\}/g, details?.order_number || orderNumber)
      .replace(/\{name\}/g, details?.customer_name || "")
      .replace(/\{address\}/g, addr);
  }, [details, orderNumber]);
  const waLink = waNumber ? `https://wa.me/${normalizeWaNumber(waNumber)}?text=${encodeURIComponent(waText)}` : "";

  const confirmLocation = async () => {
    if (!locChecked) return;
    setLocBusy(true); setLocMsg(null);
    const { data, error } = await supabase.rpc("confirm_obour_location", { p_order_number: orderNumber, p_tracking_key: trackingKey });
    setLocBusy(false);
    if (error || !(data as any)?.ok) { setLocMsg((data as any)?.message || error?.message || "تعذر تأكيد اللوكيشن — جرّب تاني"); return; }
    setLocMsg("تم تأكيد إرسال العنوان واللوكيشن 💗");
    await load();
  };

  if (!orderNumber) return <ErrorBox msg="رقم الطلب مش موجود 🥲" />;
  if (!trackingKey) {
    return (
      <div className="card p-6 text-center text-text">
        <b className="text-text">مفتاح المتابعة مفقود</b>
        <p className="text-mut text-sm mt-2">لا يمكن فتح طلب برقم فقط — افتح رابط المتابعة الكامل الذي وصلك بعد تأكيد الطلب (يحتوي على ?k=).</p>
      </div>
    );
  }
  if (!details && !error) return <Spinner label="بنجيب تفاصيل طلبك… 📋" />;

  const trackingLink = `${window.location.origin}/order/${orderNumber}?k=${trackingKey}`;
  const whatsappShare = encodeURIComponent(`طلب Lala's Bakery: ${orderNumber}\nرابط المتابعة: ${trackingLink}`);

  const method = details?.payment_method || "instapay";
  const payStatus = details?.payment_status || "pending";

  return (
    <div className="space-y-3.5">
      <CheckoutStepper step={4} />
      <div className="card p-4 text-center">
        <Logo className="mx-auto mb-2 h-24 w-auto" alt="Lala's Bakery" />
        <h1 className="text-[20px] font-extrabold text-text my-1">طلبك</h1>
        <div className="text-[28px] font-extrabold text-text tracking-wide my-2">{orderNumber}</div>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <CopyButton text={orderNumber} />
          <button className="btn-outline !px-3" onClick={async () => { const ok = await copyText(trackingLink); setCopiedLink(ok); setTimeout(() => setCopiedLink(false), 2000); }}>{copiedLink ? "تم النسخ ✅" : "نسخ رابط المتابعة"}</button>
          <a className="btn-primary !px-3" href={`https://wa.me/?text=${whatsappShare}`} target="_blank" rel="noopener noreferrer">مشاركة على واتساب</a>
        </div>
        <p className="mt-3 font-bold text-text">احتفظ برقم الطلب ومفتاح المتابعة</p>
        {details && <div className="text-mut text-sm mt-1">{details.branch_name} • الإجمالي {money(details.total)}</div>}
        {error && <ErrorBox msg={error} />}
      </div>

      {details && (
        <div className="card p-3.5 text-text space-y-2">
          <b className="text-text">الدفع</b>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="status-info inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-bold">{method === "cash" ? "💵 كاش عند الاستلام" : "📲 InstaPay (تحويل)"}</span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-bold ${payStatus === "paid" ? "status-ok" : payStatus === "rejected" ? "status-danger" : "status-warn"}`}>{PAYMENT_STATUS_LABEL[payStatus] || payStatus}</span>
          </div>
          <div className="msg-box text-sm">
            {method === "cash" ? (payStatus === "paid" ? "تم استلام الكاش — شكرًا ليك 💗" : "هتدفع كاش وقت الاستلام 💵") : (payStatus === "paid" ? "تم تأكيد التحويل — شكرًا ليك 💗" : payStatus === "rejected" ? "في مشكلة في إثبات التحويل — تواصل مع الفرع أو ارفع صورة أوضح." : "في انتظار تأكيد التحويل 📲")}
          </div>
          {method === "instapay" && payStatus !== "paid" && (
            <p className="m-0"><Link to={`/pay/${orderNumber}?k=${trackingKey}`} className="btn-primary">الذهاب لصفحة الدفع / رفع إثبات التحويل</Link></p>
          )}
          {method === "cash" && <p className="m-0 text-sm">تمام! جهّز المبلغ: <b>{money(details.total)}</b> {details.delivery_type === "obour" ? "(بيتدفع كاش لمندوب التوصيل عند الاستلام)" : "وقت الاستلام"}.</p>}
        </div>
      )}

      {/* Part 6: تأكيد العنوان واللوكيشن لطلبات العبور */}
      {details && isObour && (
        <div className="card p-3.5 text-text space-y-3">
          <div className="flex items-center justify-between gap-2">
            <b className="text-text">توصيل داخل العبور — العنوان واللوكيشن</b>
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-bold ${details.location_confirmed ? "status-ok" : "status-warn"}`}>
              {details.location_confirmed ? "📍 اللوكيشن اتأكد" : "⚠️ مستني اللوكيشن"}
            </span>
          </div>
          <div className="text-sm space-y-1">
            <p><b>الاسم:</b> {details.customer_name || "—"}</p>
            <p><b>الموبايل:</b> <span dir="ltr">{details.customer_phone || "—"}</span></p>
            <p className="text-base font-extrabold leading-relaxed">العنوان: {details.delivery_address || "—"}{details.delivery_landmark ? ` — ${details.delivery_landmark}` : ""}</p>
          </div>

          {!details.location_confirmed ? (
            <div className="space-y-2 rounded-xl border border-warn/40 bg-warn-bg/40 p-3">
              <p className="font-extrabold text-brand-900">ابعت لوكيشنك على واتساب</p>
              <p className="text-sm">رقم واتساب الفرع: <b dir="ltr" className="text-lg">{waNumber || "—"}</b></p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-outline !px-3" onClick={async () => { if (!waNumber) return; const ok = await copyText(waNumber); setCopiedWa(ok); setTimeout(()=>setCopiedWa(false), 2000); }}> {copiedWa ? "تم النسخ ✅" : "نسخ الرقم"}</button>
                {waLink ? <a className="btn-primary !px-3" href={waLink} target="_blank" rel="noopener noreferrer">افتح واتساب</a> : <span className="text-xs text-danger-text">رقم واتساب الفرع غير متاح — تواصل مع الفرع.</span>}
              </div>
              <p className="text-xs text-mut font-bold">من واتساب اضغط + ثم الموقع وابعت موقعك الحالي 📍</p>

              <label className="flex items-start gap-2 text-sm font-bold">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-600" checked={locChecked} onChange={(e) => setLocChecked(e.target.checked)} />
                <span>أكّد إني بعتّ العنوان واللوكيشن على واتساب</span>
              </label>

              <button type="button" className="btn-primary w-full" disabled={!locChecked || locBusy} onClick={confirmLocation}>
                {locBusy ? "بيتم التأكيد…" : "تم — أكّد إرسال اللوكيشن"}
              </button>
              {locMsg && <p className="text-sm font-bold">{locMsg}</p>}

              <div className="msg-box text-sm font-bold">في انتظار تأكيد اللوكيشن عشان نجهّز طلبك 💗</div>
              {showReminder && <div className="rounded-lg border border-danger-text/30 bg-danger-bg px-3 py-2 text-sm font-bold text-danger-text">تنبيه: لسه ما أكدّتش اللوكيشن — من فضلك ابعتها على واتساب عشان نجهّز طلبك (قد يتم إلغاء الطلب تلقائيًا بعد {cancelMins} دقيقة من إنشائه لو لم يُؤكَّد).</div>}
            </div>
          ) : (
            <div className="msg-box text-sm font-bold">📍 تم تأكيد العنوان واللوكيشن — شكرًا ليك 💗</div>
          )}
        </div>
      )}

      {details && details.items.length > 0 && (
        <div className="card p-3.5 text-text">
          <b>تفاصيل الطلب</b>
          <div className="mt-2 space-y-1 text-sm">
            {details.items.map((it, i) => (<div key={i} className="flex justify-between gap-2"><span>{it.name} ×{it.qty}</span><span>{money(it.line_total)}</span></div>))}
          </div>
          <div className="border-t border-border mt-2 pt-2 text-sm space-y-1">
            <div className="flex justify-between"><span>المجموع الفرعي</span><span>{money(details.subtotal)}</span></div>
            <div className="flex justify-between"><span>{DELIVERY_LABEL[details.delivery_type] || "الاستلام"}</span><span>{details.delivery_fee ? `+${money(details.delivery_fee)}` : "مجانًا"}</span></div>
            {details.delivery_type === "table" && details.delivery_floor && (
              <div className="flex justify-between items-start gap-2"><span>مكان التوصيل داخل الفرع</span><span className="text-end font-extrabold text-brand-900">الدور {details.delivery_floor}{details.delivery_spot ? ` – ${details.delivery_spot}` : ""}</span></div>
            )}
            {details.customer_note && (
              <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-2 mt-1"><b>ملاحظات على الطلب:</b> <span>{details.customer_note}</span></div>
            )}
            <div className="flex justify-between font-extrabold text-primary-strong border-t border-border pt-2 mt-1"><span>الإجمالي</span><span className="text-[17px]">{money(details.total)}</span></div>
          </div>
        </div>
      )}

      {details?.status && (
        <div className="card p-3.5">
          <b className="text-text">حالة الطلب {details.status === "preparing" ? "(جاري التحضير)" : ""}</b>
          <div className="msg-box mt-2">{isObour && needsLocation ? "في انتظار تأكيد اللوكيشن عشان نجهّز طلبك 💗" : STATUS[details.status].msg}</div>
        </div>
      )}

      <p className="m-0"><Link to={`/track?k=${trackingKey}`} className="btn-outline">تابع طلبك</Link></p>
    </div>
  );
}
