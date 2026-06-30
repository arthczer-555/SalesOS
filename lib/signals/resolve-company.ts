import type { ScoredSignal } from "./types";

export function normCompany(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(sas|sarl|sa|inc|ltd|llc|group|groupe|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Relie les signaux discovery à un compte déjà dans la watchlist quand le nom
 * correspond : on bascule alors feed='watchlist' + scope_company_id, ce qui évite
 * les doublons discovery/watchlist et fait remonter le signal sur la fiche compte.
 *
 * Cheap : une seule liste scope_companies en mémoire, match par nom normalisé.
 */
export function linkExistingCompanies(
  signals: ScoredSignal[],
  companies: { id: string; name: string }[],
): ScoredSignal[] {
  const byName = new Map<string, string>();
  for (const c of companies) {
    const key = normCompany(c.name);
    if (key) byName.set(key, c.id);
  }
  return signals.map((s) => {
    if (s.scope_company_id) return s;
    const id = byName.get(normCompany(s.company_name));
    if (!id) return s;
    return { ...s, scope_company_id: id, feed: "watchlist" };
  });
}
