"use client";

import { X } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";

interface Props {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  footer?: React.ReactNode;
}

export function Modal({ title, onClose, children, width = 460, footer }: Props) {
  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(17,17,17,0.4)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: "100%",
          maxHeight: "90vh",
          background: COLORS.bgCard,
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: `1px solid ${COLORS.line}`,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: COLORS.ink0 }}>{title}</h2>
          <button onClick={onClose} style={{ color: COLORS.ink2, padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: 18, overflowY: "auto", flex: 1 }}>{children}</div>
        {footer && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              padding: "12px 18px",
              borderTop: `1px solid ${COLORS.line}`,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export const modalInput: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  fontSize: 13,
  border: `1px solid ${COLORS.lineStrong}`,
  borderRadius: 8,
  color: COLORS.ink0,
  outline: "none",
};

export function PrimaryBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 16px",
        fontSize: 13,
        fontWeight: 600,
        color: "#fff",
        background: COLORS.brand,
        borderRadius: 8,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function GhostBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 16px",
        fontSize: 13,
        fontWeight: 600,
        color: COLORS.ink1,
        background: COLORS.bgSoft,
        border: `1px solid ${COLORS.lineStrong}`,
        borderRadius: 8,
      }}
    >
      {children}
    </button>
  );
}
