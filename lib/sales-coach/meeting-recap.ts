import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logUsage } from "../log-usage";
import type { DealSnapshot } from "../hubspot";
import { renderDealContextForPrompt } from "../hubspot";
import { extractTitleSearchHint } from "../claap";
import {
  dedupeRecipients,
  dmRecipient,
  findArthurFallbackRecipient,
  formatForwardChannelHeader,
  formatTestModeHeader,
  resolveDealOwnerRecipient,
  resolveMeetingParticipantRecipients,
  type MeetingRecipient,
} from "./slack-recipients";

const DEFAULT_RECAP_MODEL = "claude-haiku-4-5-20251001";

export type Audience = "client" | "prospect";

export type MeetingRecap = {
  context: string;
  need: string;
  risks_competition: string;
  opportunities: string;
  next_steps: string;
};

const RECAP_FIELDS: (keyof MeetingRecap)[] = [
  "context",
  "need",
  "risks_competition",
  "opportunities",
  "next_steps",
];

export const MEETING_RECAP_SYSTEM_PROMPT = `Tu es un analyste sales senior chez Coachello. À partir d'un transcript de meeting (et éventuellement du contexte global du deal HubSpot), tu produis un recap structuré en 5 sections, dans le style des debriefs internes Coachello.

Règles dures :
- Réponds UNIQUEMENT via l'outil \`meeting_recap\`.
- Langue : suis la langue dominante du transcript. Ne traduis JAMAIS. Si le transcript est en français, rends les 5 sections en français. Idem anglais. Les labels (Context, Need, etc.) sont injectés côté client — ne les répète pas dans tes valeurs.
- **Format STRICT de chaque section : 1 à 3 bullet points courts.** Un bullet = une ligne commençant par \`- \` (tiret + espace), MAX 15 mots, idéalement 8-12. Sépare chaque bullet par un VRAI saut de ligne (touche Entrée), JAMAIS par les caractères littéraux backslash-n. Aucune phrase composée, aucun paragraphe, aucun sous-bullet. Style télégraphique, dense, scannable en 5 secondes.
- N'invente JAMAIS de chiffres, montants, noms, dates, industries, employés, localisations qui ne sont pas dans les sources fournies (transcript, deal HubSpot, société HubSpot, contacts HubSpot).
- Si une section n'a vraiment rien d'utile à dire à partir des sources, **laisse-la complètement vide** (chaîne vide ""). Ne mets pas de phrase placeholder type "Aucun risque identifié" — préfère le vide. Mieux vaut un recap court et dense qu'un recap rempli de fluff.
- Priorise impitoyablement : si tu hésites entre 2 et 3 bullets, garde 2. Le lecteur veut l'essentiel en 30 secondes max.

---

## Si audience = CLIENT (compte gagné / Customer Success / passation)

Structure compacte, orientée Customer Success — pas de BANT, pas de concurrence.

1. **context** — Qui + rôle, objectif du meeting, statut compte. Ex: \`- Jessie (DRH Messika) + Julie/Baptiste (Coachello) — réalignement post-congés\`
2. **need** — Demandes du client (features, expansion, clarifications). Une demande = un bullet.
3. **risks_competition** — Uniquement risques INTERNES (insatisfactions, churn, blocages). Pas de concurrence.
4. **opportunities** — Upsells, use cases adjacents, expansion vers d'autres équipes.
5. **next_steps** — Actions concrètes pour le CSM/AE. Verbes d'action.

---

## Si audience = PROSPECT (deal en cours)

Structure orientée discovery / qualification — les signaux **BANT** et **BOSCHE** doivent transparaître dans les bullets pertinents (sans label explicite).

1. **context** — 1-3 bullets max parmi : interlocuteur (nom + rôle + niveau d'autorité : DM / influencer / champion / end-user), objet du meeting, contexte organisationnel pertinent (industrie/taille si disco), trigger / pain. Ne liste PAS tout — sélectionne les 2-3 infos les plus utiles.
2. **need** — Besoins prospect : features demandées, contraintes (langues, volumes), Budget si mentionné. Un besoin = un bullet.
3. **risks_competition** — Risques + concurrents + signaux Timeline. Un risque = un bullet.
4. **opportunities** — Upsells potentiels, expansion, packaging. Un par bullet.
5. **next_steps** — Actions sales rep. Verbes d'action. Inclut \`next_action\` du scorer IA si fourni.

---

## Exemple de bonne sortie (audience client, FR)

Pour la section \`context\` ci-dessous, la valeur passée à l'outil est une string où chaque bullet est séparé par un VRAI retour à la ligne (caractère newline réel, pas la séquence backslash-n) :

context :
- Jessie (PMO Messika) + Julie/Baptiste (Coachello) — réalignement post-congés
- 3 meetings à caler : acculturation coachs, webinaire onboarding, RH pilotage

need :
- Webinaire onboarding coachés en anglais, entre fin mai et début juillet
- Acculturation coachs animée par DRH Ségolène si possible
- Doc intégration Teams pour IT

risks_competition :
- IT non finalisé, démarrage 25 mai serré
- Coachés internationaux non identifiés (Maëlle/Solène en charge)

opportunities :
- Vidéo KPI 3 min pour éviter une réunion RH supplémentaire

next_steps :
- Jessie envoie doc Messika + planning international
- Coachello prépare checklist paramétrage

Note les bullets : courts, factuels, scannables. Pas de "qui revient de Thaïlande", pas de "responsable du projet (rôle exact non précisé)". Sec et utile.`;

export const meetingRecapTool: Anthropic.Tool = {
  name: "meeting_recap",
  description: "Recap structuré post-meeting (5 sections) dans la langue du transcript.",
  input_schema: {
    type: "object" as const,
    properties: {
      context: { type: "string", description: "Section Context — voir prompt système pour la structure exacte selon audience" },
      need: { type: "string", description: "Section Need (besoin prospect / client). Vide autorisé." },
      risks_competition: { type: "string", description: "Section Risks (clients) / Risks + Competition (prospects). Vide autorisé." },
      opportunities: { type: "string", description: "Section Opportunities. Vide autorisé." },
      next_steps: { type: "string", description: "Section Next Steps (for me) — actions concrètes, une par ligne. Vide autorisé." },
    },
    required: ["context", "need", "risks_competition", "opportunities", "next_steps"],
  },
};

export function repairRecap(recap: Partial<MeetingRecap> & { client_need?: string }): MeetingRecap {
  const out: MeetingRecap = {
    context: "",
    need: "",
    risks_competition: "",
    opportunities: "",
    next_steps: "",
  };
  // Backward-compat: tolerate legacy `client_need` field from older rows.
  if (typeof recap.client_need === "string" && !recap.need) {
    out.need = recap.client_need.trim();
  }
  for (const k of RECAP_FIELDS) {
    const v = recap[k];
    if (typeof v === "string") out[k] = v.trim();
  }
  return out;
}

type PriorAnalysisRow = {
  meeting_title: string | null;
  meeting_started_at: string | null;
  score_global: number | null;
  meeting_kind: string | null;
  analysis: { summary?: string } | null;
};

type DealScoreSummary = {
  total: number | null;
  reasoning: string | null;
  next_action: string | null;
};

// Pipelines whose label (case-insensitive substring) marks the deal as a
// client account — meetings on these deals skip the coaching analysis and
// get only the Slack recap. Override via env var (CSV) to add new pipelines
// (e.g. "Onboarding") without a code change.
const NON_PROSPECT_PIPELINE_KEYWORDS = (
  process.env.NON_PROSPECT_PIPELINE_LABELS ?? "customer success,passation"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Stage labels that mark a deal as won. HubSpot's `hs_is_closed_won` boolean
// is the source of truth, but it can lag on custom pipelines or come back
// missing — so we also check the human-readable stage label as a fallback.
const CLOSED_WON_STAGE_KEYWORDS = ["closed won", "closedwon", "gagné", "gagne", "won"];

/**
 * Decide whether a meeting belongs to a Client (closed-won OR a non-prospect
 * pipeline) or a Prospect. Defaults to "prospect" when no deal is attached.
 */
export function resolveAudience(snapshot: DealSnapshot | null): Audience {
  if (!snapshot) return "prospect";
  if (snapshot.is_closed_won === true) return "client";
  const stageLabel = (snapshot.stage_label ?? "").trim().toLowerCase();
  if (stageLabel && CLOSED_WON_STAGE_KEYWORDS.some((kw) => stageLabel.includes(kw))) {
    return "client";
  }
  const pipelineLabel = (snapshot.pipeline_label ?? "").trim().toLowerCase();
  if (pipelineLabel && NON_PROSPECT_PIPELINE_KEYWORDS.some((kw) => pipelineLabel.includes(kw))) {
    return "client";
  }
  return "prospect";
}

function renderPriorAnalysesForRecap(rows: PriorAnalysisRow[]): string {
  if (rows.length === 0) return "Aucun meeting Claap précédent analysé sur ce deal.";
  const lines = [`## Historique meetings analysés sur ce deal (${rows.length})`];
  for (const r of rows) {
    const date = r.meeting_started_at ? new Date(r.meeting_started_at).toLocaleDateString("fr-FR") : "?";
    const score = r.score_global != null ? `${r.score_global}/10` : "?";
    const summary = r.analysis?.summary?.slice(0, 200) ?? "";
    lines.push(`- [${date}] ${r.meeting_title ?? "?"} (${r.meeting_kind ?? "?"}, ${score})`);
    if (summary) lines.push(`  Résumé : ${summary}`);
  }
  return lines.join("\n");
}

function renderDealScoreForRecap(score: DealScoreSummary | null): string {
  if (!score) return "";
  const parts: string[] = [];
  parts.push(`## Score IA du deal`);
  if (score.total != null) parts.push(`- Total : ${score.total}/100`);
  if (score.reasoning) parts.push(`- Reasoning : ${score.reasoning}`);
  if (score.next_action) parts.push(`- Next action recommandée : ${score.next_action}`);
  return parts.length > 1 ? parts.join("\n") : "";
}

export async function generateMeetingRecap(args: {
  transcript: string;
  audience: Audience;
  dealSnapshot: DealSnapshot | null;
  dealScore: DealScoreSummary | null;
  priorAnalyses: PriorAnalysisRow[];
  meetingTitle: string | null;
  meetingStartedAt: string | null;
  userId: string | null;
  model?: string;
}): Promise<{ recap: MeetingRecap; usage: { input: number; output: number } }> {
  const model = args.model || DEFAULT_RECAP_MODEL;

  const sections: string[] = [
    `## Meeting à analyser`,
    `- Titre : ${args.meetingTitle ?? "?"}`,
    `- Date : ${args.meetingStartedAt ?? "?"}`,
    `- Audience : ${args.audience === "client" ? "CLIENT (compte existant)" : "PROSPECT (deal en cours)"}`,
  ];

  if (args.audience === "prospect") {
    sections.push("", renderDealContextForPrompt(args.dealSnapshot));
    const scoreBlock = renderDealScoreForRecap(args.dealScore);
    if (scoreBlock) sections.push("", scoreBlock);
    sections.push("", renderPriorAnalysesForRecap(args.priorAnalyses));
  } else if (args.dealSnapshot) {
    // Client : on garde uniquement l'identité (nom du compte, contacts)
    sections.push(
      "",
      `## Compte client`,
      `- Nom : ${args.dealSnapshot.name || "?"}`,
    );
    if (args.dealSnapshot.contacts.length > 0) {
      sections.push(`- Contacts connus :`);
      for (const c of args.dealSnapshot.contacts) {
        const name = `${c.firstname} ${c.lastname}`.trim() || c.email || "?";
        sections.push(`  - ${name}${c.jobtitle ? ` — ${c.jobtitle}` : ""}`);
      }
    }
  }

  sections.push("", `## Transcription du meeting`, args.transcript);

  const client = new Anthropic({ timeout: 600_000 });
  const stream = client.messages.stream({
    model,
    max_tokens: 4000,
    system: MEETING_RECAP_SYSTEM_PROMPT,
    messages: [{ role: "user", content: sections.join("\n") }],
    tools: [meetingRecapTool],
    tool_choice: { type: "tool" as const, name: "meeting_recap" },
  });
  const message = await stream.finalMessage();

  logUsage(args.userId, model, message.usage.input_tokens, message.usage.output_tokens, "sales_coach_recap");

  const toolBlock = message.content.find((b) => b.type === "tool_use");
  if (!toolBlock || !("input" in toolBlock)) throw new Error("No tool_use block in recap response");

  const recap = repairRecap(toolBlock.input as Partial<MeetingRecap>);
  return {
    recap,
    usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
  };
}

/* ─────────────────────────────────────────────────────────────────────── */
/*  Slack rendering                                                         */
/* ─────────────────────────────────────────────────────────────────────── */

function formatRecapMessage(args: {
  audience: Audience;
  companyName: string;
  stageDisplay: string | null;
  ownerName: string | null;
  meetingTitle: string;
  meetingStartedAt: string | null;
  participantsLabel: string | null;
  recap: MeetingRecap;
  dealId: string | null;
  appUrl: string;
}): string {
  const { audience, companyName, stageDisplay, ownerName, meetingTitle, meetingStartedAt, participantsLabel, recap, dealId, appUrl } = args;

  const headerParts: string[] = [`:office: *${companyName}*`];
  if (stageDisplay) headerParts.push(`_${stageDisplay}_`);
  if (ownerName) headerParts.push(ownerName);

  const dateStr = meetingStartedAt
    ? new Date(meetingStartedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })
    : null;
  const subtitleParts: string[] = [];
  if (dateStr) subtitleParts.push(`Meeting on ${dateStr}`);
  if (meetingTitle) subtitleParts.push(`"${meetingTitle}"`);

  const lines: string[] = [
    headerParts.join("  ·  "),
  ];
  if (subtitleParts.length > 0) lines.push(subtitleParts.join(" · "));

  if (participantsLabel) {
    lines.push(``, `Here's a quick rundown of my meeting with ${participantsLabel} from ${companyName}.`);
  } else {
    lines.push(``, `Here's a quick rundown of my meeting with the team at ${companyName}.`);
  }

  // Clients don't have "competition" — they're already customers. Only risks
  // (churn signals, internal blockers).
  const risksLabel = audience === "client" ? "Risks" : "Risks / Competition";
  const needLabel = audience === "client" ? "Client Need" : "Prospect Need";

  const bullets: Array<{ label: string; value: string }> = [
    { label: "Context", value: recap.context },
    { label: needLabel, value: recap.need },
    { label: risksLabel, value: recap.risks_competition },
    { label: "Opportunities", value: recap.opportunities },
    { label: "Next Steps (for me)", value: recap.next_steps },
  ];

  for (const b of bullets) {
    if (!b.value || !b.value.trim()) continue;
    lines.push(``, `• *${b.label}:*\n${b.value.trim()}`);
  }

  if (audience === "prospect" && dealId && appUrl) {
    lines.push(``, `<${appUrl}/deals?dealId=${encodeURIComponent(dealId)}|Open deal in SalesOS →>`);
  }

  return lines.join("\n");
}

function buildParticipantsLabel(snapshot: DealSnapshot | null, fallbackParticipants: string[] | null): string | null {
  // Prefer HubSpot contacts (named, with role) when available
  if (snapshot && snapshot.contacts.length > 0) {
    const names = snapshot.contacts
      .map((c) => `${c.firstname} ${c.lastname}`.trim() || c.email)
      .filter((n) => !!n)
      .slice(0, 3);
    if (names.length > 0) return formatList(names);
  }
  if (fallbackParticipants && fallbackParticipants.length > 0) {
    return formatList(fallbackParticipants.slice(0, 3));
  }
  return null;
}

function formatList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export async function sendMeetingRecapSlack(
  db: SupabaseClient,
  analysisId: string,
): Promise<{ ok: boolean; error?: string; destination?: string }> {
  const { data: row } = await db
    .from("sales_coach_analyses")
    .select(
      "id, hubspot_deal_id, claap_recording_id, recorder_email, meeting_title, meeting_started_at, deal_snapshot, meeting_recap, audience, participants, meeting_recap_slack_sent_at",
    )
    .eq("id", analysisId)
    .single();

  if (!row) return { ok: false, error: "Analysis not found" };
  if (row.meeting_recap_slack_sent_at) {
    return { ok: true, destination: "already_sent" };
  }
  if (!row.meeting_recap) return { ok: false, error: "meeting_recap missing" };

  const snapshot = (row.deal_snapshot as DealSnapshot | null) ?? null;
  const audience = (row.audience as Audience | null) ?? resolveAudience(snapshot);

  // Header bits — prefer the deal name, fall back to the associated company
  // name, then to the company hint extracted from the meeting title (e.g.
  // "Messika & Coachello" → "Messika"). Never expose the raw HubSpot deal id
  // as a user-facing label.
  const titleHint = extractTitleSearchHint(row.meeting_title, row.recorder_email ?? "");
  const companyName =
    snapshot?.name?.trim() ||
    snapshot?.company?.name?.trim() ||
    titleHint ||
    "ce deal";
  const stageDisplay = snapshot?.is_closed_won === true
    ? "Closed Won"
    : snapshot?.stage_label?.trim() || null;
  const ownerName = snapshot?.owner_name?.trim() || null;

  // Participants list (from Claap participants stored on the row, or HubSpot contacts)
  const fallbackParticipants = Array.isArray(row.participants)
    ? (row.participants as Array<{ name?: string; email?: string }>)
        .map((p) => p?.name?.trim() || p?.email?.trim() || "")
        .filter((s) => !!s)
    : null;
  const participantsLabel = buildParticipantsLabel(snapshot, fallbackParticipants);

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "").replace(/\/$/, "");

  const body = formatRecapMessage({
    audience,
    companyName,
    stageDisplay,
    ownerName,
    meetingTitle: row.meeting_title ?? "Meeting",
    meetingStartedAt: row.meeting_started_at,
    participantsLabel,
    recap: row.meeting_recap as MeetingRecap,
    dealId: row.hubspot_deal_id,
    appUrl,
  });

  // Header "modifie et envoie dans #X" — toujours présent dans le corps du
  // recap (mode test + mode prod), audience-conditional. Le commercial copie
  // le message, le retouche, et le forward dans le channel cible lui-même.
  // Pas de post automatique dans les channels.
  const forwardHeader = formatForwardChannelHeader(audience);
  const titledBody = forwardHeader
    ? `:clipboard: *RECAP MEETING*\n${forwardHeader}\n\n${body}`
    : `:clipboard: *RECAP MEETING*\n\n${body}`;

  // Résout les participants Coachello du meeting Claap (= cibles en mode
  // prod, et liste affichée dans le header test en mode test).
  const meetingParticipants: MeetingRecipient[] = row.claap_recording_id
    ? await resolveMeetingParticipantRecipients(
        row.claap_recording_id,
        row.recorder_email,
      ).catch((e) => {
        console.warn(`[meeting-recap/${analysisId}] participant resolution failed:`, e);
        return [] as MeetingRecipient[];
      })
    : [];

  const mode = process.env.SLACK_MODE === "prod" ? "prod" : "test";

  // Cibles prod = participants internes du meeting + owner HubSpot du deal
  // (dédupliqués), pour que l'AE responsable reçoive le recap même absent du
  // call.
  const ownerRecipient = await resolveDealOwnerRecipient(snapshot);
  const prodRecipients = dedupeRecipients([
    ...meetingParticipants,
    ...(ownerRecipient ? [ownerRecipient] : []),
  ]);

  let recipients: MeetingRecipient[];
  let isFallback = false;

  if (mode === "test") {
    const arthur = await findArthurFallbackRecipient();
    if (!arthur) {
      return { ok: false, error: `Slack user "${process.env.CLAAP_NOTE_SLACK_TEST_USER ?? "Arthur Czernichow"}" not found (mode=test)` };
    }
    recipients = [arthur];
  } else if (prodRecipients.length > 0) {
    recipients = prodRecipients;
  } else {
    const arthur = await findArthurFallbackRecipient();
    if (!arthur) {
      return { ok: false, error: "No Coachello participants in meeting and fallback user not found" };
    }
    recipients = [arthur];
    isFallback = true;
    console.warn(`[meeting-recap/${analysisId}] no Coachello participant detected — falling back to Arthur`);
  }

  // En mode test uniquement : préfixe le message avec le header qui explicite
  // à qui le DM serait parti en mode prod (et dans quel channel le commercial
  // devrait forwarder).
  const text = mode === "test"
    ? `${formatTestModeHeader({
        theoreticalRecipientEmails: isFallback ? [] : prodRecipients.map((r) => r.email),
        audience,
        kind: "recap",
      })}\n\n${titledBody}`
    : titledBody;

  let firstChannelId: string | null = null;
  let firstTs: string | null = null;
  let firstPermalink: string | null = null;
  let sentCount = 0;
  const failures: string[] = [];

  for (const r of recipients) {
    try {
      const { channelId, ts } = await dmRecipient(r.memberId, text);
      sentCount++;
      console.log(`[meeting-recap/${analysisId}] recap sent to ${r.email} (${r.memberId}, audience=${audience})`);
      if (!firstChannelId) {
        firstChannelId = channelId;
        firstTs = ts;
        if (ts) {
          // Best-effort permalink pour la vue Recaps. Sur le premier envoi
          // suffit — c'est juste un deep-link de référence.
          try {
            const linkRes = await fetch(
              `https://slack.com/api/chat.getPermalink?channel=${encodeURIComponent(channelId)}&message_ts=${encodeURIComponent(ts)}`,
              { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } },
            );
            const linkData = (await linkRes.json()) as { ok?: boolean; permalink?: string };
            if (linkData.ok && linkData.permalink) firstPermalink = linkData.permalink;
          } catch { /* permalink optional */ }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${r.email}: ${msg}`);
      console.warn(`[meeting-recap/${analysisId}] recap send failed for ${r.email}:`, msg);
    }
  }

  if (sentCount === 0) {
    return { ok: false, error: `All recipients failed: ${failures.join("; ")}` };
  }

  await db
    .from("sales_coach_analyses")
    .update({
      meeting_recap_slack_sent_at: new Date().toISOString(),
      meeting_recap_slack_text: text,
      meeting_recap_slack_ts: firstTs,
      meeting_recap_slack_channel: firstChannelId,
      meeting_recap_slack_permalink: firstPermalink,
    })
    .eq("id", analysisId);

  const destinationLabel = `DM(${recipients.map((r) => r.email).join(", ")})${isFallback ? " [fallback]" : ""}`;
  console.log(`[meeting-recap/${analysisId}] sent (${sentCount} recipients, audience=${audience}, mode=${mode})`);
  return { ok: true, destination: destinationLabel };
}
