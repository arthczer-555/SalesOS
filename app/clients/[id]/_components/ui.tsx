"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { COLORS, RADIUS, SHADOWS } from "@/lib/design/tokens";
import type { HealthLabel } from "@/lib/clients/types";

// Primitives visuelles de la fiche client v2 : une seule façon de faire une
// carte, un titre de carte, un tag de statut. Les cartes n'ont plus de bandeau
// de titre gris : titre inline (icône 15 px + titre 14/700 + méta à droite).

type IconType = React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;

export function Card({
  children,
  id,
  style,
  padding = "18px 20px",
}: {
  children: React.ReactNode;
  id?: string;
  style?: React.CSSProperties;
  padding?: string | number;
}) {
  return (
    <section
      id={id}
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: RADIUS.lg,
        boxShadow: SHADOWS.card,
        padding,
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

// Section repliable (Knowledge) : l'état vit chez le parent, la carte masque
// son corps quand `open` est faux.
export type Collapse = { open: boolean; onToggle: () => void };

export function CardHeader({
  icon: Icon,
  title,
  meta,
  right,
  style,
  collapse,
}: {
  icon?: IconType;
  title: React.ReactNode;
  meta?: React.ReactNode;
  right?: React.ReactNode;
  style?: React.CSSProperties;
  // Fourni : icône + titre deviennent le bouton de repli (chevron), la méta
  // reste visible repliée et sert de résumé.
  collapse?: Collapse;
}) {
  const heading = (
    <>
      {Icon ? <Icon size={15} style={{ color: COLORS.ink2, flexShrink: 0 }} /> : null}
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: COLORS.ink0, letterSpacing: "-0.005em" }}>{title}</h3>
    </>
  );
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 14,
        flexWrap: "wrap",
        ...style,
        ...(collapse && !collapse.open ? { marginBottom: 0 } : {}),
      }}
    >
      {collapse ? (
        <button
          type="button"
          onClick={collapse.onToggle}
          aria-expanded={collapse.open}
          className="ch-collapse"
          style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: 0, padding: 0, cursor: "pointer", color: COLORS.ink0, textAlign: "left", minWidth: 0 }}
        >
          {heading}
          <ChevronDown size={15} style={{ color: COLORS.ink3, flexShrink: 0, transform: collapse.open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
        </button>
      ) : (
        heading
      )}
      {(meta || right) && (
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {meta ? <span style={{ fontSize: 12, color: COLORS.ink3, whiteSpace: "nowrap" }}>{meta}</span> : null}
          {right}
        </div>
      )}
    </div>
  );
}

// Couleurs et libellés des trois niveaux de santé (carte, header, popup du score).
export const HEALTH_STYLE: Record<HealthLabel, { fg: string; bg: string; label: string; tint: string }> = {
  green: { fg: COLORS.ok, bg: COLORS.okBg, label: "Healthy", tint: "#f2fbf7" },
  yellow: { fg: COLORS.warn, bg: COLORS.warnBg, label: "Needs attention", tint: "#fffaf0" },
  red: { fg: COLORS.err, bg: COLORS.errBg, label: "At risk", tint: "#fff6f6" },
};

export type TagTone = "neutral" | "ok" | "warn" | "err" | "brand" | "info" | "solid";

const TAG_TONES: Record<TagTone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: COLORS.bgSoft, fg: COLORS.ink1, border: COLORS.line },
  ok: { bg: COLORS.okBg, fg: COLORS.ok, border: "#c4ecd9" },
  warn: { bg: COLORS.warnBg, fg: COLORS.warn, border: "#f6dfa4" },
  err: { bg: COLORS.errBg, fg: COLORS.err, border: "#fbcaca" },
  brand: { bg: COLORS.brandTint, fg: COLORS.brandDark, border: "#f7b7cc" },
  info: { bg: COLORS.infoBg, fg: COLORS.info, border: "#ddd3fb" },
  solid: { bg: COLORS.brand, fg: "#fff", border: COLORS.brand },
};

export function Tag({
  tone = "neutral",
  children,
  title,
  style,
}: {
  tone?: TagTone;
  children: React.ReactNode;
  title?: string;
  style?: React.CSSProperties;
}) {
  const t = TAG_TONES[tone];
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 999,
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.border}`,
        whiteSpace: "nowrap",
        lineHeight: 1.5,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function Eyebrow({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: COLORS.ink3,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  text,
  tone = "ok",
  action,
}: {
  icon: IconType;
  title: string;
  text?: string;
  tone?: "ok" | "neutral";
  action?: React.ReactNode;
}) {
  return (
    <Card style={{ textAlign: "center" }} padding="48px 20px">
      <div
        style={{
          width: 60,
          height: 60,
          borderRadius: 999,
          background: tone === "ok" ? COLORS.okBg : COLORS.bgSoft,
          color: tone === "ok" ? COLORS.ok : COLORS.ink3,
          display: "grid",
          placeItems: "center",
          margin: "0 auto 14px",
        }}
      >
        <Icon size={30} />
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: COLORS.ink0 }}>{title}</div>
      {text && <p style={{ margin: "6px auto 0", fontSize: 13, color: COLORS.ink3, maxWidth: 460 }}>{text}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </Card>
  );
}

// Carte pointillée "pas encore disponible" (bloc IA pas encore généré).
export function PendingCard({ icon: Icon, title, text, id }: { icon: IconType; title: string; text: string; id?: string }) {
  return (
    <section
      id={id}
      style={{
        background: COLORS.bgCard,
        border: `1px dashed ${COLORS.lineStrong}`,
        borderRadius: RADIUS.lg,
        padding: "18px 20px",
        scrollMarginTop: 64,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Icon size={15} style={{ color: COLORS.ink3 }} />
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: COLORS.ink2 }}>{title}</h3>
      </div>
      <div style={{ fontSize: 12.5, color: COLORS.ink3, lineHeight: 1.5 }}>{text}</div>
    </section>
  );
}

export function fmtDay(iso: string | null | undefined, withYear = false): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
}

export function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function relativeDays(iso: string | null | undefined): string {
  const d = daysAgo(iso);
  if (d === null) return "-";
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  const m = Math.round(d / 30);
  return m <= 1 ? "a month ago" : `${m} months ago`;
}

export function fmtEur(n: number | null | undefined): string {
  if (n == null) return "-";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

// Dates HubSpot : ISO ("2026-11-01") ou timestamp ms selon la propriété.
// Renvoie un ISO, ou null si illisible.
export function parseLooseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = /^\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

// Ton de la fin de contrat (Key dates, Billing) : rouge si terminé ou à 30
// jours ou moins, orange à 120 jours ou moins (le temps de préparer le
// renouvellement), neutre au-delà. null = pas de date.
export function contractEndTone(days: number | null): Extract<TagTone, "neutral" | "warn" | "err"> | null {
  if (days === null) return null;
  if (days <= 30) return "err";
  if (days <= 120) return "warn";
  return "neutral";
}

// Ton de la prochaine facturation (Key dates, vue portefeuille) : rouge si la
// date est passée (facture à émettre ou date à mettre à jour), orange à 30
// jours ou moins, rien au-delà. null = pas de date ou rien à signaler.
export function nextBillingToneOf(days: number | null): Extract<TagTone, "warn" | "err"> | null {
  if (days === null) return null;
  if (days < 0) return "err";
  if (days <= 30) return "warn";
  return null;
}
