"use client";

import { Fragment } from "react";
import {
  BarChart,
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { ActivityBucket, FunnelStage, LostReason, QuarterAmount } from "@/lib/ae-activity/types";
import { DISPOSITION_COLORS, dispositionLabels } from "./helpers";

const GRID = "#f0f0f0";
const AXIS_TICK = { fontSize: 11, fill: "#888" } as const;
const TOOLTIP_STYLE = { background: "#fff", border: "1px solid #eee", borderRadius: 8, fontSize: 12 } as const;
const LEGEND_STYLE = { fontSize: 11 } as const;

function alpha(hex: string, suffix: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${suffix}` : hex;
}

function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export function ChartCard({
  title,
  subtitle,
  note,
  children,
}: {
  title: string;
  subtitle?: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "#eee", background: "#fff" }}>
      <h3 className="text-[13px] font-semibold mb-0.5" style={{ color: "#111" }}>
        {title}
      </h3>
      {subtitle && (
        <p className="text-[11px] mb-2" style={{ color: "#aaa" }}>
          {subtitle}
        </p>
      )}
      {children}
      {note && (
        <p className="text-[11px] mt-2 rounded-lg px-2.5 py-1.5" style={{ color: "#888", background: "#f7f7f8" }}>
          {note}
        </p>
      )}
    </div>
  );
}

function Empty() {
  return (
    <div className="flex items-center justify-center text-xs" style={{ height: 200, color: "#bbb" }}>
      No data for this period
    </div>
  );
}

export function VolumeChart({ buckets, accent }: { buckets: ActivityBucket[]; accent: string }) {
  if (buckets.length === 0) return <Empty />;
  const data = buckets.map((b) => ({ label: b.label, Calls: b.outboundCalls, Emails: b.emailsOut }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={compact} width={44} />
        <RTooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#fafafa" }} />
        <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" />
        <Bar dataKey="Calls" fill={accent} radius={[3, 3, 0, 0]} />
        <Bar dataKey="Emails" fill={alpha(accent, "66")} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CallOutcomeChart({ buckets }: { buckets: ActivityBucket[] }) {
  const labels = dispositionLabels(buckets);
  if (buckets.length === 0 || labels.length === 0) return <Empty />;
  const data = buckets.map((b) => {
    const row: Record<string, string | number> = { label: b.label };
    for (const l of labels) row[l] = b.dispositions?.[l] || 0;
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={42} />
        <RTooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#fafafa" }} />
        <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" />
        {labels.map((l) => (
          <Bar key={l} dataKey={l} stackId="calls" fill={DISPOSITION_COLORS[l] || "#94a3b8"} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Décomposition des appels sortants : cold call vs appel sur un contact
 *  qui a déjà un deal. Deux facettes d'un même total → même teinte, deux
 *  intensités, séparées par un filet de surface. */
export function CallTypeChart({ buckets, accent }: { buckets: ActivityBucket[]; accent: string }) {
  if (buckets.length === 0) return <Empty />;
  const data = buckets.map((b) => ({
    label: b.label,
    "Cold call": b.callsCold,
    "On a deal": b.callsOnDeal,
  }));
  if (data.every((d) => d["Cold call"] === 0 && d["On a deal"] === 0)) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={compact} width={44} />
        <RTooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#fafafa" }} />
        <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" />
        <Bar dataKey="Cold call" stackId="c" fill={alpha(accent, "59")} stroke="#fff" strokeWidth={2} />
        <Bar dataKey="On a deal" stackId="c" fill={accent} stroke="#fff" strokeWidth={2} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MeetingSourceChart({ buckets, accent }: { buckets: ActivityBucket[]; accent: string }) {
  if (buckets.length === 0) return <Empty />;
  const data = buckets.map((b) => ({
    label: b.label,
    "Self-sourced": b.meetingsSelfSourced,
    "Inbound lead": b.meetingsInboundSourced,
    "Logged in Slack": b.selfBookedSlack,
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={42} />
        <RTooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#fafafa" }} />
        <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" />
        <Bar dataKey="Self-sourced" stackId="m" fill={accent} radius={[3, 3, 0, 0]} />
        <Bar dataKey="Inbound lead" stackId="m" fill="#94a3b8" radius={[3, 3, 0, 0]} />
        <Line type="monotone" dataKey="Logged in Slack" stroke="#111" strokeWidth={2} dot={{ r: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function FunnelChart({ funnel, accent }: { funnel: FunnelStage[]; accent: string }) {
  const data = (funnel ?? []).filter((s) => s.count > 0 || s.id === "closedwon");
  if (data.length === 0) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 10.5, fill: "#666" }}
          axisLine={false}
          tickLine={false}
          width={148}
        />
        <RTooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#fafafa" }} />
        <Bar dataKey="count" name="Deals" fill={accent} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LostReasonsChart({ lostReasons, accent }: { lostReasons: LostReason[]; accent: string }) {
  const data = lostReasons.filter((r) => r.count > 0).slice(0, 8);
  if (data.length === 0) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(150, data.length * 30)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="reason"
          tick={{ fontSize: 10.5, fill: "#666" }}
          axisLine={false}
          tickLine={false}
          width={148}
        />
        <RTooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#fafafa" }} />
        <Bar dataKey="count" name="Deals lost" fill={alpha(accent, "cc")} radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Actions vs revenu, par trimestre.
 *
 * Appels (centaines), meetings (dizaines) et euros (milliers) n'ont aucune
 * échelle commune : les empiler sur un même axe écraserait les petites séries,
 * et un second axe Y rendrait la comparaison mensongère. On aligne donc une
 * ligne par métrique, chacune normalisée sur son propre maximum, sur un axe de
 * trimestres partagé — la corrélation se lit verticalement, colonne par colonne.
 */
export function ActionsVsRevenueChart({
  buckets,
  quarters,
  accent,
}: {
  buckets: ActivityBucket[];
  quarters: QuarterAmount[];
  accent: string;
}) {
  const qOf = (b: ActivityBucket): string => {
    const m = /^(\d{4})-(\d{2})-01$/.exec(b.key);
    return m ? `Q${Math.floor((Number(m[2]) - 1) / 3) + 1}` : b.label;
  };
  const sumBy = (get: (b: ActivityBucket) => number): Record<string, number> => {
    const acc: Record<string, number> = {};
    for (const b of buckets) acc[qOf(b)] = (acc[qOf(b)] ?? 0) + (get(b) || 0);
    return acc;
  };

  const calls = sumBy((b) => b.outboundCalls);
  const meetings = sumBy((b) => (b.selfBookedSlack > 0 ? b.selfBookedSlack : b.meetingsScheduled));
  const labels = ["Q1", "Q2", "Q3", "Q4"];

  const rows: Array<{ name: string; values: (number | null)[]; fmt: (v: number) => string }> = [
    { name: "Outbound calls", values: labels.map((q) => calls[q] ?? 0), fmt: (v) => compact(v) },
    { name: "Meetings booked", values: labels.map((q) => meetings[q] ?? 0), fmt: (v) => compact(v) },
    {
      name: "Billed",
      values: labels.map((q) => quarters.find((x) => x.quarter === q)?.billed ?? null),
      fmt: (v) => compact(v),
    },
  ];

  const attainment = labels.map((q) => {
    const found = quarters.find((x) => x.quarter === q);
    if (!found || !found.target || found.billed == null) return null;
    return Math.round((found.billed / found.target) * 100);
  });

  if (rows.every((r) => r.values.every((v) => !v)) ) return <Empty />;

  return (
    <div className="pt-1">
      <div className="grid items-center gap-x-2 gap-y-2" style={{ gridTemplateColumns: "88px repeat(4, 1fr)" }}>
        <div />
        {labels.map((q) => (
          <div key={q} className="text-center text-[11px] font-medium" style={{ color: "#888" }}>
            {q}
          </div>
        ))}

        {rows.map((row) => {
          const max = Math.max(...row.values.map((v) => v ?? 0), 1);
          return (
            <Fragment key={row.name}>
              <div className="text-[11px] truncate" style={{ color: "#666" }} title={row.name}>
                {row.name}
              </div>
              {row.values.map((v, i) => (
                <div key={i} className="flex flex-col gap-0.5" title={v == null ? "—" : row.fmt(v)}>
                  <div className="h-4 rounded-[3px] overflow-hidden" style={{ background: "#f4f4f5" }}>
                    <div
                      style={{
                        width: v == null || max === 0 ? 0 : `${Math.max((v / max) * 100, v > 0 ? 3 : 0)}%`,
                        height: "100%",
                        background: accent,
                        borderRadius: 3,
                      }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums" style={{ color: "#888" }}>
                    {v == null ? "—" : row.fmt(v)}
                  </span>
                </div>
              ))}
            </Fragment>
          );
        })}

        <div className="text-[11px]" style={{ color: "#666" }}>
          Attainment
        </div>
        {attainment.map((a, i) => (
          <div key={i} className="text-center">
            <span
              className="text-[11px] font-bold px-1.5 py-0.5 rounded-full"
              style={
                a == null
                  ? { color: "#aaa", background: "#f5f5f5" }
                  : a >= 90
                    ? { color: "#166534", background: "#f0fdf4" }
                    : a >= 60
                      ? { color: "#b45309", background: "#fef3c7" }
                      : { color: "#991b1b", background: "#fee2e2" }
              }
            >
              {a == null ? "—" : `${a}%`}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] mt-2.5" style={{ color: "#aaa" }}>
        Each row is scaled to its own maximum: compare shapes across quarters, not heights across rows.
      </p>
    </div>
  );
}
