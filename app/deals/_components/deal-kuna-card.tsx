"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import {
  KUNA_DIMENSIONS,
  KUNA_STATUS_LABELS,
  kunaCounts,
  type KunaEntry,
  type KunaStatus,
} from "@/lib/deals/kuna";
import { BlockTitle, KunaChip } from "./kuna-ui";
import { timeAgo } from "../_helpers";

const TABLE_COLUMNS = "24px 170px 104px minmax(0, 1fr) minmax(0, 1fr)";

/**
 * Qualification KUNA : récap compact par défaut (compteurs + 10 dimensions),
 * tableau complet (preuve, source, action) dans le dépliant.
 */
export function DealKunaCard({ kuna, scoredAt }: { kuna: KunaEntry[]; scoredAt: string | null }) {
  const [open, setOpen] = React.useState(false);
  const counts = kunaCounts(kuna);
  const byKey = new Map(kuna.map((e) => [e.key, e]));

  return (
    <Card padding={20}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <BlockTitle
          title="KUNA qualification"
          subtitle={`What we actually know on 10 dimensions${scoredAt ? ` · scored ${timeAgo(scoredAt).toLowerCase()}` : ""}`}
          right={
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(["K", "U", "N", "A"] as KunaStatus[]).map((s) => (
                <span
                  key={s}
                  title={KUNA_STATUS_LABELS[s]}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 9px 4px 4px",
                    borderRadius: 8,
                    border: `1px solid ${COLORS.line}`,
                    fontSize: 13,
                    fontWeight: 600,
                    color: COLORS.ink0,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <KunaChip status={s} size={20} />
                  <span style={{ fontWeight: 500, color: COLORS.ink1 }}>{KUNA_STATUS_LABELS[s]}</span>
                  {counts[s]}
                </span>
              ))}
            </div>
          }
        />

        {/* Récap : une pastille par dimension (2 lignes de 5), le détail au survol */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8 }}>
          {KUNA_DIMENSIONS.map((d) => {
            const e = byKey.get(d.key);
            const status = e?.status ?? "U";
            return (
              <div
                key={d.key}
                title={e?.evidence || undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: COLORS.bgSoft,
                  border: `1px solid ${COLORS.line}`,
                  minWidth: 0,
                }}
              >
                <KunaChip status={status} />
                <span style={{ fontSize: 13, fontWeight: 500, color: COLORS.ink0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {d.label}
                </span>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            width: "100%",
            padding: "9px 12px",
            borderRadius: 8,
            border: `1px solid ${COLORS.lineStrong}`,
            background: COLORS.bgCard,
            color: COLORS.ink1,
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {open ? "Hide details" : "Show details: evidence, sources and actions"}
          <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
        </button>

        {open && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 760 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: TABLE_COLUMNS,
                    gap: 16,
                    padding: "9px 0",
                    borderTop: `1px solid ${COLORS.lineStrong}`,
                    borderBottom: `1px solid ${COLORS.lineStrong}`,
                    fontSize: 12,
                    fontWeight: 500,
                    color: COLORS.ink2,
                  }}
                >
                  <span>#</span>
                  <span>Dimension</span>
                  <span>Status</span>
                  <span>What we actually know</span>
                  <span>To make it real</span>
                </div>
                {KUNA_DIMENSIONS.map((d, i) => {
                  const e = byKey.get(d.key);
                  const status = e?.status ?? "U";
                  return (
                    <div
                      key={d.key}
                      style={{
                        display: "grid",
                        gridTemplateColumns: TABLE_COLUMNS,
                        gap: 16,
                        padding: "13px 0",
                        borderBottom: `1px solid ${COLORS.line}`,
                        alignItems: "start",
                      }}
                    >
                      <span style={{ fontSize: 12, color: COLORS.ink3, paddingTop: 3, fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{d.label}</span>
                        <span style={{ fontSize: 11, color: COLORS.ink3 }}>{d.hint}</span>
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        {(["K", "U", "N", "A"] as KunaStatus[]).map((s) => (
                          <KunaChip key={s} status={s} off={s !== status} />
                        ))}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ fontSize: 13, lineHeight: 1.5, color: COLORS.ink0 }}>{e?.evidence || "No signal."}</span>
                        <span style={{ fontSize: 11, color: COLORS.ink3 }}>{e?.source ?? "No source"}</span>
                      </div>
                      <span style={{ fontSize: 13, lineHeight: 1.5, color: COLORS.ink0 }}>{e?.action || ""}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
