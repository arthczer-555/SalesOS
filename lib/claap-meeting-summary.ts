import Anthropic from "@anthropic-ai/sdk";
import { logUsage } from "@/lib/log-usage";

const SUMMARY_MODEL = "claude-haiku-4-5-20251001";

export type MeetingSummary = {
  keyTakeawaysCompressed: string;
  nextStepsUnified: string;
};

const SYSTEM_PROMPT = `Tu es analyste sales B2B chez Coachello. À partir d'une note de meeting Claap et d'une recommandation de "next action" produite par notre scorer de deal, tu produis :

1. Une version COMPRESSÉE des Key takeaways (~40% de la longueur originale, bullets denses "• ...", regroupe les redondances, garde uniquement les faits commerciaux clés).
2. Un paragraphe Next Steps UNIFIÉ qui fusionne intelligemment :
   - la "next action" recommandée par le scorer (ce qu'il faut faire pour avancer le deal)
   - les Action items extraits du meeting
   en bullets denses "• ...". Préfixe chaque action par le responsable si identifiable. Évite les doublons entre les deux sources.

Règles dures :
- Ton dense, factuel, en bullets. Pas de "fluff".
- Langue : suis la langue dominante de la note Claap (FR ou EN).
- N'invente JAMAIS de chiffres, montants, dates, noms qui ne sont pas dans les sources.

Format de sortie : UNIQUEMENT ce JSON valide, rien d'autre :
{
  "keyTakeawaysCompressed": "• ...\\n• ...",
  "nextStepsUnified": "• ...\\n• ..."
}`;

function buildUserMessage(args: {
  rawClaapText: string;
  parsedTakeaways: string;
  parsedActionItems: string;
  nextAction: string;
}): string {
  return [
    "=== KEY TAKEAWAYS BRUTS (à compresser ~40%) ===",
    args.parsedTakeaways || "(vide)",
    "",
    "=== ACTION ITEMS BRUTS (du meeting) ===",
    args.parsedActionItems || "(vide)",
    "",
    "=== NEXT ACTION RECOMMANDÉE PAR LE SCORER ===",
    args.nextAction || "(aucune)",
    "",
    "=== TEXTE COMPLET DE LA NOTE CLAAP (référence) ===",
    args.rawClaapText.slice(0, 8000),
  ].join("\n");
}

function safeString(v: unknown, fallback = ""): string {
  if (typeof v !== "string") return fallback;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function parseSummaryJson(raw: string): MeetingSummary {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("summary: no JSON object found");
  const obj = JSON.parse(match[0]) as Record<string, unknown>;
  return {
    keyTakeawaysCompressed: safeString(obj.keyTakeawaysCompressed),
    nextStepsUnified: safeString(obj.nextStepsUnified),
  };
}

export async function generateMeetingSummary(args: {
  rawClaapText: string;
  parsedTakeaways: string;
  parsedActionItems: string;
  nextAction: string;
  userId: string | null;
}): Promise<MeetingSummary> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(args) }],
  });

  logUsage(args.userId, SUMMARY_MODEL, response.usage.input_tokens, response.usage.output_tokens, "claap_meeting_summary");

  const raw = response.content[0]?.type === "text" ? response.content[0].text : "";
  return parseSummaryJson(raw);
}

/**
 * Format the qualification object returned by scoreOneDeal as a single-line
 * dense BANT+ paragraph, e.g.:
 *   "*Budget:* 50k€  ·  *Authority:* CEO + CFO  ·  *Need:* …"
 *
 * Only includes fields that are non-null/non-empty.
 */
export function formatBantParagraph(q: Record<string, string | null>): string {
  const order: Array<[string, string]> = [
    ["budget", "Budget"],
    ["authority", "Authority"],
    ["need", "Need"],
    ["timeline", "Timeline"],
    ["champion", "Champion"],
    ["strategicFit", "Fit"],
  ];
  const parts: string[] = [];
  for (const [key, label] of order) {
    const v = q[key];
    if (v && v !== "null" && v.trim().length > 0) {
      parts.push(`*${label}:* ${v.trim()}`);
    }
  }
  return parts.join("  ·  ");
}
