import { useState } from "react";
import { supabase } from "../lib/types";
import { ErrorBox } from "../components/Common";
import { Turnstile } from "../components/Turnstile";

export default function FeedbackPage() {
  const [message, setMessage] = useState("");
  const [name, setName] = useState(sessionStorage.getItem("lalas_name") || "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    if (message.trim().length < 3) {
      setError("اكتبلنا شي جميل (٣ حروف على الأقل) 🌸");
      return;
    }
    setBusy(true);
    const { data, error: e } = await supabase.rpc("submit_feedback", {
      p_message: message,
      p_name: name.trim() || null,
      p_contact: null,
      p_turnstile_token: token || null,
    });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (e) {
      setError(e.message || "الرسالة مش واصلة — جرّب تاني 🥲");
      return;
    }
    if (res?.ok) setDone(true);
    else setError("جرّب تاني بعد لحظات 🥲");
  };

  // شاشة الشكر زي fbok في النموذج
  if (done) {
    return (
      <div className="card p-3.5 text-center">
        <div className="text-[40px]">💗</div>
        <h2 className="text-[22px] font-bold text-brand-700 my-1">شكرًا ليك!</h2>
        <div className="text-mut text-sm">رأيك وصلنا وهنقراه باهتمام.</div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <h2 className="text-[22px] font-bold text-brand-700 mt-1.5 mb-0">رأيك يهمنا 💌</h2>

      <div className="card p-3.5 space-y-2">
        <div className="msg-box">
          كل كلمة منك بتخلينا أحلى! قولنا اقتراحك أو رأيك بكل حب، عشان نكبر ونتطور معاك.
        </div>
        <input
          className="input"
          placeholder="اسمك (اختياري)"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <textarea
          className="input min-h-24"
          rows={4}
          maxLength={1000}
          placeholder="اكتب اقتراحك هنا…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />

        <Turnstile onChange={setToken} />
        {error && <ErrorBox msg={error} />}

        <p className="m-0">
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? "بنرسل بحب… 💌" : "إرسال بحب"}
          </button>
        </p>
      </div>
    </div>
  );
}
