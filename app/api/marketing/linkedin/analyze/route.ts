import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { getCompanyPosts } from "@/lib/netrows";
import { logUsage } from "@/lib/log-usage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  if (!process.env.NETROWS_API_KEY) {
    return NextResponse.json({ error: "Netrows non configuré" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { username?: string; name?: string };
  if (!body.username) return NextResponse.json({ error: "username requis" }, { status: 400 });

  try {
    const postsRes = await getCompanyPosts(body.username);
    const posts = (postsRes.data ?? []).slice(0, 10);
    if (posts.length === 0) {
      return NextResponse.json({ error: "Aucun post à analyser" }, { status: 400 });
    }

    const block = posts
      .map((p, i) => `[${i + 1}] (${p.likes} likes, ${p.comments} commentaires) ${p.text?.slice(0, 500) ?? ""}`)
      .join("\n\n---\n\n");

    const client = new Anthropic();
    const model = "claude-haiku-4-5-20251001";
    const message = await client.messages.create({
      model,
      max_tokens: 1500,
      system:
        "Tu analyses la stratégie de contenu LinkedIn d'un concurrent. Tu dois être concis, structuré, et orienté insights actionnables pour une équipe sales/marketing B2B SaaS.",
      messages: [
        {
          role: "user",
          content: `Analyse les 10 derniers posts LinkedIn de ${body.name ?? body.username} :\n\n${block}\n\nRends ton analyse au format JSON strict :\n{\n  "themes": ["thème 1", "thème 2", ...],\n  "tonality": "description courte du ton (1 phrase)",\n  "ctas": ["CTA récurrent 1", ...],\n  "topPerformers": ["résumé du post le plus engageant", ...],\n  "differentiators": ["élément différenciant 1", ...],\n  "recommendation": "1 phrase d'opportunité pour notre stratégie"\n}`,
        },
      ],
    });

    logUsage(user.id, model, message.usage.input_tokens, message.usage.output_tokens, "marketing_linkedin_analyze");

    const raw = message.content[0].type === "text" ? message.content[0].text : "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

    return NextResponse.json({ analysis: parsed });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
