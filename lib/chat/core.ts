/**
 * Cœur du chatbot CoachelloGPT, extrait de l'ancienne route /api/chat
 * pour être réutilisable depuis :
 *  - la route SSE /api/chat (UI web)
 *  - la Background Function Netlify slack-chat-background (DMs/mentions Slack)
 *
 * Boucle agentic Claude + ~30 outils (HubSpot, Slack, Gmail, Drive, LinkedIn
 * via Netrows, Tavily). Chaque appel charge :
 *  - la clé Claude chiffrée du user (table user_keys)
 *  - son user_prompt perso + le guide global bot + le mapping owners HubSpot
 *
 * On émet des `ChatEvent` via le callback `onEvent` pour que le caller
 * (SSE ou Slack) puisse afficher la progression. On renvoie aussi l'état
 * final (texte + historique) pour persister la conversation.
 */

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { logUsage } from "@/lib/log-usage";
import { DEFAULT_BOT_GUIDE } from "@/lib/guides/bot";
import { searchGmailMessages, getGmailMessage } from "@/lib/gmail";
import { searchClaapMeetings, fetchClaapMeetingDetail } from "@/lib/claap";
import { fetchDealContext } from "@/lib/hubspot";

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.fr",
  "yahoo.com", "yahoo.fr", "icloud.com", "me.com", "live.com", "live.fr",
  "msn.com", "protonmail.com", "proton.me", "pm.me",
  "free.fr", "orange.fr", "sfr.fr", "wanadoo.fr", "laposte.net", "bbox.fr",
  "neuf.fr", "aol.com",
]);
import {
  getProfile,
  searchPeople,
  reverseLookup,
  resolveUsername,
  getPeopleLikes,
  getPeopleActivity,
  getSimilarProfiles,
  getCompanyDetails,
  getCompanyPosts,
  getCompanyJobs,
  searchCompanies,
  searchPosts as netrowsSearchPosts,
  getPostReactions,
  findEmailByLinkedInCached,
  findDecisionMakerEmail,
} from "@/lib/netrows";
import * as XLSX from "xlsx";

// ── Types publics ────────────────────────────────────────────────────────────

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "tool_progress"; message: string }
  | { type: "cost_warning"; cost: number }
  | { type: "history"; messages: Anthropic.MessageParam[] }
  | { type: "done" }
  | { type: "error"; message: string };

export type ChatResult = {
  finalText: string;
  messages: Anthropic.MessageParam[];
  inputTokens: number;
  outputTokens: number;
};

export class ChatAuthError extends Error {
  status: number;
  constructor(message: string, status = 402) {
    super(message);
    this.status = status;
  }
}

// ── Tavily web search helper ─────────────────────────────────────────────────
type TavilyResult = {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
};

async function searchTavily(query: string, days = 30): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: 5,
        days,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []) as TavilyResult[];
  } catch {
    return [];
  }
}

// ── HubSpot helper ────────────────────────────────────────────────────────────
async function hubspot(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`HubSpot ${method} ${path} → ${res.status}`);
  return res.json();
}

// Curated property lists (avoids fetching all 200+ props on every cold start)
const PROPS: Record<string, string[]> = {
  contacts: [
    "firstname", "lastname", "email", "phone", "mobilephone",
    "jobtitle", "company", "industry", "city", "country",
    "lifecyclestage", "hs_lead_status", "hubspot_owner_id",
    "notes_last_contacted", "num_contacted_notes", "createdate",
    "hs_lastmodifieddate", "linkedin_bio", "website", "hs_email_optout",
  ],
  deals: [
    "dealname", "dealstage", "amount", "closedate",
    "hubspot_owner_id", "hs_lastmodifieddate", "createdate",
    "hs_deal_stage_probability", "hs_is_closed_won",
  ],
  companies: [
    "name", "domain", "industry", "city", "country", "phone",
    "numberofemployees", "annualrevenue", "createdate",
    "hs_lastmodifieddate", "description", "type", "website",
  ],
};

function getPropertyNames(objectType: string): string[] {
  return PROPS[objectType] ?? PROPS.contacts;
}

function stripEmpty(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== null && v !== "" && v !== undefined)
  );
}

// ── Slack helper ──────────────────────────────────────────────────────────────
async function slack(path: string, params?: Record<string, string>) {
  const url = new URL(`https://slack.com/api${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${path} → ${data.error}`);
  return data;
}

async function slackAllChannels(): Promise<{ name: string; id: string }[]> {
  const all: { name: string; id: string }[] = [];
  let cursor: string | undefined;
  do {
    const params: Record<string, string> = { limit: "1000", types: "public_channel,private_channel" };
    if (cursor) params.cursor = cursor;
    const data = await slack("/conversations.list", params);
    all.push(...(data.channels ?? []));
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return all;
}

async function slackPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`https://slack.com/api${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${path} → ${data.error}`);
  return data;
}

// ── Google Drive token (shared via env var) ──────────────────────────────────
let _driveAccessToken: string | null = null;
let _driveTokenExpiry = 0;

async function getDriveAccessToken(): Promise<string> {
  if (_driveAccessToken && Date.now() < _driveTokenExpiry) return _driveAccessToken;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!refreshToken) throw new Error("GOOGLE_DRIVE_REFRESH_TOKEN manquant dans .env");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("[Drive] Token refresh failed:", res.status, errBody);
    throw new Error(`Refresh token Drive échoué (${res.status}): ${errBody.slice(0, 100)}`);
  }
  const { access_token, expires_in } = await res.json();
  _driveAccessToken = access_token;
  _driveTokenExpiry = Date.now() + ((expires_in ?? 3600) - 60) * 1000;
  return access_token;
}

// ── Tool definitions ──────────────────────────────────────────────────────────
export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_contacts",
    description: "Recherche des contacts HubSpot par nom, email ou entreprise. Utilise cet outil pour répondre à des questions sur les prospects ou clients.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Texte de recherche (nom, email, société...)" },
        limit: { type: "number", description: "Nombre max de résultats (défaut : 10)" },
        my_contacts_only: { type: "boolean", description: "true = uniquement les contacts de l'utilisateur connecté" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_deals",
    description: "Recherche des deals HubSpot par nom. Utilise cet outil quand on mentionne un deal ou une entreprise spécifique.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Nom du deal ou de l'entreprise à chercher" },
        limit: { type: "number", description: "Nombre max de résultats (défaut : 10)" },
        my_deals_only: { type: "boolean", description: "true = uniquement les deals de l'utilisateur connecté" },
        owner_id: { type: "string", description: "Filtrer par un owner_id spécifique" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_deals",
    description: "Récupère les deals HubSpot en format compact. Utilise cet outil pour avoir la liste du pipeline. Pour les conversations d'un deal, utilise ensuite get_deal_activity.",
    input_schema: {
      type: "object" as const,
      properties: {
        my_deals_only: { type: "boolean", description: "true = uniquement les deals de l'utilisateur connecté" },
        owner_id: { type: "string", description: "Filtrer par un owner_id spécifique (ex: deals de Quentin → son owner_id)" },
      },
      required: [],
    },
  },
  {
    name: "get_companies",
    description: "Récupère les entreprises dans HubSpot. Utilise cet outil pour des questions sur les comptes, les secteurs, les tailles.",
    input_schema: {
      type: "object" as const,
      properties: { limit: { type: "number", description: "Nombre max de résultats (défaut : 20)" } },
      required: [],
    },
  },
  {
    name: "get_contact_details",
    description: "Récupère les détails complets d'un contact HubSpot via son ID.",
    input_schema: {
      type: "object" as const,
      properties: { contact_id: { type: "string", description: "ID HubSpot du contact" } },
      required: ["contact_id"],
    },
  },
  {
    name: "get_contact_activity",
    description: "Récupère l'historique complet d'un contact : notes, emails loggés, appels, réunions.",
    input_schema: {
      type: "object" as const,
      properties: { contact_id: { type: "string", description: "ID HubSpot du contact" } },
      required: ["contact_id"],
    },
  },
  {
    name: "get_deal_activity",
    description: "Récupère les conversations complètes d'un deal : notes, emails, appels, réunions.",
    input_schema: {
      type: "object" as const,
      properties: { deal_id: { type: "string", description: "ID HubSpot du deal" } },
      required: ["deal_id"],
    },
  },
  {
    name: "get_deal_contacts",
    description: "Récupère les contacts associés à un deal HubSpot.",
    input_schema: {
      type: "object" as const,
      properties: { deal_id: { type: "string", description: "ID HubSpot du deal" } },
      required: ["deal_id"],
    },
  },
  {
    name: "search_slack",
    description: "Recherche des messages Slack par mot-clé dans un ou plusieurs canaux.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Mots-clés à rechercher (insensible à la casse)" },
        channels: { type: "array", items: { type: "string" }, description: "Canaux où chercher (sans #)." },
        limit: { type: "number", description: "Nombre de messages à analyser par canal (défaut : 50)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_slack_channel_history",
    description: "Récupère les derniers messages d'un canal Slack.",
    input_schema: {
      type: "object" as const,
      properties: {
        channel_name: { type: "string", description: "Nom du canal sans #" },
        limit: { type: "number", description: "Nombre de messages (défaut : 20)" },
      },
      required: ["channel_name"],
    },
  },
  {
    name: "send_slack_message",
    description: "Envoie un message dans un canal Slack ou en DM à un utilisateur. Toujours demander confirmation avant d'envoyer.",
    input_schema: {
      type: "object" as const,
      properties: {
        channel: { type: "string", description: "Nom du canal sans # (ex: sales) ou email de l'utilisateur pour un DM" },
        message: { type: "string", description: "Contenu du message à envoyer" },
      },
      required: ["channel", "message"],
    },
  },
  {
    name: "web_search",
    description: "Recherche sur le web en temps réel.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Requête de recherche" },
        days: { type: "number", description: "Limiter aux résultats des N derniers jours (défaut : 30)" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_drive",
    description: "Recherche des fichiers dans Google Drive par mots-clés.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Mots-clés de recherche" },
        limit: { type: "number", description: "Nombre max de résultats (défaut : 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_drive_file",
    description: "Lit le contenu textuel d'un fichier Google Drive (Docs, Sheets, Slides exportés en texte). Pour un .xlsx, utilise read_drive_excel.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "ID du fichier Google Drive" },
        mime_type: { type: "string", description: "Type MIME du fichier" },
      },
      required: ["file_id"],
    },
  },
  {
    name: "read_drive_excel",
    description: "Lit un fichier Excel (.xlsx) stocké dans Google Drive.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "ID du fichier Drive (.xlsx)" },
        sheet_name: { type: "string", description: "Nom de l'onglet à lire" },
        range: { type: "string", description: "Plage Excel optionnelle (ex: 'A1:F50')" },
      },
      required: ["file_id"],
    },
  },
  {
    name: "search_gmail",
    description: "Recherche des emails dans la boîte Gmail de l'utilisateur connecté.",
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
    description: "Lit le contenu complet d'un email Gmail.",
    input_schema: {
      type: "object" as const,
      properties: { message_id: { type: "string", description: "ID du message Gmail" } },
      required: ["message_id"],
    },
  },
  {
    name: "list_drive_folder",
    description: "Liste les fichiers d'un dossier Google Drive.",
    input_schema: {
      type: "object" as const,
      properties: {
        folder_id: { type: "string", description: "ID du dossier Drive (défaut : root)" },
        limit: { type: "number", description: "Nombre max de fichiers (défaut : 20)" },
      },
      required: [],
    },
  },
  {
    name: "search_linkedin_people",
    description: "Recherche des profils LinkedIn par entreprise et/ou titre de poste.",
    input_schema: {
      type: "object" as const,
      properties: {
        company: { type: "string" },
        keywordTitle: { type: "string" },
        keywords: { type: "string" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        start: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "get_linkedin_profile",
    description: "Récupère le profil LinkedIn complet d'une personne à partir de son username.",
    input_schema: {
      type: "object" as const,
      properties: {
        username: { type: "string" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        company: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "get_linkedin_profile_by_email",
    description: "Trouve un profil LinkedIn à partir d'un email pro.",
    input_schema: {
      type: "object" as const,
      properties: { email: { type: "string" } },
      required: ["email"],
    },
  },
  {
    name: "get_linkedin_activity",
    description: "Récupère la dernière activité d'un profil LinkedIn.",
    input_schema: {
      type: "object" as const,
      properties: { username: { type: "string" } },
      required: ["username"],
    },
  },
  {
    name: "get_linkedin_likes",
    description: "Liste les posts récemment likés par un profil LinkedIn.",
    input_schema: {
      type: "object" as const,
      properties: { username: { type: "string" }, start: { type: "number" } },
      required: ["username"],
    },
  },
  {
    name: "get_linkedin_posts",
    description: "Liste les derniers posts publiés par un profil LinkedIn.",
    input_schema: {
      type: "object" as const,
      properties: { username: { type: "string" } },
      required: ["username"],
    },
  },
  {
    name: "get_linkedin_similar_profiles",
    description: "Trouve des profils LinkedIn similaires à un profil donné.",
    input_schema: {
      type: "object" as const,
      properties: { username: { type: "string" } },
      required: ["username"],
    },
  },
  {
    name: "get_linkedin_company",
    description: "Détails d'une entreprise LinkedIn (effectifs, secteur, siège, followers).",
    input_schema: {
      type: "object" as const,
      properties: { username: { type: "string" } },
      required: ["username"],
    },
  },
  {
    name: "get_linkedin_company_posts",
    description: "Derniers posts publiés par une page entreprise LinkedIn.",
    input_schema: {
      type: "object" as const,
      properties: { username: { type: "string" }, start: { type: "number" } },
      required: ["username"],
    },
  },
  {
    name: "get_linkedin_company_jobs",
    description: "Offres d'emploi actives publiées par une entreprise sur LinkedIn.",
    input_schema: {
      type: "object" as const,
      properties: { company_id: { type: "string" }, page: { type: "number" } },
      required: ["company_id"],
    },
  },
  {
    name: "search_linkedin_companies",
    description: "Recherche d'entreprises sur LinkedIn par mots-clés / industrie / taille.",
    input_schema: {
      type: "object" as const,
      properties: { keyword: { type: "string" }, industry: { type: "string" }, size: { type: "string" } },
      required: ["keyword"],
    },
  },
  {
    name: "search_linkedin_posts",
    description: "Recherche de posts LinkedIn par mot-clé.",
    input_schema: {
      type: "object" as const,
      properties: {
        keyword: { type: "string" },
        sortBy: { type: "string" },
        datePosted: { type: "string" },
      },
      required: ["keyword"],
    },
  },
  {
    name: "get_linkedin_post_reactions",
    description: "Liste les profils LinkedIn qui ont réagi à un post donné.",
    input_schema: {
      type: "object" as const,
      properties: { post_url: { type: "string" }, start: { type: "number" } },
      required: ["post_url"],
    },
  },
  {
    name: "find_email_by_linkedin",
    description: "Trouve l'email pro d'une personne via son username LinkedIn (5 crédits).",
    input_schema: {
      type: "object" as const,
      properties: { username: { type: "string" } },
      required: ["username"],
    },
  },
  {
    name: "find_decision_maker_email",
    description: "Trouve l'email du décideur d'une entreprise donnée (10 crédits).",
    input_schema: {
      type: "object" as const,
      properties: { company: { type: "string" }, title: { type: "string" } },
      required: ["company", "title"],
    },
  },
  {
    name: "search_claap_meetings",
    description:
      "Recherche des réunions/calls enregistrés sur Claap. Filtres combinables : participant_email, participant_domain (ex: 'acme.com'), title_query (mot dans le titre), since/until (ISO date YYYY-MM-DD), deal_id (HubSpot, matche meetings via participants + nom company). Retourne une liste légère (id, titre, date, participants) sans transcript. Utilise ensuite get_claap_meeting_transcript pour récupérer le contenu d'un meeting précis.",
    input_schema: {
      type: "object" as const,
      properties: {
        participant_email: { type: "string", description: "Email d'un participant exact (ex: 'jean@acme.com')" },
        participant_domain: { type: "string", description: "Domaine email d'un participant (ex: 'acme.com')" },
        title_query: { type: "string", description: "Sous-chaîne à matcher dans le titre du meeting (insensible à la casse)" },
        since: { type: "string", description: "Date ISO de début (ex: '2026-05-01'). Inclusif." },
        until: { type: "string", description: "Date ISO de fin (ex: '2026-05-27'). Inclusif." },
        deal_id: { type: "string", description: "ID HubSpot d'un deal : match automatique via participants + nom company (réutilise la logique de la fiche client). Combinable avec les autres filtres pour restreindre encore." },
        limit: { type: "number", description: "Nombre max de résultats (défaut : 20, max : 50)" },
      },
      required: [],
    },
  },
  {
    name: "get_claap_meeting_transcript",
    description:
      "Récupère le transcript complet et les métadonnées d'un meeting Claap précis. Utilise cet outil après search_claap_meetings pour lire/résumer/citer le contenu d'un call. Le transcript peut être long : ne demande qu'un meeting à la fois.",
    input_schema: {
      type: "object" as const,
      properties: {
        recording_id: { type: "string", description: "ID Claap du recording (obtenu via search_claap_meetings)" },
      },
      required: ["recording_id"],
    },
  },
];

// ── Tool execution ────────────────────────────────────────────────────────────
async function executeTool(
  name: string,
  input: Record<string, unknown>,
  onProgress: (msg: string) => void,
  userOwnerId: string | null,
  userId: string,
): Promise<string> {
  switch (name) {
    case "search_contacts": {
      const props = getPropertyNames("contacts");
      const filters: { propertyName: string; operator: string; value: string }[] = [];
      if (input.my_contacts_only && userOwnerId) {
        filters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: userOwnerId });
      }
      const data = await hubspot("/crm/v3/objects/contacts/search", "POST", {
        query: input.query,
        limit: input.limit || 10,
        properties: props,
        ...(filters.length ? { filterGroups: [{ filters }] } : {}),
      });
      const results = (data.results ?? []).map((r: { id: string; properties: Record<string, unknown> }) => ({
        id: r.id,
        properties: stripEmpty(r.properties),
      }));
      return JSON.stringify(results);
    }
    case "search_deals": {
      const props = getPropertyNames("deals");
      const filters: { propertyName: string; operator: string; value: string }[] = [];
      const dealOwnerId = input.owner_id as string | undefined
        ?? (input.my_deals_only && userOwnerId ? userOwnerId : undefined);
      if (dealOwnerId) {
        filters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: dealOwnerId });
      }
      const data = await hubspot("/crm/v3/objects/deals/search", "POST", {
        query: input.query,
        limit: input.limit || 10,
        properties: props,
        ...(filters.length ? { filterGroups: [{ filters }] } : {}),
      });
      const results = (data.results ?? []).map((r: { id: string; properties: Record<string, unknown> }) => ({
        id: r.id,
        properties: stripEmpty(r.properties),
      }));
      return JSON.stringify(results);
    }
    case "get_deals": {
      const props = getPropertyNames("deals");
      const allResults: { id: string; properties: Record<string, unknown> }[] = [];
      let after: string | undefined;
      const MAX_PAGES = 50;
      let pages = 0;
      let truncated = false;
      const filterId = input.owner_id as string | undefined
        ?? (input.my_deals_only && userOwnerId ? userOwnerId : undefined);
      const ownerFilter = filterId
        ? [{ propertyName: "hubspot_owner_id", operator: "EQ", value: filterId }]
        : [];
      onProgress(`Récupération des deals... 0 chargés`);
      do {
        const data = await hubspot("/crm/v3/objects/deals/search", "POST", {
          ...(ownerFilter.length ? { filterGroups: [{ filters: ownerFilter }] } : {}),
          sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
          limit: 200,
          ...(after ? { after } : {}),
          properties: props,
        });
        for (const r of (data.results ?? []) as { id: string; properties: Record<string, string> }[]) {
          allResults.push({ id: r.id, properties: r.properties } as { id: string; properties: Record<string, unknown> });
        }
        after = (data.paging as { next?: { after?: string } } | undefined)?.next?.after;
        pages++;
        onProgress(`Récupération des deals... ${allResults.length} chargés${after ? " (suite...)" : ""}`);
        if (pages >= MAX_PAGES && after) { truncated = true; break; }
      } while (after);
      const note = truncated
        ? `⚠️ Résultats partiels : ${allResults.length} deals (limite atteinte).`
        : `✅ ${allResults.length} deals récupérés.`;
      const compact = (allResults as { id: string; properties: Record<string, string> }[]).map((d) => {
        const p = d.properties;
        const date = p.createdate ? p.createdate.slice(0, 10) : "";
        const close = p.closedate ? p.closedate.slice(0, 10) : "";
        const won = p.hs_is_closed_won === "true" ? "won" : (p.dealstage === "closedlost" ? "lost" : "open");
        return `${d.id}|${p.dealname ?? ""}|${p.dealstage ?? ""}|${p.amount ?? ""}€|${date}|${close}|${won}`;
      }).join("\n");
      return `${note}\nformat: id|nom|stage|montant|createdate|closedate|statut\nPour obtenir les conversations d'un deal, utilise get_deal_activity avec son id.\n${compact}`;
    }
    case "get_companies": {
      const props = getPropertyNames("companies");
      const data = await hubspot(
        `/crm/v3/objects/companies?limit=${input.limit || 20}&properties=${props.join(",")}`
      );
      const results = (data.results ?? []).map((r: { id: string; properties: Record<string, unknown> }) => ({
        id: r.id,
        properties: stripEmpty(r.properties),
      }));
      return JSON.stringify(results);
    }
    case "get_contact_details": {
      const props = getPropertyNames("contacts");
      const data = await hubspot(`/crm/v3/objects/contacts/${input.contact_id}?properties=${props.join(",")}`);
      return JSON.stringify({ id: data.id, properties: stripEmpty(data.properties) });
    }
    case "get_contact_activity": {
      const [notes, emails, calls, meetings] = await Promise.allSettled([
        hubspot(`/crm/v3/objects/notes/search`, "POST", {
          filterGroups: [{ filters: [{ propertyName: "associations.contact", operator: "EQ", value: input.contact_id }] }],
          properties: ["hs_note_body", "hs_timestamp", "hubspot_owner_id"],
          limit: 10,
        }),
        hubspot(`/crm/v3/objects/emails/search`, "POST", {
          filterGroups: [{ filters: [{ propertyName: "associations.contact", operator: "EQ", value: input.contact_id }] }],
          properties: ["hs_email_subject", "hs_email_text", "hs_timestamp", "hs_email_direction"],
          limit: 10,
        }),
        hubspot(`/crm/v3/objects/calls/search`, "POST", {
          filterGroups: [{ filters: [{ propertyName: "associations.contact", operator: "EQ", value: input.contact_id }] }],
          properties: ["hs_call_title", "hs_call_body", "hs_timestamp", "hs_call_duration", "hs_call_disposition"],
          limit: 10,
        }),
        hubspot(`/crm/v3/objects/meetings/search`, "POST", {
          filterGroups: [{ filters: [{ propertyName: "associations.contact", operator: "EQ", value: input.contact_id }] }],
          properties: ["hs_meeting_title", "hs_meeting_body", "hs_timestamp", "hs_meeting_outcome"],
          limit: 10,
        }),
      ]);
      return JSON.stringify({
        notes: notes.status === "fulfilled" ? notes.value.results ?? [] : [],
        emails: emails.status === "fulfilled" ? emails.value.results ?? [] : [],
        calls: calls.status === "fulfilled" ? calls.value.results ?? [] : [],
        meetings: meetings.status === "fulfilled" ? meetings.value.results ?? [] : [],
      });
    }
    case "get_deal_activity": {
      const T = 1500;
      const [notes, emails, calls, meetings] = await Promise.allSettled([
        hubspot(`/crm/v3/objects/notes/search`, "POST", {
          filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: input.deal_id }] }],
          properties: ["hs_note_body", "hs_timestamp"],
          sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
          limit: 8,
        }),
        hubspot(`/crm/v3/objects/emails/search`, "POST", {
          filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: input.deal_id }] }],
          properties: ["hs_email_subject", "hs_email_text", "hs_timestamp", "hs_email_direction"],
          sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
          limit: 5,
        }),
        hubspot(`/crm/v3/objects/calls/search`, "POST", {
          filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: input.deal_id }] }],
          properties: ["hs_call_title", "hs_call_body", "hs_timestamp", "hs_call_disposition"],
          sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
          limit: 5,
        }),
        hubspot(`/crm/v3/objects/meetings/search`, "POST", {
          filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: input.deal_id }] }],
          properties: ["hs_meeting_title", "hs_meeting_body", "hs_timestamp", "hs_meeting_outcome"],
          sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
          limit: 5,
        }),
      ]);
      const trunc = (s: string | undefined) => (s ?? "").slice(0, T);
      const fmt = (r: { properties: Record<string, string> }) => {
        const p = r.properties;
        const date = p.hs_timestamp ? new Date(p.hs_timestamp).toLocaleDateString("fr-FR") : "";
        return {
          date,
          note: p.hs_note_body ? trunc(p.hs_note_body) : undefined,
          subject: p.hs_email_subject,
          text: p.hs_email_text ? trunc(p.hs_email_text) : undefined,
          direction: p.hs_email_direction,
          call: p.hs_call_title,
          body: p.hs_call_body ? trunc(p.hs_call_body) : undefined,
          meeting: p.hs_meeting_title,
          outcome: p.hs_meeting_outcome,
          summary: p.hs_meeting_body ? trunc(p.hs_meeting_body) : undefined,
        };
      };
      return JSON.stringify({
        notes: notes.status === "fulfilled" ? (notes.value.results ?? []).map(fmt) : [],
        emails: emails.status === "fulfilled" ? (emails.value.results ?? []).map(fmt) : [],
        calls: calls.status === "fulfilled" ? (calls.value.results ?? []).map(fmt) : [],
        meetings: meetings.status === "fulfilled" ? (meetings.value.results ?? []).map(fmt) : [],
      });
    }
    case "get_deal_contacts": {
      const data = await hubspot(`/crm/v3/objects/deals/${input.deal_id}/associations/contacts`);
      if (!data.results?.length) return "[]";
      const contacts = await Promise.all(
        data.results.slice(0, 10).map((a: { id: string }) =>
          hubspot(`/crm/v3/objects/contacts/${a.id}?properties=firstname,lastname,email,jobtitle,phone`)
        )
      );
      return JSON.stringify(contacts);
    }
    case "search_slack": {
      const query = (input.query as string).toLowerCase();
      const targetChannels = (input.channels as string[] | undefined)?.length
        ? input.channels as string[]
        : ["general", "1y-new-meetings", "1a-new-incoming-leads", "10-sales-intelligence", "11-everything-prospects", "12-everything-clients"];
      const perChannelLimit = String(input.limit ?? 50);
      const allChannels = await slackAllChannels();
      const channelMap = new Map(allChannels.map((c) => [c.name, c.id]));
      const results: { channel: string; text: string; user: string; timestamp: string }[] = [];
      await Promise.allSettled(targetChannels.map(async (chName) => {
        const chId = channelMap.get(chName.replace("#", ""));
        if (!chId) return;
        try {
          const histData = await slack("/conversations.history", { channel: chId, limit: perChannelLimit });
          const userIds = [...new Set((histData.messages ?? []).map((m: { user?: string }) => m.user).filter(Boolean))] as string[];
          const userMap: Record<string, string> = {};
          await Promise.allSettled(userIds.map(async (uid) => {
            try { const u = await slack("/users.info", { user: uid }); userMap[uid] = u.user?.real_name ?? uid; } catch { userMap[uid] = uid; }
          }));
          for (const m of (histData.messages ?? []) as { text: string; ts: string; user?: string }[]) {
            if (m.text?.toLowerCase().includes(query)) {
              results.push({
                channel: chName,
                text: m.text,
                user: m.user ? (userMap[m.user] ?? m.user) : "bot",
                timestamp: new Date(parseFloat(m.ts) * 1000).toISOString(),
              });
            }
          }
        } catch { /* canal inaccessible */ }
      }));
      if (results.length === 0) return `Aucun message contenant "${input.query}" trouvé dans les canaux consultés.`;
      return JSON.stringify(results);
    }
    case "get_slack_channel_history": {
      const allChannels = await slackAllChannels();
      const searched = (input.channel_name as string).replace("#", "");
      const channel = allChannels.find((c) => c.name === searched);
      if (!channel) {
        const available = allChannels.map((c) => c.name).sort().join(", ");
        return `Canal "${searched}" introuvable. Canaux accessibles : ${available}`;
      }
      const histData = await slack("/conversations.history", {
        channel: channel.id,
        limit: String(input.limit ?? 20),
      });
      const userIds = [...new Set((histData.messages ?? []).map((m: { user?: string }) => m.user).filter(Boolean))] as string[];
      const userMap: Record<string, string> = {};
      await Promise.all(userIds.map(async (uid) => {
        try {
          const u = await slack("/users.info", { user: uid });
          userMap[uid] = u.user?.real_name ?? u.user?.name ?? uid;
        } catch { userMap[uid] = uid; }
      }));
      const messages = (histData.messages ?? []).map((m: { text: string; ts: string; user?: string }) => ({
        text: m.text,
        user: m.user ? (userMap[m.user] ?? m.user) : "bot",
        timestamp: new Date(parseFloat(m.ts) * 1000).toISOString(),
      }));
      return JSON.stringify({ channel: channel.name, messages });
    }
    case "send_slack_message": {
      const target = input.channel as string;
      let channelId = target;
      if (target.includes("@")) {
        const usersData = await slack("/users.lookupByEmail", { email: target });
        const userId = usersData.user?.id;
        if (!userId) return `Utilisateur avec l'email "${target}" introuvable dans Slack.`;
        const dmData = await slackPost("/conversations.open", { users: userId });
        channelId = dmData.channel?.id;
      } else {
        const allChs = await slackAllChannels();
        const ch = allChs.find((c) => c.name === target.replace("#", ""));
        if (!ch) return `Canal "${target}" introuvable.`;
        channelId = ch.id;
      }
      await slackPost("/chat.postMessage", { channel: channelId, text: input.message as string });
      return `Message envoyé dans "${target}".`;
    }
    case "web_search": {
      const results = await searchTavily(input.query as string, (input.days as number) ?? 30);
      if (results.length === 0) return "Aucun résultat trouvé pour cette recherche.";
      return JSON.stringify(results.map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content.slice(0, 1000),
        date: r.published_date,
      })));
    }
    case "search_drive": {
      try {
        const token = await getDriveAccessToken();
        const q = encodeURIComponent(`fullText contains '${(input.query as string).replace(/'/g, "\\'")}'`);
        const limit = (input.limit as number) || 10;
        const url = `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=${limit}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&orderBy=modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          throw new Error(`Drive API ${res.status}: ${err.slice(0, 200)}`);
        }
        const data = await res.json();
        const files = (data.files ?? []).map((f: { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink: string }) => ({
          id: f.id, name: f.name, type: f.mimeType, modified: f.modifiedTime?.slice(0, 10), link: f.webViewLink,
        }));
        if (files.length === 0) return `Aucun fichier trouvé pour "${input.query}".`;
        return JSON.stringify(files);
      } catch (e) {
        return `Erreur Drive : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    case "read_drive_file": {
      try {
        const token = await getDriveAccessToken();
        const fileId = input.file_id as string;
        const mime = (input.mime_type as string) ?? "";
        let url: string;
        if (mime.startsWith("application/vnd.google-apps.")) {
          url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`;
        } else {
          url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
        }
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          throw new Error(`Drive API ${res.status}: ${err.slice(0, 200)}`);
        }
        const text = await res.text();
        return text.slice(0, 8000);
      } catch (e) {
        return `Erreur lecture Drive : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    case "read_drive_excel": {
      try {
        const token = await getDriveAccessToken();
        const fileId = input.file_id as string;
        const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          throw new Error(`Drive API ${res.status}: ${err.slice(0, 200)}`);
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        const wb = XLSX.read(buf, { type: "array" });
        const sheetName = input.sheet_name as string | undefined;
        if (!sheetName) {
          const sheets = wb.SheetNames.map((n) => {
            const ws = wb.Sheets[n];
            const ref = ws["!ref"] ?? "";
            const range = ref ? XLSX.utils.decode_range(ref) : null;
            return { name: n, rows: range ? range.e.r - range.s.r + 1 : 0, cols: range ? range.e.c - range.s.c + 1 : 0, range: ref };
          });
          return JSON.stringify({ sheets, hint: "Rappelle read_drive_excel avec 'sheet_name' pour lire un onglet." });
        }
        const ws = wb.Sheets[sheetName];
        if (!ws) return `Onglet introuvable. Onglets disponibles : ${wb.SheetNames.join(", ")}`;
        const csv = XLSX.utils.sheet_to_csv(ws, { strip: true, ...(input.range ? { range: input.range as string } : {}) });
        const cap = 12000;
        return csv.length > cap ? csv.slice(0, cap) + `\n…(tronqué à ${cap} caractères)` : csv;
      } catch (e) {
        return `Erreur lecture Excel : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    case "search_gmail": {
      if (!userId) return "Gmail non disponible : utilisateur non identifié.";
      try {
        const limit = (input.limit as number) ?? 10;
        const results = await searchGmailMessages(userId, input.query as string, limit);
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
    }
    case "read_gmail_message": {
      if (!userId) return "Gmail non disponible : utilisateur non identifié.";
      try {
        const msg = await getGmailMessage(userId, input.message_id as string);
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
    }
    case "list_drive_folder": {
      try {
        const token = await getDriveAccessToken();
        const folderId = (input.folder_id as string) || "root";
        const limit = (input.limit as number) || 20;
        const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=${limit}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&orderBy=modifiedTime desc`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          throw new Error(`Drive API ${res.status}: ${err.slice(0, 200)}`);
        }
        const data = await res.json();
        const files = (data.files ?? []).map((f: { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink: string }) => {
          const isFolder = f.mimeType === "application/vnd.google-apps.folder";
          return { id: f.id, name: f.name, type: isFolder ? "dossier" : f.mimeType, modified: f.modifiedTime?.slice(0, 10), link: f.webViewLink };
        });
        if (files.length === 0) return "Dossier vide.";
        return JSON.stringify(files);
      } catch (e) {
        return `Erreur Drive : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    case "search_linkedin_people": {
      try {
        const r = await searchPeople({
          company: input.company as string | undefined,
          keywordTitle: input.keywordTitle as string | undefined,
          keywords: input.keywords as string | undefined,
          firstName: input.firstName as string | undefined,
          lastName: input.lastName as string | undefined,
          start: input.start as number | undefined,
        });
        const items = r.data?.items ?? [];
        if (items.length === 0) return "Aucun profil trouvé.";
        return JSON.stringify(items.slice(0, 20));
      } catch (e) {
        return `Erreur LinkedIn search : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    case "get_linkedin_profile": {
      try {
        const username = await resolveUsername({
          username: input.username as string | undefined,
          firstName: input.firstName as string | undefined,
          lastName: input.lastName as string | undefined,
          company: input.company as string | undefined,
        });
        if (!username) return "Aucun username LinkedIn trouvé. Précise le nom complet et l'entreprise.";
        const profile = await getProfile(username);
        return JSON.stringify({
          username: profile.username,
          name: `${profile.firstName} ${profile.lastName}`,
          headline: profile.headline,
          summary: (profile.summary ?? "").slice(0, 600),
          location: profile.geo?.city ? `${profile.geo.city}, ${profile.geo.country}` : profile.geo?.country,
          positions: (profile.position ?? []).slice(0, 5).map((p) => ({
            company: p.companyName, title: p.title,
            start: p.start ? `${p.start.year}-${String(p.start.month ?? 1).padStart(2, "0")}` : null,
            end: p.end?.year ? `${p.end.year}-${String(p.end.month ?? 1).padStart(2, "0")}` : "actuel",
          })),
          skills: (profile.skills ?? []).slice(0, 15).map((s) => s.name),
          education: (profile.educations ?? []).slice(0, 3).map((e) => `${e.schoolName} — ${e.degree ?? ""} ${e.fieldOfStudy ?? ""}`.trim()),
        });
      } catch (e) {
        return `Erreur LinkedIn profile : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    case "get_linkedin_profile_by_email": {
      try {
        const r = await reverseLookup(input.email as string);
        if (!r.found) return "Aucun profil LinkedIn associé à cet email.";
        return JSON.stringify(r.profile);
      } catch (e) {
        return `Erreur LinkedIn reverse lookup : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    case "get_linkedin_activity": {
      try { const r = await getPeopleActivity(input.username as string); return JSON.stringify(r.data ?? []); }
      catch (e) { return `Erreur LinkedIn activity : ${e instanceof Error ? e.message : "inconnue"}`; }
    }
    case "get_linkedin_likes": {
      try { const r = await getPeopleLikes(input.username as string, (input.start as number | undefined) ?? 0); return JSON.stringify((r.data ?? []).slice(0, 15)); }
      catch (e) { return `Erreur LinkedIn likes : ${e instanceof Error ? e.message : "inconnue"}`; }
    }
    case "get_linkedin_posts": {
      try { const r = await getPeopleActivity(input.username as string); return JSON.stringify(r.data ?? []); }
      catch (e) { return `Erreur LinkedIn posts : ${e instanceof Error ? e.message : "inconnue"}`; }
    }
    case "get_linkedin_similar_profiles": {
      try { const r = await getSimilarProfiles(input.username as string); return JSON.stringify((r.data ?? []).slice(0, 15)); }
      catch (e) { return `Erreur LinkedIn similar : ${e instanceof Error ? e.message : "inconnue"}`; }
    }
    case "get_linkedin_company": {
      try { const c = await getCompanyDetails(input.username as string); return JSON.stringify(c); }
      catch (e) { return `Erreur LinkedIn company : ${e instanceof Error ? e.message : "inconnue"}`; }
    }
    case "get_linkedin_company_posts": {
      try { const r = await getCompanyPosts(input.username as string, (input.start as number | undefined) ?? 0); return JSON.stringify((r.data ?? []).slice(0, 10)); }
      catch (e) { return `Erreur LinkedIn company posts : ${e instanceof Error ? e.message : "inconnue"}`; }
    }
    case "get_linkedin_company_jobs": {
      try { const r = await getCompanyJobs(input.company_id as string, (input.page as number | undefined) ?? 1); return JSON.stringify(r.data ?? []); }
      catch (e) { return `Erreur LinkedIn jobs : ${e instanceof Error ? e.message : "inconnue"}`; }
    }
    case "search_linkedin_companies": {
      try {
        const r = await searchCompanies({
          keyword: input.keyword as string,
          industry: input.industry as string | undefined,
          size: input.size as string | undefined,
        });
        return JSON.stringify((r.data?.items ?? []).slice(0, 20));
      } catch (e) { return `Erreur LinkedIn search companies : ${e instanceof Error ? e.message : "inconnue"}`; }
    }
    case "search_linkedin_posts": {
      try {
        const r = await netrowsSearchPosts(
          input.keyword as string,
          (input.sortBy as string | undefined) ?? "date_posted",
          (input.datePosted as string | undefined) ?? ""
        );
        return JSON.stringify((r.data ?? []).slice(0, 15).map((p) => ({
          author: p.author?.name,
          headline: p.author?.headline,
          posted: p.postedAt,
          text: (p.text ?? "").slice(0, 400),
          url: p.postUrl,
          stats: { likes: p.likes, comments: p.comments },
        })));
      } catch (e) { return `Erreur LinkedIn search posts : ${e instanceof Error ? e.message : "inconnue"}`; }
    }
    case "get_linkedin_post_reactions": {
      try { const r = await getPostReactions(input.post_url as string, (input.start as number | undefined) ?? 0); return JSON.stringify((r.data ?? []).slice(0, 30)); }
      catch (e) { return `Erreur LinkedIn reactions : ${e instanceof Error ? e.message : "inconnue"}`; }
    }
    case "find_email_by_linkedin": {
      try { const r = await findEmailByLinkedInCached(input.username as string); return JSON.stringify({ email: r.email, confidence: r.confidence }); }
      catch (e) { return `Erreur email finder : ${e instanceof Error ? e.message : "inconnue"}`; }
    }
    case "find_decision_maker_email": {
      try { const r = await findDecisionMakerEmail({ company: input.company as string, title: input.title as string }); return JSON.stringify(r.data ?? { email: null }); }
      catch (e) { return `Erreur decision maker : ${e instanceof Error ? e.message : "inconnue"}`; }
    }
    case "search_claap_meetings": {
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
          onProgress(`Recherche des meetings Claap du deal ${dealId}...`);
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

        onProgress(`Recherche dans les meetings Claap...`);
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
    }
    case "get_claap_meeting_transcript": {
      if (!process.env.CLAAP_API_TOKEN) {
        return "Erreur : intégration Claap non configurée (CLAAP_API_TOKEN manquant).";
      }
      const recordingId = (input.recording_id as string | undefined)?.trim();
      if (!recordingId) return "Erreur : recording_id requis.";
      try {
        onProgress(`Chargement du transcript Claap ${recordingId}...`);
        const detail = await fetchClaapMeetingDetail(recordingId);
        if (!detail) return `Meeting Claap ${recordingId} introuvable.`;
        return JSON.stringify(detail);
      } catch (e) {
        return `Erreur Claap transcript : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    default:
      return "Outil inconnu.";
  }
}

// ── runChat : cœur agentic réutilisable ──────────────────────────────────────

/**
 * Lance la boucle agentic Claude pour un user donné, sur l'historique fourni.
 * Émet des `ChatEvent` au caller via `onEvent` (utile pour streaming SSE ou
 * pour les updates progressives Slack). Renvoie l'état final (texte +
 * historique complet incluant les tool calls) pour persistance.
 *
 * Lève `ChatAuthError` si la clé Claude n'est pas configurée pour ce user
 * (status 402 = payment required, repris tel quel par la route SSE).
 */
export async function runChat(args: {
  userId: string;
  messages: Anthropic.MessageParam[];
  onEvent?: (event: ChatEvent) => void;
  /**
   * Nom du canal Slack d'où vient la question (sans le `#`). Permet à
   * CoachelloGPT de déduire le client/compte par défaut quand la question ne
   * le précise pas (ex: question posée dans #engie → compte Engie).
   */
  channelName?: string;
}): Promise<ChatResult> {
  const { userId, messages, onEvent, channelName } = args;
  const emit = onEvent ?? (() => {});

  // 1) Charger la clé Claude chiffrée (ou fallback .env en dev)
  let claudeApiKey: string;
  if (process.env.SUPABASE_URL) {
    const { data: keyRow } = await db
      .from("user_keys")
      .select("encrypted_key, iv, auth_tag, is_active")
      .eq("user_id", userId)
      .eq("service", "claude")
      .single();
    if (!keyRow?.is_active) {
      throw new ChatAuthError("Ton accès Claude n'est pas encore configuré. Contacte Arthur.", 402);
    }
    claudeApiKey = decrypt({
      encryptedKey: keyRow.encrypted_key,
      iv: keyRow.iv,
      authTag: keyRow.auth_tag,
    });
  } else {
    claudeApiKey = process.env.ANTHROPIC_API_KEY ?? "";
  }

  const client = new Anthropic({ apiKey: claudeApiKey });

  // 2) Charger user_prompt + guide bot global + model préf + owner_id + email/nom
  let systemPrompt: string;
  let chatModel = "claude-haiku-4-5-20251001";
  let userOwnerId: string | null = null;
  let userDisplay = userId;
  if (process.env.SUPABASE_URL) {
    const [{ data: userData }, { data: globalGuide }, { data: globalModelEntry }, { data: ownerRow }] = await Promise.all([
      db.from("users").select("user_prompt, email, name").eq("id", userId).single(),
      db.from("guide_defaults").select("content").eq("key", "bot").single(),
      db.from("guide_defaults").select("content").eq("key", "model_preferences").single(),
      db.from("users").select("hubspot_owner_id").eq("id", userId).single(),
    ]);
    const adminGuide = globalGuide?.content ?? DEFAULT_BOT_GUIDE;
    const userInstructions = userData?.user_prompt?.trim() ?? "";
    systemPrompt = userInstructions
      ? `${adminGuide}\n\n--- INSTRUCTIONS PERSONNELLES DE L'UTILISATEUR ---\n${userInstructions}`
      : adminGuide;
    userOwnerId = ownerRow?.hubspot_owner_id ?? null;
    userDisplay = userData?.name ?? userData?.email ?? userId;
    try { if (globalModelEntry?.content) chatModel = (JSON.parse(globalModelEntry.content) as Record<string, string>).chat ?? chatModel; } catch { /* keep default */ }
  } else {
    systemPrompt = DEFAULT_BOT_GUIDE;
  }

  // 3) Owners HubSpot pour résoudre "deals de Quentin" → owner_id
  let ownersMap: { id: string; name: string; email: string }[] = [];
  try {
    const ownersData = await hubspot("/crm/v3/owners?limit=100");
    ownersMap = (ownersData.results ?? []).map((o: { id: string; firstName?: string; lastName?: string; email?: string }) => ({
      id: o.id,
      name: [o.firstName, o.lastName].filter(Boolean).join(" "),
      email: o.email ?? "",
    }));
  } catch { /* owners fetch failed */ }

  const teamLines = ownersMap.map((o) => `- ${o.name} (owner_id: ${o.id}, ${o.email})`).join("\n");
  systemPrompt += `\n\nCONTEXTE UTILISATEUR\nL'utilisateur connecté est ${userDisplay}${userOwnerId ? ` (HubSpot owner ID : ${userOwnerId})` : ""}.\nQuand il dit "mes deals" → utilise my_deals_only: true.\nQuand il dit "les deals de [prénom]" → résous le prénom ci-dessous et utilise owner_id.\n\nÉQUIPE COMMERCIALE (owners HubSpot) :\n${teamLines || "Aucun owner trouvé"}\n\nRÈGLES IMPORTANTES :\n- "les deals de Quentin" → trouver l'owner_id de Quentin dans la liste ci-dessus, puis get_deals avec owner_id\n- "deals perdu" ou "deals lost" = stage closedlost\n- "deals gagné" ou "deals won" = stage closedwon\n- Ne JAMAIS chercher un commercial comme un contact — ce sont des owners\n- Ne pose AUCUNE question de clarification — déduis du contexte`;

  systemPrompt += `\n\nCAPACITÉS LINKEDIN (Netrows)\nTu as accès à l'API LinkedIn pour enrichir tes réponses :\n\n• Profils :\n  - search_linkedin_people : trouver une personne par entreprise + titre\n  - get_linkedin_profile : profil complet — fallback automatique nom+entreprise si pas d'username\n  - get_linkedin_profile_by_email : reverse lookup email → profil\n  - get_linkedin_activity / get_linkedin_likes / get_linkedin_posts\n  - get_linkedin_similar_profiles\n\n• Entreprises :\n  - get_linkedin_company / get_linkedin_company_posts / get_linkedin_company_jobs\n  - search_linkedin_companies\n\n• Posts :\n  - search_linkedin_posts / get_linkedin_post_reactions\n\n• Emails :\n  - find_email_by_linkedin (5 crédits) / find_decision_maker_email (10 crédits)`;

  // Contexte canal : la question est posée dans un canal Slack précis. Si ce
  // canal est dédié à un client/compte (ex: #engie) et que le périmètre n'est
  // pas précisé, on NE déduit PAS le compte tout seul : on demande d'abord à
  // l'utilisateur s'il veut qu'on cherche uniquement sur ce compte ou partout.
  // Seule exception à la règle "ne pose aucune question de clarification".
  if (channelName) {
    systemPrompt += `\n\nCONTEXTE CANAL SLACK\nCette conversation a lieu dans le canal Slack #${channelName}. Tu sais donc toujours où tu te trouves : sers-toi de ce nom dans ta question.\nSi ce canal semble dédié à un client ou un compte précis (ex: #engie → Engie, #adyen → Adyen, #salomon → Salomon) et que la question ne précise pas le périmètre, NE déduis PAS le compte tout seul : pose d'abord une question courte qui cite le canal, du type « Je dois baser ma réponse seulement sur le canal #${channelName} (compte associé) ou sur tout (tous les comptes) ? », puis attends la réponse avant de lancer search_deals / search_contacts / get_companies. C'est la SEULE question de clarification autorisée (elle prime sur la règle "ne pose aucune question").\nLe périmètre est considéré comme "précisé" si l'utilisateur nomme un client, dit "partout" / "tous les comptes" / "ce canal", ou a déjà répondu à cette question plus haut dans le fil : dans ce cas, respecte-le sans reposer la question. Un client explicitement nommé prime toujours sur le canal.\nPour un canal générique (ex: #general, #11-everything-prospects), ne déduis aucun compte et ne pose pas la question : réponds normalement.`;
  }

  // 4) Boucle agentic
  let currentMessages: Anthropic.MessageParam[] = messages;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let costWarned = false;
  let finalText = "";
  const COST_WARNING_USD = 0.5;
  const estimateCost = (inTok: number, outTok: number) => (inTok * 0.0000008 + outTok * 0.000004);

  while (true) {
    const apiStream = client.messages.stream({
      model: chatModel,
      max_tokens: 8192,
      system: systemPrompt,
      tools: TOOLS,
      messages: currentMessages,
    });

    apiStream.on("text", (delta) => emit({ type: "text", text: delta }));

    const message = await apiStream.finalMessage();
    totalInputTokens += message.usage.input_tokens;
    totalOutputTokens += message.usage.output_tokens;

    const currentCost = estimateCost(totalInputTokens, totalOutputTokens);
    if (!costWarned && currentCost >= COST_WARNING_USD) {
      costWarned = true;
      emit({ type: "cost_warning", cost: currentCost });
    }

    if (message.stop_reason === "end_turn") {
      // Extract final assistant text from content blocks
      finalText = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      currentMessages = [...currentMessages, { role: "assistant", content: message.content }];
      emit({ type: "history", messages: currentMessages });
      emit({ type: "done" });
      logUsage(userId, chatModel, totalInputTokens, totalOutputTokens, "chat");
      return {
        finalText,
        messages: currentMessages,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      };
    }

    if (message.stop_reason === "tool_use") {
      const toolBlocks = message.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      currentMessages = [...currentMessages, { role: "assistant", content: message.content }];

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tool of toolBlocks) {
        emit({ type: "tool", name: tool.name });
        try {
          const result = await executeTool(
            tool.name,
            tool.input as Record<string, unknown>,
            (msg) => emit({ type: "tool_progress", message: msg }),
            userOwnerId,
            userId,
          );
          results.push({ type: "tool_result", tool_use_id: tool.id, content: result });
        } catch (e) {
          results.push({
            type: "tool_result",
            tool_use_id: tool.id,
            content: `Erreur: ${e instanceof Error ? e.message : "inconnue"}`,
            is_error: true,
          });
        }
      }
      currentMessages.push({ role: "user", content: results });

      // Prune les tool results volumineux des messages anciens pour rester sous 200k
      const MAX_RESULT_CHARS = 8000;
      const lastMsgIndex = currentMessages.length - 1;
      currentMessages = currentMessages.map((msg, idx) => {
        if (msg.role !== "user" || !Array.isArray(msg.content)) return msg;
        if (idx === lastMsgIndex) return msg;
        const pruned = (msg.content as Anthropic.ToolResultBlockParam[]).map((block) => {
          if (block.type !== "tool_result" || typeof block.content !== "string") return block;
          if (block.content.length <= MAX_RESULT_CHARS) return block;
          const firstLine = block.content.split("\n")[0];
          return { ...block, content: `${firstLine}\n[résultat volumineux tronqué — données déjà traitées]` };
        });
        return { ...msg, content: pruned };
      });
      continue;
    }

    // Unknown stop_reason (refusal, max_tokens, etc.) — break.
    logUsage(userId, chatModel, totalInputTokens, totalOutputTokens, "chat");
    emit({ type: "done" });
    return {
      finalText,
      messages: currentMessages,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    };
  }
}
