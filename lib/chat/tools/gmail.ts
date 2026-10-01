/**
 * Outils Gmail de CoachelloAI (extraits de l'ancien lib/chat/core.ts).
 * Boîte de l'utilisateur connecté (OAuth par user, table user_integrations).
 */

import type Anthropic from "@anthropic-ai/sdk";
import { searchGmailMessages, getGmailMessage } from "@/lib/gmail";
import type { ToolModule } from "./types";

const defs: Anthropic.Tool[] = [
  {
    name: "search_gmail",
    description:
      "Recherche des emails dans la boîte Gmail de l'utilisateur connecté. UNIQUEMENT si l'utilisateur demande de chercher dans SES mails. Syntaxe Gmail native (from:, to:, subject:, after:YYYY/MM/DD, has:attachment) ou texte libre. Pas de recherche de masse : max 1-3 lectures par réponse.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Requête Gmail" },
        limit: { type: "number", description: "Nombre max de résultats (défaut : 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_gmail_message",
    description: "Lit le contenu complet d'un email Gmail trouvé via search_gmail.",
    input_schema: {
      type: "object" as const,
      properties: { message_id: { type: "string", description: "ID du message Gmail" } },
      required: ["message_id"],
    },
  },
];

const module_: ToolModule = {
  defs,
  handlers: {
    search_gmail: async (input, ctx) => {
      if (!ctx.userId) return "Gmail non disponible : utilisateur non identifié.";
      try {
        const limit = (input.limit as number) ?? 10;
        const results = await searchGmailMessages(ctx.userId, input.query as string, limit);
        if (results.length === 0) return `Aucun email trouvé pour "${input.query}".`;
        const compact = results.map((r) => ({
          id: r.id, from: r.from, to: r.to, subject: r.subject, date: r.date,
          snippet: (r.snippet || "").slice(0, 300),
        }));
        return JSON.stringify(compact);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "inconnue";
        if (msg.includes("not connected") || msg.includes("token expired")) {
          return "Gmail non connecté pour cet utilisateur. Il doit aller dans Réglages → Connecter Google.";
        }
        return `Erreur Gmail : ${msg}`;
      }
    },

    read_gmail_message: async (input, ctx) => {
      if (!ctx.userId) return "Gmail non disponible : utilisateur non identifié.";
      try {
        const msg = await getGmailMessage(ctx.userId, input.message_id as string);
        ctx.onSource({ kind: "gmail", title: msg.subject || "(sans objet)" });
        return JSON.stringify({
          id: msg.id, from: msg.from, to: msg.to, cc: msg.cc || undefined,
          subject: msg.subject, date: msg.date, body: msg.body.slice(0, 8000),
        });
      } catch (e) {
        const em = e instanceof Error ? e.message : "inconnue";
        if (em.includes("not connected") || em.includes("token expired")) {
          return "Gmail non connecté pour cet utilisateur. Il doit aller dans Réglages → Connecter Google.";
        }
        return `Erreur Gmail : ${em}`;
      }
    },
  },
};

export const gmailTools = module_;
