import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
      },
      required: ["query"],
    },
  },
  {
    name: "search_deals",
    description:
      "Recherche des deals HubSpot par nom. Utilise cet outil quand on mentionne un deal ou une entreprise spécifique (ex: 'deal Mistral', 'opportunité Decathlon').",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Nom du deal ou de l'entreprise à chercher" },
        limit: { type: "number", description: "Nombre max de résultats (défaut : 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_deals",
    description:
      "Récupère tous les deals HubSpot. Utilise cet outil pour avoir une vue globale du pipeline.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: { type: "number", description: "Nombre max de résultats (défaut : 50)" },
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
];

// ── Tool execution ────────────────────────────────────────────────────────────
async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "search_contacts": {
      const data = await hubspot("/crm/v3/objects/contacts/search", "POST", {
        query: input.query,
        limit: input.limit || 10,
        properties: ["firstname", "lastname", "email", "company", "jobtitle", "phone", "hs_lead_status"],
      });
      return JSON.stringify(data.results ?? []);
    }
    case "search_deals": {
      const data = await hubspot("/crm/v3/objects/deals/search", "POST", {
        query: input.query,
        limit: input.limit || 10,
        properties: ["dealname", "amount", "dealstage", "closedate", "pipeline", "hubspot_owner_id"],
      });
      return JSON.stringify(data.results ?? []);
    }
    case "get_deals": {
      const data = await hubspot(
        `/crm/v3/objects/deals?limit=${input.limit || 50}&properties=dealname,amount,dealstage,closedate,pipeline,hubspot_owner_id`
      );
      return JSON.stringify(data.results ?? []);
    }
    case "get_companies": {
      const data = await hubspot(
        `/crm/v3/objects/companies?limit=${input.limit || 20}&properties=name,domain,industry,numberofemployees,annualrevenue,city`
      );
      return JSON.stringify(data.results ?? []);
    }
    case "get_contact_details": {
      const data = await hubspot(
        `/crm/v3/objects/contacts/${input.contact_id}?properties=firstname,lastname,email,company,jobtitle,phone,notes_last_updated,hs_lead_status`
      );
      return JSON.stringify(data);
    }
    default:
      return "Outil inconnu.";
  }
}

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { messages, customPrompt } = await req.json();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        let currentMessages: Anthropic.MessageParam[] = messages;

        // Agentic loop
        while (true) {
          const apiStream = client.messages.stream({
            model: "claude-haiku-4-5",
            max_tokens: 4096,
            system: customPrompt ?? `Tu es Coachello Intelligence, l'assistant IA de l'équipe commerciale de Coachello.
Tu as accès en temps réel aux données HubSpot CRM via tes outils (contacts, deals, entreprises).
Quand une question porte sur des données commerciales, utilise systématiquement tes outils pour récupérer les vraies données.
Réponds en français, de façon concise et orientée action. Formate les listes avec des tirets.`,
            tools,
            messages: currentMessages,
          });

          // Stream text deltas
          apiStream.on("text", (delta) => send({ type: "text", text: delta }));

          const message = await apiStream.finalMessage();

          if (message.stop_reason === "end_turn") {
            send({ type: "done" });
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
                const result = await executeTool(tool.name, tool.input as Record<string, unknown>);
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
            continue;
          }

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
