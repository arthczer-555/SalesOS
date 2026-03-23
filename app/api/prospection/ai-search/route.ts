import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { logUsage } from "@/lib/log-usage";

export const dynamic = "force-dynamic";

const PROPS = [
  "firstname", "lastname", "email", "jobtitle", "company",
  "industry", "lifecyclestage", "city", "country",
];

async function hubspotSearch(query: string, lifecyclestage?: string, industry?: string) {
  const filters: { propertyName: string; operator: string; value: string }[] = [];
  if (lifecyclestage) filters.push({ propertyName: "lifecyclestage", operator: "EQ", value: lifecyclestage });
  if (industry) filters.push({ propertyName: "industry", operator: "EQ", value: industry });

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

  const { query, lifecyclestage, industry } = await req.json() as {
    query: string;
    lifecyclestage?: string;
    industry?: string;
  };

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
      logUsage(user.id, "claude-haiku-4-5-20251001", totalInput, totalOutput);
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
