"use client";

import * as React from "react";
import { COLORS } from "@/lib/design/tokens";

// Popover ancré sous son déclencheur. Ferme au clic extérieur et sur Échap.
// Contrôlé (open/onOpenChange) ou non contrôlé.
export function Popover({
  trigger,
  children,
  width = 320,
  align = "left",
  open: openProp,
  onOpenChange,
  side = "bottom",
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: React.ReactNode | ((props: { close: () => void }) => React.ReactNode);
  width?: number;
  align?: "left" | "right";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "bottom" | "top";
}) {
  const [inner, setInner] = React.useState(false);
  const open = openProp ?? inner;
  const setOpen = React.useCallback(
    (v: boolean) => {
      if (openProp === undefined) setInner(v);
      onOpenChange?.(v);
    },
    [openProp, onOpenChange],
  );
  const wrapRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);
  const close = () => setOpen(false);
  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      {trigger({ open, toggle: () => setOpen(!open) })}
      {open ? (
        <div
          className="ds-pop"
          style={{
            position: "absolute",
            [side === "bottom" ? "top" : "bottom"]: "calc(100% + 6px)",
            [align]: 0,
            width,
            zIndex: 60,
            background: "#fff",
            border: `1px solid ${COLORS.line}`,
            borderRadius: 14,
            boxShadow: "0 14px 40px rgba(20, 20, 30, 0.14), 0 2px 6px rgba(20, 20, 30, 0.06)",
          }}
        >
          {typeof children === "function" ? children({ close }) : children}
        </div>
      ) : null}
    </div>
  );
}
