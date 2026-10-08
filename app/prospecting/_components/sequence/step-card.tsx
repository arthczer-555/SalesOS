"use client";

import * as React from "react";
import { CornerDownRight, GripVertical, Hand, Sparkles, Trash2, Type } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { ANGLES, STEP_KIND_META } from "@/lib/prospecting/templates";
import type { LintIssue, StepDraft } from "@/lib/prospecting/types";
import { StepKindIcon } from "../shared/meta";

const LEVEL_COLOR = { error: COLORS.err, warn: "#d97706", info: COLORS.info } as const;

function preview(step: StepDraft): string {
  const c = step.config;
  if (step.kind === "linkedin_visit") return "Open their profile so they notice you.";
  if (c.mode === "template") return (c.template.subject ? `${c.template.subject} · ` : "") + (c.template.body || "Empty template");
  if (c.instructions.trim()) return c.instructions.trim();
  return "The AI writes this step for each prospect from their research.";
}

// Carte d'une étape dans la timeline de séquence.
export function StepCard({
  step,
  index,
  day,
  active,
  issues,
  locked,
  executedCount,
  onSelect,
  onDelete,
  dragHandlers,
  dragging,
}: {
  step: StepDraft;
  index: number;
  day: number;
  active: boolean;
  issues: LintIssue[];
  locked: boolean;
  executedCount?: number;
  onSelect: () => void;
  onDelete: () => void;
  dragHandlers: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
  dragging: boolean;
}) {
  const meta = STEP_KIND_META[step.kind];
  const worst = issues.find((i) => i.level === "error") ?? issues.find((i) => i.level === "warn") ?? issues.find((i) => i.level === "info");
  const isReply = step.kind === "email" && step.threadMode === "reply";
  return (
    <div
      className={`pg-step-card ${active ? "pg-step-card-active" : ""} ${dragging ? "pg-step-card-dragging" : ""}`.trim()}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      {...dragHandlers}
      style={{ padding: "12px 12px 12px 8px", display: "flex", gap: 10, alignItems: "flex-start" }}
    >
      <span
        aria-hidden
        style={{ color: locked ? "transparent" : COLORS.ink5, cursor: locked ? "default" : "grab", paddingTop: 6, flexShrink: 0 }}
        title={locked ? undefined : "Drag to reorder"}
      >
        <GripVertical size={14} />
      </span>
      <StepKindIcon kind={step.kind} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: COLORS.brand, letterSpacing: "0.02em" }}>DAY {day}</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.ink0 }}>
            {index + 1}. {meta.label}
          </span>
          {isReply ? (
            <span className="ds-chip" title="Sent as a reply in the same Gmail thread">
              <CornerDownRight size={11} /> In thread
            </span>
          ) : null}
          {meta.manual ? (
            <span className="ds-chip" title="Manual task in your Tasks list">
              <Hand size={11} /> Manual
            </span>
          ) : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
          {step.kind !== "linkedin_visit" ? (
            step.config.mode === "template" ? (
              <span className="ds-chip ds-chip-info">
                <Type size={10} /> Template
              </span>
            ) : (
              <span className="ds-chip ds-chip-brand">
                <Sparkles size={10} /> {ANGLES[step.config.angle].label}
              </span>
            )
          ) : null}
          {typeof executedCount === "number" && executedCount > 0 ? (
            <span style={{ fontSize: 11, color: COLORS.ink3 }}>{executedCount} done</span>
          ) : null}
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: COLORS.ink2,
            marginTop: 6,
            lineHeight: 1.45,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {preview(step)}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
        {worst ? (
          <span title={worst.message} style={{ width: 8, height: 8, borderRadius: 999, background: LEVEL_COLOR[worst.level], marginTop: 4 }} />
        ) : (
          <span style={{ width: 8, height: 8 }} />
        )}
        <button
          type="button"
          className="ch-btn ch-btn-ghost ch-btn-sm ch-btn-icon-only"
          aria-label="Delete step"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          style={{ opacity: active ? 1 : 0.55 }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
