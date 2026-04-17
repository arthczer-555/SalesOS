"use client";

import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, Zap, AlertTriangle } from "lucide-react";
import { useMarketingSeo } from "@/lib/hooks/use-marketing";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceArea,
} from "recharts";

function positionBadgeStyle(pos: number) {
  if (pos <= 3) return { background: "#f0fdf4", color: "#16a34a" };
  if (pos <= 10) return { background: "#fef9c3", color: "#ca8a04" };
  if (pos <= 20) return { background: "#ffedd5", color: "#ea580c" };
  return { background: "#fee2e2", color: "#dc2626" };
}

type SortKey = "keyword" | "impressions" | "clicks" | "ctr" | "position";

export default function SeoTab() {
  const [opportunitiesOnly, setOpportunitiesOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("impressions");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { keywords, cannibalizationAlerts, seoError, isLoading } = useMarketingSeo(28, opportunitiesOnly);

  const sorted = useMemo(() => {
    return [...keywords].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (typeof va === "string" && typeof vb === "string") return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === "asc" ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [keywords, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null;
    return sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  };

  if (isLoading) return <div className="text-sm" style={{ color: "#888" }}>Loading...</div>;

  if (seoError) {
    return (
      <div className="rounded-xl flex items-start gap-3" style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "14px 18px" }}>
        <span className="text-sm shrink-0 mt-0.5">⚠</span>
        <div>
          <p className="text-sm font-medium" style={{ color: "#dc2626" }}>Search Console connection issue</p>
          <p className="text-xs mt-1" style={{ color: "#888" }}>{seoError}</p>
        </div>
      </div>
    );
  }

  if (keywords.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 rounded-xl" style={{ background: "#fff", border: "1px solid #eee" }}>
        <p className="text-sm font-medium" style={{ color: "#555" }}>No SEO data available yet</p>
        <p className="text-xs mt-1" style={{ color: "#aaa" }}>Search Console needs a few days to collect data after verification. Check back soon.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex items-center justify-between py-3">
        <span className="text-xs font-medium" style={{ color: "#888" }}>{keywords.length} keywords found</span>
        <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: "#555" }}>
          <span>Opportunities only</span>
          <button
            onClick={() => setOpportunitiesOnly(!opportunitiesOnly)}
            className="relative rounded-full transition-colors"
            style={{ width: 40, height: 22, background: opportunitiesOnly ? "#f01563" : "#e5e5e5" }}
          >
            <span className="absolute top-0.5 rounded-full bg-white transition-all" style={{ width: 18, height: 18, left: opportunitiesOnly ? 19 : 3, boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }} />
          </button>
        </label>
      </div>

      {/* Keywords Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: "#fff", border: "1px solid #eeeeee" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "#f9f9f9", borderBottom: "1px solid #eeeeee" }}>
              <th style={{ width: 20 }} />
              {([
                { key: "keyword" as SortKey, label: "KEYWORD", align: "left" as const, noSort: false },
                { key: "keyword" as SortKey, label: "PAGE", align: "left" as const, noSort: true },
                { key: "impressions" as SortKey, label: "IMPRESSIONS", align: "right" as const, noSort: false },
                { key: "clicks" as SortKey, label: "CLICKS", align: "right" as const, noSort: false },
                { key: "ctr" as SortKey, label: "CTR", align: "right" as const, noSort: false },
                { key: "position" as SortKey, label: "POSITION", align: "right" as const, noSort: false },
              ]).map((col, i) => (
                <th key={i} onClick={col.noSort ? undefined : () => handleSort(col.key)} className={`px-4 py-2.5 font-medium text-[10px] uppercase tracking-wider ${!col.noSort ? "cursor-pointer select-none" : ""}`} style={{ color: "#888", textAlign: col.align }}>
                  <span className="inline-flex items-center gap-0.5">{col.label}{!col.noSort && <SortIcon col={col.key} />}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((kw, i) => {
              const isOpportunity = kw.position >= 5 && kw.position <= 20 && kw.ctr < 3;
              const posStyle = positionBadgeStyle(kw.position);
              return (
                <tr key={`${kw.keyword}-${kw.page}-${i}`} style={{ background: isOpportunity ? "#fffbeb" : i % 2 === 1 ? "#fafafa" : "#fff", borderBottom: "1px solid #f5f5f5" }}>
                  <td className="pl-3">{isOpportunity && <Zap size={14} style={{ color: "#d97706" }} />}</td>
                  <td className="px-4 py-2.5 font-medium" style={{ color: "#111" }}>{kw.keyword}</td>
                  <td className="px-4 py-2.5" style={{ color: "#555", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kw.pageTitle || <span style={{ color: "#ccc" }}>—</span>}</td>
                  <td className="px-4 py-2.5 text-right font-mono" style={{ color: "#555" }}>{kw.impressions.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right font-mono" style={{ color: "#555" }}>{kw.clicks.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right font-mono" style={{ color: "#555" }}>{kw.ctr}%</td>
                  <td className="px-4 py-2.5 text-right"><span className="text-xs font-medium px-2 py-0.5 rounded-full" style={posStyle}>{kw.position.toFixed(1)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Cannibalization Alerts */}
      {cannibalizationAlerts.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="font-semibold text-sm" style={{ color: "#111" }}>Cannibalization</h3>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "#fee2e2", color: "#dc2626" }}>{cannibalizationAlerts.length}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {cannibalizationAlerts.map((alert, i) => (
              <div key={i} className="rounded-xl relative" style={{ background: "#fff", border: "1px solid #fecaca", padding: "16px" }}>
                <AlertTriangle size={16} className="absolute top-4 right-4" style={{ color: "#dc2626" }} />
                <p className="font-semibold text-sm mb-2" style={{ color: "#111" }}>{alert.keyword}</p>
                <div className="space-y-1.5">
                  {alert.articles.map((a) => (
                    <div key={a.page} className="flex items-center gap-2 text-xs">
                      <span style={{ color: "#555", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                      <span className="font-medium px-1.5 py-0.5 rounded-full shrink-0" style={positionBadgeStyle(a.position)}>Pos. {a.position.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
