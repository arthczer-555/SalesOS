// ────────────────────────────────────────────────────────────────────────
// Rôles sales, cumulables. Ils décident du contenu de la page d'accueil
// (/dashboard) : quels flux de revenu un utilisateur voit sur ses propres
// chiffres.
//
// Le Sheet revenue est la référence : il ventile les objectifs en New par AE,
// Renew par AM et Renew par CSM, et le même prénom apparaît dans plusieurs
// blocs. D'où le cumul plutôt qu'un rôle unique.
// ────────────────────────────────────────────────────────────────────────

export type SalesRole = "ae" | "am" | "csm";

export const SALES_ROLES: SalesRole[] = ["ae", "am", "csm"];

export const SALES_ROLE_LABEL: Record<SalesRole, string> = {
  ae: "AE",
  am: "AM",
  csm: "CSM",
};

export const SALES_ROLE_HINT: Record<SalesRole, string> = {
  ae: "Account Executive - New target, receives the deal digest",
  am: "Account Manager - Renew target",
  csm: "Customer Success - Renew delivery",
};

/** Nettoie une valeur venue de la base ou d'un payload API. */
export function parseSalesRoles(value: unknown): SalesRole[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<SalesRole>();
  for (const v of value) {
    const s = String(v).toLowerCase().trim();
    if ((SALES_ROLES as string[]).includes(s)) seen.add(s as SalesRole);
  }
  return SALES_ROLES.filter((r) => seen.has(r));
}
