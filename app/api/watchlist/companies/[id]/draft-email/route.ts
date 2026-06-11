import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getAuthenticatedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { loadCompanyHubspotContext } from "@/lib/watchlist/fetch-company-recap";
import { loadClientsRoster, formatClientsRoster } from "@/lib/watchlist/clients-roster";
import { getBriefs, type AeAnalysisContent, type HubspotRecapContent, type NewsContent } from "@/lib/watchlist/briefs";
import { DEFAULT_PROSPECTION_GUIDE } from "@/lib/guides/prospection";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MODEL = "claude-sonnet-4-6";

export interface DraftEmailResponse {
  subject: string;
  body: string;
  error?: string;
}

interface ScopeCompanyRow {
  id: string;
  name: string;
  owner: string | null;
  sector: string | null;
  current_coaching_platform: string | null;
  notes: string | null;
}

interface DraftRecipient {
  name?: string | null;
  email: string;
}

const DRAFT_TOOL: Anthropic.Tool = {
  name: "email_draft",
  description: "Retourne un brouillon d'email de prospection (objet + corps texte brut).",
  input_schema: {
    type: "object" as const,
    properties: {
      subject: { type: "string", description: "Objet de l'email, court et accrocheur, sans markdown." },
      body: {
        type: "string",
        description:
          "Corps du mail en texte brut (pas de markdown, pas de bullet points), ton humain et concret, signature avec le prénom de l'expéditeur.",
      },
    },
    required: ["subject", "body"],
  },
};

const SYSTEM_PROMPT = `Tu es un Account Executive sénior chez Coachello. Tu rédiges un email de prospection à froid ou de relance pour un compte cible.

Ton style : direct, humain, concret. Pas de jargon commercial creux, pas de tirets longs (em dash) - utilise des virgules, parenthèses ou tirets courts.
LANGUE : détecte la langue dominante du contexte fourni (emails échangés, instructions, secteur). Si le compte communique en anglais, rédige TOUT l'email en anglais ; sinon en français. En cas de doute, repli sur le français.

Règles de rédaction :
- 5 à 9 phrases maximum, un seul objet (subject) court.
- Ne jamais inventer un fait, un chiffre, un nom de client ou un engagement. Appuie-toi uniquement sur le contexte fourni.
- Si une "histoire à raconter" (social proof) est fournie, intègre-la naturellement (ex : "on accompagne déjà X dans votre secteur"). Ne cite que des clients réellement listés.
- Si des news récentes / signaux sont fournis (levée, nomination, expansion...), ancre l'accroche sur le trigger le plus pertinent et récent. N'utilise que des faits réellement présents dans le contexte.
- Si un guide de prospection est fourni, respecte son ton, sa structure et ses exemples.
- Suis les instructions de l'utilisateur en priorité si elles sont fournies.
- Termine par une signature simple avec le prénom de l'expéditeur et un call-to-action léger (ex : proposer un créneau de 20 min).
- Pas de markdown dans le corps.

Réponds UNIQUEMENT via l'outil email_draft.`;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    instructions?: string;
    recipients?: DraftRecipient[];
  };
  const instructions = (body.instructions ?? "").trim();
  const recipients = Array.isArray(body.recipients) ? body.recipients.filter((r) => r?.email) : [];

  const { data: company, error: companyErr } = await db
    .from("scope_companies")
    .select("id, name, owner, sector, current_coaching_platform, notes")
    .eq("id", id)
    .single<ScopeCompanyRow>();
  if (companyErr || !company) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const [{ data: userRow }, { data: globalGuideEntry }, hubspot, briefs, clientsRoster] = await Promise.all([
    db.from("users").select("name, prospection_guide").eq("id", user.id).single(),
    db.from("guide_defaults").select("content").eq("key", "prospection").single(),
    loadCompanyHubspotContext(id).catch(() => null),
    getBriefs(id).catch(() => null),
    loadClientsRoster().catch(() => []),
  ]);
  const senderName = userRow?.name?.trim() || user.email || "L'équipe Coachello";
  const guide = userRow?.prospection_guide ?? globalGuideEntry?.content ?? DEFAULT_PROSPECTION_GUIDE;

  const ae = briefs?.ae_analysis?.content ?? null;
  const news = briefs?.news?.content ?? null;

  const userPrompt = buildPrompt({
    company,
    senderName,
    instructions,
    recipients,
    hubspot,
    ae,
    news,
    rosterText: formatClientsRoster(clientsRoster),
    guide,
  });

  try {
    const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      tools: [DRAFT_TOOL],
      tool_choice: { type: "tool", name: "email_draft" },
    });

    logUsage(user.id, MODEL, message.usage.input_tokens, message.usage.output_tokens, "watchlist_email_draft");

    const block = message.content.find((b) => b.type === "tool_use");
    if (!block || !("input" in block)) {
      return NextResponse.json({ error: "Claude response without tool_use" }, { status: 500 });
    }
    const draft = block.input as { subject?: string; body?: string };
    return NextResponse.json({
      subject: typeof draft.subject === "string" ? draft.subject : "",
      body: typeof draft.body === "string" ? draft.body : "",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function buildPrompt(input: {
  company: ScopeCompanyRow;
  senderName: string;
  instructions: string;
  recipients: DraftRecipient[];
  hubspot: HubspotRecapContent | null;
  ae: AeAnalysisContent | null;
  news: NewsContent | null;
  rosterText: string;
  guide: string;
}): string {
  const { company, senderName, instructions, recipients, hubspot, ae, news, rosterText, guide } = input;
  const lines: string[] = [];

  lines.push(`Expéditeur : ${senderName} (Coachello).`);
  lines.push(`Compte cible : ${company.name}.`);
  if (company.sector) lines.push(`Secteur : ${company.sector}.`);
  if (company.current_coaching_platform) {
    lines.push(`Plateforme coaching actuelle du prospect : ${company.current_coaching_platform}.`);
  }
  if (company.notes) lines.push(`Notes internes : ${company.notes}`);

  // Destinataires
  lines.push("");
  if (recipients.length > 0) {
    const names = recipients
      .map((r) => (r.name && r.name.trim() ? `${r.name.trim()} <${r.email}>` : r.email))
      .join(", ");
    lines.push(`Destinataires : ${names}.`);
  } else {
    lines.push("Destinataires : non précisés (rédige un email générique adressable au prospect).");
  }

  // Instructions utilisateur (priorité)
  if (instructions) {
    lines.push("");
    lines.push("## Instructions de l'utilisateur (à suivre en priorité)");
    lines.push(instructions);
  }

  // Guide de prospection (style, structure, exemples)
  if (guide) {
    lines.push("");
    lines.push("## Guide de prospection (ton, structure, exemples à respecter)");
    lines.push(guide);
  }

  // Analyse AE
  if (ae) {
    lines.push("");
    lines.push("## Analyse AE (contexte stratégique)");
    if (ae.strategy) lines.push(`Stratégie : ${ae.strategy}`);
    if (ae.story_to_tell) lines.push(`Histoire à raconter (social proof) : ${ae.story_to_tell}`);
    if (ae.priority_contacts?.length) {
      lines.push("Contacts prioritaires et angles :");
      for (const c of ae.priority_contacts.slice(0, 5)) {
        lines.push(`- ${c.name}${c.role ? ` (${c.role})` : ""} - angle : ${c.angle}`);
      }
    }
  }

  // News récentes / signaux marché (triés récents d'abord en amont)
  if (news && (news.intel_summary || news.signals.length > 0)) {
    lines.push("");
    lines.push("## News récentes & signaux (fenêtre 90 jours, plus récents d'abord)");
    if (news.intel_summary) lines.push(`Synthèse : ${news.intel_summary}`);
    if (news.signals.length > 0) {
      lines.push("Signaux :");
      for (const s of news.signals.slice(0, 5)) {
        const date = s.created_at ? ` [${s.created_at}]` : "";
        lines.push(`- (${s.type})${date} ${s.title}${s.excerpt ? ` - ${s.excerpt}` : ""}`);
      }
    }
  }

  // Emails échangés (ton, relation)
  const emails = hubspot?.engagements.filter((e) => e.type === "email") ?? [];
  if (emails.length > 0) {
    lines.push("");
    lines.push(`## Derniers emails échangés (${emails.length}, pour caler le ton et la relation)`);
    for (const e of emails.slice(0, 6)) {
      const date = e.date ? new Date(e.date).toLocaleDateString("fr-FR") : "?";
      const dir = e.direction === "in" ? "ENTRANT" : "SORTANT";
      lines.push(`- [${date}] (${dir}) ${e.title ?? "(sans objet)"} : ${e.body.slice(0, 300)}`);
    }
  }

  // Roster clients (référence pour la story)
  lines.push("");
  lines.push("## Nos clients actuels (référence sociale, ne cite que ceux-ci)");
  lines.push(rosterText);

  lines.push("");
  lines.push("Rédige maintenant l'email via l'outil email_draft.");

  return lines.join("\n");
}
