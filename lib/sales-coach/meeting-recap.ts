import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logUsage } from "../log-usage";
import type { DealSnapshot } from "../hubspot";
import { renderDealContextForPrompt } from "../hubspot";
import { findChannelId } from "../slack-leads";

const DEFAULT_RECAP_MODEL = "claude-haiku-4-5-20251001";

export type Audience = "client" | "prospect";

export type MeetingRecap = {
  context: string;
  client_need: string;
  risks_competition: string;
  opportunities: string;
  next_steps: string;
};

const RECAP_FIELDS: (keyof MeetingRecap)[] = [
  "context",
  "client_need",
  "risks_competition",
  "opportunities",
  "next_steps",
];

export const MEETING_RECAP_SYSTEM_PROMPT = `Tu es un analyste sales senior chez Coachello. À partir d'un transcript de meeting (et éventuellement du contexte global du deal HubSpot), tu produis un recap structuré en 5 sections, dans le style des debriefs internes Coachello (cf. format Plusgrade).

Règles dures :
- Réponds UNIQUEMENT via l'outil \`meeting_recap\`.
- Langue : suis la langue dominante du transcript. Ne traduis JAMAIS. Si le transcript est en français, rends les 5 sections en français. Idem anglais. Les labels (Context, Client Need, etc.) sont injectés côté client — ne les répète pas dans tes valeurs.
- Chaque section = paragraphe multi-lignes. Une idée par ligne (saut de ligne). N'utilise pas de sous-bullets, pas de tirets, pas d'emojis.
- N'invente JAMAIS de chiffres, montants, noms, dates qui ne sont pas dans les sources fournies.
- Si une section n'a vraiment rien à dire d'utile, rends une seule ligne courte qui le dit explicitement (ex : "Aucun risque identifié sur ce meeting." / "No clear opportunity surfaced in this call."). Ne mets jamais vide.

Sections (5) :
1. **context** — Qui était présent (rôles), quel était l'objectif du meeting, statut de la relation (current customer / prospect / nouveau contact). Pour un prospect avec historique : situer ce meeting dans la séquence du deal (Xe meeting, score IA, momentum si pertinent).
2. **client_need** — Le besoin client/prospect : features demandées, contraintes (langues, intégrations, volumétrie), exigences clés, points de confusion qu'il faut clarifier.
3. **risks_competition** — Risques (côté nous, côté eux), concurrents nommés, hésitations exprimées, signaux de blocage. Pour un prospect : inclure les signaux du deal global (stalled, momentum, BANT manquants si fourni).
4. **opportunities** — Upsells, expansions, use cases adjacents (sales enablement, autres équipes), idées de packaging. Pour un prospect : reliquats du deal context si pertinent (Strategic Fit fort, etc.).
5. **next_steps** — Actions concrètes pour le sales rep ("for me"). Une action par ligne, verbes d'action. Inclut le \`next_action\` du scorer IA si fourni et pertinent.`;

export const meetingRecapTool: Anthropic.Tool = {
  name: "meeting_recap",
  description: "Recap structuré post-meeting (5 sections) dans la langue du transcript.",
  input_schema: {
    type: "object" as const,
    properties: {
      context: { type: "string", description: "Section Context (multi-lignes, langue du transcript)" },
      client_need: { type: "string", description: "Section Client Need (multi-lignes, langue du transcript)" },
      risks_competition: { type: "string", description: "Section Risks / Competition (multi-lignes, langue du transcript)" },
      opportunities: { type: "string", description: "Section Opportunities (multi-lignes, langue du transcript)" },
      next_steps: { type: "string", description: "Section Next Steps (for me) — actions concrètes, une par ligne" },
    },
    required: ["context", "client_need", "risks_competition", "opportunities", "next_steps"],
  },
};

export function repairRecap(recap: Partial<MeetingRecap>): MeetingRecap {
  const out: MeetingRecap = {
    context: "",
    client_need: "",
    risks_competition: "",
    opportunities: "",
    next_steps: "",
  };
  for (const k of RECAP_FIELDS) {
    const v = recap[k];
    out[k] = typeof v === "string" ? v.trim() : "";
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

/**
 * Decide whether a meeting belongs to a Client (closed-won OR Customer Success
 * pipeline) or a Prospect. Defaults to "prospect" when no deal is attached.
 */
export function resolveAudience(snapshot: DealSnapshot | null): Audience {
  if (!snapshot) return "prospect";
  if (snapshot.is_closed_won === true) return "client";
  if ((snapshot.pipeline_label ?? "").trim().toLowerCase() === "customer success") return "client";
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

async function findSlackUserDmChannel(displayName: string): Promise<string | null> {
  const res = await fetch(`https://slack.com/api/users.list?limit=200`, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  const data = await res.json();
  if (!data.ok) return null;
  type Member = { id: string; deleted?: boolean; is_bot?: boolean; profile?: { real_name?: string; display_name?: string } };
  const needle = displayName.toLowerCase().trim();
  const member = (data.members ?? []).find((m: Member) => {
    if (m.deleted || m.is_bot) return false;
    const realName = (m.profile?.real_name ?? "").toLowerCase();
    const dn = (m.profile?.display_name ?? "").toLowerCase();
    return realName.includes(needle) || dn.includes(needle);
  });
  if (!member) return null;
  const dm = await slackPost("/conversations.open", { users: member.id });
  return (dm as { channel: { id: string } }).channel.id ?? null;
}

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
    ? new Date(meetingStartedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })
    : null;
  const subtitleParts: string[] = [];
  if (dateStr) subtitleParts.push(`Meeting du ${dateStr}`);
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

  lines.push(
    ``,
    `• *Context:*\n${recap.context}`,
    ``,
    `• *Client Need:*\n${recap.client_need}`,
    ``,
    `• *Risks / Competition:*\n${recap.risks_competition}`,
    ``,
    `• *Opportunities:*\n${recap.opportunities}`,
    ``,
    `• *Next Steps (for me):*\n${recap.next_steps}`,
  );

  if (audience === "prospect" && dealId && appUrl) {
    lines.push(``, `<${appUrl}/deals?dealId=${encodeURIComponent(dealId)}|Ouvrir le deal dans SalesOS →>`);
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
      "id, hubspot_deal_id, meeting_title, meeting_started_at, deal_snapshot, meeting_recap, audience, participants, meeting_recap_slack_sent_at",
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

  // Header bits
  const companyName = snapshot?.name?.trim() || (row.hubspot_deal_id ? `Deal ${row.hubspot_deal_id}` : "Unknown deal");
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

  const text = formatRecapMessage({
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

  // Resolve destination: same env-driven routing as the legacy HubSpot webhook.
  const mode = process.env.CLAAP_NOTE_SLACK_MODE === "channels" ? "channels" : "dm";
  let channelId: string | null = null;
  let destinationLabel = "";

  if (mode === "channels") {
    const channelName = audience === "client" ? "12-everything-clients" : "11-everything-prospects";
    channelId = await findChannelId(channelName);
    destinationLabel = `#${channelName}`;
    if (!channelId) {
      return { ok: false, error: `Slack channel "${channelName}" not found` };
    }
  } else {
    const targetUser = process.env.CLAAP_NOTE_SLACK_TEST_USER || "Arthur Czernichow";
    channelId = await findSlackUserDmChannel(targetUser);
    destinationLabel = `DM(${targetUser})`;
    if (!channelId) {
      return { ok: false, error: `Slack user "${targetUser}" not found` };
    }
  }

  try {
    await slackPost("/chat.postMessage", {
      channel: channelId,
      text,
      unfurl_links: false,
      unfurl_media: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }

  await db
    .from("sales_coach_analyses")
    .update({ meeting_recap_slack_sent_at: new Date().toISOString() })
    .eq("id", analysisId);

  console.log(`[meeting-recap/${analysisId}] sent to ${destinationLabel} (audience=${audience})`);
  return { ok: true, destination: destinationLabel };
}
