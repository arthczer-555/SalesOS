/**
 * SalesOS Design System tokens — TS export.
 * Mirror of CSS variables in app/globals.css for components that prefer JS access.
 */

export const COLORS = {
  brand: "#f01563",
  brandDark: "#d0114f",
  brandTint: "#fde8ef",
  brandTintSoft: "#fff9fb",

  ink0: "#111111",
  ink1: "#444444",
  ink2: "#666666",
  ink3: "#888888",
  ink4: "#aaaaaa",
  ink5: "#bbbbbb",

  line: "#eeeeee",
  lineStrong: "#e5e5e5",

  bgPage: "#f9f9f9",
  bgSoft: "#fafafa",
  bgCard: "#ffffff",

  ok: "#059669",
  okBg: "#ecfdf5",
  warn: "#b45309",
  warnBg: "#fef3c7",
  err: "#dc2626",
  errBg: "#fee2e2",
  info: "#6d28d9",
  infoBg: "#ede9fe",
} as const;

export const STAGE_PALETTE = [
  "#3b82f6",
  "#7c3aed",
  "#0891b2",
  "#16a34a",
  "#ca8a04",
  "#ea580c",
  "#dc2626",
  "#db2777",
  "#be185d",
] as const;

export const RADIUS = { sm: 6, md: 10, lg: 12, xl: 16 } as const;

export const SHADOWS = {
  sm: "0 1px 2px rgba(0, 0, 0, 0.04)",
  md: "0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.03)",
  card: "0 1px 3px rgba(0, 0, 0, 0.04)",
} as const;

/**
 * Convert a numeric score to (fg, bg) colors using brand thresholds.
 * - scale=10:  green ≥ 7.5,  orange 5–7.5,  red < 5
 * - scale=100: green ≥ 75,   orange 50–75,  red < 50
 */
export function scoreToColor(
  score: number | null | undefined,
  scale: 10 | 100 = 100
): { fg: string; bg: string; label: "ok" | "warn" | "err" | "muted" } {
  if (score === null || score === undefined || Number.isNaN(score)) {
    return { fg: COLORS.ink3, bg: COLORS.bgSoft, label: "muted" };
  }
  const hi = scale === 10 ? 7.5 : 75;
  const mid = scale === 10 ? 5 : 50;
  if (score >= hi) return { fg: COLORS.ok, bg: COLORS.okBg, label: "ok" };
  if (score >= mid) return { fg: COLORS.warn, bg: COLORS.warnBg, label: "warn" };
  return { fg: COLORS.err, bg: COLORS.errBg, label: "err" };
}

/**
 * Stable color picker for stage names — preserves the existing 9-color rotation
 * used by the Deals kanban. Pass a stage label or any string id.
 */
export function stageColor(key: string | null | undefined): string {
  if (!key) return STAGE_PALETTE[0];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return STAGE_PALETTE[Math.abs(h) % STAGE_PALETTE.length];
}

/**
 * Derive a (bg, fg) gradient pair for a CompanyAvatar from the company name.
 * Returns a CSS linear-gradient string for `background`.
 */
export function companyAvatarGradient(name: string | null | undefined): {
  background: string;
  color: string;
} {
  const palette = [
    ["#0ea5e9", "#1e40af"],
    ["#10b981", "#065f46"],
    ["#f59e0b", "#b45309"],
    ["#ef4444", "#991b1b"],
    ["#8b5cf6", "#5b21b6"],
    ["#ec4899", "#9d174d"],
    ["#14b8a6", "#0f766e"],
    ["#f97316", "#9a3412"],
    ["#6366f1", "#3730a3"],
  ];
  const key = (name || "?").trim();
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  const [from, to] = palette[Math.abs(h) % palette.length];
  return { background: `linear-gradient(135deg, ${from}, ${to})`, color: "#ffffff" };
}

/**
 * Couleur d'accent stable par sales (board d'attribution). Hash déterministe du
 * nom → palette curée. Utilisée sur l'anneau d'avatar, la barre de charge et le
 * glow de drop.
 */
const REP_PALETTE = [
  "#f01563", // brand
  "#3b82f6", // blue
  "#10b981", // green
  "#8b5cf6", // violet
  "#f59e0b", // amber
  "#14b8a6", // teal
  "#f97316", // orange
  "#6366f1", // indigo
  "#ec4899", // pink
  "#0ea5e9", // sky
] as const;

export function repAccent(name: string | null | undefined): string {
  const key = (name || "?").trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return REP_PALETTE[Math.abs(h) % REP_PALETTE.length];
}

/**
 * Confidence badge style mapping.
 * Accepts "high"|"medium"|"low" or French equivalents.
 */
export function confidenceBadgeStyle(
  confidence: string | null | undefined
): { fg: string; bg: string; label: string } {
  const c = (confidence || "").toLowerCase();
  if (c === "high" || c === "haute" || c === "élevée" || c === "elevee") {
    return { fg: COLORS.ok, bg: COLORS.okBg, label: "Confiance haute" };
  }
  if (c === "medium" || c === "moyenne") {
    return { fg: COLORS.warn, bg: COLORS.warnBg, label: "Confiance moyenne" };
  }
  if (c === "low" || c === "faible") {
    return { fg: COLORS.ink3, bg: COLORS.bgSoft, label: "Confiance faible" };
  }
  return { fg: COLORS.ink3, bg: COLORS.bgSoft, label: confidence || "—" };
}

/**
 * Meeting kind badge style. Pass-through label support — caller can override.
 */
export function meetingKindBadgeStyle(kind: string | null | undefined): {
  fg: string;
  bg: string;
} {
  const k = (kind || "").toLowerCase();
  if (k.includes("discovery")) return { fg: COLORS.info, bg: COLORS.infoBg };
  if (k.includes("demo")) return { fg: COLORS.brand, bg: COLORS.brandTint };
  if (k.includes("nego")) return { fg: COLORS.warn, bg: COLORS.warnBg };
  if (k.includes("closing") || k.includes("close"))
    return { fg: COLORS.ok, bg: COLORS.okBg };
  if (k.includes("follow")) return { fg: COLORS.ink2, bg: COLORS.bgSoft };
  return { fg: COLORS.ink2, bg: COLORS.bgSoft };
}
