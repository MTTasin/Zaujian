"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  adminGet, deleteOrder, markOrdersSeen, ORDER_DELETABLE, ORDER_STATUSES, type AdminOrder,
} from "@/lib/adminApi";
import { PageHeader, Card, Select, TextInput, StatusPill, Table, Th, Td, AdminEmpty } from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";

export default function AdminOrders() {
  const router = useRouter();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");   // debounced value actually sent
  const [error, setError] = useState("");

  // Debounce the search box so we don't hit the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  function load() {
    const params = new URLSearchParams();
    if (filter) params.set("status", filter);
    if (query) params.set("q", query);
    const qs = params.toString();
    adminGet<AdminOrder[]>(`orders/${qs ? `?${qs}` : ""}`)
      .then(setOrders)
      .catch((e) => setError(e.message));
  }
  useEffect(load, [filter, query]);

  // Opening the Orders page acknowledges new orders → clears the badge + sound.
  useEffect(() => { markOrdersSeen().catch(() => {}); }, []);

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
          <Link
            href="/admin/orders/new"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-plum px-4 text-sm font-semibold text-white transition hover:bg-wine"
          >
            <Icon name="plus" size={16} /> New order
          </Link>
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
          <div className="sm:w-56">
            <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All statuses</option>
              {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
        </div>
      </Card>

      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      {orders.length === 0 ? (
        <AdminEmpty icon="cart" title="No orders" hint="Orders will appear here once customers check out." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Code</Th><Th>Customer</Th>
              <Th>Phone</Th><Th>Total</Th>
              <Th>Paid?</Th><Th>Courier</Th>
              <Th>Status</Th><Th></Th>
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
                <Td><StatusPill status={o.status} label={o.status_display} /></Td>
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
