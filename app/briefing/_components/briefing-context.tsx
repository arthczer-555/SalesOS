"use client";

import * as React from "react";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { MarkdownBlock } from "./markdown";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import type { BriefingResult, DealAnalysis, DealQualification, GatheredData } from "../_helpers";
import { isExistingClient } from "../_helpers";

const QUAL_FIELDS: { key: keyof DealQualification; label: string }[] = [
  { key: "budget", label: "Budget" },
  { key: "estimatedBudget", label: "Budget estimé" },
  { key: "authority", label: "Autorité (décisionnaire)" },
  { key: "need", label: "Besoin" },
  { key: "champion", label: "Champion interne" },
  { key: "needDetailed", label: "Besoin détaillé" },
  { key: "timeline", label: "Timeline" },
  { key: "strategicFit", label: "Fit stratégique" },
];

export function BriefingContext({ briefing, rawData }: { briefing: BriefingResult; rawData: GatheredData | null }) {
  const isClient = isExistingClient(rawData);
  const hasDeal = (rawData?.deals?.length ?? 0) > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {briefing.contextSummary && (
        <Card padding={16}>
          <SectionHeader title="Contexte" />
          <MarkdownBlock text={briefing.contextSummary} />
        </Card>
      )}

      {briefing.dealAnalysis && <DealAnalysisCard analysis={briefing.dealAnalysis} />}

      {briefing.isSalesMeeting !== false && briefing.dealQualification && !isClient && hasDeal && (() => {
        const known = QUAL_FIELDS.filter((f) => !!briefing.dealQualification![f.key]);
        const missing = QUAL_FIELDS.filter((f) => !briefing.dealQualification![f.key]);
        return (
          <Card padding={16}>
            <SectionHeader
              title={`Qualification deal — ${known.length}/${QUAL_FIELDS.length}`}
            />
            <div style={{ marginBottom: 12 }}>
              <ProgressBar
                value={(known.length / QUAL_FIELDS.length) * 100}
                max={100}
                height={4}
                variant={known.length === QUAL_FIELDS.length ? "ok" : "brand"}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {known.map((f) => (
                <div key={f.key} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: COLORS.ok,
                      marginTop: 6,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: COLORS.ink2, margin: 0 }}>{f.label}</p>
                    <p style={{ fontSize: 12, color: COLORS.ink0, margin: 0, lineHeight: 1.5 }}>
                      {briefing.dealQualification![f.key]}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            {missing.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${COLORS.line}` }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: COLORS.ink3, marginBottom: 6, marginTop: 0 }}>
                  À collecter
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {missing.map((f) => (
                    <span
                      key={f.key}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 999,
                        border: `1px solid #fecaca`,
                        background: COLORS.bgCard,
                        color: COLORS.err,
                      }}
                    >
                      {f.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>
        );
      })()}

      {briefing.nextStep && (
        <Card padding={16} style={{ background: COLORS.okBg, borderColor: COLORS.okBg }}>
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: COLORS.ok,
              margin: 0,
              marginBottom: 4,
            }}
          >
            Prochaine étape
          </p>
          <p style={{ fontSize: 13, color: "#15803d", margin: 0, lineHeight: 1.5 }}>{briefing.nextStep}</p>
        </Card>
      )}
    </div>
  );
}

const MOMENTUM_STYLES: Record<DealAnalysis["momentum"], { icon: React.ReactNode; bg: string; color: string }> = {
  "En accélération": { icon: <TrendingUp size={12} />, bg: "#f0fdf4", color: "#15803d" },
  "Stable": { icon: <Minus size={12} />, bg: "#f3f4f6", color: "#525252" },
  "En perte de vitesse": { icon: <TrendingDown size={12} />, bg: "#fef2f2", color: "#dc2626" },
};

const RISK_STYLES: Record<DealAnalysis["riskLevel"], { bg: string; color: string }> = {
  "Faible": { bg: "#f0fdf4", color: "#15803d" },
  "Moyen": { bg: "#fef3c7", color: "#d97706" },
  "Élevé": { bg: "#fef2f2", color: "#dc2626" },
};

function DealAnalysisCard({ analysis }: { analysis: DealAnalysis }) {
  if (typeof analysis.momentum !== "string" || typeof analysis.riskLevel !== "string") return null;
  const mom = MOMENTUM_STYLES[analysis.momentum] ?? MOMENTUM_STYLES.Stable;
  const risk = RISK_STYLES[analysis.riskLevel] ?? RISK_STYLES.Moyen;
  return (
    <Card padding={16}>
      <SectionHeader title="État du deal" />
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 8px",
            borderRadius: 999,
            background: mom.bg,
            color: mom.color,
          }}
        >
          {mom.icon} {analysis.momentum}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 8px",
            borderRadius: 999,
            background: risk.bg,
            color: risk.color,
          }}
        >
          <AlertTriangle size={12} /> Risque {analysis.riskLevel.toLowerCase()}
        </span>
      </div>

      {analysis.momentumAnalysis && (
        <p style={{ fontSize: 12, color: COLORS.ink1, margin: 0, marginBottom: 12, lineHeight: 1.5 }}>
          {analysis.momentumAnalysis}
        </p>
      )}

      {((Array.isArray(analysis.positiveSignals) && analysis.positiveSignals.length > 0) || (Array.isArray(analysis.negativeSignals) && analysis.negativeSignals.length > 0)) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          {Array.isArray(analysis.positiveSignals) && analysis.positiveSignals.length > 0 && (
            <div>
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "#15803d",
                  margin: 0,
                  marginBottom: 4,
                }}
              >
                Signaux positifs
              </p>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                {analysis.positiveSignals.map((s, i) => (
                  <li key={i} style={{ display: "flex", gap: 6, fontSize: 12, color: COLORS.ink1, lineHeight: 1.4 }}>
                    <CheckCircle size={12} style={{ color: "#15803d", flexShrink: 0, marginTop: 2 }} />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {Array.isArray(analysis.negativeSignals) && analysis.negativeSignals.length > 0 && (
            <div>
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "#dc2626",
                  margin: 0,
                  marginBottom: 4,
                }}
              >
                Signaux négatifs
              </p>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                {analysis.negativeSignals.map((s, i) => (
                  <li key={i} style={{ display: "flex", gap: 6, fontSize: 12, color: COLORS.ink1, lineHeight: 1.4 }}>
                    <XCircle size={12} style={{ color: "#dc2626", flexShrink: 0, marginTop: 2 }} />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {analysis.nextStepCrm && (
        <div style={{ paddingTop: 10, borderTop: `1px solid ${COLORS.line}` }}>
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: COLORS.ink3,
              margin: 0,
              marginBottom: 4,
            }}
          >
            Action CRM
          </p>
          <p style={{ fontSize: 12, color: COLORS.ink0, margin: 0, lineHeight: 1.5 }}>
            {analysis.nextStepCrm}
          </p>
        </div>
      )}
    </Card>
  );
}
