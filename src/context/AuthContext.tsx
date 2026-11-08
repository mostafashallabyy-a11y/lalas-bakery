import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, type Profile } from "../lib/types";

type AuthCtx = {
  session: boolean;
  userId: string | null;
  profile: Profile | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const C = createContext<AuthCtx>({
  session: false,
  userId: null,
  profile: null,
  loading: true,
  refresh: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async (uid: string | null) => {
    setUserId(uid);
    if (!uid) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", uid)
      .maybeSingle();
    if (error) {
      console.error("profiles:", error);
      setProfile(null);
    } else {
      setProfile(data as Profile | null);
      // RLS يمنع قراءة الملف لو الحساب مش مفعّل — بنعالجها
      if (!data) {
        const { data: self } = await supabase.from("profiles").select("*").maybeSingle();
        setProfile((self as Profile) ?? null);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session?.user.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => load(s?.user.id ?? null));
    return () => sub?.subscription.unsubscribe();
  }, []);

  const refresh = async () => load(userId);

  return (
    <C.Provider
      value={{
        session: !!userId,
        userId,
        profile,
        loading,
        refresh,
        signOut: async () => {
          await supabase.auth.signOut();
          setProfile(null);
          setUserId(null);
        },
      }}
    >
      {children}
    </C.Provider>
  );
}

export const useAuth = () => useContext(C);
