"use client";

import * as React from "react";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";

export function BriefingTakeaways({ takeaways }: { takeaways: string[] }) {
  if (!Array.isArray(takeaways) || takeaways.length === 0) return null;
  return (
    <Card padding={16}>
      <SectionHeader title="Points clés pour le meeting" />
      <ol style={{ display: "flex", flexDirection: "column", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
        {takeaways.map((t, i) => (
          <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: COLORS.ink1 }}>
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: COLORS.warnBg,
                color: COLORS.warn,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 700,
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              {i + 1}
            </span>
            <span style={{ lineHeight: 1.5 }}>{t}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
