"use client";

import * as React from "react";
import { COLORS, SHADOWS } from "@/lib/design/tokens";

type IconType = React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;

export type DropdownMenuItem = {
  key: string;
  label: string;
  description?: string;
  icon?: IconType;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  // Soit une action, soit un lien externe (ouvert dans un nouvel onglet).
  onSelect?: () => void;
  href?: string;
};

export type DropdownMenuGroup = { label?: string; items: DropdownMenuItem[] };

// Menu déroulant générique : groupes titrés, séparateurs, item "danger".
// Se ferme au clic extérieur, sur Échap et après sélection ; flèches haut/bas
// pour naviguer entre les items.
export function DropdownMenu({
  trigger,
  groups,
  width = 290,
  align = "right",
}: {
  trigger: (props: { open: boolean; toggle: () => void; ref: React.Ref<HTMLButtonElement> }) => React.ReactNode;
  groups: DropdownMenuGroup[];
  width?: number;
  align?: "left" | "right";
}) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled=true])") ?? []);
      if (items.length === 0) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      const n = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[n].focus();
      e.preventDefault();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    // Focus du 1er item à l'ouverture (navigation clavier).
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const visibleGroups = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.hidden) }))
    .filter((g) => g.items.length > 0);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      {trigger({ open, toggle: () => setOpen((o) => !o), ref: triggerRef })}
      {open && (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: "absolute",
            [align]: 0,
            top: "calc(100% + 6px)",
            width,
            maxWidth: "calc(100vw - 32px)",
            background: COLORS.bgCard,
            border: `1px solid ${COLORS.line}`,
            borderRadius: 12,
            boxShadow: SHADOWS.pop,
            padding: 6,
            zIndex: 60,
          }}
        >
          {visibleGroups.map((g, gi) => (
            <div key={g.label ?? gi}>
              {gi > 0 && <div style={{ borderTop: `1px solid ${COLORS.line}`, margin: "6px 4px" }} />}
              {g.label && (
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: COLORS.ink4,
                    padding: "8px 10px 4px",
                  }}
                >
                  {g.label}
                </div>
              )}
              {g.items.map((it) => {
                const Icon = it.icon;
                const inner = (
                  <>
                    {Icon ? <Icon size={15} style={{ color: it.danger ? COLORS.err : COLORS.ink2, marginTop: 2, flexShrink: 0 }} /> : null}
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 500 }}>{it.label}</span>
                      {it.description && (
                        <span style={{ display: "block", fontSize: 11.5, color: COLORS.ink3, lineHeight: 1.4 }}>{it.description}</span>
                      )}
                    </span>
                  </>
                );
                const className = `ch-menu-item ${it.danger ? "ch-menu-item-danger" : ""}`.trim();
                const disabledStyle: React.CSSProperties | undefined = it.disabled ? { opacity: 0.45, cursor: "not-allowed" } : undefined;
                if (it.href) {
                  return (
                    <a
                      key={it.key}
                      role="menuitem"
                      href={it.href}
                      target="_blank"
                      rel="noreferrer"
                      className={className}
                      onClick={() => setOpen(false)}
                    >
                      {inner}
                    </a>
                  );
                }
                return (
                  <button
                    key={it.key}
                    type="button"
                    role="menuitem"
                    aria-disabled={it.disabled || undefined}
                    className={className}
                    style={disabledStyle}
                    onClick={() => {
                      if (it.disabled) return;
                      setOpen(false);
                      it.onSelect?.();
                    }}
                  >
                    {inner}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
