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

// ===== أنواع مشتركة (نماذج مبسطة للجداول) =====
export type Branch = {
  id: string;
  name: string;
  description: string;
  services: string[];
  is_active: boolean;
  sort_order: number;
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
  categories?: { name: string } | null;
};

export type OrderStatus = "received" | "preparing" | "done";

export type OrderRow = {
  id: string;
  order_number: string;
  branch_id: string;
  customer_name: string;
  delivery_type: string;
  delivery_fee: number;
  subtotal: number;
  total: number;
  status: OrderStatus;
  payment_confirmed: boolean;
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
  message?: string;
};
