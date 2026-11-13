import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { storageGetJSON, storageSetJSON } from "../lib/storage";
import { trackEvent } from "../lib/analytics";
import { toast } from "../lib/toast";

export type CartItem = {
  product_id: string;
  name: string;
  price: number;
  note: string;
  image_url: string;
  qty: number;
};

type CartCtx = {
  branchId: string | null;
  branchName: string | null;
  items: CartItem[];
  // تغيير الفرع يمسح العربة (زي ما المطلوب)
  setBranch: (id: string, name: string) => void;
  add: (item: Omit<CartItem, "qty">) => void;
  inc: (productId: string) => void;
  dec: (productId: string) => void;
  remove: (productId: string) => void;
  clear: () => void;
  subtotal: number;
  count: number;
};

const C = createContext<CartCtx | null>(null);
const KEY = "lalas_cart_v1";

export function CartProvider({ children }: { children: ReactNode }) {
  const [branchId, setBranchId] = useState<string | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    const d = storageGetJSON<{ branchId: string; branchName: string; items: CartItem[] } | null>(
      "session",
      KEY,
      null
    );
    if (!d) return;
    setBranchId(d.branchId || null);
    setBranchName(d.branchName || null);
    setItems(Array.isArray(d.items) ? d.items : []);
  }, []);

  const persist = (next: { branchId: string | null; branchName: string | null; items: CartItem[] }) => {
    storageSetJSON("session", KEY, next); // safe on private mode / quota errors
  };

  const setBranch = useCallback((id: string, name: string) => {
    const next = { branchId: id, branchName: name, items: [] };
    setBranchId(id);
    setBranchName(name);
    setItems([]);
    persist(next);
  }, []);

  const add = useCallback((item: Omit<CartItem, "qty">) => {
    // مانع: منتج بسعر غير موجب مينفعش يدخل السلة حتى لو زُر الزر غلط
    if (!(Number(item.price) > 0)) {
      toast("المنتج ده لسه مفيهوش سعر صحيح");
      return;
    }
    trackEvent("add_to_cart", { currency: "EGP", value: item.price, items: [{ item_id: item.product_id, item_name: item.name, price: item.price, quantity: 1 }] });
    toast("تمت الإضافة للسلة 🧺");
    setItems((prev) => {
      const found = prev.find((i) => i.product_id === item.product_id);
      const next = found
        ? prev.map((i) => (i.product_id === item.product_id ? { ...i, qty: Math.min(30, i.qty + 1) } : i))
        : [...prev, { ...item, qty: 1 }];
      persist({ branchId, branchName, items: next });
      return next;
    });
  }, [branchId, branchName]);

  const changeQty = useCallback(
    (productId: string, delta: number) => {
      setItems((prev) => {
        const next = prev
          .map((i) =>
            i.product_id === productId ? { ...i, qty: Math.max(0, Math.min(30, i.qty + delta)) } : i
          )
          .filter((i) => i.qty > 0);
        persist({ branchId, branchName, items: next });
        return next;
      });
    },
    [branchId, branchName]
  );

  const remove = useCallback(
    (productId: string) => {
      setItems((prev) => {
        const next = prev.filter((i) => i.product_id !== productId);
        persist({ branchId, branchName, items: next });
        return next;
      });
    },
    [branchId, branchName]
  );

  const clear = useCallback(() => {
    const next = { branchId: null, branchName: null, items: [] };
    setBranchId(null);
    setBranchName(null);
    setItems([]);
    persist(next);
  }, []);

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.price * i.qty, 0), [items]);
  const count = useMemo(() => items.reduce((s, i) => s + i.qty, 0), [items]);

  return (
    <C.Provider
      value={{ branchId, branchName, items, setBranch, add, inc: (p) => changeQty(p, 1), dec: (p) => changeQty(p, -1), remove, clear, subtotal, count }}
    >
      {children}
    </C.Provider>
  );
}

export function useCart() {
  const ctx = useContext(C);
  if (!ctx) throw new Error("CartProvider ناقص");
  return ctx;
}
