// تنسيق العملة والتواريخ بحروف لاتينية واضحة
const egp = new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });

export const money = (n: number) => `${egp.format(n)} ج`;
export const num = (n: number) => egp.format(n);

export const fmtFull = (iso: string) =>
  new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));

export const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("ar-EG-u-nu-latn", { dateStyle: "short" }).format(new Date(iso));

// ===== رسائل الحالات (نفس نصوص النموذج الأصلي) =====
export const STATUS = {
  received: {
    label: "تم استلام الطلب",
    emoji: "🫶",
    msg: "وصلنا طلبك يا حلو 💗 بنراجع الدفع وهنبدأ فورًا.",
  },
  preparing: {
    label: "جاري التحضير",
    emoji: "👨‍🍳",
    msg: "جاري التحضير… الحاجات الحلوة بتاخد وقتها 🥐 وانتظارك هيستاهل!",
  },
  done: {
    label: "تم الانتهاء",
    emoji: "✅",
    msg: "طلبك جاهز يا قمر 🎀 في انتظارك بكل حب.",
  },
} as const;

export const DELIVERY_OPTIONS = [
  {
    key: "pickup",
    label: "استلام من الفرع (مجانًا)",
    fee: 0,
    desc: "طلبتك بتتجهز بسرعة، استلمها بنفسك من الفرع من غير أي رسوم ❤️",
  },
  {
    key: "table",
    label: "توصيل داخل الفرع (+5 ج)",
    fee: 5,
    desc: "هنوصّل مشروبك لحد مكانك بكل حب 💕 والـ5 جنيه دعم لطيف لزميلتنا اللي هتوصله لك.",
  },
  {
    key: "obour",
    label: "توصيل داخل نطاق العبور (+50 ج)",
    fee: 50,
    desc: "بعد الدفع تواصل على الرقم المربوط بحساب الدفع لتأكيد العنوان.",
  },
] as const;

export type DeliveryKey = (typeof DELIVERY_OPTIONS)[number]["key"];

// ===== إيموجي المنتجات (زي النموذج) =====
export function productEmoji(name: string): string {
  const n = name || "";
  if (/اسبريس|تركي|امريكان|فرنساوي/.test(n)) return "☕";
  if (/كابتشينو|لاتيه|لاته/.test(n)) return "☕";
  if (/شاي/.test(n)) return "🍵";
  if (/هوت شوك|هوتشوك|شوكولاتة ساخن|كاكاو/.test(n)) return "🍫";
  if (/آيس|ايس |مثلج|بارد|فرابيه|فرابي|سموذي/.test(n)) return "🧊";
  if (/ليمون|عصير|منجو|فراوله|فراولة|بلو بيري/.test(n)) return "🍋";
  if (/بسبوسة|كيكه|كيكة|تشيز|برتشي/.test(n)) return "🍰";
  if (/كرواسون|كنافة|فطيرة|دانش/.test(n)) return "🥐";
  if (/كوكي|كوكيز|ماكرون/.test(n)) return "🍪";
  if (/كب كيك|كبكيك|كوب كيك/.test(n)) return "🧁";
  if (/بطاطس|فرايز|تسالي|ناتشو/.test(n)) return "🍟";
  if (/توست|ساندوتش|ساندويتش/.test(n)) return "🥪";
  if (/جاتو|براوني|مولتن/.test(n)) return "🍫";
  return "🍰";
}

// ===== لصقات أقسام المنيو بايموجيها في النموذج =====
export function categoryEmoji(name: string): string {
  const n = name || "";
  if (/ساخن/.test(n)) return "☕";
  if (/بارد/.test(n)) return "🧊";
  if (/تسالي/.test(n)) return "🍿";
  if (/مخبوز|والكيك|لاذر|bake/i.test(n)) return "🥐";
  return "🍽";
}
