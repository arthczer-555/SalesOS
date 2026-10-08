// Stages "nurture" : source de vérité UNIQUE pour les exclure à la fois du
// scoring (cron + bouton "Score all") ET des digests/recap. Même heuristique
// que l'affichage de la page /deals (label de stage contenant "nurture",
// insensible à la casse). cf app/deals/page.tsx.

export function isNurtureLabel(label: string | null | undefined): boolean {
  return !!label && label.toLowerCase().includes("nurture");
}

// Mots-clés (sous-chaîne, insensible à la casse) qui marquent un deal comme
// "gagné". Le booléen HubSpot `hs_is_closed_won` est la source de vérité, MAIS
// quand un deal gagné bascule dans le pipeline Customer Success / Passation,
// HubSpot remet `hs_is_closed_won` à false (la nouvelle étape n'est pas
// configurée "closed won" sur ce pipeline). On considère donc aussi gagné tout
// deal dont le label de pipeline OU d'étape correspond. Même convention que
// resolveAudience dans lib/sales-coach/meeting-recap.ts.
const WON_KEYWORDS = [
  "closed won",
  "closedwon",
  "gagné",
  "gagne",
  "won",
  "passation",
  "customer success",
];

// Vrai si le deal est gagné : soit hs_is_closed_won === true, soit son pipeline
// / étape est un état "gagné" (Customer Success, Passation...). Pure : utilisable
// côté serveur (funnel) comme côté client (badges).
export function isWonDeal(deal: {
  is_closed_won?: boolean | null;
  pipeline_label?: string | null;
  stage_label?: string | null;
}): boolean {
  if (deal.is_closed_won === true) return true;
  for (const text of [deal.pipeline_label, deal.stage_label]) {
    const t = (text ?? "").toLowerCase();
    if (t && WON_KEYWORDS.some((kw) => t.includes(kw))) return true;
  }
  return false;
}

// Pipeline Customer Success : le workflow HubSpot y crée un deal de suivi à
// chaque closed won. Heuristique par label comme isNurtureLabel (l'id du
// pipeline n'est pas stable d'un portail à l'autre).
export function isCustomerSuccessPipeline(label: string | null | undefined): boolean {
  return !!label && label.toLowerCase().includes("customer success");
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
