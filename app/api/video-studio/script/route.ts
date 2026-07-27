import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { VIDEO_SCRIPT_GUIDE } from "@/lib/guides/video-script";
import { stripEmDashes } from "@/lib/no-em-dash";
import { lookupClientByName, loadClientContextById } from "@/lib/clients/video-context";
import { anthropicClient } from "@/lib/anthropic-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function defaultModel(): Promise<string> {
  const { data } = await db.from("guide_defaults").select("content").eq("key", "model_preferences").single();
  try {
    return (JSON.parse(data?.content ?? "{}") as Record<string, string>).deals_email ?? "claude-sonnet-4-6";
  } catch {
    return "claude-sonnet-4-6";
  }
}

const CLIENT_TOOL: Anthropic.Tool = {
  name: "get_client_context",
  description:
    "Look up an existing Coachello client/account by company name and return its internal context (coach brief, deal recap, insights). Call this when the request mentions a specific client or company we work with, to ground the script in real data. Returns 'no match' if the company is not a known client.",
  input_schema: {
    type: "object",
    properties: {
      company_name: { type: "string", description: "The client/company name mentioned in the request" },
    },
    required: ["company_name"],
  },
};

type Matched = { id: string; name: string };

function extractText(content: Anthropic.ContentBlock[]): string {
  return stripEmDashes(content.map((b) => (b.type === "text" ? b.text : "")).join("").trim());
}

// POST /api/video-studio/script
// Body: { prompt: string; clientId?: string }
// Génère un script de vidéo parlé. Si clientId est fourni (lien direct depuis la
// fiche client), le contexte est injecté d'office. Sinon Claude décide lui-même
// d'appeler get_client_context quand la demande vise un client connu, ou rédige
// depuis ses connaissances.
// Renvoie { script, client: { id, name } | null }.
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY missing" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { prompt?: string; clientId?: string };
  const prompt = (body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });

  const model = await defaultModel();
  const anthropic = anthropicClient();
  let matched: Matched | null = null;

  // Cas 1 : client forcé via lien direct -> contexte injecté, pas d'outil.
  if (body.clientId) {
    const ctx = await loadClientContextById(body.clientId);
    if (ctx) matched = { id: ctx.client.id, name: ctx.client.company_name };
    const userPrompt = [
      "Demande de l'utilisateur (sujet de la vidéo) :",
      prompt,
      "",
      "Contexte du client (à utiliser) :",
      ctx?.text ?? "(client introuvable)",
    ].join("\n");

    const message = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: VIDEO_SCRIPT_GUIDE,
      messages: [{ role: "user", content: userPrompt }],
    });
    logUsage(user.id, model, message.usage.input_tokens, message.usage.output_tokens, "video_script");
    const script = extractText(message.content);
    return NextResponse.json({ script, client: matched });
  }

  // Cas 2 : boucle agentique. Claude peut appeler get_client_context par nom.
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  let script = "";

  for (let i = 0; i < 4; i++) {
    const message = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: VIDEO_SCRIPT_GUIDE,
      tools: [CLIENT_TOOL],
      messages,
    });
    logUsage(user.id, model, message.usage.input_tokens, message.usage.output_tokens, "video_script");

    if (message.stop_reason === "tool_use") {
      const toolUses = message.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const name = (tu.input as { company_name?: string }).company_name ?? "";
        const ctx = await lookupClientByName(name);
        if (ctx && !matched) matched = { id: ctx.client.id, name: ctx.client.company_name };
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: ctx ? ctx.text : `No client matching "${name}" in our database.`,
        });
      }
      messages.push({ role: "assistant", content: message.content });
      messages.push({ role: "user", content: results });
      continue;
    }

    script = extractText(message.content);
    break;
  }

  return NextResponse.json({ script, client: matched });
}
