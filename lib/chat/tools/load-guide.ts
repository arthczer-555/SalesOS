/**
 * Le méta-outil du pattern "manifest" : l'agent charge lui-même les guides
 * détaillés (packs sales, base de connaissance Notion) au moment où il en a
 * besoin. Le tool_result reste dans l'historique : un pack chargé au tour 1
 * est actif toute la conversation, sans rechargement.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { loadGuideBundle } from "../rag/guide-loader";
import type { ToolModule } from "./types";

const defs: Anthropic.Tool[] = [
  {
    name: "load_guide",
    description:
      "Charge un guide interne détaillé (pack). AVANT toute tâche non triviale, charge le ou les packs pertinents du catalogue de ton system prompt (plusieurs load_guide en parallèle si la question est mixte). Obligatoire avant d'utiliser notion_fetch/notion_search : charge d'abord 'notion_knowledge' (registre des pages + règles). Un pack déjà chargé dans la conversation reste actif : ne le recharge pas.",
    input_schema: {
      type: "object" as const,
      properties: {
        pack: { type: "string", description: "Slug du pack à charger, tel que listé dans le catalogue (ex: 'proposals', 'notion_knowledge')" },
      },
      required: ["pack"],
    },
  },
];

const module_: ToolModule = {
  defs,
  handlers: {
    load_guide: async (input, ctx) => {
      const slug = String(input.pack ?? "").trim();
      const bundle = await loadGuideBundle();
      const pack = bundle.packs.get(slug);
      if (!pack) {
        const available = [...bundle.packs.keys()].join(", ");
        return `Pack "${slug}" introuvable. Packs disponibles : ${available}`;
      }
      ctx.onProgress(`Guide chargé : ${slug}`);
      ctx.onSource({ kind: "guide", title: `Guide : ${slug}` });
      const staleNote = bundle.stale
        ? "\n\n(Note : guide servi depuis le snapshot de secours, GitHub était indisponible ; il peut dater de quelques heures.)"
        : "";
      // Les guides sont rédigés en français et arrivent APRÈS le system dans le
      // contexte : sans ce rappel, une question en anglais repart en français.
      const langNote = `\n\n(RAPPEL LANGUE : ce guide est rédigé en français, c'est un document de travail. Ta réponse, elle, doit être INTÉGRALEMENT dans la langue de la question de l'utilisateur. Traduis le contenu utile, ne le recopie pas tel quel.)`;
      return `GUIDE "${slug}" (suis ces instructions pour la suite de la conversation) :\n\n${pack.body}${staleNote}${langNote}`;
    },
  },
};

export const loadGuideTools = module_;
