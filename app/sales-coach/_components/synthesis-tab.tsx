"use client";

import { CheckCircle2, Mail, MessageSquare, AlertTriangle, Target, ChevronRight, TrendingUp } from "lucide-react";
import type {
  AnySalesCoachAnalysis,
  ClientSalesCoachAnalysis,
  KeyMoment,
  KeyMomentKind,
  SalesCoachAnalysis,
} from "@/lib/guides/sales-coach";
import { extractStringArray, isClientAnalysis } from "@/lib/guides/sales-coach";
import type { TalkRatio } from "@/lib/sales-coach/talk-ratio";
import { COLORS, scoreToColor } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { KeyMoments } from "./key-moments";

const KEY_MOMENT_KINDS = new Set<KeyMomentKind>([
  "engagement",
  "objection",
  "pivot",
  "doubt",
  "next_step",
  "concession",
]);

function toKeyMoments(v: unknown): KeyMoment[] {
  const items = Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v as Record<string, unknown>) : [];
  const out: KeyMoment[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const m = it as Partial<KeyMoment>;
    if (typeof m.kind !== "string" || !KEY_MOMENT_KINDS.has(m.kind as KeyMomentKind)) continue;
    out.push({
      timestamp_seconds: typeof m.timestamp_seconds === "number" ? m.timestamp_seconds : 0,
      kind: m.kind as KeyMomentKind,
      label: typeof m.label === "string" ? m.label : "",
      quote: typeof m.quote === "string" ? m.quote : "",
    });
  }
  return out;
}

const MEDDIC_LABELS: { key: keyof SalesCoachAnalysis["meddic"]; label: string; short: string }[] = [
  { key: "metrics", label: "Metrics", short: "M" },
  { key: "economic_buyer", label: "Economic Buyer", short: "EB" },
  { key: "decision_criteria", label: "Decision Criteria", short: "DC" },
  { key: "decision_process", label: "Decision Process", short: "DP" },
  { key: "identify_pain", label: "Identify Pain", short: "IP" },
  { key: "champion", label: "Champion", short: "C" },
];

const AXES_LABELS = [
  { key: "opening", label: "Opening" },
  { key: "discovery", label: "Discovery" },
  { key: "active_listening", label: "Active listening" },
  { key: "value_articulation", label: "Value articulation" },
  { key: "objection_handling", label: "Objection handling" },
  { key: "next_steps", label: "Next steps" },
] as const;

const CLIENT_AXES_LABELS = [
  { key: "opening", label: "Opening & rapport" },
  { key: "discovery", label: "Discovery (évolution)" },
  { key: "active_listening", label: "Écoute active" },
  { key: "value_reinforcement", label: "Value reinforcement" },
  { key: "expansion_discovery", label: "Expansion discovery" },
  { key: "next_steps", label: "Next steps" },
] as const;

const CUSTOMER_HEALTH_LABELS = [
  { key: "relationship", label: "Relation" },
  { key: "adoption", label: "Adoption" },
  { key: "sentiment", label: "Sentiment" },
  { key: "expansion_signals", label: "Signaux expansion" },
  { key: "risk_flags", label: "Risk flags" },
] as const;

interface Props {
  analysis: AnySalesCoachAnalysis;
  talkRatio: TalkRatio | null;
  onOpenEmailDraft: () => void;
  onGoToAxes: () => void;
  onGoToMeddic: () => void;
  onGoToCustomerHealth?: () => void;
}

function isMeddicNA(score: number, notes: string): boolean {
  return score === 0 && /n\/?a/i.test(notes);
}

export function SynthesisTab({
  analysis,
  talkRatio,
  onOpenEmailDraft,
  onGoToAxes,
  onGoToMeddic,
  onGoToCustomerHealth,
}: Props) {
  const isClient = isClientAnalysis(analysis);
  const strengths = extractStringArray(analysis.strengths);
  const weaknesses = extractStringArray(analysis.weaknesses);
  const priorities = extractStringArray(analysis.coaching_priorities);
  const keyMoments = toKeyMoments(analysis.key_moments);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* SYNTHÈSE */}
      {typeof analysis.summary === "string" && analysis.summary.trim() && (
        <Card padding={18}>
          <SectionHeader title="Synthèse" />
          <p
            style={{
              fontSize: 14,
              color: COLORS.ink0,
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            {analysis.summary}
          </p>
        </Card>
      )}

      {/* POINTS FORTS */}
      {strengths.length > 0 && (
        <Card padding={16}>
          <SectionHeader
            title={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <CheckCircle2 size={14} style={{ color: COLORS.ok }} />
                Points forts
              </span>
            }
          />
          <ul style={{ display: "flex", flexDirection: "column", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
            {strengths.map((s, i) => (
              <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span style={{ color: COLORS.ok, marginTop: 2, lineHeight: 1 }}>•</span>
                <span style={{ fontSize: 13, color: COLORS.ink0, lineHeight: 1.5 }}>{s}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* À TRAVAILLER */}
      {weaknesses.length > 0 && (
        <Card padding={16}>
          <SectionHeader
            title={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={14} style={{ color: COLORS.warn }} />
                À travailler
              </span>
            }
          />
          <ul style={{ display: "flex", flexDirection: "column", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
            {weaknesses.map((w, i) => (
              <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span style={{ color: COLORS.warn, marginTop: 2, lineHeight: 1 }}>•</span>
                <span style={{ fontSize: 13, color: COLORS.ink0, lineHeight: 1.5 }}>{w}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* TOP 3 ACTIONS */}
      {priorities.length > 0 && (
        <Card padding={16}>
          <SectionHeader
            title={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Target size={14} style={{ color: COLORS.brand }} />
                Top 3 actions pour le prochain call
              </span>
            }
          />
          <ol style={{ display: "flex", flexDirection: "column", gap: 10, margin: 0, padding: 0, listStyle: "none" }}>
            {priorities.map((p, i) => (
              <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span
                  style={{
                    flexShrink: 0,
                    width: 22,
                    height: 22,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#fff",
                    background: COLORS.brand,
                    borderRadius: 999,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ fontSize: 13, color: COLORS.ink0, lineHeight: 1.5, flex: 1 }}>{p}</span>
              </li>
            ))}
          </ol>
          <div
            style={{
              paddingTop: 12,
              marginTop: 12,
              borderTop: `1px solid ${COLORS.line}`,
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <button
              onClick={onOpenEmailDraft}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontWeight: 500,
                padding: "6px 12px",
                borderRadius: 8,
                background: COLORS.brand,
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
            >
              <Mail size={12} />
              Brouillon mail follow-up
            </button>
          </div>
        </Card>
      )}

      {/* Scores par axe */}
      <Card padding={16}>
        <SectionHeader
          title="Scores par axe"
          right={
            <button
              onClick={onGoToAxes}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                fontSize: 11,
                fontWeight: 500,
                color: COLORS.brand,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              Voir le détail
              <ChevronRight size={12} />
            </button>
          }
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {isClient
            ? CLIENT_AXES_LABELS.map(({ key, label }) => {
                const axes = (analysis as ClientSalesCoachAnalysis).axes;
                const axis = axes?.[key];
                const score = axis?.score ?? 0;
                const sc = scoreToColor(score, 10);
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 200, fontSize: 12, color: COLORS.ink1 }}>{label}</div>
                    <div style={{ flex: 1 }}>
                      <ProgressBar value={score * 10} max={100} height={6} variant="auto" scale={100} />
                    </div>
                    <div
                      style={{
                        width: 44,
                        textAlign: "right",
                        fontSize: 12,
                        fontWeight: 600,
                        color: sc.fg,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {score.toFixed(1)}
                    </div>
                  </div>
                );
              })
            : AXES_LABELS.map(({ key, label }) => {
                const axes = (analysis as SalesCoachAnalysis).axes;
                const axis = axes?.[key];
                const score = axis?.score ?? 0;
                const sc = scoreToColor(score, 10);
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 160, fontSize: 12, color: COLORS.ink1 }}>{label}</div>
                    <div style={{ flex: 1 }}>
                      <ProgressBar value={score * 10} max={100} height={6} variant="auto" scale={100} />
                    </div>
                    <div
                      style={{
                        width: 44,
                        textAlign: "right",
                        fontSize: 12,
                        fontWeight: 600,
                        color: sc.fg,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {score.toFixed(1)}
                    </div>
                  </div>
                );
              })}
        </div>
      </Card>

      {/* Customer Health (client) ou Score MEDDIC (prospect) */}
      {isClient && (analysis as ClientSalesCoachAnalysis).customer_health && (
        <Card padding={16}>
          <SectionHeader
            title={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <TrendingUp size={14} style={{ color: "#059669" }} />
                Customer Health
              </span>
            }
            right={onGoToCustomerHealth ? (
              <button
                onClick={onGoToCustomerHealth}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 2,
                  fontSize: 11,
                  fontWeight: 500,
                  color: COLORS.brand,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Voir le détail
                <ChevronRight size={12} />
              </button>
            ) : null}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {CUSTOMER_HEALTH_LABELS.map(({ key, label }) => {
              const ch = (analysis as ClientSalesCoachAnalysis).customer_health;
              const value = (ch?.[key] ?? "").trim();
              const isEmpty = !value || /pas observable/i.test(value);
              return (
                <div key={key} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ width: 140, fontSize: 12, color: COLORS.ink1, paddingTop: 1 }}>{label}</div>
                  <div
                    style={{
                      flex: 1,
                      fontSize: 12,
                      color: isEmpty ? COLORS.ink3 : COLORS.ink0,
                      fontStyle: isEmpty ? "italic" : "normal",
                      lineHeight: 1.5,
                    }}
                  >
                    {value || "Pas observable dans ce meeting"}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {!isClient && (analysis as SalesCoachAnalysis).meddic && (
        <Card padding={16}>
          <SectionHeader
            title="Score MEDDIC"
            right={
              <button
                onClick={onGoToMeddic}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 2,
                  fontSize: 11,
                  fontWeight: 500,
                  color: COLORS.brand,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Voir le détail
                <ChevronRight size={12} />
              </button>
            }
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {MEDDIC_LABELS.map(({ key, label }) => {
              const meddic = (analysis as SalesCoachAnalysis).meddic;
              const dim = meddic[key];
              if (!dim) return null;
              const score = typeof dim.score === "number" ? dim.score : 0;
              const notes = typeof dim.notes === "string" ? dim.notes : "";
              const na = isMeddicNA(score, notes);
              const sc = scoreToColor(score, 10);
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 160, fontSize: 12, color: COLORS.ink1 }}>{label}</div>
                  <div style={{ flex: 1 }}>
                    {na ? (
                      <div style={{ height: 6 }} />
                    ) : (
                      <ProgressBar value={score * 10} max={100} height={6} variant="auto" scale={100} />
                    )}
                  </div>
                  <div
                    style={{
                      width: 44,
                      textAlign: "right",
                      fontSize: 12,
                      fontWeight: 600,
                      color: na ? COLORS.ink3 : sc.fg,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {na ? "N/A" : score.toFixed(1)}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Talk ratio */}
      {talkRatio && (
        <Card padding={16}>
          <SectionHeader
            title="Talk ratio"
            right={
              <span style={{ fontSize: 11, color: COLORS.ink3 }}>
                Coachello {talkRatio.internal_pct}% · Prospect {talkRatio.external_pct}%
              </span>
            }
          />
          <div
            style={{
              display: "flex",
              height: 8,
              borderRadius: 999,
              overflow: "hidden",
              background: COLORS.line,
              marginBottom: talkRatio.by_speaker.length > 0 ? 10 : 0,
            }}
          >
            <div style={{ width: `${talkRatio.internal_pct}%`, background: "#6d28d9" }} />
            <div style={{ width: `${talkRatio.external_pct}%`, background: COLORS.ok }} />
          </div>
          {talkRatio.by_speaker.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
              {talkRatio.by_speaker.map((s) => (
                <span key={s.speakerId} style={{ fontSize: 11, color: COLORS.ink2 }}>
                  <MessageSquare
                    size={10}
                    style={{
                      display: "inline-block",
                      verticalAlign: "middle",
                      color: s.isInternal ? "#6d28d9" : COLORS.ok,
                      marginRight: 4,
                    }}
                  />
                  {s.name ?? s.email ?? "Speaker"} {s.pct}%
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Key moments */}
      {keyMoments.length > 0 && (
        <Card padding={16}>
          <SectionHeader title={`Moments clés (${keyMoments.length})`} />
          <KeyMoments moments={keyMoments} />
        </Card>
      )}
    </div>
  );
}
