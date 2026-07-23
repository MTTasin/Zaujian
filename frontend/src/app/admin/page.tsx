"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { adminGet, type AnalyticsData, type DashboardData } from "@/lib/adminApi";
import {
  PageHeader, Card, StatCard, StatusPill, Loading, Table, Th, Td,
} from "@/components/admin/ui";

const PLUM = "#5b2a4e";
const GOLD = "#a9822f";
const PIE_COLORS = [PLUM, GOLD, "#2e7d5b", "#3b6ea5", "#7c4d8b", "#b4791f"];

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    adminGet<DashboardData>("dashboard/").then(setData).catch((e) => setError(e.message));
    adminGet<AnalyticsData>("analytics/").then(setAnalytics).catch(() => {});
  }, []);

  if (error) return <p className="rounded-lg bg-red-50 p-4 text-red-600">{error}</p>;
  if (!data) return <Loading />;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Overview of store activity" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Orders today" value={data.orders_today} icon="cart" tone="plum" />
        <StatCard label="Pending payment" value={data.pending_payment} icon="wallet" tone="amber" />
        <StatCard label="Pending custom pricing" value={data.pending_custom} icon="edit" tone="blue" />
        <StatCard label="Total orders" value={data.total_orders} icon="box" tone="gold" />
        <StatCard
          label="Profit"
          value={`৳${Math.round(data.total_profit).toLocaleString()}`}
          icon="wallet"
          tone="green"
          hint={data.uncosted_count > 0 ? `${data.uncosted_count} orders not costed yet` : undefined}
        />
      </div>

      <div className="mt-6">
        <h2 className="mb-3 font-semibold text-slate-800">Today</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Visitors" value={data.visitors_today} icon="user" tone="slate" />
          <StatCard label="Popups shown" value={data.popups_shown_today} icon="sparkles" tone="gold" />
          <StatCard label="Popups clicked" value={data.popups_clicked_today} icon="check" tone="green" />
        </div>
      </div>

      {analytics && (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <h2 className="mb-4 font-semibold text-slate-800">Orders &amp; revenue (14 days)</h2>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={analytics.daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(d) => d.slice(5)} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0" }} />
                <Line type="monotone" dataKey="orders" stroke={PLUM} strokeWidth={2.5} dot={false} name="Orders" />
                <Line type="monotone" dataKey="revenue" stroke={GOLD} strokeWidth={2.5} dot={false} name="Revenue ৳" />
              </LineChart>
            </ResponsiveContainer>
          </Card>
          <Card className="p-5">
            <h2 className="mb-4 font-semibold text-slate-800">Orders by status</h2>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={analytics.status_breakdown} dataKey="count" nameKey="status"
                  cx="50%" cy="50%" outerRadius={80} paddingAngle={2}
                  label={(p: { name?: string }) => p.name ?? ""}>
                  {analytics.status_breakdown.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0" }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>
          <Card className="p-5 lg:col-span-3">
            <h2 className="mb-4 font-semibold text-slate-800">Daily revenue (৳)</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={analytics.daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(d) => d.slice(5)} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0" }} />
                <Bar dataKey="revenue" fill={PLUM} radius={[4, 4, 0, 0]} name="Revenue ৳" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      <div className="mt-8">
        <h2 className="mb-3 font-semibold text-slate-800">Recent orders</h2>
        <Table>
          <thead>
            <tr>
              <Th>Code</Th><Th>Customer</Th><Th>Phone</Th><Th>Total</Th><Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {data.recent_orders.map((o) => (
              <tr key={o.id} className="transition hover:bg-slate-50">
                <Td>
                  <Link href={`/admin/orders/${o.id}`} className="font-mono font-semibold text-plum hover:underline">
                    {o.uid}
                  </Link>
                </Td>
                <Td className="font-medium text-slate-900">{o.customer_name}</Td>
                <Td>{o.phone}</Td>
                <Td className="tabular-nums">৳ {o.total}</Td>
                <Td><StatusPill status={o.status} label={o.status_display} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
