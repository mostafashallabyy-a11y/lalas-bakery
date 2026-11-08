// تنسيق العملة والتواريخ بحروف لاتينية واضحة
const egp = new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });

export const money = (n: number) => `${egp.format(n)} ج.م`;
export const num = (n: number) => egp.format(n);

export const fmtFull = (iso: string) =>
  new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));

export const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("ar-EG-u-nu-latn", { dateStyle: "short" }).format(new Date(iso));

// ===== رسائل الحالات بتتبع الطلب (عامية مصرية دافئة) =====
export const STATUS = {
  received: {
    label: "تم استلام الطلب",
    emoji: "🫶",
    msg: "طلبك وصلنا وسجّلناه ورقم ده بيخليه ليك لوحدك 🥐 لحد ما نأكد الدفع، الحالة هتفضل (تم استلام الطلب) — وماتقلقش، إحنا فاهدينك.",
  },
  preparing: {
    label: "جاري التحضير",
    emoji: "👨‍🍳",
    msg: "ريحة القهوة مالية المكان وطلبتك تحت التحضير بعناية وبكل حب 💗 ثواني وخلصنا، وطيزك مش هتستنى كتير.",
  },
  done: {
    label: "تم الانتهاء",
    emoji: "✅",
    msg: "هنأ جاهز ومزوق زي ما بتحب ❤️ شهية وعافية دايمًا، وساعتها قولنا رأيك في صفحة آراء العملاء — الكلام الجميل بينور لنا الطريق.",
  },
} as const;

export const DELIVERY_OPTIONS = [
  {
    key: "pickup",
    label: "استلام من الفرع — مجانًا",
    fee: 0,
    desc: "طلباتك بتتجهز بسرعة، استلمها بنفسك من الفرع من غير أي رسوم ❤️",
  },
  {
    key: "table",
    label: "نوصلها لترابيزتك — +5 ج.م",
    fee: 5,
    desc: "هنجيبلك المشروب لحد ترابيزتك بحب، والخمس جنيه دي رفعة منك لزميلتنا اللي بتتعب وياك ❤️",
  },
  {
    key: "obour",
    label: "دليفري داخل العبور — +50 ج.م",
    fee: 50,
    desc: "كلمنا على الرقم المرتبط بحساب الدفع لتأكيد العنوان.",
  },
] as const;

export type DeliveryKey = (typeof DELIVERY_OPTIONS)[number]["key"];
