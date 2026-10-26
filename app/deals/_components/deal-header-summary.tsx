"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, RefreshCw, XCircle, Zap } from "lucide-react";
import { reliabilityColor, reliabilityLabel, scoreBadge, type DealScore } from "@/lib/deal-scoring";
import type { DealThreading } from "@/lib/deals/kuna";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { DealEvent } from "../_helpers";
import { daysSince, timeAgo } from "../_helpers";
import { BlockTitle } from "./kuna-ui";

// Couleurs des labels de score (mêmes seuils que scoreBadge, textes assombris
// pour le contraste).
const SCORE_TONE: Record<string, { ring: string; text: string }> = {
  "High Priority": { ring: "#16a34a", text: "#166534" },
  "On Track": { ring: "#ca8a04", text: "#854d0e" },
  Fragile: { ring: "#ea580c", text: "#9a3412" },
  "At Risk": { ring: "#dc2626", text: "#b91c1c" },
};

function ScoreRing({ value, color }: { value: number; color: string }) {
  const size = 56;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, value)) / 100) * circ;
  return (
    <svg role="img" aria-label={`Deal score ${value} out of 100`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLORS.line} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize="17" fontWeight="700" fill={COLORS.ink0}>
        {value}
      </text>
    </svg>
  );
}

function Fact({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "err" | "muted" }) {
  return (
    <div style={{ minWidth: 0 }}>
      <dt style={{ fontSize: 12, color: COLORS.ink2 }}>{label}</dt>
      <dd style={{ margin: "5px 0 0", fontSize: 14, fontWeight: 600, color: tone === "err" ? COLORS.err : tone === "muted" ? COLORS.ink3 : COLORS.ink0 }}>
        {value}
        {sub && <span style={{ fontWeight: 400, color: tone === "err" ? COLORS.err : COLORS.ink2 }}> · {sub}</span>}
      </dd>
    </div>
  );
}

/**
 * Ligne de résumé sous le nom du deal : note /100 compacte (l'ancienne note,
 * détails dépliables) + faits clés (montant, close date, dernière réponse du
 * prospect, âge du deal).
 */
export function DealHeaderSummary({
  score,
  scoredAt,
  detailsOpen,
  onToggleDetails,
  onRescore,
  rescoring,
  amountNum,
  closedate,
  createdate,
  stageLabel,
  events,
  threading,
}: {
  score: DealScore | null;
  scoredAt: string | null;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onRescore: () => void;
  rescoring: boolean;
  amountNum: number;
  closedate: string;
  createdate: string;
  stageLabel: string;
  events: DealEvent[];
  threading: DealThreading;
}) {
  const badge = score ? scoreBadge(score.total) : null;
  const tone = badge ? SCORE_TONE[badge.label] ?? { ring: badge.color, text: badge.color } : null;

  const closeDelta = daysSince(closedate); // > 0 = dépassée
  const closeLabel = closedate
    ? new Date(closedate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : null;
  const lastReply = threading.active[0];
  const age = daysSince(createdate);
  const stageEntry = events.find((e) => e.kind === "stage" && e.label.trim() === stageLabel.trim());
  const inStage = stageEntry ? daysSince(stageEntry.iso) : null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "16px 32px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, paddingRight: 32, borderRight: `1px solid ${COLORS.line}` }}>
        {score && badge && tone ? (
          <>
            <ScoreRing value={score.total} color={tone.ring} />
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: tone.text }}>{badge.label}</span>
              <span style={{ fontSize: 12, color: COLORS.ink2 }}>
                <span style={{ color: reliabilityColor(score.reliability), fontWeight: 600 }}>{reliabilityLabel(score.reliability)}</span>
                {scoredAt ? ` · scored ${timeAgo(scoredAt).toLowerCase()}` : ""}
              </span>
              <button
                type="button"
                onClick={onToggleDetails}
                aria-expanded={detailsOpen}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  fontSize: 12,
                  fontWeight: 600,
                  color: COLORS.brand,
                  cursor: "pointer",
                  alignSelf: "flex-start",
                }}
              >
                Score details
                <ChevronDown size={12} style={{ transform: detailsOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13, color: COLORS.ink2 }}>Not scored yet</span>
            <button
              type="button"
              onClick={onRescore}
              disabled={rescoring}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 8,
                border: "none",
                background: COLORS.brand,
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                cursor: rescoring ? "default" : "pointer",
                opacity: rescoring ? 0.7 : 1,
              }}
            >
              {rescoring ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />}
              {rescoring ? "Scoring…" : "Score this deal"}
            </button>
          </div>
        )}
      </div>

      <dl style={{ flex: "1 1 420px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16, margin: 0 }}>
        <Fact
          label="Amount"
          value={amountNum > 0 ? `${(amountNum / 1000).toFixed(0)}k€` : "No amount"}
          tone={amountNum > 0 ? undefined : "muted"}
        />
        <Fact
          label="Close date"
          value={closeLabel ?? "Not set"}
          sub={
            closeDelta === null
              ? undefined
              : closeDelta > 0
                ? `overdue ${closeDelta}d`
                : closeDelta === 0
                  ? "today"
                  : `in ${-closeDelta} days`
          }
          tone={!closeLabel ? "muted" : closeDelta !== null && closeDelta > 0 ? "err" : undefined}
        />
        <Fact
          label="Last prospect reply"
          value={lastReply ? timeAgo(lastReply.lastInboundAt) : `None in ${threading.windowDays} days`}
          sub={lastReply ? (lastReply.name || lastReply.email).split(" ")[0] : undefined}
          tone={lastReply ? undefined : "err"}
        />
        <Fact
          label="Age"
          value={age !== null ? `${age} days` : "-"}
          sub={inStage !== null ? `${inStage} in stage` : undefined}
        />
      </dl>
    </div>
  );
}

/**
 * Détail de la note /100 (déplié depuis le header) : raisonnement de l'IA
 * (✓ ✗ ⚠) et les 7 composantes.
 */
export function DealScoreDetails({ score, reasoning }: { score: DealScore; reasoning: string | null }) {
  const lines = (reasoning ?? "").split("\n").filter(Boolean);
  const structured = lines.some((l) => /^[✓✗⚠]/.test(l));
  return (
    <Card padding={20}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <BlockTitle title="Score details" subtitle="Why the deal scores what it scores, dimension by dimension" />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
          {lines.length > 0 && (
            <div style={{ flex: "2 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {structured ? (
                lines.map((line, i) => {
                  const isOk = line.startsWith("✓");
                  const isErr = line.startsWith("✗");
                  const Icon = isOk ? CheckCircle2 : isErr ? XCircle : AlertTriangle;
                  const fg = isOk ? COLORS.ok : isErr ? COLORS.err : COLORS.warn;
                  const bg = isOk ? COLORS.okBg : isErr ? COLORS.errBg : COLORS.warnBg;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <span
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 999,
                          background: bg,
                          color: fg,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Icon size={14} strokeWidth={2.25} />
                      </span>
                      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: COLORS.ink0 }}>{line.replace(/^[✓✗⚠]\s*/, "")}</p>
                    </div>
                  );
                })
              ) : (
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: COLORS.ink0 }}>{reasoning}</p>
              )}
            </div>
          )}
          <div style={{ flex: "1 1 260px", minWidth: 0, display: "flex", flexDirection: "column", gap: 9 }}>
            {score.components.map((c) => (
              <div key={c.name}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 12, color: COLORS.ink1 }}>{c.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink0, fontVariantNumeric: "tabular-nums" }}>
                    {c.earned}/{c.max}
                  </span>
                </div>
                <ProgressBar value={(c.earned / c.max) * 100} max={100} height={4} variant="brand" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
