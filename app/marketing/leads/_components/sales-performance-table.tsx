"use client";

import { Loader2 } from "lucide-react";
import { useLeadsFunnel } from "@/lib/hooks/use-marketing";

function formatAmount(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + "€";
}

export default function SalesPerformanceTable() {
  const { funnel, isLoading } = useLeadsFunnel();

  if (isLoading || !funnel) {
    return (
      <div
        style={{
          background: "#fff",
          border: "1px solid #eee",
          borderRadius: 8,
          padding: 24,
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "#888",
        }}
      >
        <Loader2 size={16} className="animate-spin" /> Chargement de la performance sales…
      </div>
    );
  }

  const rows = funnel.funnel.bySales ?? [];

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #eee",
        borderRadius: 8,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>
          Performance par sales (365 derniers jours)
        </div>
        <div style={{ fontSize: 12, color: "#888" }}>{rows.length} sales</div>
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: "#888" }}>
          Aucun deal attribué sur la période. Les sales apparaissent ici dès qu&apos;un deal HubSpot
          leur est attribué.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ background: "#f9f9f9", borderBottom: "1px solid #eee" }}>
                <Th align="left">Sales</Th>
                <Th>Leads</Th>
                <Th>Deals</Th>
                <Th>Won</Th>
                <Th>Lost</Th>
                <Th>Conversion</Th>
                <Th>Pipeline ouvert</Th>
                <Th>Won (€)</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.ownerId}
                  style={{ borderTop: i > 0 ? "1px solid #f4f4f4" : undefined }}
                >
                  <Td align="left">
                    <span style={{ color: "#111", fontWeight: 500 }}>{r.ownerName}</span>
                  </Td>
                  <Td>{r.leadsCount}</Td>
                  <Td>{r.dealsCount}</Td>
                  <Td>
                    <span style={{ color: "#10b981", fontWeight: 600 }}>{r.wonCount}</span>
                  </Td>
                  <Td>
                    <span style={{ color: "#ef4444" }}>{r.lostCount}</span>
                  </Td>
                  <Td>
                    <span style={{ fontWeight: 600 }}>
                      {r.leadsCount > 0 ? `${Math.round(r.conversionPct)}%` : "-"}
                    </span>
                  </Td>
                  <Td>{formatAmount(r.openPipelineAmount)}</Td>
                  <Td>{formatAmount(r.wonAmount)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children, align = "right" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      style={{
        padding: "8px 12px",
        textAlign: align,
        fontSize: 11,
        fontWeight: 600,
        color: "#888",
        textTransform: "uppercase",
        letterSpacing: 0.5,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, align = "right" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td
      style={{
        padding: "10px 12px",
        textAlign: align,
        color: "#444",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}
