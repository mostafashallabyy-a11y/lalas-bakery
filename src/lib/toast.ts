// Tiny global toast bus — UI-only, no app state involved.
// Usage: import { toast } from "../lib/toast"; toast("تمت الإضافة للسلة 🧺");
type ToastItem = { id: number; message: string };
type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
let seq = 1;
const listeners = new Set<Listener>();

function emit() {
  const snapshot = [...toasts];
  listeners.forEach((l) => l(snapshot));
}

export function toast(message: string, durationMs = 2400) {
  const id = seq++;
  toasts = [...toasts.slice(-2), { id, message }];
  emit();
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, durationMs);
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener([...toasts]);
  return () => {
    listeners.delete(listener);
  };
}
