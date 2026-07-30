/**
 * Outils Notion de CoachelloGPT : LECTURE SEULE, par décision produit
 * (cf. __documentation/coachello-gpt-rag-plan.md §6.3). Aucun outil d'écriture
 * n'existe ici et aucun ne doit y être ajouté : le mode ÉCRITURE se fait en
 * local via le repo Coachello.RAG.
 *
 * Chaque page lue est émise comme source (ctx.onSource) pour l'UI et pour les
 * citations. La procédure de navigation (registre d'IDs, fetch déterministe
 * d'abord, search en fallback) vit dans le pack notion_knowledge (load_guide).
 */

import type Anthropic from "@anthropic-ai/sdk";
import { isNotionConfigured } from "@/lib/notion/client";
import { fetchPageAsMarkdown, searchNotion } from "@/lib/notion/read";
import type { ToolModule } from "./types";

const NOT_CONFIGURED =
  "Erreur : intégration Notion non configurée (NOTION_TOKEN manquant). La base de connaissance Coachello est indisponible.";

const defs: Anthropic.Tool[] = [
  {
    name: "notion_fetch",
    description:
      "Lit une page (ou database) Notion de la base de connaissance Coachello EN ENTIER, rendue en markdown. Méthode PAR DÉFAUT : navigation déterministe par les IDs du registre (charge d'abord le guide notion_knowledge via load_guide si ce n'est pas fait). COUVERTURE : appelle notion_fetch PLUSIEURS FOIS EN PARALLÈLE dans le même tour, une par page plausible du registre (procédure/runbook + écran de l'outil + qui-fait-quoi), au lieu d'une seule page suivie d'un second tour. Les appels parallèles sont exécutés simultanément : le coût en temps est le même qu'un seul. Les sous-pages apparaissent comme des liens avec leur id : descends en refetchant. Cite ensuite chaque page utilisée : Source : [Titre](URL Notion).",
    input_schema: {
      type: "object" as const,
      properties: {
        page_id_or_url: { type: "string", description: "ID Notion (32 hex ou UUID) ou URL de la page/database" },
      },
      required: ["page_id_or_url"],
    },
  },
  {
    name: "notion_search",
    description:
      "Recherche par mots-clés dans la base de connaissance Coachello (Notion). SEULEMENT quand la page cible n'est pas identifiable via le registre (sinon notion_fetch direct). Vérifie que les résultats appartiennent bien à l'arbre 🧭 DATABASE en les croisant avec le registre avant de les utiliser.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Mots-clés de recherche" },
        limit: { type: "number", description: "Nombre max de résultats (défaut : 10)" },
      },
      required: ["query"],
    },
  },
];

const module_: ToolModule = {
  defs,
  handlers: {
    notion_fetch: async (input, ctx) => {
      if (!isNotionConfigured()) return NOT_CONFIGURED;
      try {
        ctx.onProgress("Reading Notion page...");
        const page = await fetchPageAsMarkdown(input.page_id_or_url as string);
        ctx.onSource({ kind: "notion", title: page.title, url: page.url });
        const CAP = 30000;
        const body = page.markdown || "(page vide)";
        const capped = body.length > CAP
          ? body.slice(0, CAP) + `\n…(page tronquée à ${CAP} caractères ; refetch une sous-page précise pour le détail)`
          : body;
        // La base est rédigée en français et ce contenu arrive après le system,
        // donc juste avant la rédaction : sans rappel, il entraîne la réponse
        // en français même quand la question est dans une autre langue.
        return `# ${page.title}\nURL : ${page.url}\n\n${capped}\n\n(RAPPEL LANGUE : source en français. Ta réponse doit être dans la langue de la question de l'utilisateur : traduis ce contenu, ne le recopie pas.)`;
      } catch (e) {
        return `Erreur Notion : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    },

    notion_search: async (input) => {
      if (!isNotionConfigured()) return NOT_CONFIGURED;
      try {
        const limit = Math.max(1, Math.min(20, Number(input.limit) || 10));
        const hits = await searchNotion(input.query as string, limit);
        if (hits.length === 0) return `Aucune page Notion trouvée pour "${input.query}".`;
        return JSON.stringify(hits);
      } catch (e) {
        return `Erreur Notion search : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    },
  },
};

export const notionTools = module_;
