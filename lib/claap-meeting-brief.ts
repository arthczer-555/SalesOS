import Anthropic from "@anthropic-ai/sdk";
import type { DealSnapshot } from "@/lib/hubspot";
import { logUsage } from "@/lib/log-usage";

const BRIEF_MODEL = "claude-haiku-4-5-20251001";

export type MeetingBrief = {
  company: string;
  contactDm: string;
  context: string;
  painOpportunity: string;
  competition: string;
  budgetTiming: string;
  dealDynamics: string;
  nextSteps: { us: string; them: string };
  keyTakeawaysCompressed: string;
  actionItemsCompressed: string;
};

const FALLBACK_VALUE = "_Non mentionné_";

function emptyBrief(): MeetingBrief {
  return {
    company: FALLBACK_VALUE,
    contactDm: FALLBACK_VALUE,
    context: FALLBACK_VALUE,
    painOpportunity: FALLBACK_VALUE,
    competition: FALLBACK_VALUE,
    budgetTiming: FALLBACK_VALUE,
    dealDynamics: FALLBACK_VALUE,
    nextSteps: { us: FALLBACK_VALUE, them: FALLBACK_VALUE },
    keyTakeawaysCompressed: "",
    actionItemsCompressed: "",
  };
}

function formatDealSnapshotForPrompt(snap: DealSnapshot): string {
  const lines: string[] = [];
  lines.push(`Deal: ${snap.name}`);
  lines.push(`Stage: ${snap.stage_label ?? snap.stage}`);
  if (snap.amount != null) lines.push(`Montant: ${snap.amount}€`);
  if (snap.close_date) lines.push(`Close date: ${snap.close_date}`);
  if (snap.deal_type) lines.push(`Type: ${snap.deal_type}`);
  if (snap.description) lines.push(`Description: ${snap.description.slice(0, 400)}`);

  if (snap.contacts.length > 0) {
    lines.push("");
    lines.push("Contacts:");
    for (const c of snap.contacts.slice(0, 5)) {
      const name = `${c.firstname} ${c.lastname}`.trim() || c.email || c.id;
      lines.push(`- ${name} — ${c.jobtitle || "?"} (${c.email || "—"})`);
    }
  }

  if (snap.engagements.length > 0) {
    lines.push("");
    lines.push("Échanges récents (top 8):");
    for (const e of snap.engagements.slice(0, 8)) {
      const date = e.date ? new Date(e.date).toISOString().slice(0, 10) : "?";
      const head = `[${e.type} ${date}] ${e.title ?? ""}`.trim();
      const body = (e.body || "").slice(0, 600);
      lines.push(body ? `${head}\n${body}` : head);
    }
  }

  return lines.join("\n");
}

function formatQualificationForPrompt(q: Record<string, string | null>): string {
  const entries = Object.entries(q).filter(([, v]) => v && v !== "null");
  if (entries.length === 0) return "Aucune qualification BANT+ disponible.";
  return entries.map(([k, v]) => `- ${k}: ${v}`).join("\n");
}

const SYSTEM_PROMPT = `Tu es un analyste sales B2B chez Coachello. À partir d'une note de meeting Claap, du contexte deal HubSpot et de la qualification BANT+ déjà calculée, tu produis un brief commercial structuré au format JSON STRICT.

Règles dures :
- Ton dense, factuel, en bullets courts (• ...). Pas de phrases "fluff".
- Pas de répétition entre sections.
- Si une section n'a aucun signal dans les sources, écris exactement : "_Non mentionné_".
- Compresse drastiquement les "Key takeaways" et "Action items" : ~40% de la longueur originale, bullets denses, regroupe les redondances.
- Langue : suis la langue dominante de la note Claap (FR ou EN). Mais les noms de sections JSON restent en anglais.
- N'invente JAMAIS de chiffres, montants, dates, noms ou concurrents qui ne sont pas explicitement dans les sources.

Format de sortie EXACT — réponds UNIQUEMENT avec ce JSON valide, rien d'autre :
{
  "company": "Bullets courts: industrie, taille (effectifs), géographie, target population (qui est concerné par le coaching).",
  "contactDm": "Bullets courts: contact principal + rôle. Décisionnaire(s) identifié(s) + influence/rôle.",
  "context": "Bullets courts: setup actuel (coaching/L&D existant), key gaps observés.",
  "painOpportunity": "Bullets courts: use cases + scope (qui, quoi, à quelle échelle). Préférence Human only / Hybrid / AI si mentionné.",
  "competition": "Bullets courts: vendors mentionnés, alternatives internes, statut compétitif. Si rien: _Non mentionné_.",
  "budgetTiming": "Bullets courts: signal budget (chiffres, fourchettes, contraintes). Timeline (pilote / rollout / décision).",
  "dealDynamics": "Bullets courts: process de décision + critères clés. Risques identifiés.",
  "nextSteps": {
    "us": "Bullets courts: ce que NOUS (Coachello) devons faire ensuite.",
    "them": "Bullets courts: ce que LE PROSPECT doit faire ensuite."
  },
  "keyTakeawaysCompressed": "Version compressée des Key takeaways en bullets denses (• ...). Cible ~40% de la longueur originale.",
  "actionItemsCompressed": "Version compressée des Action items en bullets denses (• ...). Préfixe chaque action par le responsable si identifiable."
}`;

function buildUserMessage(args: {
  rawClaapText: string;
  parsedTakeaways: string;
  parsedActionItems: string;
  dealSnap: DealSnapshot;
  qualification: Record<string, string | null>;
  nextAction: string;
}): string {
  return [
    "=== CONTEXTE DEAL HUBSPOT ===",
    formatDealSnapshotForPrompt(args.dealSnap),
    "",
    "=== QUALIFICATION BANT+ (déjà calculée) ===",
    formatQualificationForPrompt(args.qualification),
    args.nextAction ? `\nNext action recommandée: ${args.nextAction}` : "",
    "",
    "=== NOTE CLAAP — KEY TAKEAWAYS BRUTS ===",
    args.parsedTakeaways || "(vide)",
    "",
    "=== NOTE CLAAP — ACTION ITEMS BRUTS ===",
    args.parsedActionItems || "(vide)",
    "",
    "=== NOTE CLAAP — TEXTE COMPLET (référence) ===",
    args.rawClaapText.slice(0, 8000),
  ]
    .filter(Boolean)
    .join("\n");
}

function safeString(v: unknown, fallback = FALLBACK_VALUE): string {
  if (typeof v !== "string") return fallback;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function parseBriefJson(raw: string): MeetingBrief {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("brief: no JSON object found in response");
  const obj = JSON.parse(match[0]) as Record<string, unknown>;

  const ns = (obj.nextSteps ?? {}) as Record<string, unknown>;

  return {
    company: safeString(obj.company),
    contactDm: safeString(obj.contactDm),
    context: safeString(obj.context),
    painOpportunity: safeString(obj.painOpportunity),
    competition: safeString(obj.competition),
    budgetTiming: safeString(obj.budgetTiming),
    dealDynamics: safeString(obj.dealDynamics),
    nextSteps: {
      us: safeString(ns.us),
      them: safeString(ns.them),
    },
    keyTakeawaysCompressed: safeString(obj.keyTakeawaysCompressed, ""),
    actionItemsCompressed: safeString(obj.actionItemsCompressed, ""),
  };
}

export async function generateMeetingBrief(args: {
  rawClaapText: string;
  parsedTakeaways: string;
  parsedActionItems: string;
  dealSnap: DealSnapshot;
  qualification: Record<string, string | null>;
  nextAction: string;
  userId: string | null;
}): Promise<MeetingBrief> {
  const client = new Anthropic();
  const userMessage = buildUserMessage(args);

  const response = await client.messages.create({
    model: BRIEF_MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  logUsage(args.userId, BRIEF_MODEL, response.usage.input_tokens, response.usage.output_tokens, "claap_meeting_brief");

  const raw = response.content[0]?.type === "text" ? response.content[0].text : "";
  try {
    return parseBriefJson(raw);
  } catch (e) {
    console.warn("[claap-meeting-brief] JSON parse failed, returning empty brief:", e);
    const empty = emptyBrief();
    empty.keyTakeawaysCompressed = args.parsedTakeaways;
    empty.actionItemsCompressed = args.parsedActionItems;
    return empty;
  }
}

export function fallbackBrief(args: {
  parsedTakeaways: string;
  parsedActionItems: string;
}): MeetingBrief {
  const empty = emptyBrief();
  empty.keyTakeawaysCompressed = args.parsedTakeaways;
  empty.actionItemsCompressed = args.parsedActionItems;
  return empty;
}
