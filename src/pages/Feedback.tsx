import { useState } from "react";
import { supabase } from "../lib/types";
import { ErrorBox } from "../components/Common";
import { Turnstile } from "../components/Turnstile";

export default function FeedbackPage() {
  const [message, setMessage] = useState("");
  const [name, setName] = useState(sessionStorage.getItem("lalas_name") || "");
  const [contact, setContact] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setDone(null);
    if (message.trim().length < 3) {
      setError("اكتبلنا شي جميل (٣ حروف على الأقل) 🌸");
      return;
    }
    setBusy(true);
    const { data, error: e } = await supabase.rpc("submit_feedback", {
      p_message: message,
      p_name: name.trim() || null,
      p_contact: contact.trim() || null,
      p_turnstile_token: token || null,
    });
    setBusy(false);
    const res = data as { ok: boolean; message?: string } | null;
    if (e) {
      setError(e.message || "الرسالة مش واصلة — جرّب تاني 🥲");
      return;
    }
    if (res?.ok) {
      setDone(res.message || "رسالتك وصلت لقلبتنا ❤️");
      setMessage("");
    } else {
      setError("جرّب تاني بعد لحظات 🥲");
    }
  };

  return (
    <div className="py-4 space-y-4 max-w-lg mx-auto">
      <h1 className="text-xl font-extrabold text-brand-700 text-center">رأيك يوصلنا ويكمّل حلاوة المكان 💞</h1>
      <p className="text-sm text-brand-800 font-bold text-center">
        بنحب نسمع منك: كوفي حلو، خدمة أحلى، ومنيو أوسع. اقتراحاتك بتجعل الفرع تتطور خطوة جديدة كل يوم،
        وكل رسالة ليك بتفرق معنا وبتقربنا لأسمى أحاسيس 💗
      </p>

      <div className="card p-4 space-y-3">
        <div>
          <label htmlFor="fb-msg" className="label">رسالتك / اقتراحك (مطلوب)</label>
          <textarea
            id="fb-msg"
            className="input min-h-28"
            maxLength={1000}
            placeholder="اكتب بكل حاجة جوه قلبك… اقتراح أو فكرة فرع جديد أو منيو جديد 🍋"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="fb-name" className="label">اسمك (اختياري)</label>
          <input id="fb-name" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="fb-contact" className="label">طريقة تواصل (اختياري)</label>
          <input id="fb-contact" className="input" maxLength={80} placeholder="واتساب أو إيميل لو حابب رد" value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>

        <Turnstile onChange={setToken} />
        {error && <ErrorBox msg={error} />}
        {done && (
          <div className="bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 text-sm font-bold text-brand-800">
            {done} 🌸
          </div>
        )}
        <button className="btn-primary w-full py-3 text-lg" onClick={submit} disabled={busy}>
          {busy ? "بنرسل رسالتك بحب… 💌" : "ابعت حبك 💌"}
        </button>
        <p className="text-center text-xs text-brand-700">
          ملاحظة: رسايلك للإدارة محفوظة بخصوصية — هتشوفها بس المدير
        </p>
      </div>
    </div>
  );
}
