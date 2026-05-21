"use client";

import * as React from "react";
import { COLORS } from "@/lib/design/tokens";

export function StatsMini({
  radar,
  signals30d,
  outreach,
  champions,
}: {
  radar: number;
  signals30d: number;
  outreach: number;
  champions: number;
}) {
  return (
    <section
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 12,
        padding: "12px 14px",
      }}
    >
      <h3
        style={{
          margin: "0 0 8px",
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: COLORS.ink3,
        }}
      >
        📊 Stats
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Stat label="Radar" value={radar} />
        <Stat label="Signaux 30j" value={signals30d} />
        <Stat label="Échanges" value={outreach} />
        <Stat label="Champions" value={champions} accent={champions > 0} />
      </div>
    </section>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: accent ? COLORS.brand : COLORS.ink0,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 10, color: COLORS.ink3, marginTop: 3 }}>{label}</div>
    </div>
  );
}
