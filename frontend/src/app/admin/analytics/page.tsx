"use client";

// Storefront analytics. Two clocks on this page:
//   * the live card polls every 10s (only while this tab is visible)
//   * everything else reloads when the range changes — today is computed live
//     server-side, older days come from the nightly rollups.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { getLive, getOverview, type AnalyticsOverview, type LiveData } from "@/lib/adminApi";
import { PageHeader, Card, StatCard, Select, Loading, Table, Th, Td } from "@/components/admin/ui";
import { Icon } from "@/components/ui/Icon";

// Recharts renders inline styles, so the tooltip has to read the vars too.
const CHART_TOOLTIP = {
  borderRadius: 12,
  border: "1px solid var(--chart-grid)",
  background: "var(--chart-tooltip-bg)",
  color: "var(--chart-tooltip-text)",
} as const;

const PLUM = "var(--chart-plum)";
const GOLD = "var(--chart-gold)";
const PIE_COLORS = [PLUM, GOLD, "var(--chart-green)", "var(--chart-blue)",
  "var(--chart-violet)", "var(--chart-amber)"];

const LIVE_POLL_MS = 10_000;
const RANGES = [
  { value: 7, label: "Last 7 days" },
  { value: 14, label: "Last 14 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

const STEP_LABELS: Record<string, string> = {
  view_combo: "Viewed a listing",
  add_to_cart: "Added to cart",
  begin_checkout: "Started checkout",
  purchase: "Placed order",
};

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export default function AdminAnalytics() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [live, setLive] = useState<LiveData | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getOverview(days).then(setData).catch((e) => setError(e.message));
  }, [days]);

  const pollLive = useCallback(() => {
    // Don't burn a Passenger worker for a tab nobody is looking at.
    if (document.visibilityState !== "visible") return;
    getLive().then(setLive).catch(() => {});
  }, []);

  useEffect(() => {
    pollLive();
    timer.current = setInterval(pollLive, LIVE_POLL_MS);
    document.addEventListener("visibilitychange", pollLive);
    return () => {
      if (timer.current) clearInterval(timer.current);
      document.removeEventListener("visibilitychange", pollLive);
    };
  }, [pollLive]);

  if (error) return <p className="rounded-lg bg-red-50 p-4 text-red-600">{error}</p>;
  if (!data) return <Loading />;

  const t = data.today;
  const funnelTop = data.funnel[0]?.sessions || 0;

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Storefront traffic, behaviour and product performance"
        action={
          <div className="w-44">
            <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
              {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </div>
        }
      />

      {/* ---- Live ---- */}
      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
            </span>
            <div>
              <p className="font-display text-3xl font-bold text-plum">
                {live?.active ?? "—"}
                <span className="ml-2 text-sm font-medium text-slate-500">
                  visitor{live?.active === 1 ? "" : "s"} right now
                </span>
              </p>
              <p className="text-xs text-slate-400">
                active in the last {Math.round((live?.window_seconds ?? 300) / 60)} minutes
              </p>
            </div>
          </div>
          <div className="flex gap-2 text-xs font-semibold">
            <span className="rounded-full bg-plum/10 px-3 py-1.5 text-plum">
              {live?.in_wizard ?? 0} customizing
            </span>
            <span className="rounded-full bg-amber-100 px-3 py-1.5 text-amber-700">
              {live?.in_cart ?? 0} in cart
            </span>
            <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-emerald-700">
              {live?.in_checkout ?? 0} in checkout
            </span>
          </div>
        </div>

        {!!live?.by_path?.length && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            {live.by_path.map((p) => (
              <span key={p.path} className="rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
                <span className="font-mono">{p.path}</span>
                <span className="ml-2 font-semibold text-plum">{p.count}</span>
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* ---- Today ---- */}
      <h2 className="mb-3 font-semibold text-slate-800">Today</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Visitors" value={t.visitors} icon="user" tone="plum" />
        <StatCard label="Pageviews" value={t.pageviews} icon="image" tone="slate" />
        <StatCard label="New visitors" value={t.new_visitors} icon="sparkles" tone="gold" />
        <StatCard label="Bounce rate" value={`${t.bounce_rate}%`} icon="arrowRight" tone="amber"
                  hint="Left after one page" />
        <StatCard label="Avg. visit" value={mmss(t.avg_seconds)} icon="clock" tone="blue" />
      </div>

      {/* ---- Trend ---- */}
      <Card className="mt-6 p-5">
        <h2 className="mb-4 font-semibold text-slate-800">Traffic ({days} days)</h2>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data.trend}>
            <defs>
              <linearGradient id="vis" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PLUM} stopOpacity={0.35} />
                <stop offset="100%" stopColor={PLUM} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--chart-axis)" }} tickFormatter={(d) => d.slice(5)} />
            <YAxis tick={{ fontSize: 11, fill: "var(--chart-axis)" }} />
            <Tooltip contentStyle={CHART_TOOLTIP} />
            <Area type="monotone" dataKey="visitors" stroke={PLUM} strokeWidth={2.5}
                  fill="url(#vis)" name="Visitors" />
            <Area type="monotone" dataKey="pageviews" stroke={GOLD} strokeWidth={2}
                  fillOpacity={0} name="Pageviews" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* ---- Funnel + sources ---- */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-1 font-semibold text-slate-800">Funnel</h2>
          <p className="mb-4 text-xs text-slate-400">
            Sessions reaching each step — one person viewing ten times counts once.
          </p>
          <div className="space-y-3">
            {data.funnel.map((f) => {
              const pct = funnelTop ? (f.sessions / funnelTop) * 100 : 0;
              return (
                <div key={f.step}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium text-slate-700">{STEP_LABELS[f.step] ?? f.step}</span>
                    <span className="tabular-nums text-slate-500">
                      {f.sessions} <span className="text-xs">({pct.toFixed(0)}%)</span>
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-plum transition-all"
                         style={{ width: `${Math.max(pct, 1)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-slate-800">Devices</h2>
          {data.devices.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={data.devices} dataKey="sessions" nameKey="device"
                     cx="50%" cy="50%" outerRadius={70} label>
                  {data.devices.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Card>
      </div>

      {/* ---- Listings ---- */}
      <Card className="mt-6 p-5">
        <h2 className="mb-1 font-semibold text-slate-800">Listings — views to orders</h2>
        <p className="mb-4 text-xs text-slate-400">
          High views with low conversion usually means the photo or the price, not the product.
        </p>
        {data.top_combos.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Listing</Th><Th>Views</Th><Th>Carts</Th>
                <Th>Orders</Th><Th>Conversion</Th><Th>Revenue</Th>
              </tr>
            </thead>
            <tbody>
              {data.top_combos.map((c) => (
                <tr key={c.combo_id}>
                  <Td className="font-medium text-slate-900">{c.name}</Td>
                  <Td className="tabular-nums">{c.views}</Td>
                  <Td className="tabular-nums">{c.carts}</Td>
                  <Td className="tabular-nums">{c.orders}</Td>
                  <Td>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      c.conversion >= 5 ? "bg-emerald-100 text-emerald-700"
                        : c.conversion > 0 ? "bg-amber-100 text-amber-700"
                        : "bg-slate-100 text-slate-500"
                    }`}>
                      {c.conversion}%
                    </span>
                  </Td>
                  <Td className="tabular-nums">৳ {c.revenue.toLocaleString()}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <Empty hint="Listing stats appear after the nightly rollup runs." />}
      </Card>

      {/* ---- Pages / sources / searches ---- */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-slate-800">Top pages</h2>
          {data.top_pages.length ? (
            <Table>
              <thead><tr><Th>Path</Th><Th>Views</Th><Th>Entries</Th><Th>Exits</Th></tr></thead>
              <tbody>
                {data.top_pages.map((p) => (
                  <tr key={p.path}>
                    <Td>
                      {p.label && (
                        <div className="font-medium text-slate-900">{p.label}</div>
                      )}
                      <span className="font-mono text-xs text-slate-500">{p.path}</span>
                    </Td>
                    <Td className="tabular-nums">{p.views}</Td>
                    <Td className="tabular-nums">{p.entries}</Td>
                    <Td className="tabular-nums">{p.exits}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty hint="Page stats appear after the nightly rollup runs." />}
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-slate-800">Where they came from</h2>
          {data.sources.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.sources} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis type="number" tick={{ fontSize: 11, fill: "var(--chart-axis)" }} />
                <YAxis type="category" dataKey="source" width={90}
                       tick={{ fontSize: 11, fill: "var(--chart-axis)" }} />
                <Tooltip contentStyle={CHART_TOOLTIP} />
                <Bar dataKey="sessions" fill={PLUM} radius={[0, 6, 6, 0]} name="Sessions" />
                <Bar dataKey="orders" fill={GOLD} radius={[0, 6, 6, 0]} name="Orders" />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty hint="Source stats appear after the nightly rollup runs." />}
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-1 font-semibold text-slate-800">Searches with no results</h2>
          <p className="mb-4 text-xs text-slate-400">Demand you aren&apos;t serving yet.</p>
          {data.empty_searches.length ? (
            <ul className="space-y-2">
              {data.empty_searches.map((s) => (
                <li key={s.term} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span className="text-sm text-slate-700">{s.term}</span>
                  <span className="text-xs font-semibold text-plum">{s.count}×</span>
                </li>
              ))}
            </ul>
          ) : <Empty hint="Nothing yet — good sign." />}
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-slate-800">Live activity</h2>
          {live?.recent?.length ? (
            <ul className="space-y-2">
              {live.recent.map((e, i) => (
                <li key={i} className="flex items-center gap-3 text-sm">
                  <span className="text-plum/40"><Icon name="chevronRight" size={14} /></span>
                  <span className="font-medium text-slate-700">{e.name.replace(/_/g, " ")}</span>
                  {e.label && <span className="truncate text-slate-500">{e.label}</span>}
                  <span className="ml-auto shrink-0 font-mono text-xs text-slate-400">
                    {new Date(e.ts).toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka" })}
                  </span>
                </li>
              ))}
            </ul>
          ) : <Empty hint="Waiting for visitor activity." />}
        </Card>
      </div>
    </div>
  );
}

function Empty({ hint }: { hint?: string }) {
  return (
    <p className="py-8 text-center text-sm text-slate-400">
      {hint ?? "No data yet."}
    </p>
  );
}
