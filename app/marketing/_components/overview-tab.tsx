"use client";

import { useState, useMemo } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { useMarketingOverview } from "@/lib/hooks/use-marketing";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";

interface OverviewTabProps {
  onArticleClick: (articleId: string) => void;
}


function formatDuration(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function formatNumber(n: number) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}


const PERIODS = [
  { value: 7 as const, label: "7d" },
  { value: 14 as const, label: "14d" },
  { value: 30 as const, label: "30d" },
  { value: 90 as const, label: "90d" },
  { value: 365 as const, label: "1y" },
];

export default function OverviewTab({ onArticleClick }: OverviewTabProps) {
  const [period, setPeriod] = useState<7 | 14 | 30 | 90 | 365>(30);
  const { kpis, trafficData, trafficSources, topPages, source, ga4Error, isLoading } = useMarketingOverview(period);

  const kpiCards = useMemo(() => {
    if (!kpis) return [];
    return [
      { label: "SESSIONS", value: formatNumber(kpis.sessions), wow: kpis.sessionsWoW, invertColor: false },
      { label: "UNIQUE VISITORS", value: formatNumber(kpis.uniqueVisitors), wow: kpis.uniqueVisitorsWoW, invertColor: false },
      { label: "PAGE VIEWS", value: formatNumber(kpis.pageViews), wow: kpis.pageViewsWoW, invertColor: false },
      { label: "BOUNCE RATE", value: `${kpis.bounceRate}%`, wow: kpis.bounceRateWoW, invertColor: true },
      { label: "AVG. DURATION", value: formatDuration(kpis.avgDuration), wow: kpis.avgDurationWoW, invertColor: false },
      { label: "CTA CONVERSIONS", value: String(kpis.ctaConversions), wow: kpis.ctaConversionsWoW, invertColor: false },
    ];
  }, [kpis]);

  const hasLiveTopPages = topPages.length > 0;

  if (isLoading) return <div className="text-sm" style={{ color: "#888" }}>Loading...</div>;

  const totalSessions = trafficSources.reduce((s, t) => s + t.sessions, 0);
  const hasData = kpis !== null;

  return (
    <div className="space-y-5">
      {/* Date filter + source badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className="text-xs font-medium rounded-full px-3 py-1 transition-colors"
              style={{
                background: period === p.value ? "#f01563" : "#fff",
                color: period === p.value ? "#fff" : "#888",
                border: period === p.value ? "1px solid #f01563" : "1px solid #eee",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span
          className="text-[10px] font-medium px-2 py-0.5 rounded-full"
          style={{
            background: source === "ga4" ? "#f0fdf4" : "#f5f5f5",
            color: source === "ga4" ? "#16a34a" : "#888",
          }}
        >
          {source === "ga4" ? "Live — Google Analytics" : "Mock Data"}
        </span>
      </div>

      {/* GA4 Error Banner */}
      {ga4Error && (
        <div className="rounded-xl flex items-start gap-3" style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "14px 18px" }}>
          <span className="text-sm shrink-0 mt-0.5">⚠</span>
          <div>
            <p className="text-sm font-medium" style={{ color: "#dc2626" }}>Google Analytics connection issue</p>
            <p className="text-xs mt-1" style={{ color: "#888" }}>{ga4Error}</p>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpiCards.map((k) => {
          const isPositive = k.invertColor ? k.wow < 0 : k.wow > 0;
          return (
            <div
              key={k.label}
              className="rounded-xl"
              style={{ background: "#fff", border: "1px solid #eeeeee", padding: "16px 20px" }}
            >
              <p className="text-xs font-medium tracking-wide" style={{ color: "#999" }}>{k.label}</p>
              <p className="text-2xl font-bold mt-1" style={{ color: "#111" }}>{k.value}</p>
              <div
                className="flex items-center gap-1 mt-1.5 text-xs font-medium rounded-full px-2 py-0.5 w-fit"
                style={{
                  background: isPositive ? "#f0fdf4" : "#fef2f2",
                  color: isPositive ? "#16a34a" : "#dc2626",
                }}
              >
                {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {k.wow > 0 ? "+" : ""}{k.wow}%
              </div>
            </div>
          );
        })}
      </div>

      {/* Traffic Chart */}
      <div className="rounded-xl" style={{ background: "#fff", border: "1px solid #eeeeee", padding: "20px" }}>
        <div className="mb-4">
          <h3 className="font-semibold" style={{ color: "#111" }}>Traffic</h3>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={trafficData}>
            <defs>
              <linearGradient id="gradSessions" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f01563" stopOpacity={0.08} />
                <stop offset="100%" stopColor="#f01563" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradVisitors" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.05} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#aaa" }}
              tickFormatter={(d: string) => {
                const date = new Date(d);
                if (period >= 365) return date.toLocaleDateString("en-US", { month: "short" });
                if (period >= 90) return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
                return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
              }}
              interval={period >= 365 ? 30 : period >= 90 ? 7 : period >= 30 ? 3 : 1}
              axisLine={false}
              tickLine={false}
            />
            <YAxis hide />
            <RechartsTooltip
              contentStyle={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, boxShadow: "0 2px 8px rgba(0,0,0,0.08)", fontSize: 13 }}
              labelFormatter={(d) => new Date(String(d)).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}
              formatter={(value, name) => [value, name === "sessions" ? "Sessions" : "Visitors"]}
            />
            <Area type="monotone" dataKey="sessions" stroke="#f01563" strokeWidth={2} fill="url(#gradSessions)" />
            <Area type="monotone" dataKey="visitors" stroke="#3b82f6" strokeWidth={1.5} fill="url(#gradVisitors)" />
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-3 text-xs" style={{ color: "#888" }}>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 rounded" style={{ background: "#f01563" }} /> Sessions</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 rounded" style={{ background: "#3b82f6" }} /> Visitors</span>
        </div>
      </div>

      {/* Sources + Top Articles */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Sources */}
        <div className="lg:col-span-2 rounded-xl" style={{ background: "#fff", border: "1px solid #eeeeee", padding: "20px" }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold" style={{ color: "#111" }}>Traffic Sources</h3>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: source === "ga4" ? "#f0fdf4" : "#f5f5f5", color: source === "ga4" ? "#16a34a" : "#888" }}>
              {source === "ga4" ? "Live" : "Mock"}
            </span>
          </div>
          <div className="flex justify-center">
            <PieChart width={200} height={200}>
              <Pie
                data={trafficSources}
                dataKey="sessions"
                nameKey="source"
                cx={100}
                cy={100}
                innerRadius={60}
                outerRadius={80}
                paddingAngle={2}
              >
                {trafficSources.map((s, i) => (
                  <Cell key={i} fill={s.color} />
                ))}
              </Pie>
              <text x={100} y={95} textAnchor="middle" style={{ fontSize: 18, fontWeight: 700, fill: "#111" }}>
                {formatNumber(totalSessions)}
              </text>
              <text x={100} y={112} textAnchor="middle" style={{ fontSize: 10, fill: "#888" }}>sessions</text>
            </PieChart>
          </div>
          <div className="space-y-2 mt-2">
            {trafficSources.map((s) => (
              <div key={s.source} className="flex items-center gap-2 text-sm">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                <span style={{ color: "#555" }}>{s.source}</span>
                <span className="ml-auto font-medium" style={{ color: "#111" }}>{s.percentage}%</span>
                <span className="text-xs" style={{ color: "#aaa" }}>{formatNumber(s.sessions)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top Articles */}
        <div className="lg:col-span-3 rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #eeeeee" }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ background: "#f9f9f9", borderBottom: "1px solid #eeeeee" }}>
            <h3 className="font-semibold text-sm" style={{ color: "#111" }}>Top Blog Articles</h3>
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{
                background: hasLiveTopPages ? "#f0fdf4" : "#f5f5f5",
                color: hasLiveTopPages ? "#16a34a" : "#888",
              }}
            >
              {hasLiveTopPages ? `Live — ${topPages.length} pages from GA4` : "No data"}
            </span>
          </div>
          {topPages.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid #eeeeee" }}>
                  <th className="text-left px-4 py-2 font-medium text-[10px] uppercase tracking-wider" style={{ color: "#888" }}>#</th>
                  <th className="text-left px-4 py-2 font-medium text-[10px] uppercase tracking-wider" style={{ color: "#888" }}>Title</th>
                  <th className="text-left px-4 py-2 font-medium text-[10px] uppercase tracking-wider" style={{ color: "#888" }}>Path</th>
                  <th className="text-right px-4 py-2 font-medium text-[10px] uppercase tracking-wider" style={{ color: "#888" }}>Sessions</th>
                  <th className="text-right px-4 py-2 font-medium text-[10px] uppercase tracking-wider" style={{ color: "#888" }}>Page Views</th>
                </tr>
              </thead>
              <tbody>
                {topPages.map((page, i) => (
                  <tr
                    key={page.path}
                    className="transition-colors"
                    style={{ borderBottom: "1px solid #f5f5f5" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#fafafa"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
                  >
                    <td className="px-4 py-2.5 font-medium" style={{ color: "#bbb" }}>{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium" style={{ color: "#111", maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {page.title || page.path}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: "#aaa", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <code className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#f5f5f5" }}>{page.path}</code>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono" style={{ color: "#555" }}>{formatNumber(page.sessions)}</td>
                    <td className="px-4 py-2.5 text-right font-mono" style={{ color: "#555" }}>{formatNumber(page.pageViews)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex items-center justify-center py-10">
              <p className="text-xs" style={{ color: "#aaa" }}>Connect Google Analytics to see your top blog articles</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
