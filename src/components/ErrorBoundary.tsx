import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { storageGetJSON } from "../lib/storage";

type Props = { children: ReactNode };
type State = { error: Error | null; orderNumber: string | null; trackingLink: string | null };

// Shown when the app crashes — never a white screen.
// If the order was created it survives in localStorage ("my_orders") — we show it.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, orderNumber: null, trackingLink: null };

  static getDerivedStateFromError(error: Error): State {
    let orderNumber: string | null = null;
    let trackingLink: string | null = null;
    try {
      const saved = storageGetJSON<{ order_number?: string; tracking_key?: string } | null>("local", "lalas_last_order", null)
        ?? storageGetJSON<{ order_number?: string; tracking_key?: string } | null>("local", "my_orders", null);
      // my_orders is an array of entries in Checkout — handle both shapes defensively
      const entry = Array.isArray(saved) ? saved[0] : saved;
      if (entry?.order_number) {
        orderNumber = entry.order_number;
        trackingLink = entry.tracking_key ? `/order/${entry.order_number}?k=${entry.tracking_key}` : `/order/${entry.order_number}`;
      }
    } catch {
      /* ignore — show the friendly page without order details */
    }
    return { error, orderNumber, trackingLink };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[lalas-boundary] order/customer flow crashed:", error, info?.componentStack || "");
  }

  render() {
    const { error, orderNumber, trackingLink } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="card p-6 text-center space-y-3 text-brand-900">
        <div className="text-[40px]">💗</div>
        <h2 className="text-[20px] font-bold text-brand-700">حصلت مشكلة بسيطة</h2>
        <p className="text-mut text-sm">
          الموقع اتعرض لمشكلة مؤقتة، بس لا تقلق. {orderNumber ? "طلبك محفوظ معاك:" : "أرجع تاني وجرب تاني."}
        </p>
        {orderNumber && (
          <div className="msg-box text-sm">
            <b>رقم طلبك: </b>
            <span className="text-brand-800 font-extrabold" dir="ltr">{orderNumber}</span>
            {trackingLink && (
              <div className="mt-1">
                <Link to={trackingLink} className="underline font-bold text-brand-700">افتح طلبك ومتابعته</Link>
              </div>
            )}
          </div>
        )}
        <div className="flex gap-2 justify-center flex-wrap pt-1">
          <button className="btn-primary !px-4" onClick={() => window.location.reload()}>
            جرّب تاني
          </button>
          <Link to="/track" className="btn-outline !px-4">
            طلباتي
          </Link>
        </div>
        <p className="text-[10px] text-brand-400">لو المشكلة استمرت، كلمنا على واتساب وهنحلّها معاك.</p>
      </div>
    );
  }
}
