import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

function getDefaultPrompt(): string {
  const filePath = path.join(process.cwd(), "prompt-guide.txt");
  return fs.readFileSync(filePath, "utf-8");
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
    "dealname", "dealstage", "amount", "closedate", "pipeline",
    "hubspot_owner_id", "hs_lastmodifieddate", "createdate",
    "description", "hs_deal_stage_probability", "hs_is_closed",
    "hs_is_closed_won", "num_associated_contacts", "notes_last_contacted",
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
      "Récupère tous les deals actifs HubSpot (hors closedwon/closedlost), triés par activité récente. Utilise cet outil pour avoir une vue globale du pipeline.",
    input_schema: {
      type: "object" as const,
      properties: {},
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
    description: "Récupère les notes, emails, appels et activités associés à un deal spécifique. Utilise cet outil pour comprendre l'historique d'un deal.",
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
];

// ── Tool execution ────────────────────────────────────────────────────────────
async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "search_contacts": {
      const props = getPropertyNames("contacts");
      const data = await hubspot("/crm/v3/objects/contacts/search", "POST", {
        query: input.query,
        limit: input.limit || 10,
        properties: props,
      });
      const results = (data.results ?? []).map((r: { id: string; properties: Record<string, unknown> }) => ({
        id: r.id,
        properties: stripEmpty(r.properties),
      }));
      return JSON.stringify(results);
    }
    case "search_deals": {
      const props = getPropertyNames("deals");
      const data = await hubspot("/crm/v3/objects/deals/search", "POST", {
        query: input.query,
        limit: input.limit || 10,
        properties: props,
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
      do {
        const data = await hubspot("/crm/v3/objects/deals/search", "POST", {
          filterGroups: [
            {
              filters: [
                { propertyName: "dealstage", operator: "NEQ", value: "closedwon" },
                { propertyName: "dealstage", operator: "NEQ", value: "closedlost" },
              ],
            },
          ],
          sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
          limit: 200,
          ...(after ? { after } : {}),
          properties: props,
        });
        for (const r of (data.results ?? []) as { id: string; properties: Record<string, unknown> }[]) {
          allResults.push({ id: r.id, properties: stripEmpty(r.properties) });
        }
        after = (data.paging as { next?: { after?: string } } | undefined)?.next?.after;
      } while (after);
      return JSON.stringify(allResults);
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
      const [notes, emails, calls] = await Promise.allSettled([
        hubspot(`/crm/v3/objects/notes/search`, "POST", {
          filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: input.deal_id }] }],
          properties: ["hs_note_body", "hs_timestamp"],
          limit: 20,
        }),
        hubspot(`/crm/v3/objects/emails/search`, "POST", {
          filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: input.deal_id }] }],
          properties: ["hs_email_subject", "hs_email_text", "hs_timestamp", "hs_email_direction"],
          limit: 10,
        }),
        hubspot(`/crm/v3/objects/calls/search`, "POST", {
          filterGroups: [{ filters: [{ propertyName: "associations.deal", operator: "EQ", value: input.deal_id }] }],
          properties: ["hs_call_title", "hs_call_body", "hs_timestamp"],
          limit: 10,
        }),
      ]);
      return JSON.stringify({
        notes: notes.status === "fulfilled" ? notes.value.results ?? [] : [],
        emails: emails.status === "fulfilled" ? emails.value.results ?? [] : [],
        calls: calls.status === "fulfilled" ? calls.value.results ?? [] : [],
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
      const channelsData = await slack("/conversations.list", { limit: "200", types: "public_channel,private_channel,mpim" });
      const allChannels: { name: string; id: string }[] = channelsData.channels ?? [];
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
      const channelsData = await slack("/conversations.list", { limit: "200", types: "public_channel,private_channel" });
      const channel = (channelsData.channels ?? []).find(
        (c: { name: string; id: string }) => c.name === (input.channel_name as string).replace("#", "")
      );
      if (!channel) return `Canal "${input.channel_name}" introuvable.`;

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
        const channelsData = await slack("/conversations.list", { limit: "200", types: "public_channel,private_channel" });
        const ch = (channelsData.channels ?? []).find(
          (c: { name: string; id: string }) => c.name === target.replace("#", "")
        );
        if (!ch) return `Canal "${target}" introuvable.`;
        channelId = ch.id;
      }

      await slackPost("/chat.postMessage", {
        channel: channelId,
        text: input.message as string,
      });
      return `Message envoyé dans "${target}".`;
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
  } else {
    // Local dev fallback — no Supabase configured
    claudeApiKey = process.env.ANTHROPIC_API_KEY ?? "";
  }

  const client = new Anthropic({ apiKey: claudeApiKey });

  // Fetch user's personal prompt from DB (fallback to default file)
  let systemPrompt: string;
  if (process.env.SUPABASE_URL) {
    const { data: userData } = await db
      .from("users")
      .select("user_prompt")
      .eq("id", user.id)
      .single();
    systemPrompt = userData?.user_prompt ?? getDefaultPrompt();
  } else {
    systemPrompt = getDefaultPrompt();
  }

  const { messages, model: requestedModel } = await req.json();
  const model = requestedModel ?? "claude-haiku-4-5";

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        let currentMessages: Anthropic.MessageParam[] = messages;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        // Agentic loop
        while (true) {
          const apiStream = client.messages.stream({
            model,
            max_tokens: 4096,
            system: systemPrompt,
            tools,
            messages: currentMessages,
          });

          // Stream text deltas
          apiStream.on("text", (delta) => send({ type: "text", text: delta }));

          const message = await apiStream.finalMessage();
          totalInputTokens += message.usage.input_tokens;
          totalOutputTokens += message.usage.output_tokens;

          if (message.stop_reason === "end_turn") {
            // Send full message history (with tool calls) back to client for next turn
            currentMessages = [...currentMessages, { role: "assistant", content: message.content }];
            send({ type: "history", messages: currentMessages });
            send({ type: "done" });
            // Log usage asynchronously (fire-and-forget)
            if (process.env.SUPABASE_URL) {
              void Promise.resolve(
                db.from("usage_logs").insert({
                  user_id: user.id,
                  model,
                  input_tokens: totalInputTokens,
                  output_tokens: totalOutputTokens,
                })
              );
            }
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
