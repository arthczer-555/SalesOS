import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { logUsage } from "@/lib/log-usage";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const PROPS = [
  "firstname", "lastname", "email", "jobtitle", "company",
  "industry", "lifecyclestage", "city", "country",
  "notes_last_contacted", "hs_lead_status", "numberofemployees", "hs_lead_source",
  "hubspot_owner_id", "linkedin_url",
];

type ExtraFilters = {
  country?: string;
  leadstatus?: string;
  contacted?: string;
  companysize?: string;
  source?: string;
  createdyear?: string;
  ownerFilter?: string;
  myOwnerId?: string | null;
};

type HsFilter = { propertyName: string; operator: string; value?: string; highValue?: string };

async function hubspotSearch(query: string, lifecyclestage?: string, industry?: string, extra: ExtraFilters = {}) {
  const filters: HsFilter[] = [];
  if (lifecyclestage) filters.push({ propertyName: "lifecyclestage", operator: "EQ", value: lifecyclestage });
  if (industry) filters.push({ propertyName: "industry", operator: "EQ", value: industry });
  if (extra.country) filters.push({ propertyName: "country", operator: "EQ", value: extra.country });
  if (extra.leadstatus) filters.push({ propertyName: "hs_lead_status", operator: "EQ", value: extra.leadstatus });
  if (extra.source) filters.push({ propertyName: "hs_lead_source", operator: "EQ", value: extra.source });

  if (extra.createdyear) {
    const year = parseInt(extra.createdyear);
    if (!isNaN(year)) {
      const start = new Date(year, 0, 1).getTime();
      const end = new Date(year + 1, 0, 1).getTime();
      filters.push({ propertyName: "createdate", operator: "BETWEEN", value: String(start), highValue: String(end) });
    }
  }

  if (extra.ownerFilter !== "all" && (extra.ownerFilter || extra.myOwnerId)) {
    filters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: extra.ownerFilter || extra.myOwnerId! });
  }

  if (extra.companysize) {
    const ranges: Record<string, [number, number | null]> = {
      "1-10": [1, 10], "11-50": [11, 50], "51-200": [51, 200],
      "201-1000": [201, 1000], "1000+": [1001, null],
    };
    const range = ranges[extra.companysize];
    if (range) {
      filters.push({ propertyName: "numberofemployees", operator: "GTE", value: String(range[0]) });
      if (range[1]) filters.push({ propertyName: "numberofemployees", operator: "LTE", value: String(range[1]) });
    }
  }

  const now = Date.now();
  if (extra.contacted === "never") {
    filters.push({ propertyName: "notes_last_contacted", operator: "NOT_HAS_PROPERTY" });
  } else if (extra.contacted === "lt7") {
    filters.push({ propertyName: "notes_last_contacted", operator: "GTE", value: String(now - 7 * 864e5) });
  } else if (extra.contacted === "lt30") {
    filters.push({ propertyName: "notes_last_contacted", operator: "GTE", value: String(now - 30 * 864e5) });
  } else if (extra.contacted === "30to60") {
    filters.push({ propertyName: "notes_last_contacted", operator: "BETWEEN", value: String(now - 60 * 864e5), highValue: String(now - 30 * 864e5) });
  } else if (extra.contacted === "60to180") {
    filters.push({ propertyName: "notes_last_contacted", operator: "BETWEEN", value: String(now - 180 * 864e5), highValue: String(now - 60 * 864e5) });
  } else if (extra.contacted === "180to365") {
    filters.push({ propertyName: "notes_last_contacted", operator: "BETWEEN", value: String(now - 365 * 864e5), highValue: String(now - 180 * 864e5) });
  } else if (extra.contacted === "gt365") {
    filters.push({ propertyName: "notes_last_contacted", operator: "LTE", value: String(now - 365 * 864e5) });
  }

  const body: Record<string, unknown> = {
    limit: 20,
    properties: PROPS,
    sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
  };
  if (query) body.query = query;
  if (filters.length) body.filterGroups = [{ filters }];

  const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HubSpot search → ${res.status}`);
  const data = await res.json();

  return (data.results ?? []).map((c: { id: string; properties: Record<string, string> }) => ({
    id: c.id,
    firstName: c.properties.firstname ?? "",
    lastName: c.properties.lastname ?? "",
    email: c.properties.email ?? "",
    jobTitle: c.properties.jobtitle ?? "",
    company: c.properties.company ?? "",
    industry: c.properties.industry ?? "",
    lifecyclestage: c.properties.lifecyclestage ?? "",
    city: c.properties.city ?? "",
    country: c.properties.country ?? "",
    lastContacted: c.properties.notes_last_contacted ?? "",
    leadStatus: c.properties.hs_lead_status ?? "",
    employees: c.properties.numberofemployees ?? "",
    source: c.properties.hs_lead_source ?? "",
    linkedinUrl: c.properties.linkedin_url ?? null,
  }));
}

const tools: Anthropic.Tool[] = [
  {
    name: "search_contacts",
    description: "Recherche des contacts HubSpot. Utilise cet outil pour trouver des prospects selon des critères précis (nom, poste, entreprise, secteur, etc.).",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Texte de recherche : nom, poste, entreprise, mot-clé" },
        lifecyclestage: {
          type: "string",
          description: "Filtre sur le stade : subscriber, lead, marketingqualifiedlead, salesqualifiedlead, opportunity, customer",
        },
        industry: { type: "string", description: "Filtre sur le secteur d'activité" },
      },
      required: [],
    },
  },
];

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { query, lifecyclestage, industry, country, leadstatus, contacted, companysize, source, createdyear, ownerFilter } = await req.json() as {
    query: string;
    lifecyclestage?: string;
    industry?: string;
    country?: string;
    leadstatus?: string;
    contacted?: string;
    companysize?: string;
    source?: string;
    createdyear?: string;
    ownerFilter?: string;
  };

  const { data: userRow } = await db.from("users").select("hubspot_owner_id").eq("id", user.id).single();
  const myOwnerId: string | null = userRow?.hubspot_owner_id ?? null;
  const extra: ExtraFilters = { country, leadstatus, contacted, companysize, source, createdyear, ownerFilter, myOwnerId };

  const client = new Anthropic();

  const systemPrompt = `Tu es un assistant de prospection B2B. L'utilisateur cherche des prospects dans sa base HubSpot.
Analyse sa demande en langage naturel, utilise l'outil search_contacts pour trouver les contacts les plus pertinents.
Tu peux faire 1 à 3 appels selon la complexité de la demande.
À la fin, réponds en JSON avec exactement ce format :
{ "explanation": "phrase courte expliquant ce que tu as trouvé", "contact_ids": ["id1", "id2", ...] }
Mets uniquement les IDs des contacts les plus pertinents dans contact_ids (max 20).`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Requête : "${query}"${lifecyclestage ? ` | Lifecycle: ${lifecyclestage}` : ""}${industry ? ` | Secteur: ${industry}` : ""}`,
    },
  ];

  type ContactResult = Awaited<ReturnType<typeof hubspotSearch>>[number];
  // Tool-use loop (max 4 iterations)
  let allContacts: Record<string, ContactResult> = {};
  let iterations = 0;
  let totalInput = 0, totalOutput = 0;

  while (iterations < 4) {
    iterations++;
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages,
    });

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;

    if (response.stop_reason === "end_turn") {
      logUsage(user.id, "claude-haiku-4-5-20251001", totalInput, totalOutput, "prospection_search");
      // Parse final JSON response
      const text = response.content.find((b) => b.type === "text")?.text ?? "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const explanation: string = parsed.explanation ?? "";
          const ids: string[] = parsed.contact_ids ?? [];
          const results = ids
            .map((id) => allContacts[id])
            .filter(Boolean);
          return NextResponse.json({ results, explanation });
        } catch { /* fall through */ }
      }
      // Fallback: return all collected contacts
      return NextResponse.json({
        results: Object.values(allContacts),
        explanation: "Voici les contacts trouvés.",
      });
    }

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        if (block.name === "search_contacts") {
          const input = block.input as { query?: string; lifecyclestage?: string; industry?: string };
          try {
            const contacts = await hubspotSearch(
              input.query ?? "",
              input.lifecyclestage,
              input.industry,
              extra,
            );
            // Store contacts by ID for later lookup
            for (const c of contacts) allContacts[c.id] = c;
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(contacts.map((c: ContactResult) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, jobTitle: c.jobTitle, company: c.company, industry: c.industry, lifecyclestage: c.lifecyclestage }))),
            });
          } catch (e) {
            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: `Erreur: ${e}`, is_error: true });
          }
        }
      }

      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
    } else {
      break;
    }
  }

  logUsage(user.id, "claude-haiku-4-5-20251001", totalInput, totalOutput);
  return NextResponse.json({ results: Object.values(allContacts), explanation: "Voici les contacts trouvés." });
}
