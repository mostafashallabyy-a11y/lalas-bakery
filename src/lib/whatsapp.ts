import { money } from "./format";

export type ShareOrderDetails = {
  order_number: string;
  branch_name?: string;
  customer_name?: string | null;
  items?: { name: string; qty: number; line_total?: number }[];
  delivery_type: string;
  delivery_floor?: string | null;
  delivery_spot?: string | null;
  delivery_address?: string | null;
  delivery_landmark?: string | null;
  customer_note?: string | null;
  delivery_fee?: number;
  total: number;
  payment_method?: "cash" | "instapay";
};

function deliveryLine(d: ShareOrderDetails): string {
  if (d.delivery_type === "table") {
    const spot = d.delivery_spot?.trim();
    return `طريقة الاستلام: توصيل داخل الفرع – الدور ${d.delivery_floor || "—"}${spot ? ` – (${spot})` : ""}`;
  }
  if (d.delivery_type === "obour") {
    const addr = [d.delivery_address, d.delivery_landmark ? `علامة مميزة: ${d.delivery_landmark}` : ""]
      .filter(Boolean)
      .join(" - ");
    return `طريقة الاستلام: توصيل العبور – العنوان ${addr || "—"}`;
  }
  return "طريقة الاستلام: استلام من الفرع";
}

function paymentLine(d: ShareOrderDetails, closingOverride?: string): string {
  const methodLine = d.payment_method === "cash" ? "طريقة الدفع: كاش عند الاستلام" : "طريقة الدفع: InstaPay";
  if (closingOverride) return `${methodLine}\n${closingOverride}`;
  return d.payment_method === "cash"
    ? methodLine
    : `${methodLine}\nأنا حولت المبلغ، ده إثبات التحويل 👇 (هبعت صورة التحويل هنا)`;
}

export function buildOrderWhatsAppMessage(
  d: ShareOrderDetails,
  heading = "طلب جديد 💗",
  closingOverride?: string
): string {
  const itemsLine = d.items?.length
    ? d.items.map((i) => `${i.name} ×${i.qty}`).join("، ")
    : "—";
  const fee = Number(d.delivery_fee || 0);
  const totalLine = fee > 0 ? `الإجمالي: ${money(d.total)} (شامل التوصيل)` : `الإجمالي: ${money(d.total)}`;
  const lines = [
    heading,
    `رقم الطلب: ${d.order_number}`,
    d.customer_name ? `الاسم: ${d.customer_name}` : null,
    d.branch_name ? `الفرع: ${d.branch_name}` : null,
    `الطلب: ${itemsLine}`,
    deliveryLine(d),
    d.customer_note ? `ملاحظات: ${d.customer_note}` : null,
    totalLine,
    paymentLine(d, closingOverride),
  ].filter(Boolean);
  return lines.join("\n");
}

export function waMeLink(number: string, message: string): string {
  const digits = (number || "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
