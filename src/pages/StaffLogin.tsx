import { useState, FormEvent } from "react";
import { useNavigate, useLocation, Navigate, Link } from "react-router-dom";
import { supabase } from "../lib/types";
import { useAuth } from "../context/AuthContext";
import { ErrorBox } from "../components/Common";

const friendlyAuthError = (m: string) => {
  if (/invalid login credentials/i.test(m)) return "البريد أو الباسورد مش صح 🥲";
  if (/email not confirmed/i.test(m)) return "لم يتم تأكيد البريد بعد — فعّله من لوحة Supabase";
  if (/rate limit/i.test(m)) return "محاولات كتير — استنى شوية وجرب تاني";
  return "مش قادرين ندخلك دلوقتي — جرّب تاني بعد لحظات 🥲";
};

export default function StaffLogin() {
  const { session, profile, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { state } = useLocation() as { state?: { from?: string } };

  if (!loading && session && profile?.is_active) {
    return <Navigate to={state?.from || "/staff"} replace />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (authError) {
      setError(friendlyAuthError(authError.message));
      return;
    }
    navigate(state?.from || "/staff", { replace: true });
  };

  return (
    <div className="py-8 max-w-sm mx-auto space-y-2.5">
      <h2 className="text-[22px] font-bold text-brand-700 text-center mt-1.5">دخول الإدارة 🔐</h2>
      <p className="text-sm text-mut">
        للزملاء والمدير فقط — الدخول بالإيميل والباسورد (بدل الرمز السري في النسخة التجريبية).
      </p>

      <form className="card p-4 space-y-3" onSubmit={submit}>
        <div>
          <label htmlFor="staff-email" className="label">البريد</label>
          <input id="staff-email" className="input" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="staff-pass" className="label">الباسورد</label>
          <input id="staff-pass" className="input" type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <ErrorBox msg={error} />}
        <button className="btn-primary w-full py-3" disabled={busy}>
          {busy ? "بنفحص بياناتك…" : "ادخل 🔐"}
        </button>
      </form>
      <p className="text-center text-xs text-mut font-bold">
        حسابك مش مفعّل؟ كلم المدير يفعّلك. <br />
        <Link to="/" className="underline">رجوع للصفحة الرئيسية</Link>
      </p>
    </div>
  );
}
