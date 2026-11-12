import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { supabase, type OrderStatus } from "../lib/types";
import { money, PAYMENT_STATUS_LABEL } from "../lib/format";
import { CopyButton, ErrorBox, Spinner, Logo } from "../components/Common";
import CheckoutStepper from "../components/CheckoutStepper";
import { compressImage } from "../lib/image";
import { randomId } from "../lib/random";
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
};

export default function Payment() {
  const { orderNumber: rawNum } = useParams<{ orderNumber: string }>();
  const orderNumber = (rawNum || "").trim().toUpperCase();
  const { search } = useLocation();
  const trackingKey = new URLSearchParams(search).get("k") || "";

  const [instapay, setInstapay] = useState<string | null>(null);
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [proofUploaded, setProofUploaded] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);

  const customerName = storageGet("session", "lalas_name") || "";

  useEffect(() => {
    if (!orderNumber || !trackingKey) {
      setError("رابط الدفع ناقص — افتح صفحة الدفع من رابط المتابعة الكامل (يحتوي على ?k=).");
      return;
    }
    (async () => {
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
      }
    })();
  }, [orderNumber, trackingKey]);

  useEffect(() => {
    if (!orderNumber || !trackingKey) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      const { data } = await supabase.rpc("track_order_by_key", {
        p_order_number: orderNumber,
        p_tracking_key: trackingKey,
      });
      const r = data as any;
      if (r?.ok) setInfo((prev) => (prev ? { ...prev, status: r.status ?? prev.status, payment_method: r.payment_method ?? prev.payment_method, payment_status: r.payment_status ?? prev.payment_status } : prev));
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [orderNumber, trackingKey]);

  const noteText = `${orderNumber}${customerName ? " " + customerName : ""}`;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      setProofError("الملف يجب أن يكون صورة (jpg, png, webp) فقط");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setProofError("حجم الصورة أكبر من 3 ميجابايت — اختر صورة أصغر");
      return;
    }
    setProofError(null);
    setProofFile(file);
  };

  const uploadProof = async () => {
    if (!proofFile || !orderNumber) return;
    if (!info?.order_id) {
      setProofError("مش لاقيين بيانات الطلب — حدّث الصفحة وجرب تاني");
      return;
    }
    setProofUploading(true);
    setProofError(null);
    try {
      const compressed = await compressImage(proofFile, { maxWidth: 1200, quality: 0.85 });
      const rawExt = (compressed.name.split(".").pop() || "jpg").toLowerCase();
      const ext = (rawExt === "jpeg" || rawExt === "jpg" || rawExt === "png" || rawExt === "webp") ? rawExt : "jpg";
      const random = randomId();
      const objectName = `${info.order_id}/${random}.${ext}`;
      const rpcPath = `payment-proofs/${objectName}`;
      const { error: supErr } = await supabase.storage.from("payment-proofs").upload(objectName, compressed, {
        contentType: compressed.type || `image/${ext === "jpg" ? "jpeg" : ext}`,
        upsert: false,
      });
      if (supErr) throw supErr;
      const { data: rpcData, error: rpcErr } = await supabase.rpc("upload_payment_proof", {
        p_order_number: orderNumber,
        p_tracking_key: trackingKey,
        p_path: rpcPath,
      });
      if (rpcErr) throw new Error(rpcErr.message || "فشل في رفع إثبات الدفع");
      const r = rpcData as { ok?: boolean; message?: string } | null;
      if (!r?.ok) throw new Error(r?.message || "فشل في رفع إثبات الدفع");
      setProofUploaded(true);
    } catch (e) {
      setProofError(e instanceof Error ? e.message : "فشل في رفع الصورة — جرّب تاني");
    } finally {
      setProofUploading(false);
    }
  };

  if (!orderNumber) return <ErrorBox msg="رقم الطلب مش موجود في اللنك 🥲" />;
  if (!info && !error) return <Spinner label="بنجهزلك صفحة الدفع… 💳" />;

  const method = info?.payment_method || "instapay";
  const payStatus = info?.payment_status || "pending";

  return (
    <div className="space-y-3.5">
      <CheckoutStepper step={3} />
      <div className="card p-3.5 text-center">
        <Logo className="mx-auto mb-1 h-20 w-auto" alt="Lala's Bakery" />
        <h1 className="text-[20px] font-extrabold text-brand-800 dark:text-[#ffe3ea] my-1">طلبك {orderNumber}</h1>
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
          <div className="text-mut text-sm mt-2">
            تقدر تتابع حالة طلبك من صفحة المتابعة.
          </div>
          <p className="m-0 mt-3">
            <Link to={`/order/${orderNumber}?k=${trackingKey}`} className="btn-primary">صفحة الطلب والمتابعة</Link>
          </p>
        </div>
      ) : (
        <div className="card p-3.5 text-brand-900">
          <b>خطوات الدفع (InstaPay):</b>
          {instapay === "" ? (
            <ErrorBox msg="لسه المدير مظبطش رقم انستا باي — كلمنا في الفرع مباشرة ونظبطلك الطلب 🥺" />
          ) : (
            <ol className="list-decimal pr-5 mt-2 space-y-1.5">
              <li>
                انسخ الرقم:{" "}
                <b className="text-brand-700" dir="ltr">{instapay}</b>{" "}
                {instapay && <CopyButton text={instapay} />}
              </li>
              <li>حوّل <b>{info ? money(info.total) : "…"}</b></li>
              <li>اكتب في الملاحظة: <b>{noteText}</b> <CopyButton text={noteText} /></li>
              <li>
                <b>ارفق صورة التحويل:</b>
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFile} className="block mt-1" />
                {proofFile && (
                  <div className="text-xs text-mut mt-1">{proofFile.name} · {(proofFile.size / 1024 / 1024).toFixed(2)} ميغا</div>
                )}
                <button
                  className="btn-primary mt-1.5 shrink-0"
                  disabled={proofUploading || proofUploaded || !proofFile}
                  onClick={uploadProof}
                >
                  {proofUploading ? "يتم الرفع…" : proofUploaded ? "تم الرفع ✓" : "رفع إثبات التحويل"}
                </button>
                {proofError && <ErrorBox msg={proofError} />}
                {proofUploaded && <div className="text-xs text-brand-700 mt-1">تم رفع إثبات التحويل — هنتأكد منه ونبدأ التحضير فوراً</div>}
              </li>
            </ol>
          )}
          <div className="text-sm mt-2">حالة الدفع: <b>{PAYMENT_STATUS_LABEL[payStatus] || payStatus}</b></div>
          <div className="text-mut text-sm mt-2">بنبدأ التحضير أول ما الدفع يتأكد، وتقدر تتابع طلبك برقمه.</div>
          <p className="m-0 mt-3 flex gap-2 justify-center flex-wrap">
            <Link to={`/order/${orderNumber}?k=${trackingKey}`} className="btn-outline">صفحة الطلب</Link>
            <Link to={`/track?k=${trackingKey}`} className="btn-primary">تابع طلبك</Link>
          </p>
        </div>
      )}
    </div>
  );
}
