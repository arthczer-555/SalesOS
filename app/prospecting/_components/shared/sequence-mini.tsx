"use client";

import * as React from "react";
import { COLORS } from "@/lib/design/tokens";
import { stepDayOffsets } from "@/lib/prospecting/settings";
import { STEP_KIND_META } from "@/lib/prospecting/templates";
import type { StepDraft } from "@/lib/prospecting/types";
import { StepKindIcon } from "./meta";

// Aperçu compact d'une séquence : icônes d'étapes reliées, avec le jour.
export function SequenceMini({ steps, size = 24 }: { steps: Pick<StepDraft, "kind" | "delayDays">[]; size?: number }) {
  const days = stepDayOffsets(steps);
  if (steps.length === 0) return <span style={{ fontSize: 12, color: COLORS.ink4 }}>Empty sequence</span>;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", flexWrap: "wrap", rowGap: 6 }}>
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span style={{ width: 10, height: 1.5, background: COLORS.lineStrong, marginTop: size / 2, flexShrink: 0 }} /> : null}
          <span title={`Day ${days[i]}: ${STEP_KIND_META[s.kind].label}`} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <StepKindIcon kind={s.kind} size={size} />
            <span style={{ fontSize: 9.5, fontWeight: 700, color: COLORS.ink3, fontVariantNumeric: "tabular-nums" }}>D{days[i]}</span>
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

export function sequenceSummary(steps: Pick<StepDraft, "kind" | "delayDays">[]): string {
  const days = stepDayOffsets(steps);
  const total = days[days.length - 1] ?? 0;
  const emails = steps.filter((s) => s.kind === "email").length;
  const manual = steps.length - emails;
  const parts = [`${steps.length} ${steps.length === 1 ? "step" : "steps"}`, `${total} days`, `${emails} ${emails === 1 ? "email" : "emails"}`];
  if (manual) parts.push(`${manual} manual`);
  return parts.join(" · ");
}
