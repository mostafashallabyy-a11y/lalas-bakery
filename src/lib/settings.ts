import { supabase } from "./types";

export async function fetchSetting(key: string): Promise<string> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return (data?.value as string) || "";
}

export async function fetchBrandWhatsapp(): Promise<string> {
  return fetchSetting("brand_whatsapp_number");
}
