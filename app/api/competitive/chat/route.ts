import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return new Response("Non authentifié", { status: 401 });

  const { question, competitorIds } = await req.json();
  if (!question?.trim()) return new Response("Question manquante", { status: 400 });

  // Build context from stored competitors + signals
  const { data: competitors } = await db
    .from("competitors")
    .select("id, name, website, category, description")
    .eq("user_id", user.id);

  const ids = competitorIds?.length
    ? competitorIds
    : (competitors ?? []).map((c: { id: string }) => c.id);

  const { data: signals } = await db
    .from("competitive_signals")
    .select("competitor_name, type, title, summary, signal_date, confidence")
    .in("competitor_id", ids.length > 0 ? ids : ["none"])
    .order("signal_date", { ascending: false })
    .limit(40);

  const competitorContext = (competitors ?? [])
    .map((c: { name: string; website: string | null; category: string; description: string | null }) =>
      `- ${c.name} (${c.category})${c.website ? ` — ${c.website}` : ""}${c.description ? ` : ${c.description}` : ""}`
    ).join("\n");

  const signalContext = (signals ?? [])
    .map((s: { competitor_name: string; type: string; signal_date: string; title: string; summary: string; confidence: string }) =>
      `[${s.competitor_name}] [${s.type.toUpperCase()}] ${s.signal_date ?? ""} — ${s.title}: ${s.summary} (${s.confidence})`
    ).join("\n");

  const systemPrompt = `Tu es un expert en intelligence concurrentielle pour Coachello (coaching professionnel B2B, France/Europe).
Tu réponds à des questions sur les concurrents de Coachello en te basant sur les données de veille disponibles et ta connaissance du marché.
Sois direct, factuel et orienté vers l'action commerciale. Réponds en français.

Concurrents surveillés :
${competitorContext || "Aucun concurrent configuré."}

Signaux de veille récents :
${signalContext || "Aucun signal disponible."}`;

  const client = new Anthropic();
  let inputTokens = 0;
  let outputTokens = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (text: string) => controller.enqueue(new TextEncoder().encode(text));
      try {
        const apiStream = await client.messages.stream({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: question }],
        });

        for await (const chunk of apiStream) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            send(chunk.delta.text);
          }
        }

        const final = await apiStream.finalMessage();
        inputTokens = final.usage.input_tokens;
        outputTokens = final.usage.output_tokens;
        logUsage(user.id, "claude-haiku-4-5-20251001", inputTokens, outputTokens);
      } catch (e) {
        send(`\n\nErreur : ${e instanceof Error ? e.message : "inconnue"}`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
