import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { supabase, type OrderStatus } from "../lib/types";
import { money } from "../lib/format";
import { CopyButton, ErrorBox, Spinner } from "../components/Common";
import { compressImage } from "../lib/image";
import { randomId } from "../lib/random";
import { storageGet } from "../lib/storage";

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
  const { search } = useLocation();
  const trackingKey = new URLSearchParams(search).get("k") || "";

  const [instapay, setInstapay] = useState<string | null>(null);
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [proofUploaded, setProofUploaded] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);

  // الاسم بنخليه في الجلسة فقط — للنسخ في ملاحظة التحويل (يُتجاهل بأمان على iPhone private mode)
  const customerName = storageGet("session", "lalas_name") || "";

  useEffect(() => {
    if (!orderNumber || !trackingKey) {
      setError("رابط الدفع ناقص — افتح صفحة الدفع من رابط المتابعة الكامل (يحتوي على ?k=).");
      return;
    }
    (async () => {
      // رقم انستا باي متاح للجميع من settings
      const { data: s } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "instapay_number")
        .maybeSingle();
      setInstapay(s?.value || "");

      // مبلغ الطلب (RPC عام يحتاج رقم الطلب + مفتاح التتبع معًا)
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

  // تحديث الحالة عبر الـ RPC المصرح به (الرقم + المفتاح) — استطلاع قصير، لا مشترك في الجدول كله
  useEffect(() => {
    if (!orderNumber || !trackingKey) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      const { data } = await supabase.rpc("track_order_by_key", {
        p_order_number: orderNumber,
        p_tracking_key: trackingKey,
      });
      const r = data as { ok: boolean; status: OrderStatus; updated_at?: string } | null;
      if (r?.ok && r.status) setInfo((prev) => (prev ? { ...prev, status: r.status, updated_at: r.updated_at } : prev));
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
    setProofUploading(true);
    setProofError(null);
    try {
      // ضغط الصورة من جهة العميل
      const compressed = await compressImage(proofFile, { maxWidth: 1200, quality: 0.85 });
      // اسم الملف: payment-proofs/<order_id>/<uuid>.jpg — نستخدم order_number místo id لأن العميل مايعرفش id
      const ext = compressed.name.split(".").pop() || "jpg";
      const random = randomId();
      const path = `payment-proofs/${orderNumber}/${random}.${ext}`;

      const { error: supErr } = await supabase.storage.from("payment-proofs").upload(path, compressed, {
        contentType: compressed.type,
        upsert: false,
      });
      if (supErr) throw supErr;

      // تخزين المسار في الطلب عبر RPC يتحقق من الرقم + المفتاح
      // نجلب المفتاح من saved orders أو من اللنك
      const urlParams = new URLSearchParams(window.location.search);
      const trackingKey = urlParams.get("k") || "";
      const { error: rpcErr } = await supabase.rpc("upload_payment_proof", {
        p_order_number: orderNumber,
        p_tracking_key: trackingKey,
        p_path: path,
      });
      if (rpcErr) throw new Error(rpcErr.message || "فشل في رفع إثبات الدفع");

      setProofUploaded(true);
    } catch (e) {
      setProofError(e instanceof Error ? e.message : "فشل في رفع الصورة — جرّب تاني");
    } finally {
      setProofUploading(false);
    }
  };

  if (!orderNumber) return <ErrorBox msg="رقم الطلب مش موجود في اللنك 🥲" />;
  if (!instapay) return <Spinner label="بنجهزلك صفحة الدفع… 💳" />;

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
            <li>
              <b>ارفق صورة التحويل:</b>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFile}
                className="block mt-1"
              />
              {proofFile && (
                <div className="text-xs text-mut mt-1">
                  {proofFile.name} · {(proofFile.size / 1024 / 1024).toFixed(2)} ميغا
                </div>
              )}
              <button
                className="btn-primary mt-1.5 shrink-0"
                disabled={proofUploading || proofUploaded || !proofFile}
                onClick={uploadProof}
              >
                {proofUploading ? "يتم الرفع…" : proofUploaded ? "تم الرفع ✓" : "رفع إثبات التحويل"}
              </button>
              {proofError && <ErrorBox msg={proofError} />}
              {proofUploaded && (
                <div className="text-xs text-brand-700 mt-1">
                  تم رفع إثبات التحويل — هنتأكد منه ونبدأ التحضير فوراً
                </div>
              )}
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
