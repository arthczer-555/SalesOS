"use client";

// Petits éléments visuels partagés par les panneaux du drawer d'ajout.
import * as React from "react";
import { Check } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { PersonAvatar } from "@/components/ui/person-avatar";

type IconType = React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;

export function PanelHeader({
  icon: Icon,
  title,
  description,
  right,
  accent = COLORS.brand,
}: {
  icon: IconType;
  title: React.ReactNode;
  description?: React.ReactNode;
  right?: React.ReactNode;
  accent?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 11,
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          color: accent,
          background: `linear-gradient(135deg, ${accent}1f, ${accent}0a)`,
          border: `1px solid ${accent}2e`,
        }}
      >
        <Icon size={17} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.ink0, letterSpacing: "-0.01em" }}>{title}</div>
        {description ? <div style={{ fontSize: 12.5, color: COLORS.ink3, marginTop: 2, lineHeight: 1.5 }}>{description}</div> : null}
      </div>
      {right ? <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>{right}</div> : null}
    </div>
  );
}

export function Eyebrow({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: COLORS.ink3,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Puce bascule (séniorités, tailles, personas). */
export function ChipToggle({
  active,
  onClick,
  children,
  color,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** Pastille de couleur (persona). */
  color?: string | null;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        font: "inherit",
        fontSize: 12,
        fontWeight: 600,
        padding: "4px 10px",
        borderRadius: 999,
        cursor: "pointer",
        whiteSpace: "nowrap",
        border: `1px solid ${active ? COLORS.brand : COLORS.lineStrong}`,
        background: active ? COLORS.brandTint : "#fff",
        color: active ? COLORS.brandDark : COLORS.ink1,
        transition: "background 0.12s, border-color 0.12s, color 0.12s",
      }}
    >
      {active ? <Check size={11} /> : color ? <span style={{ width: 7, height: 7, borderRadius: 99, background: color }} /> : null}
      {children}
    </button>
  );
}

/** Cellule "personne" : avatar + nom + ligne secondaire. */
export function PersonCell({ name, sub, note, badges }: { name: string; sub?: React.ReactNode; note?: React.ReactNode; badges?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <PersonAvatar name={name} size={28} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
            {name}
          </span>
          {badges}
        </div>
        {sub ? (
          <div style={{ fontSize: 12, color: COLORS.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>{sub}</div>
        ) : null}
        {note ? <div style={{ fontSize: 11, color: COLORS.info, fontWeight: 600, marginTop: 1 }}>{note}</div> : null}
      </div>
    </div>
  );
}

/** Cadre carte blanche des panneaux. */
export function Card({ children, style, padding = 14 }: { children: React.ReactNode; style?: React.CSSProperties; padding?: number }) {
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${COLORS.line}`,
        borderRadius: 14,
        padding,
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Conteneur de tableau (bordure + coins arrondis + scroll interne). */
export function TableFrame({ children, maxHeight }: { children: React.ReactNode; maxHeight?: number | string }) {
  return (
    <div
      className="thin-scrollbar"
      style={{
        border: `1px solid ${COLORS.line}`,
        borderRadius: 14,
        overflow: "auto",
        background: "#fff",
        maxHeight,
      }}
    >
      {children}
    </div>
  );
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** "3 days ago", "2 months ago" : date relative courte. */
export function relativeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? "s" : ""} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}

/** Libellé de la touche de raccourci (Cmd sur Mac, Ctrl ailleurs). Rendu client uniquement (drawer). */
export function modKey(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? "\u2318" : "Ctrl";
}
