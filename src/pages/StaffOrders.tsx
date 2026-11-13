import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, type OrderRow, type OrderEventRow, type OrderStatus } from "../lib/types";
import { money, fmtFull, STATUS, PAYMENT_STATUS_LABEL } from "../lib/format";
import { Spinner, EmptyBox, ErrorBox } from "../components/Common";
import { useAuth } from "../context/AuthContext";
import { Phone, MessageCircle } from "lucide-react";

const STATUS_FLOW: OrderStatus[] = ["received", "preparing", "done"];

export default function StaffOrders() {
  const { profile } = useAuth();
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [payFilter, setPayFilter] = useState<"all" | "cash" | "instapay">("all");
  const [payStatusFilter, setPayStatusFilter] = useState<"all" | "pending" | "paid" | "rejected" | "refunded">("all");
  const [working, setWorking] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, OrderEventRow[]>>({});

  const load = useCallback(async () => {
    try { await supabase.rpc("expire_stale_cash_orders", { p_branch_id: null } as any); } catch {}
    try { await supabase.rpc("expire_unconfirmed_obour_orders", {} as any); } catch {}
    const { data, error: e } = await supabase
      .from("orders")
      .select("*, branches(name), order_items(*), order_events(*)")
      .order("created_at", { ascending: false })
      .limit(150);
    if (e) {
      console.error("Staff orders load error:", e);
      setError("مش قادرين نجيب الطلبات — جرّب تحديث الصفحة");
      setOrders([]);
    } else {
      const rows = (data as unknown as OrderRow[]) ?? [];
      setOrders(rows);
      setError(null);
    }
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel("staff-orders").on("postgres_changes", { event: "*", schema: "public", table: "orders" }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const shown = useMemo(() => {
    let list = orders ?? [];
    if (filter === "active") list = list.filter((o) => !(o.status === "done" && (o.payment_status === "paid" || o.payment_status === "rejected" || o.payment_status === "refunded")));
    if (payFilter !== "all") list = list.filter((o) => (o.payment_method || "instapay") === payFilter);
    if (payStatusFilter !== "all") list = list.filter((o) => (o.payment_status || "pending") === payStatusFilter);
    return list;
  }, [orders, filter, payFilter, payStatusFilter]);

  const callRpc = async (name: string, params: any) => {
    setWorking(params.p_order_id || "rpc");
    const { data, error: e } = await supabase.rpc(name, params);
    setWorking(null);
    if (e || (data && data.ok === false)) {
      console.error("Staff RPC error:", name, e || data);
      setError((e as any)?.message || data?.message || "حصلت مشكلة — جرّب تاني");
      return false;
    }
    setError(null);
    load();
    return true;
  };

  const setStatus = async (o: OrderRow, s: OrderStatus) => {
    if (s === "done" && (o.payment_status || (o.payment_confirmed ? "paid" : "pending")) !== "paid") {
      const ok = confirm("الدفع لسه مش مؤكد/مستلم — متأكد إنك عايز تعلّم الطلب منتهي؟");
      if (!ok) return;
    }
    await callRpc("staff_set_status", { p_order_id: o.id, p_new_status: s });
  };

  const confirmInstaPay = (o: OrderRow) => callRpc("staff_confirm_payment", { p_order_id: o.id });
  const rejectInstaPay = async (o: OrderRow) => {
    const reason = prompt("سبب عدم تأكيد/رفض التحويل:", "لم يتم التحقق من التحويل") || "لم يتم التحقق من التحويل";
    await callRpc("staff_reject_payment", { p_order_id: o.id, p_reason: reason });
  };
  const acceptCash = (o: OrderRow) => callRpc("staff_set_status", { p_order_id: o.id, p_new_status: "preparing" });
  const markCashReceived = (o: OrderRow) => callRpc("staff_mark_cash_received", { p_order_id: o.id });
  const markLocationReceived = (o: OrderRow) => callRpc("staff_mark_location_received", { p_order_id: o.id });
  const cancelOrder = async (o: OrderRow) => {
    const reason = prompt("سبب الرفض/الإلغاء:", "تم الإلغاء");
    if (reason == null) return;
    await callRpc("staff_cancel_order", { p_order_id: o.id, p_reason: reason || "تم الإلغاء" });
  };

  const expand = async (id: string) => {
    if (expanded === id) return setExpanded(null);
    setExpanded(id);
    if (!events[id]) {
      const { data } = await supabase.from("order_events").select("*, profiles(full_name, email)").eq("order_id", id).order("created_at");
      if (data) setEvents((prev) => ({ ...prev, [id]: data as unknown as OrderEventRow[] }));
    }
  };

  if (!orders) return <Spinner label="بنحمّل شاشة الموظف… 📋" />;

  return (
    <div className="py-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-extrabold text-text">الطلبات الواردة 📋</h1>
        <div className="flex gap-1 flex-wrap">
          <button className={`pill ${filter === "active" ? "bg-btnbg text-btnfg" : "bg-surface border border-border"}`} onClick={() => setFilter("active")}>شغالة</button>
          <button className={`pill ${filter === "all" ? "bg-btnbg text-btnfg" : "bg-surface border border-border"}`} onClick={() => setFilter("all")}>كلها</button>
          <select className="pill bg-surface border border-border" value={payFilter} onChange={(e) => setPayFilter(e.target.value as any)}>
            <option value="all">كل طرق الدفع</option><option value="cash">💵 كاش</option><option value="instapay">📲 InstaPay</option>
          </select>
          <select className="pill bg-surface border border-border" value={payStatusFilter} onChange={(e) => setPayStatusFilter(e.target.value as any)}>
            <option value="all">كل حالات الدفع</option><option value="pending">قيد الانتظار</option><option value="paid">مدفوع</option><option value="rejected">مرفوض</option><option value="refunded">مسترد</option>
          </select>
          <button className="pill bg-surface border border-border" onClick={load}>↻</button>
        </div>
      </div>

      {error && <ErrorBox msg={error} />}
      {shown.length === 0 && <EmptyBox msg="مفيش طلبات مطابقة دلوقتي 🌙" />}

      <div className="grid gap-3">
        {shown.map((o) => {
          const s: OrderStatus = (o.status as OrderStatus) ?? "received";
          const st = STATUS[s];
          const next = STATUS_FLOW[STATUS_FLOW.indexOf(o.status as OrderStatus) + 1];
          const method = o.payment_method || "instapay";
          const pStatus = o.payment_status || (o.payment_confirmed ? "paid" : "pending");
          const isCash = method === "cash";
          const cancelled = o.status === "done" && (pStatus === "rejected" || pStatus === "refunded");
          const isObour = o.delivery_type === "obour";
          const phone = (o.customer_phone || "").replace(/\s+/g, "");
          return (
            <div key={o.id} className="card p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-extrabold text-brand-600 text-lg" dir="ltr">{o.order_number}</p>
                  <p className="text-xs text-brand-800">{o.branches?.name} • {fmtFull(o.created_at)}</p>
                  <div className="flex gap-1 flex-wrap mt-1">
                    <span className="pill bg-brand-50 border border-brand-200 text-brand-800">{isCash ? "💵 كاش" : "📲 InstaPay"}</span>
                    <span className={`pill border ${pStatus === "paid" ? "status-ok border-ok/40 text-ok-text" : pStatus === "pending" ? "status-warn border-warn/40 text-warn-text" : "status-danger border-danger-text/30 text-danger-text"}`}>
                      {pStatus === "pending" && !isCash && (o as any).instapay_claimed_at ? "تم الدفع — في انتظار التأكيد الآلي" : (PAYMENT_STATUS_LABEL[pStatus] || pStatus)}
                    </span>
                    {isObour && (
                      <span className={`pill border ${o.location_confirmed ? "status-ok border-ok/40 text-ok-text" : "status-warn border-warn/40 text-warn-text"}`}>
                        {o.location_confirmed ? "📍 اللوكيشن اتأكد" : "⚠️ مستني اللوكيشن"}
                      </span>
                    )}
                  </div>
                </div>
                <span className={`pill ${o.status === "done" ? "status-ok text-ok-text" : "bg-brand-100 text-brand-800"}`}>{st?.label} {st?.emoji}</span>
              </div>

              <div className="text-sm font-bold text-brand-900 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span>👤 {o.customer_name}{phone ? ` • ${phone}` : ""}</span>
                  {isObour && phone && (
                    <>
                      <a className="inline-flex items-center gap-1 rounded-lg border border-brand-200 px-2 py-1 text-xs" href={`tel:${phone}`}><Phone size={14}/>اتصال</a>
                      <a className="inline-flex items-center gap-1 rounded-lg border border-brand-200 px-2 py-1 text-xs" href={`https://wa.me/${phone.startsWith("0") ? "2"+phone : phone}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={14}/>واتساب</a>
                    </>
                  )}
                </div>
                <p>{o.order_items?.map((i) => `${i.name_snapshot} ×${i.qty}`).join(" • ")}</p>
                <p className="text-brand-800">
                  {o.delivery_type === "pickup" ? "استلام من الفرع" : o.delivery_type === "table" ? "توصيل داخل الفرع (+5)" : "توصيل داخل نطاق العبور"} • الإجمالي {money(o.total)}
                </p>
              </div>

              {o.delivery_type === "table" && (o.delivery_floor || o.delivery_spot) && (
                <div className="rounded-xl border-2 border-brand-400 bg-brand-50 px-3 py-2">
                  <p className="text-xs font-bold text-brand-700 mb-0.5">مكان التوصيل داخل الفرع</p>
                  <p className="text-xl sm:text-2xl font-extrabold text-brand-900 leading-snug">الدور {o.delivery_floor || "—"}{o.delivery_spot ? ` – ${o.delivery_spot}` : ""}</p>
                </div>
              )}

              {isObour && (
                <div className="rounded-xl border border-brand-200 bg-surface2 px-3 py-2 space-y-1">
                  <p className="text-xs font-bold text-brand-700">عنوان التوصيل (العبور)</p>
                  <p className="text-base sm:text-lg font-extrabold text-brand-900 leading-relaxed">{o.delivery_address || "—"}{o.delivery_landmark ? ` — علامة مميزة: ${o.delivery_landmark}` : ""}</p>
                </div>
              )}

              {(o as any).customer_note && (
                <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2">
                  <p className="text-xs font-bold text-amber-800 mb-0.5">ملاحظات على الطلب</p>
                  <p className="text-sm font-extrabold text-amber-950 whitespace-pre-wrap">{(o as any).customer_note}</p>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                {!isCash && !cancelled && pStatus !== "paid" && (
                  <div className="w-full rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2 text-sm font-bold text-violet-900">
                    InstaPay — رقم الأوردر: <b dir="ltr" className="text-base">{o.order_number}</b> {(o as any).instapay_claimed_at ? "• العميل أبلغ بإتمام التحويل (بانتظار التأكيد الآلي)" : "• بانتظار تأكيد العميل بالتحويل"}
                  </div>
                )}

                {!isCash && !cancelled && pStatus !== "paid" && (
                  <>
                    <button className="btn-primary !py-2 !px-3 text-xs font-extrabold" disabled={working === o.id} onClick={() => confirmInstaPay(o)}>✓ تأكيد الدفع (برقم الطلب)</button>
                    <button className="btn-soft !py-1.5 !px-3 text-xs text-red-600" disabled={working === o.id} onClick={() => rejectInstaPay(o)}>رفض/لم يُستلم التحويل</button>
                  </>
                )}

                {isCash && !cancelled && o.status === "received" && <button className="btn-primary !py-1.5 !px-3 text-xs" disabled={working === o.id} onClick={() => acceptCash(o)}>قبول الطلب</button>}
                {isCash && !cancelled && pStatus !== "paid" && <button className="btn-primary !py-1.5 !px-3 text-xs" disabled={working === o.id} onClick={() => markCashReceived(o)}>💵 تم استلام الكاش</button>}

                {isObour && !cancelled && !o.location_confirmed && <button className="btn-primary !py-1.5 !px-3 text-xs" disabled={working === o.id} onClick={() => markLocationReceived(o)}>تم استلام اللوكيشن على واتساب</button>}

                {!cancelled && next && o.status !== "done" && !(isCash && o.status === "received") && (
                  <button className="btn-primary !py-1.5 !px-3 text-xs" disabled={working === o.id} onClick={() => setStatus(o, next)}>الانتقال لـ "{STATUS[next].label}"</button>
                )}

                {!cancelled && <button className="btn-soft !py-1.5 !px-3 text-xs text-red-600" disabled={working === o.id} onClick={() => cancelOrder(o)}>رفض/إلغاء</button>}
                <button className="btn-soft !py-1.5 !px-3 text-xs" onClick={() => expand(o.id)}>{expanded === o.id ? "إخفاء السجل" : "سجل الطلب"}</button>
              </div>

              {expanded === o.id && (
                <div className="border-t border-brand-100 pt-2 space-y-1">
                  {o.delivery_type === "table" && (o.delivery_floor || o.delivery_spot) && <p className="text-sm font-extrabold text-brand-900">📍 التوصيل داخل الفرع: الدور {o.delivery_floor || "—"}{o.delivery_spot ? ` – ${o.delivery_spot}` : ""}</p>}
                  {isObour && <p className="text-sm font-extrabold text-brand-900">📍 العنوان: {o.delivery_address || "—"}{o.delivery_landmark ? ` — ${o.delivery_landmark}` : ""} • اللوكيشن: {o.location_confirmed ? "مؤكد ✅" : "لم يُؤكَّد ⚠️"}</p>}
                  {(o as any).customer_note && <p className="text-sm font-extrabold text-amber-900">ملاحظة العميل: {(o as any).customer_note}</p>}
                  {(events[o.id] || []).map((ev) => (
                    <p key={ev.id} className="text-xs text-brand-800">• {fmtFull(ev.created_at)} — {ev.event_type === "created" ? "التسجيل" : ev.event_type === "payment_confirmed" ? "تأكيد دفع" : ev.event_type === "payment_rejected" ? "رفض دفع" : ev.event_type === "cash_received" ? "تم استلام الكاش" : ev.event_type === "order_cancelled" ? "إلغاء الطلب" : `الحالة: ${ev.old_status ?? ""} → ${ev.new_status ?? ""}`} {ev.profiles ? `— بواسطة ${ev.profiles.full_name || ev.profiles.email}` : ""} {ev.note ? `(${ev.note})` : ""}</p>
                  ))}
                  {(events[o.id] || []).length === 0 && <p className="text-xs text-brand-700">بنحمّل السجل…</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-brand-700">كل تغيير حالة بيتسجّل باسمك ووقته تلقائيًا يا {profile?.full_name || "عميلنا الغالي"} 🌷</p>
    </div>
  );
}
