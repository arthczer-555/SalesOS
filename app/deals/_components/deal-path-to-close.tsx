"use client";

import * as React from "react";
import { Check, Sparkles } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { pathToClose, type KunaEntry, type NextMove } from "@/lib/deals/kuna";
import { BlockTitle, KunaChip, LEVEL_STYLE } from "./kuna-ui";

/**
 * Les 4 conditions qui rendent un deal "forecastable" : budget, date de
 * décision et Economic Buyer en K, + 3 contacts actifs (threading live ; 2 =
 * threading moyen, en orange).
 */
export function DealPathToClose({ kuna, activeThreads }: { kuna: KunaEntry[]; activeThreads: number }) {
  const conditions = pathToClose(kuna, activeThreads);
  const metCount = conditions.filter((c) => c.met).length;

  return (
    <Card padding={20}>
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
                    background: c.level === "missing" ? "#f1f1f4" : LEVEL_STYLE[c.level].solid,
                    outline: c.level === "missing" ? "1px dashed #d4d4d8" : "none",
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
                border: `1px solid ${LEVEL_STYLE[c.level].tileBorder}`,
                background: LEVEL_STYLE[c.level].tileBg,
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
                      background: c.level === "missing" ? COLORS.errBg : LEVEL_STYLE[c.level].solid,
                      color: c.level === "missing" ? "#b91c1c" : LEVEL_STYLE[c.level].onSolid,
                    }}
                  >
                    {c.chip}
                  </span>
                ) : (
                  <KunaChip status={c.chipStatus} />
                )}
                <span style={{ fontSize: 12, fontWeight: 600, color: LEVEL_STYLE[c.level].text }}>{c.state}</span>
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

const dayMonth = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Bandeau "Next move" en tête de fiche : l'action, son échéance, les étapes et
 * le pourquoi, avec le bouton qui ouvre le chat coach. Un score antérieur au
 * format structuré n'a qu'un texte libre : on l'affiche tel quel.
 */
export function DealNextMove({
  move,
  text,
  chatOpen,
  onAsk,
}: {
  move: NextMove | null;
  text: string | null;
  chatOpen: boolean;
  onAsk: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = !!move?.by && move.by < today;
  return (
    <Card
      padding={16}
      style={{ background: COLORS.ink0, borderColor: COLORS.ink0, display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#ff8ab3" }}>Next move</span>
          {move?.by && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: 99,
                background: overdue ? "#b91c1c" : "rgba(255,255,255,0.12)",
                color: "#fff",
              }}
            >
              {overdue ? `Overdue · ${dayMonth(move.by)}` : `By ${dayMonth(move.by)}`}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onAsk}
          aria-expanded={chatOpen}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            borderRadius: 7,
            border: "none",
            background: "#fff",
            color: COLORS.ink0,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Sparkles size={13} style={{ color: COLORS.brand }} aria-hidden="true" />
          {chatOpen ? "Hide the coach" : "Ask how to proceed"}
        </button>
      </div>

      {move ? (
        <>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.35, color: "#fff" }}>{move.action}</p>
          {move.steps.length > 0 && (
            <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
              {move.steps.map((step, i) => (
                <li key={i} style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.4, color: "#e4e4e7" }}>
                  <span style={{ flexShrink: 0, width: 14, fontWeight: 700, color: "#ff8ab3", fontVariantNumeric: "tabular-nums" }}>{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          )}
          {move.why && (
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: "#a1a1aa" }}>
              <span style={{ fontWeight: 600, color: "#d4d4d8" }}>Why: </span>
              {move.why}
            </p>
          )}
        </>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.45, color: "#fff" }}>{text}</p>
          <span style={{ fontSize: 11, color: "#a1a1aa" }}>Rescore this deal for a step-by-step plan.</span>
        </>
      )}
    </Card>
  );
}
