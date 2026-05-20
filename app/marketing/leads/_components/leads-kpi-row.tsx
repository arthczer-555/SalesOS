"use client";

import { Loader2 } from "lucide-react";
import { useLeadsFunnel } from "@/lib/hooks/use-marketing";

const GREEN = "#10b981";
const BLUE = "#3b82f6";
const PURPLE = "#8b5cf6";
const RED = "#ef4444";

function formatAmount(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + "€";
}

function pct(num: number, denom: number): string {
  if (!denom) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

export default function LeadsKpiRow() {
  const { funnel, isLoading } = useLeadsFunnel();

  if (isLoading || !funnel || !funnel.funnel) {
    return (
      <div
        style={{
          background: "#fff",
          border: "1px solid #eee",
          borderRadius: 8,
          padding: 16,
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "#888",
        }}
      >
        <Loader2 size={16} className="animate-spin" /> Chargement des KPI…
      </div>
    );
  }

  const { funnel: f, openPipelineAmount, closedLostAmount } = funnel;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 12,
      }}
    >
      <KpiCard
        label="% leads → disco"
        value={pct(f.disco, f.validated)}
        subtitle={`${f.disco} / ${f.validated} validés`}
        color={BLUE}
      />
      <KpiCard
        label="% leads → won"
        value={pct(f.closedWon, f.validated)}
        subtitle={`${f.closedWon} / ${f.validated} validés`}
        color={GREEN}
      />
      <KpiCard
        label="Pipeline ouvert"
        value={formatAmount(openPipelineAmount)}
        subtitle="Deals en cours"
        color={PURPLE}
      />
      <KpiCard
        label="Closed lost"
        value={formatAmount(closedLostAmount)}
        subtitle={`${f.closedLost} deal${f.closedLost > 1 ? "s" : ""} perdu${f.closedLost > 1 ? "s" : ""}`}
        color={RED}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  subtitle,
  color,
}: {
  label: string;
  value: string;
  subtitle?: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: "#fafafa",
        border: "1px solid #eee",
        borderRadius: 6,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "#888",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={label}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={value}
      >
        {value}
      </div>
      {subtitle && (
        <div
          style={{
            fontSize: 10,
            color: "#888",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={subtitle}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}
