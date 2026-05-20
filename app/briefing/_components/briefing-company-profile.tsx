"use client";

import * as React from "react";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import type { BriefingResult } from "../_helpers";

const STRATEGIC_TYPE_LABELS: Record<string, string> = {
  acquisition: "Acquisition",
  partnership: "Partenariat",
  merger: "Fusion",
  divestiture: "Cession",
};

export function BriefingCompanyProfile({ briefing }: { briefing: BriefingResult }) {
  if (!briefing.companyProfile && !briefing.companyInsights) return null;

  if (!briefing.companyProfile && briefing.companyInsights) {
    return (
      <Card padding={16}>
        <SectionHeader title="Profil entreprise" />
        <p style={{ fontSize: 13, color: COLORS.ink1, margin: 0, lineHeight: 1.5 }}>
          {briefing.companyInsights}
        </p>
      </Card>
    );
  }

  const cp = briefing.companyProfile!;
  const metrics = [
    { label: "Revenu", value: cp.revenue },
    { label: "Effectif", value: cp.headcount },
    { label: "Clients", value: cp.clients },
    { label: "Modèle", value: cp.businessModel },
    { label: "Marché", value: cp.industry },
  ].filter((m) => m.value);

  return (
    <Card padding={16}>
      <SectionHeader title="Profil entreprise" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "8px 16px",
          marginBottom: cp.keyFact || briefing.growthDynamics?.summary || briefing.strategicHistory?.length ? 12 : 0,
        }}
      >
        {metrics.map((m) => (
          <React.Fragment key={m.label}>
            <span style={{ fontSize: 12, color: COLORS.ink2 }}>{m.label}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{m.value}</span>
          </React.Fragment>
        ))}
      </div>
      {(cp.keyFact || briefing.growthDynamics?.summary) && (
        <div
          style={{
            paddingTop: 12,
            borderTop: `1px solid ${COLORS.line}`,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {cp.keyFact && (
            <p style={{ fontSize: 12, color: COLORS.ink1, margin: 0, lineHeight: 1.5 }}>
              <strong style={{ color: COLORS.ink0, fontWeight: 600 }}>À noter : </strong>
              {cp.keyFact}
            </p>
          )}
          {briefing.growthDynamics?.summary && (
            <p style={{ fontSize: 12, color: COLORS.ink2, margin: 0, lineHeight: 1.5 }}>
              {briefing.growthDynamics.summary}
            </p>
          )}
        </div>
      )}
      {Array.isArray(briefing.strategicHistory) && briefing.strategicHistory.length > 0 && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: `1px solid ${COLORS.line}`,
          }}
        >
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: COLORS.ink3,
              marginBottom: 6,
              marginTop: 0,
            }}
          >
            Historique stratégique
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {briefing.strategicHistory.map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12 }}>
                <span style={{ color: COLORS.ink3, minWidth: 36 }}>{item.year ?? "—"}</span>
                <span style={{ fontWeight: 600, color: COLORS.ink2, minWidth: 80 }}>
                  {STRATEGIC_TYPE_LABELS[item.type] ?? item.type}
                </span>
                <span style={{ color: COLORS.ink1, lineHeight: 1.5 }}>
                  <strong style={{ color: COLORS.ink0, fontWeight: 600 }}>{item.entity}</strong> — {item.description}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
