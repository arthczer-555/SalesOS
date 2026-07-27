import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { repairAnalysis, type SalesCoachAnalysis } from "@/lib/guides/sales-coach";
import { NO_EM_DASH_RULE, stripEmDashes } from "@/lib/no-em-dash";
import type { DealSnapshot } from "@/lib/hubspot";
import { anthropicClient } from "@/lib/anthropic-client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

const draftTool: Anthropic.Tool = {
  name: "email_draft",
  description: "Retourne un brouillon d'email de suivi post-meeting",
  input_schema: {
    type: "object" as const,
    properties: {
      subject: { type: "string", description: "Sujet de l'email, court, accroche-réfléchie" },
      body: { type: "string", description: "Corps du mail en texte brut, ton chaleureux et concret. Pas de markdown." },
    },
    required: ["subject", "body"],
  },
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  // Body optionnel : sans body on régénère de zéro, avec `instructions` on
  // retouche le brouillon courant (édité côté client) selon la demande.
  const {
    instructions = "",
    currentSubject = "",
    currentBody = "",
  } = (await req.json().catch(() => ({}))) as {
    instructions?: string;
    currentSubject?: string;
    currentBody?: string;
  };
  const rewriteInstructions = instructions.trim();

  const { data: userRow } = await db.from("users").select("is_admin, name").eq("id", user.id).single();
  const isAdmin = !!userRow?.is_admin;

  const { data: row } = await db
    .from("sales_coach_analyses")
    .select("user_id, meeting_title, meeting_started_at, analysis, deal_snapshot, recorder_email, email_draft")
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

  // Brouillon de référence pour une retouche : ce que l'utilisateur a sous les
  // yeux (donc ses éditions manuelles), sinon la dernière version enregistrée.
  const storedDraft = (row.email_draft ?? null) as { subject?: string; body?: string } | null;
  const baseSubject = currentSubject.trim() || storedDraft?.subject?.trim() || "";
  const baseBody = currentBody.trim() || storedDraft?.body?.trim() || "";
  const isRewrite = Boolean(rewriteInstructions && baseBody);

  const userPrompt = [
    `Tu rédiges un email de suivi commercial post-meeting pour ${senderName}.`,
    `Le mail est envoyé à : ${contactNames || "le prospect"}.`,
    `Meeting : ${row.meeting_title}${meetingDate ? ` (${meetingDate})` : ""}.`,
    snapshot ? `Deal : ${snapshot.name} · ${snapshot.stage_label ?? snapshot.stage} · ${snapshot.amount ? `${snapshot.amount}€` : "-"}.` : "",
    "",
    `Synthèse du meeting : ${analysis.summary}`,
    "",
    `Next steps validés (à confirmer dans le mail) :`,
    ...(analysis.coaching_priorities ?? []).map((p) => `- ${p}`),
    "",
    `Risques perçus côté deal : ${(analysis.risks ?? []).join(" · ") || "aucun"}.`,
    "",
    "Règles de rédaction :",
    "- LANGUE : détecte la langue dominante de la Synthèse du meeting et des Next steps. Sinon, repli sur le français. Rédige TOUT (subject, body, signature) dans cette langue. Si la synthèse est en anglais, écris en anglais ; en espagnol, en espagnol ; etc.",
    isRewrite
      ? "- Les instructions de réécriture ne définissent PAS la langue : garde celle de l'email actuel, sauf si l'utilisateur demande explicitement une autre langue."
      : "",
    "- ton chaleureux mais sobre, pas commercial",
    "- 4-6 phrases max",
    "- pas de markdown, pas de bullet points dans le corps",
    "- inclure 1-2 next steps concrets, datés si possible",
    "- finir par une signature simple avec le prénom",
    "- jamais inventer un fait, un chiffre, un engagement non discuté",
    `- ${NO_EM_DASH_RULE}`,
    isRewrite
      ? "- En cas de conflit, les INSTRUCTIONS DE RÉÉCRITURE priment sur les règles de longueur et de ton ci-dessus."
      : "",
    isRewrite ? `\nEMAIL ACTUEL (à retoucher) :\nObjet : ${baseSubject}\n\n${baseBody}` : "",
    isRewrite ? `\nINSTRUCTIONS DE RÉÉCRITURE DE L'UTILISATEUR :\n${rewriteInstructions}` : "",
    isRewrite
      ? "\nRetouche cet email en respectant ces instructions. Ne change que ce qui est demandé, garde le reste tel quel."
      : "",
    "",
    "Utilise l'outil email_draft pour retourner le sujet + le corps.",
  ].filter(Boolean).join("\n");

  const client = anthropicClient({ timeout: 60_000 });
  const message = await client.messages.create({
    model,
    max_tokens: 1500,
    messages: [{ role: "user", content: userPrompt }],
    tools: [draftTool],
    tool_choice: { type: "tool" as const, name: "email_draft" },
  });

  logUsage(
    user.id,
    model,
    message.usage.input_tokens,
    message.usage.output_tokens,
    isRewrite ? "sales_coach_email_rewrite" : "sales_coach_email_draft",
  );

  const block = message.content.find((b) => b.type === "tool_use");
  if (!block || !("input" in block)) {
    return NextResponse.json({ error: "No tool_use block in response" }, { status: 500 });
  }

  const rawDraft = block.input as { subject: string; body: string };
  const draft = {
    subject: stripEmDashes(rawDraft.subject ?? ""),
    body: stripEmDashes(rawDraft.body ?? ""),
  };

  await db
    .from("sales_coach_analyses")
    .update({
      email_draft: { ...draft, generated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  return NextResponse.json({ ...draft });
}
