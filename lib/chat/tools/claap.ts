/**
 * Outils Claap (meetings/calls enregistrés) de CoachelloAI (extraits de core.ts).
 * Les meetings dont le transcript est lu sont émis comme sources pour l'UI.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { searchClaapMeetings, fetchClaapMeetingDetail } from "@/lib/claap";
import { fetchDealContext } from "@/lib/hubspot";
import type { ToolModule } from "./types";

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.fr",
  "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "live.com", "live.fr",
  "msn.com", "protonmail.com", "proton.me", "pm.me",
  "free.fr", "orange.fr", "sfr.fr", "wanadoo.fr", "laposte.net", "bbox.fr",
  "neuf.fr", "aol.com",
]);

const defs: Anthropic.Tool[] = [
  {
    name: "search_claap_meetings",
    description:
      "Recherche des réunions/calls enregistrés sur Claap. RÉFLEXE pour un deal/compte ciblé : liste ses meetings via deal_id même si la question ne parle pas de meetings (les calls font partie de la situation du compte) ; si deal_id ne renvoie rien, retente avec participant_domain ou title_query. En analyse de masse du pipeline, ne PAS appeler deal par deal. Filtres combinables : participant_email, participant_domain (ex: 'acme.com'), title_query (mot du titre), since/until (ISO YYYY-MM-DD), deal_id (HubSpot). Retourne une liste légère (id, titre, date, participants) sans transcript : utilise ensuite get_claap_meeting_transcript pour lire un meeting.",
    input_schema: {
      type: "object" as const,
      properties: {
        participant_email: { type: "string", description: "Email d'un participant exact (ex: 'jean@acme.com')" },
        participant_domain: { type: "string", description: "Domaine email d'un participant (ex: 'acme.com')" },
        title_query: { type: "string", description: "Sous-chaîne à matcher dans le titre du meeting (insensible à la casse)" },
        since: { type: "string", description: "Date ISO de début (ex: '2026-05-01'). Inclusif." },
        until: { type: "string", description: "Date ISO de fin (ex: '2026-05-27'). Inclusif." },
        deal_id: { type: "string", description: "ID HubSpot d'un deal : match automatique via participants + nom company. Combinable avec les autres filtres." },
        limit: { type: "number", description: "Nombre max de résultats (défaut : 20, max : 50)" },
      },
      required: [],
    },
  },
  {
    name: "get_claap_meeting_transcript",
    description:
      "Transcript complet et métadonnées d'un meeting Claap précis (recording_id obtenu via search_claap_meetings, jamais inventé). Les transcripts sont longs : 1 à 2 max par réponse, les plus récents/pertinents. Pour résumer/débriefer, rédige dans la LANGUE du transcript.",
    input_schema: {
      type: "object" as const,
      properties: {
        recording_id: { type: "string", description: "ID Claap du recording (obtenu via search_claap_meetings)" },
      },
      required: ["recording_id"],
    },
  },
];

const module_: ToolModule = {
  defs,
  handlers: {
    search_claap_meetings: async (input, ctx) => {
      if (!process.env.CLAAP_API_TOKEN) {
        return "Erreur : intégration Claap non configurée (CLAAP_API_TOKEN manquant).";
      }
      const dealId = (input.deal_id as string | undefined)?.trim();
      const participantEmail = (input.participant_email as string | undefined)?.trim();
      const participantDomain = (input.participant_domain as string | undefined)?.trim();
      const titleQuery = (input.title_query as string | undefined)?.trim();
      const since = (input.since as string | undefined)?.trim();
      const until = (input.until as string | undefined)?.trim();
      const limit = Math.max(1, Math.min(50, (input.limit as number | undefined) ?? 20));

      try {
        if (dealId) {
          ctx.onProgress(`Searching Claap meetings for deal ${dealId}...`);
          const deal = await fetchDealContext(dealId);
          if (!deal) return `Deal HubSpot ${dealId} introuvable.`;

          const domains = new Set<string>();
          const companyDomain = deal.company?.domain?.toLowerCase().trim();
          if (companyDomain && !PUBLIC_EMAIL_DOMAINS.has(companyDomain)) domains.add(companyDomain);
          for (const c of deal.contacts ?? []) {
            const dom = c.email?.toLowerCase().trim().split("@")[1];
            if (dom && !PUBLIC_EMAIL_DOMAINS.has(dom)) domains.add(dom);
          }
          if (domains.size === 0 && !titleQuery) {
            return JSON.stringify({
              deal_id: dealId,
              deal_name: deal.name,
              count: 0,
              meetings: [],
              note: "Aucun domaine externe trouvé sur le deal (company.domain + contacts.email tous vides ou publics). Précise un title_query ou un participant_email pour matcher.",
            });
          }

          const matches = await searchClaapMeetings({
            participant_domains: Array.from(domains),
            title_query: titleQuery,
            since,
            until,
            limit,
          });
          return JSON.stringify({
            deal_id: dealId,
            deal_name: deal.name,
            domains_used: Array.from(domains),
            count: matches.length,
            meetings: matches,
          });
        }

        ctx.onProgress(`Searching Claap meetings...`);
        const matches = await searchClaapMeetings({
          participant_email: participantEmail,
          participant_domain: participantDomain,
          title_query: titleQuery,
          since,
          until,
          limit,
        });
        return JSON.stringify({ count: matches.length, meetings: matches });
      } catch (e) {
        return `Erreur Claap search : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    },

    get_claap_meeting_transcript: async (input, ctx) => {
      if (!process.env.CLAAP_API_TOKEN) {
        return "Erreur : intégration Claap non configurée (CLAAP_API_TOKEN manquant).";
      }
      const recordingId = (input.recording_id as string | undefined)?.trim();
      if (!recordingId) return "Erreur : recording_id requis.";
      try {
        ctx.onProgress(`Loading Claap transcript ${recordingId}...`);
        const detail = await fetchClaapMeetingDetail(recordingId);
        if (!detail) return `Meeting Claap ${recordingId} introuvable.`;
        const d = detail as { title?: string; name?: string; date?: string; created_at?: string; url?: string; share_url?: string };
        const title = d.title ?? d.name ?? `Meeting ${recordingId}`;
        const date = (d.date ?? d.created_at ?? "").slice(0, 10);
        ctx.onSource({
          kind: "claap",
          title: date ? `${title} (${date})` : title,
          url: d.share_url ?? d.url,
        });
        return JSON.stringify(detail);
      } catch (e) {
        return `Erreur Claap transcript : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    },
  },
};

export const claapTools = module_;
