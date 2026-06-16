// Stages "nurture" : source de vérité UNIQUE pour les exclure à la fois du
// scoring (cron + bouton "Score all") ET des digests/recap. Même heuristique
// que l'affichage de la page /deals (label de stage contenant "nurture",
// insensible à la casse). cf app/deals/page.tsx.

export function isNurtureLabel(label: string | null | undefined): boolean {
  return !!label && label.toLowerCase().includes("nurture");
}

// Résout les IDs de stages "nurture" sur tous les pipelines de deals. Utilisé
// par les chemins de scoring (qui ne fetchent pas les labels de stage par
// ailleurs) pour ajouter un filtre `dealstage NOT_IN` à la recherche HubSpot.
// Fail-open : en cas d'erreur API on renvoie [] (on ne casse pas le scoring,
// quitte à scorer un nurture cette fois-ci plutôt que de tout bloquer).
export async function fetchNurtureStageIds(): Promise<string[]> {
  try {
    const res = await fetch("https://api.hubapi.com/crm/v3/pipelines/deals", {
      headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}` },
    });
    if (!res.ok) throw new Error(`HubSpot ${res.status}`);
    const data = (await res.json()) as { results?: { stages?: { id?: string; label?: string }[] }[] };
    const ids: string[] = [];
    for (const p of data.results ?? []) {
      for (const s of p.stages ?? []) {
        if (s?.id && isNurtureLabel(s.label)) ids.push(s.id);
      }
    }
    return ids;
  } catch (e) {
    console.warn("[deals/stages] fetchNurtureStageIds failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
