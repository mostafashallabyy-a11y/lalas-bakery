import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type OrderRow, type OrderEventRow, type OrderStatus } from "../lib/types";
import { money, fmtFull, STATUS } from "../lib/format";
import { Spinner, EmptyBox, ErrorBox } from "../components/Common";
import { useAuth } from "../context/AuthContext";

const STATUS_FLOW: OrderStatus[] = ["received", "preparing", "done"];

export default function StaffOrders() {
  const { profile } = useAuth();
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [working, setWorking] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, OrderEventRow[]>>({});

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from("orders")
      .select("*, branches(name), order_items(*), order_events(*, profiles(full_name, email))")
      .order("created_at", { ascending: false })
      .limit(100);
    if (e) {
      setError("مش قادرين نجيب الطلبات — راجع تصريحك أو جرّب تاني 🥲");
      setOrders([]);
    } else {
      setOrders((data as unknown as OrderRow[]) ?? []);
      setError(null);
    }
  }, []);

  useEffect(() => {
    load();
    // Realtime: إعلانات جديدة/تحديث على جدول orders (RLS staff يسمح)
    const ch = supabase
      .channel("staff-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const shown = useMemo(() => {
    const list = orders ?? [];
    return filter === "active" ? list.filter((o) => o.status !== "done") : list;
  }, [orders, filter]);

  const setStatus = async (o: OrderRow, s: OrderStatus) => {
    setWorking(o.id);
    // نقفل التحويل لـ "تم الانتهاء" لو الدفع مش متأكد — مع تأكيد من الموظف
    if (s === "done" && !o.payment_confirmed) {
      const ok = confirm("الدفع لسه مش متأكد — متأكد إنك عايز تعلّم الطلب إنه خلص؟");
      if (!ok) {
        setWorking(null);
        return;
      }
    }
    const { data, error: e } = await supabase.rpc("staff_set_status", { p_order_id: o.id, p_new_status: s });
    setWorking(null);
    if (e || !data?.ok) {
      setError((e as Error)?.message || "حصلت مشكلة في تحديث الحالة — جرّب تاني");
      return;
    }
    setError(null);
    load();
  };

  const setPayment = async (o: OrderRow, confirmed: boolean) => {
    setWorking(o.id);
    const { data, error: e } = await supabase.rpc("staff_set_payment", { p_order_id: o.id, p_confirmed: confirmed });
    setWorking(null);
    if (e || !data?.ok) {
      setError((e as Error)?.message || "حصلت مشكلة في تأكيد الدفع — جرّب تاني");
      return;
    }
    setError(null);
    load();
  };

  const expand = async (id: string) => {
    if (expanded === id) return setExpanded(null);
    setExpanded(id);
    if (!events[id]) {
      const { data } = await supabase
        .from("order_events")
        .select("*, profiles(full_name, email)")
        .eq("order_id", id)
        .order("created_at");
      if (data) setEvents((prev) => ({ ...prev, [id]: data as unknown as OrderEventRow[] }));
    }
  };

  if (!orders) return <Spinner label="بنشيل شاشة الموظف… ⏳" />;

  return (
    <div className="py-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold text-brand-700">الطلبات الواردة 🧾</h1>
        <div className="flex gap-1">
          <button className={`pill ${filter === "active" ? "bg-brand-500 text-white" : "bg-white border border-brand-200"}`} onClick={() => setFilter("active")}>شغالة</button>
          <button className={`pill ${filter === "all" ? "bg-brand-500 text-white" : "bg-white border border-brand-200"}`} onClick={() => setFilter("all")}>كلها</button>
          <button className="pill bg-white border border-brand-200" onClick={load}>↺</button>
        </div>
      </div>

      {error && <ErrorBox msg={error} />}
      {shown.length === 0 && <EmptyBox msg="مفيش طلبات دلوقتي ☕ استريح شوية" />}

      <div className="grid gap-3">
        {shown.map((o) => {
          const s: OrderStatus = (o.status as OrderStatus) ?? "received";
          const st = STATUS[s];
          const next = STATUS_FLOW[STATUS_FLOW.indexOf(o.status as OrderStatus) + 1];
          return (
            <div key={o.id} className="card p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-extrabold text-brand-600 text-lg" dir="ltr">{o.order_number}</p>
                  <p className="text-xs text-brand-800">{o.branches?.name} · {fmtFull(o.created_at)}</p>
                </div>
                <span className={`pill ${o.status === "done" ? "bg-green-100 text-green-800" : "bg-brand-100 text-brand-800"}`}>
                  {st?.label} {st?.emoji}
                </span>
              </div>

              <div className="text-sm font-bold text-brand-900 space-y-1">
                <p>👤 {o.customer_name} {o.payment_confirmed ? "✅ مدفوع" : "⏳ الدفع مش متأكد"}</p>
                <p>{o.order_items?.map((i) => `${i.name_snapshot} ×${i.qty}`).join(" · ")}</p>
                <p className="text-brand-800">
                  {o.delivery_type === "pickup" ? "استلام من الفرع" : o.delivery_type === "table" ? "للترابيزة (+5)" : "دليفري داخل العبور (+50)"} — الإجمالي {money(o.total)}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {o.payment_confirmed ? (
                  <button className="btn-soft !py-1.5 !px-3 text-xs" disabled={working === o.id} onClick={() => setPayment(o, false)}>إلغاء تأكيد الدفع</button>
                ) : (
                  <button className="btn-primary !py-1.5 !px-3 text-xs" disabled={working === o.id} onClick={() => setPayment(o, true)}>✅ تأكيد الدفع</button>
                )}
                {next && o.status !== "done" && (
                  <button className="btn-primary !py-1.5 !px-3 text-xs" disabled={working === o.id} onClick={() => setStatus(o, next)}>
                    الانتقال لـ «{STATUS[next].label}»
                  </button>
                )}
                <button className="btn-soft !py-1.5 !px-3 text-xs" onClick={() => expand(o.id)}>
                  {expanded === o.id ? "إخفاء السجل" : "سجل الطلب"}
                </button>
              </div>

              {expanded === o.id && (
                <div className="border-t border-brand-100 pt-2 space-y-1">
                  {(events[o.id] || []).map((ev) => (
                    <p key={ev.id} className="text-xs text-brand-800">
                      · {fmtFull(ev.created_at)} — {ev.event_type === "created" ? "التسجيل" : ev.event_type === "payment_confirmed" ? "تأكيد دفع 💰" : ev.event_type === "payment_rejected" ? "إلغاء دفع ⚠️" : `الحالة: ${ev.old_status ?? ""} ← ${ev.new_status ?? ""}`}
                      {ev.profiles ? ` — بواسطة ${ev.profiles.full_name || ev.profiles.email}` : " — بواسطة العميل"}
                    </p>
                  ))}
                  {(events[o.id] || []).length === 0 && <p className="text-xs text-brand-700">بنجيب السجل…</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-brand-700">
        كل تغيير حالة بيتسجل باسمك ووقتها تلقائيًا يا {profile?.full_name || "زميلنا الغالي"} 🌸
      </p>
    </div>
  );
}
