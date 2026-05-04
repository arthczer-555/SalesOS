import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { logUsage } from "@/lib/log-usage";
import { DEFAULT_BOT_GUIDE } from "@/lib/guides/bot";
import { searchGmailMessages, getGmailMessage } from "@/lib/gmail";
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
  findEmailByLinkedIn,
  findDecisionMakerEmail,
} from "@/lib/netrows";

export const maxDuration = 300; // 5 minutes — required for large HubSpot fetches

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

// ── Curated property lists (avoids fetching all 200+ props on every cold start) ─
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

// Strip null/empty values to keep context manageable
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

// Fetch all channels with pagination (Slack caps each page at 1000)
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

// ── Tool definitions ──────────────────────────────────────────────────────────
const tools: Anthropic.Tool[] = [
  {
    name: "search_contacts",
    description:
      "Recherche des contacts HubSpot par nom, email ou entreprise. Utilise cet outil pour répondre à des questions sur les prospects ou clients.",
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
    description:
      "Recherche des deals HubSpot par nom. Utilise cet outil quand on mentionne un deal ou une entreprise spécifique.",
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
    description:
      "Récupère les deals HubSpot en format compact. Utilise cet outil pour avoir la liste du pipeline. Pour les conversations d'un deal, utilise ensuite get_deal_activity.",
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
    description:
      "Récupère les entreprises dans HubSpot. Utilise cet outil pour des questions sur les comptes, les secteurs, les tailles.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: { type: "number", description: "Nombre max de résultats (défaut : 20)" },
      },
      required: [],
    },
  },
  {
    name: "get_contact_details",
    description: "Récupère les détails complets d'un contact HubSpot via son ID.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: { type: "string", description: "ID HubSpot du contact" },
      },
      required: ["contact_id"],
    },
  },
  {
    name: "get_contact_activity",
    description: "Récupère l'historique complet d'un contact : notes, emails loggés, appels, réunions. Utilise cet outil pour comprendre l'historique des échanges avec un contact.",
    input_schema: {
      type: "object" as const,
      properties: {
        contact_id: { type: "string", description: "ID HubSpot du contact" },
      },
      required: ["contact_id"],
    },
  },
  {
    name: "get_deal_activity",
    description: "Récupère les conversations complètes d'un deal : notes, emails, appels, réunions. Utilise cet outil après get_deals pour obtenir le contexte détaillé (ce qui a été dit, les blocages, les prochaines étapes) de chaque deal identifié comme pertinent.",
    input_schema: {
      type: "object" as const,
      properties: {
        deal_id: { type: "string", description: "ID HubSpot du deal" },
      },
      required: ["deal_id"],
    },
  },
  {
    name: "get_deal_contacts",
    description: "Récupère les contacts associés à un deal HubSpot.",
    input_schema: {
      type: "object" as const,
      properties: {
        deal_id: { type: "string", description: "ID HubSpot du deal" },
      },
      required: ["deal_id"],
    },
  },
  {
    name: "search_slack",
    description: "Recherche des messages Slack par mot-clé dans un ou plusieurs canaux. Utilise cet outil pour trouver des conversations sur un deal, un contact ou un sujet.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Mots-clés à rechercher (insensible à la casse)" },
        channels: { type: "array", items: { type: "string" }, description: "Canaux où chercher (sans #). Si vide, cherche dans les canaux les plus pertinents." },
        limit: { type: "number", description: "Nombre de messages à analyser par canal (défaut : 50)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_slack_channel_history",
    description: "Récupère les derniers messages d'un canal Slack. Utilise cet outil pour avoir le contexte récent d'un canal (#sales, #deals...).",
    input_schema: {
      type: "object" as const,
      properties: {
        channel_name: { type: "string", description: "Nom du canal sans # (ex: sales, general)" },
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
    description:
      "Recherche sur le web en temps réel. Utilise cet outil pour des questions sur l'actualité, les concurrents, les tendances marché, ou toute information externe récente.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Requête de recherche (en anglais ou français selon le sujet)" },
        days: { type: "number", description: "Limiter aux résultats des N derniers jours (défaut : 30)" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_drive",
    description:
      "Recherche des fichiers dans Google Drive par mots-clés. Utilise cet outil pour trouver des présentations, propositions commerciales, documents liés à un deal ou un client.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Mots-clés de recherche (nom de client, deal, type de doc...)" },
        limit: { type: "number", description: "Nombre max de résultats (défaut : 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_drive_file",
    description:
      "Lit le contenu textuel d'un fichier Google Drive (Google Docs, Sheets, Slides exportés en texte). Utilise cet outil après search_drive pour lire un document trouvé.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "ID du fichier Google Drive" },
        mime_type: { type: "string", description: "Type MIME du fichier (ex: application/vnd.google-apps.document)" },
      },
      required: ["file_id"],
    },
  },
  {
    name: "search_gmail",
    description:
      "Recherche des emails dans la boîte Gmail de l'utilisateur connecté. Utilise la syntaxe Gmail (from:, to:, subject:, after:YYYY/MM/DD, before:, has:attachment, etc.). Utilise cet outil pour retrouver des échanges avec un prospect/client ou sur un sujet précis. Renvoie les métadonnées (from, subject, date, snippet) — utilise ensuite read_gmail_message pour lire le contenu complet d'un mail.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Requête Gmail (ex: 'from:contact@engie.com', 'subject:proposition after:2026/01/01', 'salomon')" },
        limit: { type: "number", description: "Nombre max de résultats (défaut : 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_gmail_message",
    description:
      "Lit le contenu complet d'un email Gmail (corps, expéditeur, destinataire, sujet). Utilise cet outil après search_gmail pour lire un email précis.",
    input_schema: {
      type: "object" as const,
      properties: {
        message_id: { type: "string", description: "ID du message Gmail (retourné par search_gmail)" },
      },
      required: ["message_id"],
    },
  },
  {
    name: "list_drive_folder",
    description:
      "Liste les fichiers d'un dossier Google Drive. Utilise cet outil pour naviguer dans l'arborescence Drive, explorer un dossier spécifique.",
    input_schema: {
      type: "object" as const,
      properties: {
        folder_id: { type: "string", description: "ID du dossier Drive (défaut : root = racine du Drive)" },
        limit: { type: "number", description: "Nombre max de fichiers (défaut : 20)" },
      },
      required: [],
    },
  },
  // ── LinkedIn (Netrows) tools ─────────────────────────────────────────────
  {
    name: "search_linkedin_people",
    description:
      "Recherche des profils LinkedIn par entreprise et/ou titre de poste. Idéal pour trouver le DRH/Head of L&D d'une boîte. Si tu as juste un nom + une entreprise, utilise firstName + lastName + company.",
    input_schema: {
      type: "object" as const,
      properties: {
        company: { type: "string", description: "Nom d'entreprise (ex: Danone)" },
        keywordTitle: { type: "string", description: "Titre cible (ex: 'DRH OR Directeur des Ressources Humaines')" },
        keywords: { type: "string", description: "Mots-clés libres" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        start: { type: "number", description: "Pagination (0 par défaut)" },
      },
      required: [],
    },
  },
  {
    name: "get_linkedin_profile",
    description:
      "Récupère le profil LinkedIn complet d'une personne (parcours, compétences, formation, bio) à partir de son username LinkedIn. Si tu n'as pas le username, utilise plutôt search_linkedin_people ou get_linkedin_profile_by_email.",
    input_schema: {
      type: "object" as const,
      properties: {
        username: { type: "string", description: "Username LinkedIn (ex: 'jean-dupont')" },
        firstName: { type: "string", description: "Prénom (fallback si pas d'username)" },
        lastName: { type: "string", description: "Nom (fallback si pas d'username)" },
        company: { type: "string", description: "Entreprise (aide la résolution)" },
      },
      required: [],
    },
  },
  {
    name: "get_linkedin_profile_by_email",
    description:
      "Trouve un profil LinkedIn à partir d'un email professionnel (reverse lookup). Idéal quand tu as un contact HubSpot et veux son LinkedIn.",
    input_schema: {
      type: "object" as const,
      properties: { email: { type: "string", description: "Email pro (pas gmail/yahoo)" } },
      required: ["email"],
    },
  },
  {
    name: "get_linkedin_activity",
    description:
      "Récupère la dernière activité d'un profil LinkedIn (timestamps, types de posts/likes récents).",
    input_schema: {
      type: "object" as const,
      properties: { username: { type: "string" } },
      required: ["username"],
    },
  },
  {
    name: "get_linkedin_likes",
    description:
      "Liste les posts récemment likés par un profil LinkedIn. Utile pour identifier ses centres d'intérêt et engagements.",
    input_schema: {
      type: "object" as const,
      properties: {
        username: { type: "string" },
        start: { type: "number", description: "Pagination" },
      },
      required: ["username"],
    },
  },
  {
    name: "get_linkedin_posts",
    description:
      "Liste les derniers posts publiés par un profil LinkedIn. Utile pour préparer une accroche personnalisée.",
    input_schema: {
      type: "object" as const,
      properties: { username: { type: "string" } },
      required: ["username"],
    },
  },
  {
    name: "get_linkedin_similar_profiles",
    description:
      "Trouve des profils LinkedIn similaires à un profil donné. Utile pour étendre une short-list de prospects.",
    input_schema: {
      type: "object" as const,
      properties: { username: { type: "string" } },
      required: ["username"],
    },
  },
  {
    name: "get_linkedin_company",
    description:
      "Détails d'une entreprise LinkedIn (effectifs, secteur, siège, follower count, description). Username = slug LinkedIn de la page entreprise.",
    input_schema: {
      type: "object" as const,
      properties: { username: { type: "string", description: "Slug LinkedIn (ex: 'danone')" } },
      required: ["username"],
    },
  },
  {
    name: "get_linkedin_company_posts",
    description:
      "Derniers posts publiés par une page entreprise LinkedIn (annonces, nominations, lancements).",
    input_schema: {
      type: "object" as const,
      properties: {
        username: { type: "string" },
        start: { type: "number" },
      },
      required: ["username"],
    },
  },
  {
    name: "get_linkedin_company_jobs",
    description: "Offres d'emploi actives publiées par une entreprise sur LinkedIn.",
    input_schema: {
      type: "object" as const,
      properties: {
        company_id: { type: "string", description: "Username/slug ou ID LinkedIn de l'entreprise" },
        page: { type: "number" },
      },
      required: ["company_id"],
    },
  },
  {
    name: "search_linkedin_companies",
    description: "Recherche d'entreprises sur LinkedIn par mots-clés / industrie / taille.",
    input_schema: {
      type: "object" as const,
      properties: {
        keyword: { type: "string" },
        industry: { type: "string" },
        size: { type: "string" },
      },
      required: ["keyword"],
    },
  },
  {
    name: "search_linkedin_posts",
    description:
      "Recherche de posts LinkedIn par mot-clé. Utile pour la veille et la détection de signaux (ex: 'coaching managers', 'burnout L&D').",
    input_schema: {
      type: "object" as const,
      properties: {
        keyword: { type: "string" },
        sortBy: { type: "string", description: "'date_posted' (défaut) ou 'relevance'" },
        datePosted: { type: "string", description: "Filtre date ('past-week', 'past-month'…)" },
      },
      required: ["keyword"],
    },
  },
  {
    name: "get_linkedin_post_reactions",
    description: "Liste les profils LinkedIn qui ont réagi à un post donné.",
    input_schema: {
      type: "object" as const,
      properties: {
        post_url: { type: "string", description: "URL complète du post LinkedIn" },
        start: { type: "number" },
      },
      required: ["post_url"],
    },
  },
  {
    name: "find_email_by_linkedin",
    description:
      "Trouve l'email professionnel d'une personne à partir de son username LinkedIn (5 crédits). Renvoie l'email + niveau de confiance.",
    input_schema: {
      type: "object" as const,
      properties: { username: { type: "string" } },
      required: ["username"],
    },
  },
  {
    name: "find_decision_maker_email",
    description:
      "Trouve l'email du décideur (DRH, Head of L&D, etc.) d'une entreprise donnée (10 crédits). Idéal pour ouvrir une approche cold.",
    input_schema: {
      type: "object" as const,
      properties: {
        company: { type: "string" },
        title: { type: "string", description: "Titre du décideur (ex: 'Head of L&D')" },
      },
      required: ["company", "title"],
    },
  },
];

// ── Tool execution ────────────────────────────────────────────────────────────
// ── Google Drive helper (shared token via env var) ───────────────────────────
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

async function executeTool(name: string, input: Record<string, unknown>, onProgress?: (msg: string) => void, userOwnerId?: string | null, userId?: string): Promise<string> {
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
      onProgress?.(`Récupération des deals... 0 chargés`);
      do {
        const data = await hubspot("/crm/v3/objects/deals/search", "POST", {
          ...(ownerFilter.length ? { filterGroups: [{ filters: ownerFilter }] } : {}),
          sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
          limit: 200,
          ...(after ? { after } : {}),
          properties: props,
        });
        for (const r of (data.results ?? []) as { id: string; properties: Record<string, string> }[]) {
          const p = r.properties;
          allResults.push({ id: r.id, properties: p } as { id: string; properties: Record<string, unknown> });
        }
        after = (data.paging as { next?: { after?: string } } | undefined)?.next?.after;
        pages++;
        onProgress?.(`Récupération des deals... ${allResults.length} chargés${after ? " (suite...)" : ""}`);
        if (pages >= MAX_PAGES && after) { truncated = true; break; }
      } while (after);
      const note = truncated
        ? `⚠️ Résultats partiels : ${allResults.length} deals (limite atteinte).`
        : `✅ ${allResults.length} deals récupérés.`;
      // Compact one-line format per deal to minimize tokens
      const compact = (allResults as { id: string; properties: Record<string, string> }[]).map((d) => {
        const p = d.properties;
        const date = p.createdate ? p.createdate.slice(0, 10) : "";
        const close = p.closedate ? p.closedate.slice(0, 10) : "";
        const won = p.hs_is_closed_won === "true" ? "won" : (p.dealstage === "closedlost" ? "lost" : "open");
        return `${d.id}|${p.dealname ?? ""}|${p.dealstage ?? ""}|${p.amount ?? ""}€|${date}|${close}|${won}`;
      }).join("\n");
      return `${note}\nformat: id|nom|stage|montant|createdate|closedate|statut\nPour obtenir les conversations (notes/appels/réunions) d'un deal spécifique, utilise get_deal_activity avec son id.\n${compact}`;
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
      const data = await hubspot(
        `/crm/v3/objects/contacts/${input.contact_id}?properties=${props.join(",")}`
      );
      return JSON.stringify({ id: data.id, properties: stripEmpty(data.properties) });
    }
    case "get_contact_activity": {
      // Fetch notes, emails, calls, meetings associated with the contact
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
      const T = 1500; // max chars per field
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
      // Fetch contact details for each associated contact
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

      // Resolve channel names → IDs
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
        } catch { /* canal inaccessible, on ignore */ }
      }));

      if (results.length === 0) return `Aucun message contenant "${input.query}" trouvé dans les canaux consultés.`;
      return JSON.stringify(results);
    }
    case "get_slack_channel_history": {
      // Resolve channel name → ID
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

      // Resolve user IDs to names
      const userIds = [...new Set(
        (histData.messages ?? []).map((m: { user?: string }) => m.user).filter(Boolean)
      )] as string[];
      const userMap: Record<string, string> = {};
      await Promise.all(userIds.map(async (uid) => {
        try {
          const u = await slack("/users.info", { user: uid });
          userMap[uid] = u.user?.real_name ?? u.user?.name ?? uid;
        } catch { userMap[uid] = uid; }
      }));

      const messages = (histData.messages ?? []).map((m: {
        text: string; ts: string; user?: string;
      }) => ({
        text: m.text,
        user: m.user ? (userMap[m.user] ?? m.user) : "bot",
        timestamp: new Date(parseFloat(m.ts) * 1000).toISOString(),
      }));
      return JSON.stringify({ channel: channel.name, messages });
    }
    case "send_slack_message": {
      const target = input.channel as string;
      let channelId = target;

      // If it looks like an email, find the user's DM channel
      if (target.includes("@")) {
        const usersData = await slack("/users.lookupByEmail", { email: target });
        const userId = usersData.user?.id;
        if (!userId) return `Utilisateur avec l'email "${target}" introuvable dans Slack.`;
        const dmData = await slackPost("/conversations.open", { users: userId });
        channelId = dmData.channel?.id;
      } else {
        // Resolve channel name → ID
        const allChs = await slackAllChannels();
        const ch = allChs.find((c) => c.name === target.replace("#", ""));
        if (!ch) return `Canal "${target}" introuvable.`;
        channelId = ch.id;
      }

      await slackPost("/chat.postMessage", {
        channel: channelId,
        text: input.message as string,
      });
      return `Message envoyé dans "${target}".`;
    }
    case "web_search": {
      const results = await searchTavily(
        input.query as string,
        (input.days as number) ?? 30
      );
      if (results.length === 0) return "Aucun résultat trouvé pour cette recherche.";
      return JSON.stringify(
        results.map((r) => ({
          title: r.title,
          url: r.url,
          content: r.content.slice(0, 1000),
          date: r.published_date,
        }))
      );
    }
    case "search_drive": {
      try {
        console.log("[Drive] search_drive called, query:", input.query);
        const token = await getDriveAccessToken();
        console.log("[Drive] Got access token OK");
        const q = encodeURIComponent(
          `fullText contains '${(input.query as string).replace(/'/g, "\\'")}'`
        );
        const limit = (input.limit as number) || 10;
        const url = `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=${limit}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&orderBy=modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true`;
        console.log("[Drive] Fetching:", url.slice(0, 200));
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          console.error("[Drive] API error:", res.status, err.slice(0, 300));
          throw new Error(`Drive API ${res.status}: ${err.slice(0, 200)}`);
        }
        const data = await res.json();
        console.log("[Drive] Results:", data.files?.length ?? 0, "files");
        const files = (data.files ?? []).map((f: { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink: string }) => ({
          id: f.id,
          name: f.name,
          type: f.mimeType,
          modified: f.modifiedTime?.slice(0, 10),
          link: f.webViewLink,
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
          // Google Docs/Sheets/Slides → export as plain text
          url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`;
        } else {
          // Binary/other files → download content
          url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
        }
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          throw new Error(`Drive API ${res.status}: ${err.slice(0, 200)}`);
        }
        const text = await res.text();
        return text.slice(0, 8000); // limit to ~2k tokens
      } catch (e) {
        return `Erreur lecture Drive : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    case "search_gmail": {
      if (!userId) return "Gmail non disponible : utilisateur non identifié.";
      try {
        const limit = (input.limit as number) ?? 10;
        const results = await searchGmailMessages(userId, input.query as string, limit);
        if (results.length === 0) return `Aucun email trouvé pour "${input.query}".`;
        const compact = results.map((r) => ({
          id: r.id,
          from: r.from,
          to: r.to,
          subject: r.subject,
          date: r.date,
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
          id: msg.id,
          from: msg.from,
          to: msg.to,
          cc: msg.cc || undefined,
          subject: msg.subject,
          date: msg.date,
          body: msg.body.slice(0, 8000),
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
          return {
            id: f.id,
            name: f.name,
            type: isFolder ? "dossier" : f.mimeType,
            modified: f.modifiedTime?.slice(0, 10),
            link: f.webViewLink,
          };
        });
        if (files.length === 0) return "Dossier vide.";
        return JSON.stringify(files);
      } catch (e) {
        return `Erreur Drive : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    // ── LinkedIn (Netrows) ─────────────────────────────────────────────
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
            company: p.companyName,
            title: p.title,
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
      try {
        const r = await getPeopleActivity(input.username as string);
        return JSON.stringify(r.data ?? []);
      } catch (e) {
        return `Erreur LinkedIn activity : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    case "get_linkedin_likes": {
      try {
        const r = await getPeopleLikes(input.username as string, (input.start as number | undefined) ?? 0);
        return JSON.stringify((r.data ?? []).slice(0, 15));
      } catch (e) {
        return `Erreur LinkedIn likes : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    case "get_linkedin_posts": {
      try {
        // Posts d'une PERSONNE ne sont pas exposés par Netrows ; on retourne ses likes en proxy
        // si l'API évolue, on basculera ici. Pour les posts d'une page entreprise, voir
        // get_linkedin_company_posts.
        const r = await getPeopleActivity(input.username as string);
        return JSON.stringify(r.data ?? []);
      } catch (e) {
        return `Erreur LinkedIn posts : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    case "get_linkedin_similar_profiles": {
      try {
        const r = await getSimilarProfiles(input.username as string);
        return JSON.stringify((r.data ?? []).slice(0, 15));
      } catch (e) {
        return `Erreur LinkedIn similar : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    case "get_linkedin_company": {
      try {
        const c = await getCompanyDetails(input.username as string);
        return JSON.stringify(c);
      } catch (e) {
        return `Erreur LinkedIn company : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    case "get_linkedin_company_posts": {
      try {
        const r = await getCompanyPosts(input.username as string, (input.start as number | undefined) ?? 0);
        return JSON.stringify((r.data ?? []).slice(0, 10));
      } catch (e) {
        return `Erreur LinkedIn company posts : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    case "get_linkedin_company_jobs": {
      try {
        const r = await getCompanyJobs(input.company_id as string, (input.page as number | undefined) ?? 1);
        return JSON.stringify(r.data ?? []);
      } catch (e) {
        return `Erreur LinkedIn jobs : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    case "search_linkedin_companies": {
      try {
        const r = await searchCompanies({
          keyword: input.keyword as string,
          industry: input.industry as string | undefined,
          size: input.size as string | undefined,
        });
        return JSON.stringify((r.data?.items ?? []).slice(0, 20));
      } catch (e) {
        return `Erreur LinkedIn search companies : ${e instanceof Error ? e.message : "inconnue"}`;
      }
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
      } catch (e) {
        return `Erreur LinkedIn search posts : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    case "get_linkedin_post_reactions": {
      try {
        const r = await getPostReactions(input.post_url as string, (input.start as number | undefined) ?? 0);
        return JSON.stringify((r.data ?? []).slice(0, 30));
      } catch (e) {
        return `Erreur LinkedIn reactions : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    case "find_email_by_linkedin": {
      try {
        const r = await findEmailByLinkedIn(input.username as string);
        return JSON.stringify(r.data ?? { email: null });
      } catch (e) {
        return `Erreur email finder : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    case "find_decision_maker_email": {
      try {
        const r = await findDecisionMakerEmail({
          company: input.company as string,
          title: input.title as string,
        });
        return JSON.stringify(r.data ?? { email: null });
      } catch (e) {
        return `Erreur decision maker : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    }
    default:
      return "Outil inconnu.";
  }
}

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // ── Auth + per-user Claude key ───────────────────────────────────────────────
  const user = await getAuthenticatedUser();
  if (!user) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: "Non authentifié." })}\n\n`,
      { status: 401, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  let claudeApiKey: string;

  if (process.env.SUPABASE_URL) {
    const { data: keyRow } = await db
      .from("user_keys")
      .select("encrypted_key, iv, auth_tag, is_active")
      .eq("user_id", user.id)
      .eq("service", "claude")
      .single();

    if (!keyRow?.is_active) {
      return new Response(
        `data: ${JSON.stringify({ type: "error", message: "Ton accès Claude n'est pas encore configuré. Contacte Arthur." })}\n\n`,
        { status: 402, headers: { "Content-Type": "text/event-stream" } }
      );
    }

    claudeApiKey = decrypt({
      encryptedKey: keyRow.encrypted_key,
      iv: keyRow.iv,
      authTag: keyRow.auth_tag,
    });
    console.log(`[Chat] Decrypted key for ${user.email}: starts="${claudeApiKey.slice(0, 10)}" ends="${claudeApiKey.slice(-4)}" len=${claudeApiKey.length}`);
  } else {
    // Local dev fallback — no Supabase configured
    claudeApiKey = process.env.ANTHROPIC_API_KEY ?? "";
  }

  const client = new Anthropic({ apiKey: claudeApiKey });

  // Fetch user's personal prompt, owner ID, and model preferences
  let systemPrompt: string;
  let chatModel = "claude-haiku-4-5-20251001";
  let userOwnerId: string | null = null;
  if (process.env.SUPABASE_URL) {
    const [{ data: userData }, { data: globalGuide }, { data: globalModelEntry }, { data: ownerRow }] = await Promise.all([
      db.from("users").select("user_prompt").eq("id", user.id).single(),
      db.from("guide_defaults").select("content").eq("key", "bot").single(),
      db.from("guide_defaults").select("content").eq("key", "model_preferences").single(),
      db.from("users").select("hubspot_owner_id").eq("id", user.id).single(),
    ]);
    const adminGuide = globalGuide?.content ?? DEFAULT_BOT_GUIDE;
    const userInstructions = userData?.user_prompt?.trim() ?? "";
    systemPrompt = userInstructions
      ? `${adminGuide}\n\n--- INSTRUCTIONS PERSONNELLES DE L'UTILISATEUR ---\n${userInstructions}`
      : adminGuide;
    userOwnerId = ownerRow?.hubspot_owner_id ?? null;
    try { if (globalModelEntry?.content) chatModel = (JSON.parse(globalModelEntry.content) as Record<string, string>).chat ?? chatModel; } catch { /* keep default */ }
  } else {
    systemPrompt = DEFAULT_BOT_GUIDE;
  }

  // Fetch all HubSpot owners so the bot knows the team
  let ownersMap: { id: string; name: string; email: string }[] = [];
  try {
    const ownersData = await hubspot("/crm/v3/owners?limit=100");
    ownersMap = (ownersData.results ?? []).map((o: { id: string; firstName?: string; lastName?: string; email?: string }) => ({
      id: o.id,
      name: [o.firstName, o.lastName].filter(Boolean).join(" "),
      email: o.email ?? "",
    }));
  } catch { /* owners fetch failed — continue without */ }

  // Inject owner + team context into system prompt
  const teamLines = ownersMap.map((o) => `- ${o.name} (owner_id: ${o.id}, ${o.email})`).join("\n");
  const ownerContext = `\n\nCONTEXTE UTILISATEUR\nL'utilisateur connecté est ${user.name ?? user.email}${userOwnerId ? ` (HubSpot owner ID : ${userOwnerId})` : ""}.\nQuand il dit "mes deals" → utilise my_deals_only: true.\nQuand il dit "les deals de [prénom]" → résous le prénom ci-dessous et utilise owner_id.\n\nÉQUIPE COMMERCIALE (owners HubSpot) :\n${teamLines || "Aucun owner trouvé"}\n\nRÈGLES IMPORTANTES :\n- "les deals de Quentin" → trouver l'owner_id de Quentin dans la liste ci-dessus, puis get_deals avec owner_id\n- "deals perdu" ou "deals lost" = stage closedlost\n- "deals gagné" ou "deals won" = stage closedwon\n- Ne JAMAIS chercher un commercial comme un contact — ce sont des owners\n- Ne pose AUCUNE question de clarification — déduis du contexte`;
  systemPrompt += ownerContext;

  const linkedinCapabilities = `\n\nCAPACITÉS LINKEDIN (Netrows)\nTu as accès à l'API LinkedIn pour enrichir tes réponses :\n\n• Profils :\n  - search_linkedin_people : trouver une personne par entreprise + titre (ex: "DRH de Danone")\n  - get_linkedin_profile : profil complet (parcours, skills, formation) — fallback automatique nom+entreprise si pas d'username\n  - get_linkedin_profile_by_email : reverse lookup email → profil\n  - get_linkedin_activity / get_linkedin_likes / get_linkedin_posts : dernière activité\n  - get_linkedin_similar_profiles : profils similaires\n\n• Entreprises :\n  - get_linkedin_company : effectifs, secteur, siège, followers\n  - get_linkedin_company_posts : derniers posts de la page entreprise (annonces, nominations)\n  - get_linkedin_company_jobs : offres actives\n  - search_linkedin_companies : recherche par mots-clés\n\n• Posts :\n  - search_linkedin_posts : posts par mot-clé (veille)\n  - get_linkedin_post_reactions : qui a réagi à un post\n\n• Emails :\n  - find_email_by_linkedin : email d'un profil LinkedIn (5 crédits)\n  - find_decision_maker_email : email du décideur RH/L&D d'une entreprise (10 crédits)\n\nQuand l'utilisateur demande "qu'est-ce que tu peux faire sur LinkedIn", liste ces capacités groupées.`;
  systemPrompt += linkedinCapabilities;

  const { messages } = await req.json();
  const model = chatModel;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        let currentMessages: Anthropic.MessageParam[] = messages;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let costWarned = false;
        const COST_WARNING_USD = 0.5;
        // Haiku pricing: $0.80/M input, $4/M output (approx)
        const estimateCost = (inTok: number, outTok: number) => (inTok * 0.0000008 + outTok * 0.000004);

        // Agentic loop
        while (true) {
          const apiStream = client.messages.stream({
            model,
            max_tokens: 8192,
            system: systemPrompt,
            tools,
            messages: currentMessages,
          });

          // Stream text deltas
          apiStream.on("text", (delta) => send({ type: "text", text: delta }));

          const message = await apiStream.finalMessage();
          totalInputTokens += message.usage.input_tokens;
          totalOutputTokens += message.usage.output_tokens;

          // Cost warning
          const currentCost = estimateCost(totalInputTokens, totalOutputTokens);
          if (!costWarned && currentCost >= COST_WARNING_USD) {
            costWarned = true;
            send({ type: "cost_warning", cost: currentCost });
          }

          console.log("[Chat] stop_reason:", message.stop_reason, "content blocks:", message.content.map(b => b.type));

          if (message.stop_reason === "end_turn") {
            // Send full message history (with tool calls) back to client for next turn
            currentMessages = [...currentMessages, { role: "assistant", content: message.content }];
            send({ type: "history", messages: currentMessages });
            send({ type: "done" });
            logUsage(user.id, model, totalInputTokens, totalOutputTokens, "chat");
            break;
          }

          if (message.stop_reason === "tool_use") {
            const toolBlocks = message.content.filter(
              (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
            );

            currentMessages = [
              ...currentMessages,
              { role: "assistant", content: message.content },
            ];

            const results: Anthropic.ToolResultBlockParam[] = [];

            for (const tool of toolBlocks) {
              send({ type: "tool", name: tool.name });
              try {
                const result = await executeTool(
                  tool.name,
                  tool.input as Record<string, unknown>,
                  (msg) => send({ type: "tool_progress", message: msg }),
                  userOwnerId,
                  user.id,
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

            // Prune oversized tool results from history to stay under 200k token limit.
            // IMPORTANT: only prune messages that are NOT the last one — the last tool result
            // must stay intact so Claude can extract IDs/data from it in the next turn.
            const MAX_RESULT_CHARS = 8000;
            const lastMsgIndex = currentMessages.length - 1;
            currentMessages = currentMessages.map((msg, idx) => {
              if (msg.role !== "user" || !Array.isArray(msg.content)) return msg;
              if (idx === lastMsgIndex) return msg; // protect most recent result
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

          logUsage(user.id, model, totalInputTokens, totalOutputTokens);
          send({ type: "done" });
          break;
        }
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "Erreur inconnue" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
