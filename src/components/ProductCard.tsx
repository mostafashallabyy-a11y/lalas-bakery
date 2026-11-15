import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { money, productEmoji } from "../lib/format";
import { imageSources } from "../lib/images";
import type { Product } from "../lib/types";

export type CardVariant = "grid" | "hero" | "carousel";

type Props = {
  product: Product;
  qty: number;
  variant?: CardVariant;
  /** الأكثر طلبًا — يظهر فقط لما يكون فيه بيانات بيع حقيقية */
  bestSeller?: boolean;
  /** أول صور الشاشة: تتحمّل فورًا وبدون تأجيل */
  priority?: boolean;
  onAdd: (p: Product) => void;
  onInc: (id: string) => void;
  onDec: (id: string) => void;
};

/** صورة المنتج: هيكل تحميل، مقاس ثابت ضد الاهتزاز، بديل ناعم لو مفيش صورة */
function ProductPhoto({
  name,
  imageUrl,
  variant,
  dimmed,
  priority,
}: {
  name: string;
  imageUrl?: string | null;
  variant: CardVariant;
  dimmed?: boolean;
  priority?: boolean;
}) {
  const sources = useMemo(() => imageSources(imageUrl), [imageUrl]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(!sources.src);
  // تحميل ذكي: الصورة مش بتتنزل غير لما تقرب من الشاشة (توفير باقة الموبايل)
  const [nearView, setNearView] = useState(!!priority);
  const holder = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (priority || !sources.src) {
      setNearView(true);
      return;
    }
    const el = holder.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNearView(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px 0px", threshold: 0.01 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [priority, sources.src]);

  const box =
    variant === "hero"
      ? "aspect-[16/10] min-h-[190px]"
      : variant === "carousel"
        ? "h-[96px] w-[96px]"
        : "aspect-[4/3] min-h-[176px]";

  const sizes =
    variant === "hero"
      ? "(max-width: 720px) 100vw, 360px"
      : variant === "carousel"
        ? "96px"
        : "(max-width: 720px) 50vw, 240px";

  if (!sources.src || failed) {
    return (
      <div
        className={`relative grid ${box} w-full place-items-center overflow-hidden bg-surface2`}
        aria-hidden="true"
      >
        <span className="text-[52px] leading-none opacity-70">{productEmoji(name)}</span>
        <span className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/10 to-transparent" />
      </div>
    );
  }

  return (
    <div ref={holder} className={`relative ${box} w-full overflow-hidden bg-surface2`}>
      {(!loaded || !nearView) && <div className="skeleton absolute inset-0 !rounded-none" aria-hidden="true" />}
      {nearView && (
        <img
          src={sources.src}
          srcSet={sources.srcSet}
          sizes={sources.srcSet ? sizes : undefined}
          alt={name}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          width={800}
          height={800}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`h-full w-full object-cover object-center transition-opacity duration-300 ${
            loaded ? "opacity-100" : "opacity-0"
          } ${dimmed ? "grayscale" : ""}`}
        />
      )}
    </div>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "accent" | "new" | "warn" | "muted";
  children: React.ReactNode;
}) {
  const cls =
    tone === "accent"
      ? "bg-badge text-badge-fg"
      : tone === "new"
        ? "bg-surface text-primary-strong border border-border"
        : tone === "warn"
          ? "status-warn"
          : "bg-surface/95 text-muted border border-border";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-extrabold leading-5 shadow-sm ${cls}`}
    >
      {children}
    </span>
  );
}

/** زر الإضافة الكبير: بعد أول ضغطة يتحول لعدّاد (− qty +) */
function AddControl({
  name,
  qty,
  onAdd,
  onInc,
  onDec,
  big,
}: {
  name: string;
  qty: number;
  onAdd: () => void;
  onInc: () => void;
  onDec: () => void;
  big?: boolean;
}) {
  if (qty > 0) {
    return (
      <div
        className="stepper-in flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface p-0.5"
        role="group"
        aria-label={`كمية ${name} في السلة`}
      >
        <button
          type="button"
          onClick={onDec}
          aria-label={`قلل ${name} من السلة`}
          className="grid h-11 w-9 place-items-center rounded-full text-text outline-none transition hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-ring active:scale-90"
        >
          <Minus size={17} strokeWidth={2.5} aria-hidden="true" />
        </button>
        <b className="min-w-[18px] text-center text-[14px] tabular-nums text-text" aria-live="polite">
          {qty}
        </b>
        <button
          type="button"
          onClick={onInc}
          aria-label={`زود ${name} في السلة`}
          className="grid h-11 w-9 place-items-center rounded-full bg-btnbg text-btnfg outline-none transition focus-visible:ring-2 focus-visible:ring-ring active:scale-90"
        >
          <Plus size={17} strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid="add-button"
      onClick={onAdd}
      aria-label={`أضف ${name} للسلة`}
      className={`add-btn inline-flex shrink-0 items-center justify-center gap-1 rounded-full bg-btnbg font-extrabold text-btnfg outline-none transition hover:brightness-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-95 ${
        big ? "min-h-[48px] px-5 text-[15px]" : "min-h-[44px] px-3.5 text-[13.5px]"
      }`}
    >
      <Plus size={17} strokeWidth={2.8} aria-hidden="true" />
      أضف
    </button>
  );
}

export function ProductCard({
  product: p,
  qty,
  variant = "grid",
  bestSeller,
  priority,
  onAdd,
  onInc,
  onDec,
}: Props) {
  const price = Number(p.price);
  const trackStock = p.track_stock === true;
  const stockQty = trackStock ? Number(p.stock_qty ?? 0) : Infinity;
  const threshold = trackStock ? Number(p.low_stock_threshold ?? 0) : 0;
  const outOfStock = trackStock && stockQty <= 0;
  const lowStock = trackStock && stockQty > 0 && stockQty <= threshold;

  const badges =
    !outOfStock && (bestSeller || p.is_new || lowStock) ? (
      <div className="absolute start-1.5 top-1.5 flex max-w-[calc(100%-12px)] flex-wrap gap-1">
        {bestSeller && <Badge tone="accent">الأكثر طلبًا 🔥</Badge>}
        {p.is_new && <Badge tone="new">جديد ✨</Badge>}
        {lowStock && <Badge tone="warn">باقي {stockQty} قطع 🔥</Badge>}
      </div>
    ) : outOfStock ? (
      <div className="absolute start-1.5 top-1.5">
        <Badge tone="muted">غير متاح</Badge>
      </div>
    ) : null;

  // كارت أفقي صغير — لشريط "الأكثر طلبًا"
  if (variant === "carousel") {
    return (
      <article
        data-testid="product-card"
        className={`menu-card menu-card-row ${outOfStock ? "opacity-75" : ""}`}
      >
        <div className="relative shrink-0">
          <ProductPhoto name={p.name} imageUrl={p.image_url} variant="carousel" dimmed={outOfStock} priority={priority} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 p-2.5">
          <h3 className="line-clamp-2 text-[13px] font-extrabold leading-[1.35] text-text">{p.name}</h3>
          <div className="mt-auto flex items-end justify-between gap-1 pt-1">
            <div className="text-[15px] font-extrabold tabular-nums text-primary-strong">{money(price)}</div>
            {outOfStock ? (
              <span className="inline-flex min-h-[44px] items-center rounded-full border border-border px-2 text-[11px] font-bold text-muted">
                خلصت
              </span>
            ) : (
              <AddControl
                name={p.name}
                qty={qty}
                onAdd={() => onAdd(p)}
                onInc={() => onInc(p.id)}
                onDec={() => onDec(p.id)}
              />
            )}
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      data-testid="product-card"
      className={`menu-card group ${variant === "hero" ? "menu-card-hero" : ""} ${
        outOfStock ? "opacity-75" : ""
      }`}
    >
      <div className="relative">
        <ProductPhoto name={p.name} imageUrl={p.image_url} variant={variant} dimmed={outOfStock} priority={priority} />
        {badges}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 p-2">
        <h3
          className={`line-clamp-2 font-extrabold leading-[1.3] text-text ${
            variant === "hero" ? "text-[15.5px]" : "text-[13px]"
          }`}
        >
          {p.name}
        </h3>
        {p.note ? (
          <p className="clamp-2 text-[10.5px] leading-[14px] text-muted">{p.note}</p>
        ) : null}

        <div className="mt-auto flex items-end justify-between gap-1 pt-1.5">
          <div className="min-w-0 leading-tight">
            <div
              className={`font-extrabold tabular-nums text-primary-strong ${
                variant === "hero" ? "text-[20px]" : "text-[16.5px]"
              }`}
            >
              {money(price)}
            </div>
          </div>

          {outOfStock ? (
            <span className="inline-flex min-h-[44px] items-center rounded-full border border-border px-3 text-[12px] font-bold text-muted">
              خلصت
            </span>
          ) : (
            <AddControl
              name={p.name}
              qty={qty}
              big={variant === "hero"}
              onAdd={() => onAdd(p)}
              onInc={() => onInc(p.id)}
              onDec={() => onDec(p.id)}
            />
          )}
        </div>
      </div>
    </article>
  );
}
