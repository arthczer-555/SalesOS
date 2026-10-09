import { COLORS as BASE } from "@/lib/design/tokens";

export { RADIUS, SHADOWS } from "@/lib/design/tokens";

// Palette chaude des pages Clients (maquettes du 2026-10-09) : fond beige,
// gris et lignes tirés vers le chaud, actions principales en brun. Le rose de
// la marque reste réservé aux alertes (échéance "This week", watch points,
// handover). Mêmes clés que lib/design/tokens, plus les teintes propres à la
// palette : les composants de /clients importent COLORS d'ici. Les variables
// CSS équivalentes sont redéfinies sous .ch-warm (app/globals.css), posée par
// app/clients/layout.tsx.
export const COLORS = {
  ...BASE,
  ink0: "#1a1816",
  ink1: "#46423d",
  ink2: "#6b655e",
  ink3: "#8d867d",
  ink4: "#b1aaa0",
  ink5: "#c5bfb6",
  line: "#ece8e1",
  lineStrong: "#e2ddd4",
  bgPage: "#f4f2ee",
  bgSoft: "#f8f6f2",
  bgCard: "#ffffff",
  // Actions principales (Import, Suggest values, Draft email…).
  primary: "#5b4a42",
  primaryDark: "#4a3c35",
  // Fond neutre chaud : pastilles neutres, sidebar de Knowledge, segmented.
  sand: "#efece6",
  // Encarts "à compléter" (infos manquantes, Needs attention).
  warnTint: "#fdf8ec",
  warnLine: "#f1e3bd",
} as const;
