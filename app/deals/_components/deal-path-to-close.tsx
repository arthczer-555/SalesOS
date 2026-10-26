"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { pathToClose, type KunaEntry } from "@/lib/deals/kuna";
import { BlockTitle, KunaChip } from "./kuna-ui";

/**
 * Les 4 conditions qui rendent un deal "forecastable" : budget, date de
 * décision et Economic Buyer en K, + assez de contacts actifs (threading live).
 */
export function DealPathToClose({
  kuna,
  activeThreads,
  amount,
}: {
  kuna: KunaEntry[];
  activeThreads: number;
  amount: number;
}) {
  const conditions = pathToClose(kuna, activeThreads, amount);
  const metCount = conditions.filter((c) => c.met).length;

  return (
    <Card padding={20} style={{ flex: "999 1 520px", minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <BlockTitle
          title="Path to close"
          subtitle={`${metCount} of 4 closing conditions confirmed. A deal is forecastable once all four are.`}
          right={
            <div style={{ display: "flex", gap: 4, width: 132 }} aria-hidden="true">
              {conditions.map((c) => (
                <span
                  key={c.key}
                  style={{
                    flex: 1,
                    height: 6,
                    borderRadius: 3,
                    background: c.met ? "#15803d" : "#f1f1f4",
                    outline: c.met ? "none" : "1px dashed #d4d4d8",
                    outlineOffset: -1,
                  }}
                />
              ))}
            </div>
          }
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          {conditions.map((c) => (
            <div
              key={c.key}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 14,
                borderRadius: 10,
                border: `1px solid ${c.met ? "#bbf7d0" : COLORS.line}`,
                background: c.met ? "#f0fdf4" : COLORS.bgCard,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {c.chipStatus === "threads" ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      height: 22,
                      padding: "0 7px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      background: c.met ? "#15803d" : COLORS.errBg,
                      color: c.met ? "#fff" : "#b91c1c",
                    }}
                  >
                    {c.chip}
                  </span>
                ) : (
                  <KunaChip status={c.chipStatus} />
                )}
                <span style={{ fontSize: 12, fontWeight: 600, color: c.met ? "#166534" : COLORS.ink1 }}>{c.state}</span>
                {c.met && <Check size={14} style={{ color: "#15803d", marginLeft: "auto" }} aria-hidden="true" />}
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0 }}>{c.title}</span>
              {c.now && <span style={{ fontSize: 12, lineHeight: 1.45, color: COLORS.ink2 }}>{c.now}</span>}
              {!c.met && c.action && (
                <span
                  style={{
                    marginTop: "auto",
                    paddingTop: 8,
                    borderTop: `1px solid ${COLORS.line}`,
                    fontSize: 12,
                    lineHeight: 1.45,
                    color: COLORS.ink0,
                  }}
                >
                  → {c.action}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function DealNextMove({ text }: { text: string }) {
  return (
    <Card
      padding={20}
      style={{
        flex: "1 1 280px",
        minWidth: 0,
        background: COLORS.ink0,
        borderColor: COLORS.ink0,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, color: "#ff8ab3" }}>Next move</span>
      <p style={{ margin: 0, fontSize: 15, fontWeight: 500, lineHeight: 1.5, color: "#fff" }}>{text}</p>
    </Card>
  );
}
