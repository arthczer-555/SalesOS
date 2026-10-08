/**
 * "Il me manque un outil" : quand un agent ne peut pas faire exactement ce que
 * l'utilisateur a demandé (aucune source ne fournit la donnée, ou c'est une
 * action qu'un agent ne sait pas faire), il le dit au lieu de bricoler, et
 * l'utilisateur peut demander l'outil à Arthur en un clic (boîte à idées, DM
 * Slack, voir app/api/agents/[id]/request-tool).
 *
 * Deux moments de détection, une seule liste (agents.design_notes.missing_tools) :
 *  - au design : le designer IA compare la demande au catalogue des sources ;
 *  - à l'exécution : le modèle découvre une limite réelle d'un outil (ex. une
 *    granularité qui n'existe pas) et pose un marqueur [[MISSING_TOOL: …]] que
 *    le moteur retire du message et remplace par une ligne standard.
 *
 * Isomorphe : aucun import serveur.
 */

export type AgentMissingTool = {
  need: string;
  reason: string;
  found_in: "design" | "run";
  found_at: string;
  requested_at?: string | null;
};

// [[MISSING_TOOL: besoin | raison]] (la raison est optionnelle).
const MARKER_RE = /\[\[\s*MISSING_TOOL\s*:\s*([^|\]]+?)\s*(?:\|\s*([^\]]*?)\s*)?\]\]/gi;

export const MISSING_TOOL_MARKER_HELP = "[[MISSING_TOOL: <besoin, en anglais> | <pourquoi aucun outil ne le couvre>]]";

const key = (need: string) =>
  need
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Retire les marqueurs d'une sortie de run et renvoie les manques trouvés. */
export function extractMissingTools(output: string): { clean: string; items: { need: string; reason: string }[] } {
  const items: { need: string; reason: string }[] = [];
  const clean = output
    .replace(MARKER_RE, (_m, need: string, reason?: string) => {
      if (need.trim()) items.push({ need: need.trim(), reason: (reason ?? "").trim() });
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const seen = new Set<string>();
  return { clean, items: items.filter((i) => !seen.has(key(i.need)) && seen.add(key(i.need))) };
}

/** Ligne ajoutée en pied du message Slack, une par outil manquant. */
export function missingToolFooter(items: { need: string }[]): string {
  if (items.length === 0) return "";
  return items.map((i) => `⚠️ _Missing tool: ${i.need}. Ask Arthur to add it to CoachelloHQ._`).join("\n");
}

/**
 * Fusionne des manques dans la liste existante (dédup sur le besoin), en
 * gardant la date de découverte et la date de demande à Arthur.
 * `replace` : la liste entrante fait autorité (design : le designer a reçu la
 * liste actuelle, y compris les manques vus en run, et la renvoie à jour) ;
 * sinon on ajoute (run).
 */
export function mergeMissingTools(
  existing: AgentMissingTool[] | undefined,
  incoming: { need: string; reason: string }[],
  foundIn: "design" | "run",
  opts: { replace?: boolean } = {},
): AgentMissingTool[] {
  const now = new Date().toISOString();
  const prev = existing ?? [];
  const byKey = new Map(prev.map((m) => [key(m.need), m]));
  const out = new Map((opts.replace ? [] : prev).map((m) => [key(m.need), m]));
  for (const item of incoming) {
    const k = key(item.need);
    if (!k) continue;
    const before = byKey.get(k);
    out.set(k, {
      need: item.need.slice(0, 160),
      reason: item.reason.slice(0, 300),
      found_in: before?.found_in ?? foundIn,
      found_at: before?.found_at ?? now,
      requested_at: before?.requested_at ?? null,
    });
  }
  return [...out.values()];
}

// ── Récap d'un envoi groupé ────────────────────────────────────────────────
// [[RECAP: 3 clients at risk]] : une ligne pour le DM récap du créateur,
// retirée du message envoyé au destinataire.
const RECAP_RE = /\[\[\s*RECAP\s*:\s*([^\]]*?)\s*\]\]/gi;

export const RECAP_MARKER_HELP = "[[RECAP: <résumé en 3 à 8 mots>]]";

export function extractRecap(output: string): { clean: string; recap: string | null } {
  let recap: string | null = null;
  const clean = output
    .replace(RECAP_RE, (_m, text: string) => {
      if (!recap && text.trim()) recap = text.trim().slice(0, 140);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { clean, recap };
}
