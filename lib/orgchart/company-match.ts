// Décide si une organisation renvoyée par Apollo appartient au MÊME groupe que
// le compte (ex : "Allianz Partners" / "Allianz Trade" pour le compte "Allianz").
// Utilisé pour la détection de DÉPART : un "false" déclenche une proposition
// destructive (suppression du chart + réécriture HubSpot), donc l'heuristique est
// volontairement CONSERVATRICE (en cas de doute -> même groupe -> pas de départ).
//
// Remplace trois implémentations divergentes basées sur un simple `includes()` du
// token le plus long (faux positifs/négatifs sur abréviations, sous-marques,
// variantes régionales). cf. B11.
import { normalizeCompany, jaroWinkler } from "@/lib/fuzzy-match";

// Mots trop génériques pour distinguer deux entreprises : ne comptent pas comme
// un token partagé "significatif".
const GENERIC_TOKENS = new Set([
  "group",
  "groupe",
  "holding",
  "holdings",
  "international",
  "global",
  "tech",
  "technology",
  "technologies",
  "solutions",
  "services",
  "partners",
  "company",
  "industries",
  "systems",
  "digital",
  "consulting",
]);

const MIN_TOKEN_LEN = 3;
const JW_THRESHOLD = 0.85;

function significantTokens(normalized: string): string[] {
  return normalized.split(" ").filter((t) => t.length >= MIN_TOKEN_LEN && !GENERIC_TOKENS.has(t));
}

export function sameCompanyGroup(accountName: string | null | undefined, org: string | null | undefined): boolean {
  if (!org) return true; // pas d'info Apollo -> on ne conclut pas à un départ
  const a = normalizeCompany(accountName);
  const o = normalizeCompany(org);
  if (!a || !o) return true; // impossible de trancher -> on ne flague pas un départ
  if (a === o) return true;

  // 1) Token significatif partagé (ex : "allianz" présent des deux côtés).
  const aTokens = new Set(significantTokens(a));
  const oTokens = significantTokens(o);
  if (oTokens.some((t) => aTokens.has(t))) return true;
  // Repli si l'un n'a que des tokens génériques : compare tous les tokens >= 3.
  if (aTokens.size === 0 || oTokens.length === 0) {
    const aAll = new Set(a.split(" ").filter((t) => t.length >= MIN_TOKEN_LEN));
    if (o.split(" ").filter((t) => t.length >= MIN_TOKEN_LEN).some((t) => aAll.has(t))) return true;
  }

  // 2) Similarité globale élevée (ex : variantes orthographiques proches).
  return jaroWinkler(a, o) >= JW_THRESHOLD;
}
