"use client";

import * as React from "react";
import { Settings2, ChevronDown, ChevronRight } from "lucide-react";
import { COLORS, repAccent } from "@/lib/design/tokens";
import { RepDropZone } from "./rep-dropzone";
import { UNASSIGNED_KEY } from "./types";

export interface RailRep {
  id: string;
  name: string;
  email: string | null;
  count: number;
}

export function SalesRail({
  reps,
  offRoster,
  unassignedCount,
  activeFilter,
  dragActive,
  mode = "drop",
  showUnassigned = true,
  onFilter,
  onAssign,
  onConfigure,
}: {
  reps: RailRep[];
  offRoster: Array<{ name: string; count: number }>;
  unassignedCount: number;
  activeFilter: string; // "__all__" | UNASSIGNED_KEY | owner name (lower)
  dragActive: boolean;
  mode?: "filter" | "drop";
  showUnassigned?: boolean;
  onFilter: (key: string) => void;
  onAssign: (owner: string | null) => void;
  onConfigure: () => void;
}) {
  const [showOff, setShowOff] = React.useState(true);
  const droppable = mode === "drop";
  const maxCount = Math.max(1, ...reps.map((r) => r.count), ...offRoster.map((o) => o.count));

  return (
    <aside
      style={{
        width: 280,
        flexShrink: 0,
        borderLeft: `1px solid ${COLORS.line}`,
        background: COLORS.bgSoft,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: `1px solid ${COLORS.line}`,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: COLORS.ink3,
            flex: 1,
          }}
        >
          Sales ({reps.length})
        </span>
        {droppable && (
          <button
            type="button"
            onClick={onConfigure}
            title="Configurer les sales affichés"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 8px",
              fontSize: 11,
              fontWeight: 500,
              borderRadius: 6,
              border: `1px solid ${COLORS.line}`,
              background: COLORS.bgCard,
              color: COLORS.ink2,
              cursor: "pointer",
            }}
          >
            <Settings2 size={12} /> Configurer
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
        {/* Non attribué */}
        {showUnassigned && (
          <RepDropZone
            label="Non attribué"
            accent={COLORS.warn}
            count={unassignedCount}
            maxCount={maxCount}
            variant="unassigned"
            active={activeFilter === UNASSIGNED_KEY}
            dragActive={dragActive}
            droppable={droppable}
            onClick={() => onFilter(activeFilter === UNASSIGNED_KEY ? "__all__" : UNASSIGNED_KEY)}
            onAssign={() => onAssign(null)}
          />
        )}

        {reps.length === 0 && (
          <div style={{ padding: "10px 8px", fontSize: 11, color: COLORS.ink3 }}>
            Aucun sales dans le roster. Clique sur <strong>Configurer</strong> pour en ajouter.
          </div>
        )}

        {reps.map((r) => {
          const key = r.name.toLowerCase();
          return (
            <RepDropZone
              key={r.id}
              label={r.name}
              accent={repAccent(r.name)}
              count={r.count}
              maxCount={maxCount}
              variant="rep"
              active={activeFilter === key}
              dragActive={dragActive}
              droppable={droppable}
              email={r.email}
              onClick={() => onFilter(activeFilter === key ? "__all__" : key)}
              onAssign={() => onAssign(r.name)}
            />
          );
        })}

        {offRoster.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <button
              type="button"
              onClick={() => setShowOff((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                width: "100%",
                padding: "6px 8px",
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: COLORS.ink4,
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              {showOff ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Hors roster ({offRoster.length})
            </button>
            {showOff && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, opacity: 0.85 }}>
                {offRoster.map((o) => {
                  const key = o.name.toLowerCase();
                  return (
                    <RepDropZone
                      key={key}
                      label={o.name}
                      accent={repAccent(o.name)}
                      count={o.count}
                      maxCount={maxCount}
                      variant="rep"
                      active={activeFilter === key}
                      dragActive={dragActive}
                      droppable={droppable}
                      onClick={() => onFilter(activeFilter === key ? "__all__" : key)}
                      onAssign={() => onAssign(o.name)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
