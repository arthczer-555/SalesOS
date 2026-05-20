import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { repairAnalysis, type SalesCoachAnalysis } from "@/lib/guides/sales-coach";
import type { DealSnapshot } from "@/lib/hubspot";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

const draftTool: Anthropic.Tool = {
  name: "email_draft",
  description: "Retourne un brouillon d'email de suivi post-meeting",
  input_schema: {
    type: "object" as const,
    properties: {
      subject: { type: "string", description: "Sujet de l'email — court, accroche-réfléchie" },
      body: { type: "string", description: "Corps du mail en texte brut, ton chaleureux et concret. Pas de markdown." },
    },
    required: ["subject", "body"],
  },
};

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const { data: userRow } = await db.from("users").select("is_admin, name").eq("id", user.id).single();
  const isAdmin = !!userRow?.is_admin;

  const { data: row } = await db
    .from("sales_coach_analyses")
    .select("user_id, meeting_title, meeting_started_at, analysis, deal_snapshot, recorder_email")
    .eq("id", id)
    .single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isAdmin && row.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!row.analysis) return NextResponse.json({ error: "Analyse non disponible" }, { status: 400 });

  const analysis = repairAnalysis(row.analysis as SalesCoachAnalysis);
  const snapshot = row.deal_snapshot as DealSnapshot | null;

  // Resolve model preference (sales_coach key)
  let model = DEFAULT_MODEL;
  const { data: prefs } = await db.from("guide_defaults").select("content").eq("key", "model_preferences").single();
  try {
    if (prefs?.content) {
      model = (JSON.parse(prefs.content) as Record<string, string>).sales_coach ?? model;
    }
  } catch { /* keep default */ }

  const senderName = userRow?.name?.trim() || row.recorder_email || "L'équipe Coachello";
  const contactNames = (snapshot?.contacts ?? [])
    .map((c) => `${c.firstname} ${c.lastname}`.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
  const meetingDate = row.meeting_started_at
    ? new Date(row.meeting_started_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })
    : null;

  const userPrompt = [
    `Tu rédiges un email de suivi commercial post-meeting pour ${senderName}.`,
    `Le mail est envoyé à : ${contactNames || "le prospect"}.`,
    `Meeting : ${row.meeting_title}${meetingDate ? ` (${meetingDate})` : ""}.`,
    snapshot ? `Deal : ${snapshot.name} · ${snapshot.stage_label ?? snapshot.stage} · ${snapshot.amount ? `${snapshot.amount}€` : "—"}.` : "",
    "",
    `Synthèse du meeting : ${analysis.summary}`,
    "",
    `Next steps validés (à confirmer dans le mail) :`,
    ...(analysis.coaching_priorities ?? []).map((p) => `- ${p}`),
    "",
    `Risques perçus côté deal : ${(analysis.risks ?? []).join(" · ") || "aucun"}.`,
    "",
    "Règles de rédaction :",
    "- ton chaleureux mais sobre, pas commercial",
    "- 4-6 phrases max",
    "- pas de markdown, pas de bullet points dans le corps",
    "- inclure 1-2 next steps concrets, datés si possible",
    "- finir par une signature simple avec le prénom",
    "- jamais inventer un fait, un chiffre, un engagement non discuté",
    "",
    "Utilise l'outil email_draft pour retourner le sujet + le corps.",
  ].filter(Boolean).join("\n");

  const client = new Anthropic({ timeout: 60_000 });
  const message = await client.messages.create({
    model,
    max_tokens: 1500,
    messages: [{ role: "user", content: userPrompt }],
    tools: [draftTool],
    tool_choice: { type: "tool" as const, name: "email_draft" },
  });

  logUsage(user.id, model, message.usage.input_tokens, message.usage.output_tokens, "sales_coach_email_draft");

  const block = message.content.find((b) => b.type === "tool_use");
  if (!block || !("input" in block)) {
    return NextResponse.json({ error: "No tool_use block in response" }, { status: 500 });
  }

  const draft = block.input as { subject: string; body: string };

  await db
    .from("sales_coach_analyses")
    .update({
      email_draft: { ...draft, generated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  return NextResponse.json({ ...draft });
}
