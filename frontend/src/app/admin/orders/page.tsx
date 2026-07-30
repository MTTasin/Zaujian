"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  adminGet, adminPost, deleteOrder, markOrdersSeen, syncSteadfast,
  ORDER_DELETABLE, ORDER_SORTS, ORDER_STATUSES,
  type AdminOrder,
} from "@/lib/adminApi";
import { PageHeader, Card, Select, TextInput, Table, Th, Td, AdminEmpty } from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";

// Submission date + time in Bangladesh local time (server stores UTC).
function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
    timeZone: "Asia/Dhaka",
  });
}

const SORT_KEY = "admin_orders_sort";
const SORT_DEFAULT = "status";   // workflow priority; the backend defines the order

export default function AdminOrders() {
  const router = useRouter();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");   // debounced value actually sent
  const [sort, setSort] = useState<string>(SORT_DEFAULT);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  // Remember the admin's chosen sort across visits (sorting is a personal habit).
  useEffect(() => {
    const saved = localStorage.getItem(SORT_KEY);
    if (saved && ORDER_SORTS.some((s) => s.value === saved)) setSort(saved);
  }, []);
  function changeSort(next: string) {
    setSort(next);
    localStorage.setItem(SORT_KEY, next);
  }
  // Header click: first click applies `asc`, clicking the same column again flips.
  const toggle = (asc: string, desc: string) => () =>
    changeSort(sort === asc ? desc : asc);
  const arrow = (asc: string, desc: string) =>
    sort === asc ? " ↑" : sort === desc ? " ↓" : "";

  // Debounce the search box so we don't hit the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  function load() {
    const params = new URLSearchParams();
    if (filter) params.set("status", filter);
    if (query) params.set("q", query);
    if (sort) params.set("sort", sort);
    const qs = params.toString();
    adminGet<AdminOrder[]>(`orders/${qs ? `?${qs}` : ""}`)
      .then(setOrders)
      .catch((e) => setError(e.message));
  }
  useEffect(load, [filter, query, sort]);

  // Opening the Orders page acknowledges new orders → clears the badge + sound.
  useEffect(() => { markOrdersSeen().catch(() => {}); }, []);

  // Inline status change from the list. set_status→confirmed fires the Meta
  // Purchase (same as the detail page); it does NOT book Steadfast — that stays
  // on the detail-page Confirm action. Optimistic, reverts on failure.
  async function changeStatus(o: AdminOrder, next: string) {
    if (next === o.status) return;
    if (next === "confirmed" && !o.courier_submitted &&
        !confirm(`Mark ${o.uid} confirmed? This reports the Meta Purchase. (No Steadfast booking — use the order page for that.)`)) {
      return;
    }
    setError("");
    setOrders((rows) => rows.map((r) => (r.id === o.id ? { ...r, status: next } : r)));
    try {
      await adminPost(`orders/${o.id}/set_status/`, { status: next });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update status");
      load();
    }
  }

  // Bulk Steadfast sweep. Only `shipped` orders are checked (backend enforces);
  // parcels Steadfast reports as delivered flip the order to `delivered`.
  async function sync() {
    setError("");
    setSyncMsg("");
    setSyncing(true);
    try {
      const r = await syncSteadfast();
      const parts = [`Checked ${r.checked} shipped order${r.checked === 1 ? "" : "s"}`];
      parts.push(r.delivered_count
        ? `${r.delivered_count} marked delivered (${r.delivered.join(", ")})`
        : "none newly delivered");
      if (r.errors.length) parts.push(`${r.errors.length} failed: ` +
        r.errors.map((e) => `${e.uid} — ${e.error}`).join("; "));
      if (r.remaining) parts.push(`${r.remaining} left — press again`);
      setSyncMsg(parts.join(" · "));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Steadfast sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function del(o: AdminOrder, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Permanently delete order ${o.uid}? This cannot be undone.`)) return;
    setError("");
    try {
      await deleteOrder(o.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete order");
    }
  }

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="All customer orders"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={sync}
              disabled={syncing}
              title="Check every shipped order's parcel on Steadfast; delivered ones become 'delivered'"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-plum/30 bg-white px-4 text-sm font-semibold text-plum transition hover:bg-plum/5 disabled:opacity-50"
            >
              <Icon name="truck" size={16} />
              {syncing ? "Checking Steadfast…" : "Sync Steadfast (shipped)"}
            </button>
            <Link
              href="/admin/orders/new"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-plum px-4 text-sm font-semibold text-white transition hover:bg-wine"
            >
              <Icon name="plus" size={16} /> New order
            </Link>
          </div>
        }
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, name, phone, email…"
            />
          </div>
          <div className="sm:w-48">
            <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All statuses</option>
              {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <div className="sm:w-56">
            <Select
              value={sort}
              onChange={(e) => changeSort(e.target.value)}
              aria-label="Sort orders"
            >
              {ORDER_SORTS.map((s) => (
                <option key={s.value} value={s.value}>Sort: {s.label}</option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {syncMsg && <p className="mb-4 rounded-lg bg-plum/5 p-3 text-sm text-plum">{syncMsg}</p>}

      {orders.length === 0 ? (
        <AdminEmpty icon="cart" title="No orders" hint="Orders will appear here once customers check out." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th onClick={toggle("code", "-code")} title="Sort by code">
                Code{arrow("code", "-code")}
              </Th>
              <Th onClick={toggle("newest", "oldest")} title="Sort by date placed">
                Placed{arrow("newest", "oldest")}
              </Th>
              <Th onClick={toggle("name", "-name")} title="Sort by customer name">
                Customer{arrow("name", "-name")}
              </Th>
              <Th>Phone</Th>
              <Th onClick={toggle("total_high", "total_low")} title="Sort by total">
                Total{arrow("total_high", "total_low")}
              </Th>
              <Th onClick={toggle("paid", "unpaid")} title="Sort by payment verified">
                Paid?{arrow("paid", "unpaid")}
              </Th>
              <Th onClick={toggle("courier", "no_courier")} title="Sort by courier booked">
                Courier{arrow("courier", "no_courier")}
              </Th>
              <Th onClick={toggle("status", "-status")} title="Sort by workflow status">
                Status{arrow("status", "-status")}
              </Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr
                key={o.id}
                onClick={() => router.push(`/admin/orders/${o.id}`)}
                className="cursor-pointer transition hover:bg-plum/5"
              >
                <Td>
                  <Link
                    href={`/admin/orders/${o.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="font-mono font-semibold text-plum hover:underline"
                  >
                    {o.uid}
                  </Link>
                  {o.is_repeat_customer && (
                    <span title="Repeat customer" className="ml-1 inline-flex align-middle text-gold">
                      <Icon name="star" size={14} fill />
                    </span>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-xs text-slate-500">{fmtDate(o.created_at)}</Td>
                <Td className="font-medium text-slate-900">{o.customer_name}</Td>
                <Td>{o.phone}</Td>
                <Td className="tabular-nums">৳ {o.total}</Td>
                <Td>
                  {o.payment_verified
                    ? <span className="text-emerald-600"><Icon name="check" size={16} /></span>
                    : <span className="text-slate-300">—</span>}
                </Td>
                <Td>
                  {o.courier_submitted
                    ? <span className="text-plum"><Icon name="truck" size={16} /></span>
                    : <span className="text-slate-300">—</span>}
                </Td>
                <Td>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Select
                      value={o.status}
                      onChange={(e) => changeStatus(o, e.target.value)}
                      className="min-h-8 py-1 text-xs"
                    >
                      {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </div>
                </Td>
                <Td>
                  {ORDER_DELETABLE.has(o.status) ? (
                    <button
                      onClick={(e) => del(o, e)}
                      aria-label={`Delete order ${o.uid}`}
                      className="text-slate-400 transition hover:text-red-600"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  ) : (
                    <span
                      title="Only pending or cancelled orders can be deleted — cancel it first."
                      className="text-slate-200"
                    >
                      <Icon name="trash" size={16} />
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
