/**
 * Outils HubSpot de CoachelloAI (extraits de l'ancien lib/chat/core.ts).
 * Les règles d'usage vivent dans les DESCRIPTIONS des outils : elles sont lues
 * par le modèle au moment exact où il choisit un outil (et cachées avec le
 * préfixe), au lieu d'être noyées dans un guide monolithique.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { dealNameSearchFilters } from "@/lib/hubspot";
import type { ToolModule } from "./types";

// ── Helper API ───────────────────────────────────────────────────────────────

export async function hubspot(path: string, method = "GET", body?: unknown) {
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

// ── Définitions ──────────────────────────────────────────────────────────────

const defs: Anthropic.Tool[] = [
  {
    name: "search_contacts",
    description:
      "Recherche des contacts HubSpot par nom, email ou entreprise. Pour les prospects et clients. Ne cherche JAMAIS un commercial Coachello ici : ce sont des owners (fournis dans ton contexte), pas des contacts.",
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
      "Recherche UN deal HubSpot précis par nom de deal ou d'entreprise. À utiliser quand un deal/une société est nommé explicitement. Pour une analyse de masse du pipeline, utilise get_deals (UNE fois), jamais search_deals en boucle. Rappel : le montant d'un deal n'est PAS le CA facturé (source de vérité facturation = get_billing_revenue).",
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
      "Liste complète du pipeline HubSpot en format compact. À appeler UNE SEULE FOIS par analyse (ne le rappelle jamais, ne le complète pas avec search_deals par secteur). Filtre ensuite toi-même par critères, puis approfondis avec get_deal_activity (max 10 par réponse). 'deals de Quentin' → owner_id résolu depuis la liste d'équipe de ton contexte.",
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
    description: "Récupère les entreprises dans HubSpot. Pour des questions sur les comptes, les secteurs, les tailles.",
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
    description:
      "Conversations complètes d'un deal : notes, emails, appels, réunions. C'est ici qu'on comprend POURQUOI un deal a calé et quoi dire pour relancer. Max 10 appels par réponse (analyse les 10 plus prometteurs, propose de continuer). Pour un deal ciblé, complète TOUJOURS avec search_slack et search_claap_meetings(deal_id).",
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
];

// ── Handlers ─────────────────────────────────────────────────────────────────

const module_: ToolModule = {
  defs,
  handlers: {
    search_contacts: async (input, ctx) => {
      const props = getPropertyNames("contacts");
      const filters: { propertyName: string; operator: string; value: string }[] = [];
      if (input.my_contacts_only && ctx.userOwnerId) {
        filters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: ctx.userOwnerId });
      }
      // Le param `query` de HubSpot tokenise sur les espaces : chercher un
      // contact chez "HealthHero" via "Health Hero" échoue (le token "hero" ne
      // matche pas le token "healthhero"). On lance en parallèle la requête
      // d'origine + une variante "collée" (espaces retirés) et on merge, pour
      // récupérer aussi les noms de société concaténés sans casser les vrais
      // noms de personnes espacés.
      const rawQuery = String(input.query ?? "").trim();
      const collapsed = rawQuery.replace(/\s+/g, "");
      const queries = collapsed && collapsed !== rawQuery ? [rawQuery, collapsed] : [rawQuery];
      const responses = await Promise.all(
        queries.map((q) =>
          hubspot("/crm/v3/objects/contacts/search", "POST", {
            query: q,
            limit: input.limit || 10,
            properties: props,
            ...(filters.length ? { filterGroups: [{ filters }] } : {}),
          }),
        ),
      );
      const byId = new Map<string, { id: string; properties: Record<string, unknown> }>();
      for (const data of responses) {
        for (const r of (data.results ?? []) as { id: string; properties: Record<string, unknown> }[]) {
          if (!byId.has(r.id)) byId.set(r.id, { id: r.id, properties: stripEmpty(r.properties) });
        }
      }
      return JSON.stringify([...byId.values()]);
    },

    search_deals: async (input, ctx) => {
      const props = getPropertyNames("deals");
      // Recherche par tokens wildcard sur dealname (robuste aux espaces et aux
      // noms concaténés) plutôt que le param `query` de HubSpot, qui échoue sur
      // "Health Hero" quand le deal s'appelle "HealthHero" (voir le helper).
      const filters = dealNameSearchFilters(String(input.query ?? ""));
      const dealOwnerId = (input.owner_id as string | undefined)
        ?? (input.my_deals_only && ctx.userOwnerId ? ctx.userOwnerId : undefined);
      if (dealOwnerId) {
        filters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: dealOwnerId });
      }
      const data = await hubspot("/crm/v3/objects/deals/search", "POST", {
        limit: input.limit || 10,
        properties: props,
        ...(filters.length ? { filterGroups: [{ filters }] } : {}),
      });
      const results = (data.results ?? []).map((r: { id: string; properties: Record<string, unknown> }) => ({
        id: r.id,
        properties: stripEmpty(r.properties),
      }));
      return JSON.stringify(results);
    },

    get_deals: async (input, ctx) => {
      const props = getPropertyNames("deals");
      const allResults: { id: string; properties: Record<string, unknown> }[] = [];
      let after: string | undefined;
      const MAX_PAGES = 50;
      let pages = 0;
      let truncated = false;
      const filterId = (input.owner_id as string | undefined)
        ?? (input.my_deals_only && ctx.userOwnerId ? ctx.userOwnerId : undefined);
      const ownerFilter = filterId
        ? [{ propertyName: "hubspot_owner_id", operator: "EQ", value: filterId }]
        : [];
      ctx.onProgress(`Loading deals... 0 loaded`);
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
        ctx.onProgress(`Loading deals... ${allResults.length} loaded${after ? " (more...)" : ""}`);
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
    },

    get_companies: async (input) => {
      const props = getPropertyNames("companies");
      const data = await hubspot(
        `/crm/v3/objects/companies?limit=${input.limit || 20}&properties=${props.join(",")}`
      );
      const results = (data.results ?? []).map((r: { id: string; properties: Record<string, unknown> }) => ({
        id: r.id,
        properties: stripEmpty(r.properties),
      }));
      return JSON.stringify(results);
    },

    get_contact_details: async (input) => {
      const props = getPropertyNames("contacts");
      const data = await hubspot(`/crm/v3/objects/contacts/${input.contact_id}?properties=${props.join(",")}`);
      return JSON.stringify({ id: data.id, properties: stripEmpty(data.properties) });
    },

    get_contact_activity: async (input) => {
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
    },

    get_deal_activity: async (input) => {
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
    },

    get_deal_contacts: async (input) => {
      const data = await hubspot(`/crm/v3/objects/deals/${input.deal_id}/associations/contacts`);
      if (!data.results?.length) return "[]";
      const contacts = await Promise.all(
        data.results.slice(0, 10).map((a: { id: string }) =>
          hubspot(`/crm/v3/objects/contacts/${a.id}?properties=firstname,lastname,email,jobtitle,phone`)
        )
      );
      return JSON.stringify(contacts);
    },
  },
};

export const hubspotTools = module_;
