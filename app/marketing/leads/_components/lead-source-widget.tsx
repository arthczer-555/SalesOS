"use client";

import { Loader2 } from "lucide-react";
import { useLeadsFunnel } from "@/lib/hooks/use-marketing";

const PALETTE = ["#f01563", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ef4444", "#64748b"];

export default function LeadSourceWidget() {
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
        <Loader2 size={16} className="animate-spin" /> Chargement des origines…
      </div>
    );
  }

  const buckets = funnel.funnel.bySource ?? [];
  const total = buckets.reduce((acc, b) => acc + b.count, 0);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #eee",
        borderRadius: 8,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>Origine des leads validés</div>
        <div style={{ fontSize: 12, color: "#888" }}>{total} leads</div>
      </div>

      {buckets.length === 0 ? (
        <div style={{ fontSize: 12, color: "#888" }}>
          Aucune origine extraite pour la période. Vérifie que &quot;How did you hear about us&quot; est
          présent sur les captures envoyées.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {buckets.map((b, i) => {
            const widthPct = total > 0 ? (b.count / total) * 100 : 0;
            const color = PALETTE[i % PALETTE.length];
            return (
              <div key={`${b.source}-${i}`} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 140,
                    fontSize: 12,
                    color: "#555",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={b.source}
                >
                  {b.source}
                </div>
                <div
                  style={{
                    flex: 1,
                    background: "#f4f4f4",
                    borderRadius: 4,
                    height: 22,
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(widthPct, 2)}%`,
                      background: color,
                      height: "100%",
                      borderRadius: 4,
                      display: "flex",
                      alignItems: "center",
                      paddingLeft: 8,
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {b.count}
                  </div>
                </div>
                <div style={{ width: 50, textAlign: "right", fontSize: 12, color: "#555" }}>
                  {total > 0 ? `${Math.round((b.count / total) * 100)}%` : ""}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
