"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { ActivityBucket, Granularity, RepSnapshot } from "@/lib/ae-activity/types";

// Métriques comparables entre reps (vue "Tous").
const METRICS = [
  { key: "calls", label: "Outbound calls", get: (b: ActivityBucket) => b.outboundCalls },
  { key: "booked", label: "Meetings booked", get: (b: ActivityBucket) => b.meetingsScheduled },
  { key: "held", label: "Meetings held", get: (b: ActivityBucket) => b.meetingsHeld },
  { key: "leads", label: "Inbound leads", get: (b: ActivityBucket) => b.leadsInbound },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

function firstName(n: string): string {
  return n.split(" ")[0] || n;
}

/**
 * Graphe de comparaison des sales (vue "Tous") : une ligne par rep sur la
 * granularité choisie, sélecteur de métrique (appels / meetings bookés / tenus)
 * et toggles pour retirer des sales du graphe.
 */
export function RepCompare({ reps, gran }: { reps: RepSnapshot[]; gran: Granularity }) {
  const [metricKey, setMetricKey] = useState<MetricKey>("calls");
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const data = useMemo(() => {
    const get = (METRICS.find((m) => m.key === metricKey) ?? METRICS[0]).get;
    const keyToLabel = new Map<string, string>();
    const keys = new Set<string>();
    for (const rep of reps) {
      for (const b of rep.byGranularity[gran] ?? []) {
        keys.add(b.key);
        keyToLabel.set(b.key, b.label);
      }
    }
    const ordered = [...keys].sort();
    const repMaps = reps.map((rep) => {
      const m = new Map<string, number>();
      for (const b of rep.byGranularity[gran] ?? []) m.set(b.key, get(b));
      return m;
    });
    return ordered.map((k) => {
      const row: Record<string, string | number> = { label: keyToLabel.get(k) ?? k };
      reps.forEach((rep, i) => {
        row[rep.repOwnerId] = repMaps[i].get(k) ?? 0;
      });
      return row;
    });
  }, [reps, gran, metricKey]);

  const toggle = (ownerId: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(ownerId)) next.delete(ownerId);
      else next.add(ownerId);
      return next;
    });

  const visible = reps.filter((r) => !hidden.has(r.repOwnerId));

  return (
    <div className="rounded-xl border p-4 mb-6" style={{ borderColor: "#eee", background: "#fff" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-[14px] font-semibold" style={{ color: "#111" }}>
            Comparaison des sales
          </h3>
          <p className="text-[11px]" style={{ color: "#aaa" }}>
            une ligne par rep · clique un rep pour l&apos;enlever du graphe
          </p>
        </div>
        <div className="inline-flex gap-1 rounded-xl p-1" style={{ background: "#f5f5f5" }}>
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetricKey(m.key)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
              style={{
                background: metricKey === m.key ? "#111" : "transparent",
                color: metricKey === m.key ? "#fff" : "#666",
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Toggles reps */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {reps.map((rep) => {
          const off = hidden.has(rep.repOwnerId);
          return (
            <button
              key={rep.repOwnerId}
              onClick={() => toggle(rep.repOwnerId)}
              className="text-[11px] px-2 py-1 rounded-full font-medium flex items-center gap-1.5"
              style={{
                background: off ? "#f5f5f5" : `${rep.accent}18`,
                color: off ? "#bbb" : rep.accent,
                textDecoration: off ? "line-through" : "none",
              }}
            >
              <span
                style={{ width: 8, height: 8, borderRadius: "50%", background: off ? "#ccc" : rep.accent }}
              />
              {firstName(rep.repName)}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="flex items-center justify-center text-xs" style={{ height: 260, color: "#bbb" }}>
          Aucun rep sélectionné
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#888" }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11, fill: "#888" }}
              axisLine={false}
              tickLine={false}
              width={40}
              allowDecimals={false}
            />
            <RTooltip contentStyle={{ background: "#fff", border: "1px solid #eee", borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
            {visible.map((rep) => (
              <Line
                key={rep.repOwnerId}
                type="monotone"
                dataKey={rep.repOwnerId}
                name={firstName(rep.repName)}
                stroke={rep.accent}
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
