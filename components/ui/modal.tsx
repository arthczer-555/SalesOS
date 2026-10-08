"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { COLORS, SHADOWS } from "@/lib/design/tokens";

type IconType = React.ComponentType<{ size?: number | string }>;

/** Ferme sur Échap, focus le premier élément focusable à l'ouverture. */
export function useOverlayBehavior(open: boolean, onClose: () => void, panelRef: React.RefObject<HTMLElement | null>) {
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  });
  React.useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>("[data-autofocus], input:not([type=hidden]), textarea, select, button:not([data-close])");
      el?.focus();
    }, 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
      prev?.focus?.();
    };
  }, [open, panelRef]);
}

export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

// Fenêtre modale centrée : titre + description + icône, corps scrollable,
// pied de page (actions). Ferme sur Échap et clic sur le fond.
export function Modal({
  open,
  onClose,
  title,
  description,
  icon: Icon,
  width = 560,
  footer,
  children,
  closeOnOverlay = true,
  bodyStyle,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: IconType;
  width?: number;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  closeOnOverlay?: boolean;
  bodyStyle?: React.CSSProperties;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  useOverlayBehavior(open, onClose, panelRef);
  if (!open) return null;
  return (
    <Portal>
      <div style={{ position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center", padding: 20 }}>
        <div className="ds-overlay" onClick={closeOnOverlay ? onClose : undefined} />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          className="ds-modal"
          style={{
            position: "relative",
            width: "100%",
            maxWidth: width,
            maxHeight: "calc(100vh - 40px)",
            display: "flex",
            flexDirection: "column",
            background: "#fff",
            borderRadius: 18,
            boxShadow: SHADOWS.pop,
            overflow: "hidden",
          }}
        >
          {title ? (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "18px 20px 0" }}>
              {Icon ? (
                <div
                  style={{
                    width: 36,
                    height: 36,
                    flexShrink: 0,
                    borderRadius: 11,
                    display: "grid",
                    placeItems: "center",
                    background: COLORS.brandTint,
                    color: COLORS.brand,
                  }}
                >
                  <Icon size={17} />
                </div>
              ) : null}
              <div style={{ flex: 1, minWidth: 0, paddingTop: Icon ? 1 : 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.ink0, letterSpacing: "-0.01em" }}>{title}</div>
                {description ? <div style={{ fontSize: 13, color: COLORS.ink2, marginTop: 3, lineHeight: 1.45 }}>{description}</div> : null}
              </div>
              <button data-close type="button" onClick={onClose} className="ch-btn ch-btn-ghost ch-btn-sm ch-btn-icon-only" aria-label="Close">
                <X size={15} />
              </button>
            </div>
          ) : null}
          <div className="thin-scrollbar" style={{ padding: 20, overflowY: "auto", flex: 1, ...bodyStyle }}>
            {children}
          </div>
          {footer ? (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 8,
                padding: "12px 20px",
                borderTop: `1px solid ${COLORS.line}`,
                background: COLORS.bgSoft,
              }}
            >
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </Portal>
  );
}
