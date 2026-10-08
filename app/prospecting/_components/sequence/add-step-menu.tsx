"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { COLORS } from "@/lib/design/tokens";
import { STEP_KINDS } from "@/lib/prospecting/settings";
import { STEP_KIND_META } from "@/lib/prospecting/templates";
import type { StepKind } from "@/lib/prospecting/types";
import { StepKindIcon } from "../shared/meta";

// Menu d'ajout d'étape (email automatique ou tâche manuelle).
export function AddStepMenu({
  onAdd,
  variant = "inline",
  disabled,
}: {
  onAdd: (kind: StepKind) => void;
  variant?: "inline" | "button";
  disabled?: boolean;
}) {
  return (
    <Popover
      width={300}
      align="left"
      trigger={({ open, toggle }) =>
        variant === "button" ? (
          <button
            type="button"
            className="ch-btn"
            disabled={disabled}
            onClick={toggle}
            style={{ borderStyle: "dashed", width: "100%", justifyContent: "center", color: COLORS.ink2, background: "transparent" }}
          >
            <Plus size={14} /> Add step
          </button>
        ) : (
          <button
            type="button"
            className="pg-add-step"
            data-open={open}
            disabled={disabled}
            onClick={toggle}
            aria-label="Insert a step here"
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              border: `1px solid ${COLORS.lineStrong}`,
              background: "#fff",
              color: COLORS.ink2,
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
              boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
            }}
          >
            <Plus size={12} />
          </button>
        )
      }
    >
      {({ close }) => (
        <div style={{ padding: 6 }}>
          <div className="ds-kpi-label" style={{ padding: "6px 8px 4px" }}>
            Automatic
          </div>
          <Item kind="email" onPick={(k) => { onAdd(k); close(); }} />
          <div className="ds-kpi-label" style={{ padding: "10px 8px 4px" }}>
            Manual tasks
          </div>
          {STEP_KINDS.filter((k) => k !== "email").map((k) => (
            <Item key={k} kind={k} onPick={(x) => { onAdd(x); close(); }} />
          ))}
        </div>
      )}
    </Popover>
  );
}

function Item({ kind, onPick }: { kind: StepKind; onPick: (k: StepKind) => void }) {
  const meta = STEP_KIND_META[kind];
  return (
    <button type="button" className="ch-menu-item" onClick={() => onPick(kind)} style={{ alignItems: "center" }}>
      <StepKindIcon kind={kind} size={26} />
      <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{meta.label}</span>
        <span style={{ fontSize: 11.5, color: COLORS.ink3, lineHeight: 1.35 }}>{meta.description}</span>
      </span>
    </button>
  );
}
