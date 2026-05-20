"use client";

import * as React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { ScoreBadge } from "@/components/ui/score-badge";
import type { GatheredData } from "../_helpers";

type SignalKind = "pos" | "neg";
type Signal = { kind: SignalKind; text: string };

function parseSignals(text: string): Signal[] {
  const out: Signal[] = [];
  const re = /([✓✗])\s*([^✓✗⚠]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const kind: SignalKind = m[1] === "✓" ? "pos" : "neg";
    const t = m[2].trim().replace(/\s+/g, " ");
    if (t) out.push({ kind, text: t });
  }
  return out;
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        padding: "3px 9px",
        borderRadius: 999,
        background: COLORS.bgSoft,
        border: `1px solid ${COLORS.line}`,
        color: COLORS.ink2,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: COLORS.ink3, fontWeight: 600 }}>{label}</span>
      <span style={{ color: COLORS.ink1, fontWeight: 600 }}>{value}</span>
    </span>
  );
}

function SignalBox({
  title,
  items,
  Icon,
  fg,
  bg,
  border,
  dotColor,
  flex,
}: {
  title: string;
  items: string[];
  Icon: React.ComponentType<{ size?: number }>;
  fg: string;
  bg: string;
  border: string;
  dotColor: string;
  flex: number;
}) {
  if (items.length === 0) return null;
  return (
    <div
      style={{
        flex,
        minWidth: 0,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 12,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ display: "inline-flex", color: fg }}>
          <Icon size={14} />
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: fg,
          }}
        >
          {title}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10,
            fontWeight: 700,
            color: fg,
            background: "rgba(255,255,255,0.65)",
            padding: "1px 7px",
            borderRadius: 999,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {items.length}
        </span>
      </div>
      <ul style={{ display: "flex", flexDirection: "column", gap: 6, margin: 0, padding: 0, listStyle: "none" }}>
        {items.map((t, i) => (
          <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: COLORS.ink1, lineHeight: 1.45 }}>
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: dotColor,
                marginTop: 7,
                flexShrink: 0,
              }}
            />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BriefingDealSummary({ rawData }: { rawData: GatheredData | null }) {
  const deal = rawData?.deals?.[0];
  if (!deal) return null;

  const amountNum = deal.amount ? Number(deal.amount) : 0;
  const dealAmount = amountNum > 0 ? `${amountNum.toLocaleString("fr-FR")} €` : null;
  const closureLabel = deal.closedate
    ? new Date(deal.closedate).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })
    : null;
  const stage = deal.stage ?? "";
  const isClosedWon = /closed\s*won/i.test(stage) || stage.toLowerCase() === "closedwon";

  const signals = deal.reasoning ? parseSignals(deal.reasoning) : [];
  const pos = signals.filter((s) => s.kind === "pos").map((s) => s.text);
  const neg = signals.filter((s) => s.kind === "neg").map((s) => s.text);
  const hasBoxes = pos.length + neg.length > 0;
  const fallbackText = !hasBoxes && deal.reasoning ? deal.reasoning.trim() : null;

  return (
    <Card padding={16}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: hasBoxes || fallbackText ? 14 : 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: COLORS.ink3,
                flexShrink: 0,
              }}
            >
              Deal
            </span>
            <span
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: COLORS.ink0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {deal.name}
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <MetaChip label="Stade" value={deal.stage} />
            {dealAmount && <MetaChip label="Montant" value={dealAmount} />}
            {closureLabel && <MetaChip label="Clôture" value={closureLabel} />}
            {deal.ownerName && <MetaChip label="Owner" value={deal.ownerName} />}
          </div>
        </div>
        {deal.scoreTotal !== null && !isClosedWon && <ScoreBadge value={deal.scoreTotal} scale={100} size="sm" />}
      </div>

      {hasBoxes && (
        <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
          <SignalBox
            title="Points forts"
            items={pos}
            Icon={CheckCircle2}
            fg={COLORS.ok}
            bg={COLORS.okBg}
            border="#bbf7d0"
            dotColor={COLORS.ok}
            flex={1}
          />
          <SignalBox
            title="Points faibles"
            items={neg}
            Icon={XCircle}
            fg={COLORS.err}
            bg={COLORS.errBg}
            border="#fecaca"
            dotColor={COLORS.err}
            flex={1}
          />
        </div>
      )}

      {fallbackText && (
        <p style={{ fontSize: 12, color: COLORS.ink2, margin: 0, lineHeight: 1.5 }}>{fallbackText}</p>
      )}
    </Card>
  );
}
