"use client";

import * as React from "react";
import { X } from "lucide-react";
import { COLORS, SHADOWS } from "@/lib/design/tokens";
import { Portal, useOverlayBehavior } from "./modal";

// Panneau latéral droit (fiche prospect, ajout de prospects...). Corps
// scrollable, en-tête et pied fixes.
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  headerLeft,
  headerRight,
  width = 560,
  footer,
  children,
  bodyStyle,
  noPadding,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
  width?: number;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  bodyStyle?: React.CSSProperties;
  noPadding?: boolean;
}) {
  const panelRef = React.useRef<HTMLElement>(null);
  useOverlayBehavior(open, onClose, panelRef);
  if (!open) return null;
  return (
    <Portal>
      <div style={{ position: "fixed", inset: 0, zIndex: 85 }}>
        <div className="ds-overlay" onClick={onClose} />
        <aside
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          className="ds-drawer"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: `min(${width}px, 100vw)`,
            background: "#fff",
            boxShadow: SHADOWS.pop,
            display: "flex",
            flexDirection: "column",
            borderTopLeftRadius: 18,
            borderBottomLeftRadius: 18,
            overflow: "hidden",
          }}
        >
          {title || headerRight || headerLeft ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 18px",
                borderBottom: `1px solid ${COLORS.line}`,
                flexShrink: 0,
              }}
            >
              {headerLeft}
              <div style={{ flex: 1, minWidth: 0 }}>
                {title ? (
                  <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {title}
                  </div>
                ) : null}
                {subtitle ? <div style={{ fontSize: 12, color: COLORS.ink3, marginTop: 2 }}>{subtitle}</div> : null}
              </div>
              {headerRight}
              <button data-close type="button" onClick={onClose} className="ch-btn ch-btn-ghost ch-btn-sm ch-btn-icon-only" aria-label="Close">
                <X size={15} />
              </button>
            </div>
          ) : null}
          <div className="thin-scrollbar" style={{ flex: 1, overflowY: "auto", padding: noPadding ? 0 : 18, ...bodyStyle }}>
            {children}
          </div>
          {footer ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 8,
                padding: "12px 18px",
                borderTop: `1px solid ${COLORS.line}`,
                background: COLORS.bgSoft,
                flexShrink: 0,
              }}
            >
              {footer}
            </div>
          ) : null}
        </aside>
      </div>
    </Portal>
  );
}
