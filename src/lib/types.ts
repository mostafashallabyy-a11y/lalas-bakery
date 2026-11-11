import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const turnstileSiteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || "";

if (!url || !key) {
  // رسالة واضحة بدل كراش صامت
  console.error("VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY مش موجودين في .env");
}

export const supabase = createClient(url || "https://placeholder.invalid", key || "public-anon-key", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export const TURNSTILE_SITE_KEY = turnstileSiteKey;

// ===== حماية من السبنر اللانهائي: أي استعلام للزبون له مهلة قصوى =====
// لو الاستعلام اتعلق (مشبك شبكة/جلسة قديمة) نرجّع null بدل ما نعلق الواجهة للأبد
export type QueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

export function withTimeout<T>(
  p: PromiseLike<{ data: T | null; error: unknown }>,
  ms = 12000
): Promise<QueryResult<T> | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve({ data: v.data as T | null, error: v.error ? { message: String(v.error) } : null });
      },
      (e) => {
        clearTimeout(timer);
        resolve({ data: null, error: { message: String(e) } });
      }
    );
  });
}

// ===== أنواع مشتركة (نماذج مبسطة للجداول) =====
export type Branch = {
  id: string;
  name: string;
  description: string;
  services: string[];
  is_active: boolean;
  sort_order: number;
  logo: string;
  cover_image: string;
  promo_brief: string;
  cash_enabled?: boolean;
  cash_max_amount?: number;
};

export type BranchPromo = {
  id: string;
  branch_id: string;
  title: string;
  text: string;
  image_url: string;
  link_url: string;
  button_label: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Category = {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
};

export type Product = {
  id: string;
  branch_id: string;
  category_id: string;
  name: string;
  price: number;
  note: string;
  image_url: string;
  is_active: boolean;
  sort_order: number;
  stock_qty: number;
  low_stock_threshold: number;
  track_stock: boolean;
  categories?: { name: string } | null;
};

export type StockMovement = {
  id: string;
  product_id: string;
  branch_id: string;
  change_qty: number;
  reason: string;
  changed_by: string | null;
  note: string;
  created_at: string;
  profiles?: { full_name: string; email: string } | null;
};

export type LowStockAlert = {
  id: string;
  product_id: string;
  branch_id: string;
  stock_qty: number;
  threshold: number;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

export type OrderStatus = "received" | "preparing" | "done";
export type PaymentMethod = "cash" | "instapay";
export type PaymentStatus = "pending" | "paid" | "rejected" | "refunded";

export type OrderRow = {
  id: string;
  order_number: string;
  branch_id: string;
  customer_name: string;
  customer_phone?: string | null;
  delivery_type: string;
  delivery_fee: number;
  subtotal: number;
  total: number;
  status: OrderStatus;
  payment_confirmed: boolean;
  payment_method?: PaymentMethod;
  payment_status?: PaymentStatus;
  cash_received_at?: string | null;
  cash_received_by?: string | null;
  source: "online" | "pos";
  payment_proof_path: string | null;
  created_at: string;
  updated_at: string;
  branches?: { name: string } | null;
  order_items?: OrderItemRow[];
  order_events?: OrderEventRow[];
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: string | null;
  name_snapshot: string;
  unit_price: number;
  qty: number;
  line_total: number;
};

export type OrderEventRow = {
  id: string;
  order_id: string;
  event_type: string;
  old_status: OrderStatus | null;
  new_status: OrderStatus | null;
  changed_by: string | null;
  note: string;
  created_at: string;
  profiles?: { full_name: string; email: string } | null;
};

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: "staff" | "manager";
  is_active: boolean;
  created_at: string;
};

export type FeedbackRow = {
  id: string;
  message: string;
  name: string | null;
  contact: string | null;
  is_read: boolean;
  created_at: string;
};

export type ReportData = {
  totals: { orders_count: number; revenue: number; paid_count: number; avg_order: number };
  per_day: { day: string; orders_count: number; revenue: number }[];
  per_branch: { branch: string; orders_count: number; revenue: number }[];
  per_staff: { full_name: string; email: string; orders_handled: number; avg_prep_minutes: number | null }[];
  top_products: { product: string; qty: number; revenue: number }[];
};

export type TrackResult = {
  ok: boolean;
  order_number?: string;
  status?: OrderStatus;
  updated_at?: string;
  payment_method?: PaymentMethod;
  payment_status?: PaymentStatus;
  message?: string;
};

export type SocialLink = {
  id: string;
  scope: string; // 'brand' or a branch_id
  platform: 'instagram' | 'facebook' | 'tiktok' | 'whatsapp' | 'youtube' | 'x' | 'snapchat' | 'telegram' | 'google_maps' | 'website';
  url: string; // always https://
  label: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};
