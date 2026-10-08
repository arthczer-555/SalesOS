"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { Tag, type TagTone } from "@/components/ui/tag";
import { COLORS } from "@/lib/design/tokens";
import type { LintIssue, LintLevel } from "@/lib/prospecting/types";

const LEVEL: Record<LintLevel, { tone: TagTone; icon: React.ComponentType<{ size?: number | string }>; rank: number }> = {
  error: { tone: "err", icon: XCircle, rank: 0 },
  warn: { tone: "warn", icon: AlertTriangle, rank: 1 },
  info: { tone: "info", icon: Info, rank: 2 },
};

// Pastilles de lint d'un message (erreur bloquante > avertissement > conseil).
export function LintChips({ issues, showOk = true }: { issues: LintIssue[] | null | undefined; showOk?: boolean }) {
  const list = [...(issues ?? [])].sort((a, b) => LEVEL[a.level].rank - LEVEL[b.level].rank);
  if (!list.length) {
    return showOk ? (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: COLORS.ok, fontWeight: 600 }}>
        <CheckCircle2 size={13} /> Follows best practices
      </span>
    ) : null;
  }
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {list.map((i, k) => (
        <span key={`${i.code}-${k}`} title={i.message} style={{ maxWidth: "100%" }}>
          <Tag tone={LEVEL[i.level].tone} icon={LEVEL[i.level].icon} size="sm" style={{ whiteSpace: "normal", lineHeight: 1.35 }}>
            {i.message}
          </Tag>
        </span>
      ))}
    </div>
  );
}

/** Pastille de synthèse pour la file (rouge = bloquant, ambre = à revoir). */
export function LintDot({ errors, warns }: { errors: number; warns: number }) {
  const color = errors ? COLORS.err : warns ? "#f59e0b" : COLORS.ok;
  const title = errors ? `${errors} blocking issue${errors > 1 ? "s" : ""}` : warns ? `${warns} warning${warns > 1 ? "s" : ""}` : "No issue";
  return <span title={title} aria-label={title} style={{ width: 8, height: 8, borderRadius: 999, background: color, flexShrink: 0, boxShadow: `0 0 0 3px ${color}22` }} />;
}
