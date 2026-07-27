import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { loadCompanyHubspotContext } from "@/lib/watchlist/fetch-company-recap";
import { loadClientsRoster, formatClientsRoster } from "@/lib/watchlist/clients-roster";
import { getBriefs, type AeAnalysisContent, type HubspotRecapContent, type NewsContent } from "@/lib/watchlist/briefs";
import { DEFAULT_PROSPECTION_GUIDE } from "@/lib/guides/prospection";
import { NO_EM_DASH_RULE, stripEmDashes } from "@/lib/no-em-dash";
import { anthropicClient } from "@/lib/anthropic-client";

const MODEL = "claude-sonnet-4-6";

export interface DraftRecipient {
  name?: string | null;
  email: string;
}

export interface ScopeCompanyRow {
  id: string;
  name: string;
  owner: string | null;
  sector: string | null;
  current_coaching_platform: string | null;
  notes: string | null;
}

export interface DraftEmailParams {
  scopeCompanyId: string;
  userId: string;
  userEmail?: string | null;
  instructions?: string;
  recipients?: DraftRecipient[];
  personalized?: boolean;
}

export interface DraftEmailResult {
  subject: string;
  body: string;
  error?: string;
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

Ton style : direct, humain, concret. Pas de jargon commercial creux.
${NO_EM_DASH_RULE}
LANGUE : rédige dans la langue du PROSPECT, pas celle des instructions. Détecte-la depuis le compte lui-même : pays et implantation de l'entreprise, langue des emails reçus de leur part, langue de ses news. Un compte non francophone = anglais, même si les instructions sont en français (sauf si l'utilisateur demande explicitement une langue). En cas de doute, rédige TOUT l'email en anglais.

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

/**
 * Moteur de rédaction d'email de prospection, partagé entre la route
 * /api/watchlist/companies/[id]/draft-email et le flux "act" de la page Signals.
 * Charge le contexte (HubSpot, briefs, roster, guide) et appelle Claude Sonnet.
 */
export async function draftProspectionEmail(params: DraftEmailParams): Promise<DraftEmailResult> {
  const instructions = (params.instructions ?? "").trim();
  const recipients = (params.recipients ?? []).filter((r) => r?.email);
  const personalized = params.personalized === true;

  const { data: company, error: companyErr } = await db
    .from("scope_companies")
    .select("id, name, owner, sector, current_coaching_platform, notes")
    .eq("id", params.scopeCompanyId)
    .single<ScopeCompanyRow>();
  if (companyErr || !company) {
    return { subject: "", body: "", error: "Account not found" };
  }

  const [{ data: userRow }, { data: globalGuideEntry }, hubspot, briefs, clientsRoster] = await Promise.all([
    db.from("users").select("name, prospection_guide").eq("id", params.userId).single(),
    db.from("guide_defaults").select("content").eq("key", "prospection").single(),
    loadCompanyHubspotContext(params.scopeCompanyId).catch(() => null),
    getBriefs(params.scopeCompanyId).catch(() => null),
    loadClientsRoster().catch(() => []),
  ]);
  const senderName = userRow?.name?.trim() || params.userEmail || "L'équipe Coachello";
  const guide = userRow?.prospection_guide ?? globalGuideEntry?.content ?? DEFAULT_PROSPECTION_GUIDE;

  const userPrompt = buildPrompt({
    company,
    senderName,
    instructions,
    recipients,
    personalized,
    hubspot,
    ae: briefs?.ae_analysis?.content ?? null,
    news: briefs?.news?.content ?? null,
    rosterText: formatClientsRoster(clientsRoster),
    guide,
  });

  try {
    const client = anthropicClient({ timeout: 60_000, maxRetries: 1 });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      tools: [DRAFT_TOOL],
      tool_choice: { type: "tool", name: "email_draft" },
    });
    logUsage(params.userId, MODEL, message.usage.input_tokens, message.usage.output_tokens, "watchlist_email_draft");

    const block = message.content.find((b) => b.type === "tool_use");
    if (!block || !("input" in block)) {
      return { subject: "", body: "", error: "Claude response without tool_use" };
    }
    const draft = block.input as { subject?: string; body?: string };
    return {
      subject: typeof draft.subject === "string" ? stripEmDashes(draft.subject) : "",
      body: typeof draft.body === "string" ? stripEmDashes(draft.body) : "",
    };
  } catch (e) {
    return { subject: "", body: "", error: e instanceof Error ? e.message : String(e) };
  }
}

function buildPrompt(input: {
  company: ScopeCompanyRow;
  senderName: string;
  instructions: string;
  recipients: DraftRecipient[];
  personalized: boolean;
  hubspot: HubspotRecapContent | null;
  ae: AeAnalysisContent | null;
  news: NewsContent | null;
  rosterText: string;
  guide: string;
}): string {
  const { company, senderName, instructions, recipients, personalized, hubspot, ae, news, rosterText, guide } = input;
  const lines: string[] = [];

  lines.push(`Expéditeur : ${senderName} (Coachello).`);
  lines.push(`Compte cible : ${company.name}.`);
  if (company.sector) lines.push(`Secteur : ${company.sector}.`);
  if (company.current_coaching_platform) {
    lines.push(`Plateforme coaching actuelle du prospect : ${company.current_coaching_platform}.`);
  }
  if (company.notes) lines.push(`Notes internes : ${company.notes}`);

  lines.push("");
  if (recipients.length > 0) {
    const names = recipients
      .map((r) => (r.name && r.name.trim() ? `${r.name.trim()} <${r.email}>` : r.email))
      .join(", ");
    lines.push(`Destinataires : ${names}.`);
  } else {
    lines.push("Destinataires : non précisés (rédige un email générique adressable au prospect).");
  }

  if (personalized) {
    lines.push("");
    lines.push("## Mode envoi personnalisé (IMPORTANT)");
    lines.push(
      "Ce brouillon sera envoyé individuellement à chaque destinataire, avec son prénom injecté automatiquement.",
    );
    lines.push(
      'Commence le mail par une salutation contenant le token littéral "[first name]" (ou "[prénom]" si le mail est en français). N\'écris JAMAIS un vrai prénom : le token sera remplacé pour chaque prospect.',
    );
    lines.push(
      "Le reste du mail doit convenir à TOUS les destinataires : ne mentionne ni le nom, ni le rôle d'une personne en particulier.",
    );
  }

  if (instructions) {
    lines.push("");
    lines.push("## Instructions de l'utilisateur (à suivre en priorité)");
    lines.push(instructions);
  }

  if (guide) {
    lines.push("");
    lines.push("## Guide de prospection (ton, structure, exemples à respecter)");
    lines.push(guide);
  }

  if (ae) {
    lines.push("");
    lines.push("## Analyse AE (contexte stratégique)");
    if (ae.relationship_state) lines.push(`État de la relation : ${ae.relationship_state}`);
    if (ae.state_summary) lines.push(`Situation : ${ae.state_summary}`);
    if (ae.strategy) lines.push(`Stratégie : ${ae.strategy}`);
    if (ae.story_to_tell) lines.push(`Histoire à raconter (social proof) : ${ae.story_to_tell}`);
    if (ae.priority_contacts?.length) {
      lines.push("Contacts prioritaires (rationale, et message d'ouverture proposé par l'analyse AE, à réutiliser comme base si le destinataire correspond) :");
      for (const c of ae.priority_contacts.slice(0, 5)) {
        const hook = c.opening_message ?? c.angle;
        lines.push(`- ${c.name}${c.role ? ` (${c.role})` : ""} - ${c.rationale}`);
        if (c.opening_subject) lines.push(`  Objet proposé : ${c.opening_subject}`);
        if (hook) lines.push(`  Message proposé : ${hook.replace(/\n/g, " / ")}`);
      }
    }
    if (ae.linkedin?.length) {
      lines.push("");
      lines.push(
        "LinkedIn des prospects (poste, posts perso récents) - sers-t'en pour personnaliser sur un fait réel du destinataire, sans jamais inventer :",
      );
      for (const p of ae.linkedin.slice(0, 5)) {
        lines.push(`- ${p.name}${p.currentPosition ? ` (${p.currentPosition})` : ""}`);
        for (const post of p.posts.slice(0, 2)) {
          lines.push(`  Post : ${post.text.slice(0, 200).replace(/\n/g, " ")}`);
        }
      }
    }
  }

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

  lines.push("");
  lines.push("## Nos clients actuels (référence sociale, ne cite que ceux-ci)");
  lines.push(rosterText);

  lines.push("");
  lines.push("Rédige maintenant l'email via l'outil email_draft.");

  return lines.join("\n");
}
