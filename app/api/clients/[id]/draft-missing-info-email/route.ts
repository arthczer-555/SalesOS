import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import {
  getMissingRecommendedFields,
  getMissingRequiredFields,
  type ClientFields,
  type ClientRow,
  type MissingInfoEmailDraft,
} from "@/lib/clients/types";
import { NO_EM_DASH_RULE, stripEmDashes } from "@/lib/no-em-dash";
import { anthropicClient } from "@/lib/anthropic-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function defaultModel(): Promise<string> {
  const { data } = await db.from("guide_defaults").select("content").eq("key", "model_preferences").single();
  try {
    return (JSON.parse(data?.content ?? "{}") as Record<string, string>).deals_email ?? "claude-haiku-4-5-20251001";
  } catch {
    return "claude-haiku-4-5-20251001";
  }
}

// Interlocuteur : signataire en priorite, sinon contact RH principal.
function pickContact(fields: Partial<ClientFields>): { name: string; email: string } {
  const gi = (fields.general_info ?? {}) as Record<string, { value?: { name?: string; email?: string } | null }>;
  for (const key of ["contact_signataire", "contact_principal_rh", "contact_rh_operationnel"]) {
    const v = gi[key]?.value;
    if (v && (v.name || v.email)) return { name: v.name ?? "", email: v.email ?? "" };
  }
  return { name: "", email: "" };
}

async function generateDraft(client: ClientRow, senderName: string, userId: string): Promise<MissingInfoEmailDraft> {
  const fields = (client.fields_json ?? {}) as Partial<ClientFields>;

  // Infos manquantes = champs de NOTRE contexte (la fiche) qu'on ne connait pas
  // encore. On NE demande PAS les champs HubSpot (internes, non pertinents pour
  // l'interlocuteur).
  const missing = [...getMissingRequiredFields(fields), ...getMissingRecommendedFields(fields)].map((m) => m.label);

  const contact = pickContact(fields);

  const contextBlock = [
    `Société cliente : ${client.company_name}`,
    contact.name ? `Interlocuteur : ${contact.name}` : null,
    contact.email ? `Email interlocuteur : ${contact.email}` : null,
    senderName ? `Expéditeur (nous) : ${senderName}` : null,
    "",
    "Informations manquantes à demander :",
    ...(missing.length
      ? missing.map((m) => `- ${m}`)
      : ["- (aucune information précise manquante, formuler une demande générale de finalisation d'onboarding)"]),
  ]
    .filter((l) => l !== null)
    .join("\n");

  const systemPrompt = [
    "Tu es un Account Executive chez Coachello (coaching professionnel B2B).",
    "Tu rédiges un email court, chaleureux et professionnel à l'interlocuteur d'un client qui vient de signer, pour récupérer les informations manquantes nécessaires au démarrage (onboarding).",
    "L'email liste poliment les éléments manquants (regroupés et reformulés de façon naturelle, pas en jargon CRM), et propose un échange rapide si besoin.",
    "LANGUE : détecte la langue dominante à partir du nom de l'interlocuteur et du contexte fourni ; en cas de doute, repli sur le français. Rédige TOUT (subject, body) dans cette langue.",
    NO_EM_DASH_RULE,
    'Réponds UNIQUEMENT en JSON valide : { "subject": "...", "body": "..." }',
    "Le body est en texte brut (pas de HTML, pas de markdown), avec une formule d'appel et une signature au nom de l'expéditeur.",
  ].join("\n");

  const model = await defaultModel();
  const anthropic = anthropicClient();
  const message = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: `Rédige l'email de demande d'informations manquantes :\n\n${contextBlock}` }],
  });

  logUsage(userId, model, message.usage.input_tokens, message.usage.output_tokens, "clients_missing_info_email");

  const raw = message.content[0]?.type === "text" ? message.content[0].text : "";
  let subject = "";
  let body = "";
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]) as { subject?: string; body?: string };
      subject = parsed.subject ?? "";
      body = parsed.body ?? "";
    }
  } catch {
    body = raw;
  }
  subject = stripEmDashes(subject);
  body = stripEmDashes(body);

  return { to: contact.email, subject, body, missing, generated_at: new Date().toISOString() };
}

// POST /api/clients/[id]/draft-missing-info-email
// Body: { regenerate?: boolean }
//
// Renvoie le brouillon en cache (clients.missing_info_email_draft) sans rien
// regenerer. Si absent OU regenerate=true, genere via IA (langue auto), persiste
// et renvoie. Pas d'envoi : la modal review permet d'editer puis copier.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY missing" }, { status: 500 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { regenerate?: boolean };

  const { data: clientData, error } = await db.from("clients").select("*").eq("id", id).single();
  if (error || !clientData) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  const client = clientData as ClientRow;

  const cached = client.missing_info_email_draft ?? null;
  if (cached && !body.regenerate) {
    return NextResponse.json({ draft: cached, cached: true });
  }

  const senderName = user.name || user.email?.split("@")[0] || "";
  const draft = await generateDraft(client, senderName, user.id);
  await db.from("clients").update({ missing_info_email_draft: draft }).eq("id", id);

  return NextResponse.json({ draft, cached: false });
}

// PATCH /api/clients/[id]/draft-missing-info-email
// Body: { to?, subject?, body? } — persiste les editions de l'AE dans le cache.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const patch = (await req.json().catch(() => ({}))) as { to?: string; subject?: string; body?: string };

  const { data: row, error } = await db.from("clients").select("missing_info_email_draft").eq("id", id).single();
  if (error || !row) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const current = (row.missing_info_email_draft ?? null) as MissingInfoEmailDraft | null;
  if (!current) return NextResponse.json({ error: "No draft to update" }, { status: 400 });

  const updated: MissingInfoEmailDraft = {
    ...current,
    to: patch.to ?? current.to,
    subject: patch.subject ?? current.subject,
    body: patch.body ?? current.body,
  };
  const { error: updErr } = await db.from("clients").update({ missing_info_email_draft: updated }).eq("id", id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ draft: updated });
}
