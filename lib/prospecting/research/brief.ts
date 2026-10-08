// Brief de recherche prospect (Haiku, sortie structurée) : résumé, accroches
// sourcées et datées, douleurs probables, fit persona, angle et langue. Le brief
// ne fait que ranger les faits collectés : une URL de source inconnue est
// retirée, un fait sans source reste mais perd sa force.
import { getModelPreference } from "@/lib/models/get-model-preference";
import { stripEmDashes } from "@/lib/no-em-dash";
import type { ContactResearch, ContactRow, HookKind, Persona, ResearchBrief, ResearchHook } from "../types";
import { asRecordArray, asString, asStringArray, callTool, FAST_MODEL_DEFAULT } from "../ai/llm";
import { clean, DASH_RULE, renderProspect, resolveLanguage } from "../ai/prompt";

const HOOK_KINDS: HookKind[] = ["post", "news", "hiring", "career", "crm", "company"];

const BRIEF_TOOL = {
  name: "research_brief",
  description: "Retourne le brief de recherche structuré du prospect.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: { type: "string", description: "2 à 3 phrases en anglais : qui est la personne, ce qui se passe dans son entreprise, pourquoi c'est pertinent." },
      hooks: {
        type: "array",
        description: "0 à 5 accroches tirées des faits fournis, de la plus forte à la plus faible.",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "Le fait, en une phrase en anglais, tel qu'il pourrait être évoqué dans un message." },
            kind: { type: "string", enum: HOOK_KINDS },
            sourceUrl: { type: "string", description: "URL exacte de la source parmi celles fournies, sinon chaîne vide." },
            date: { type: "string", description: "Date du fait (YYYY-MM-DD ou YYYY-MM) si connue, sinon chaîne vide." },
            strength: { type: "integer", enum: [1, 2, 3], description: "3 = récent, spécifique et lié au persona ; 1 = faible." },
          },
          required: ["text", "kind", "sourceUrl", "date", "strength"],
        },
      },
      pains: { type: "array", items: { type: "string" }, description: "1 à 3 douleurs probables pour CE prospect (en anglais), déduites des faits." },
      personaFitScore: { type: "integer", description: "0 à 100 : adéquation du prospect avec le persona ciblé." },
      personaFitReason: { type: "string", description: "Une phrase en anglais qui justifie le score." },
      suggestedAngle: { type: "string", description: "Angle d'approche recommandé en une phrase (anglais)." },
      language: { type: "string", enum: ["en", "fr"], description: "Langue dans laquelle écrire au prospect." },
      doNotMention: { type: "array", items: { type: "string" }, description: "Sujets à éviter (sensibles, obsolètes, risqués), en anglais." },
    },
    required: ["summary", "hooks", "pains", "personaFitScore", "personaFitReason", "suggestedAngle", "language", "doNotMention"],
  },
};

interface BriefOutput {
  summary?: unknown;
  hooks?: unknown;
  pains?: unknown;
  personaFitScore?: unknown;
  personaFitReason?: unknown;
  suggestedAngle?: unknown;
  language?: unknown;
  doNotMention?: unknown;
}

function personaSummary(persona: Persona | null): string {
  if (!persona) return "Persona : non défini (offre générale Coachello : coaching des managers, humain + IA, AI roleplays).";
  const m = persona.messaging;
  return [
    `Persona ciblé : ${persona.name}. ${persona.description}`,
    persona.targeting.titles.length ? `Intitulés typiques : ${persona.targeting.titles.slice(0, 10).join(", ")}` : "",
    persona.targeting.hiringTitles.length ? `Signal fort : l'entreprise recrute des ${persona.targeting.hiringTitles.join(", ")}.` : "",
    m.pains.length ? `Douleurs typiques : ${m.pains.join(" ; ")}` : "",
  ]
    .filter(Boolean)
    .map(clean)
    .join("\n");
}

const today = () => new Date().toISOString().slice(0, 10);

export async function generateResearchBrief(input: {
  contact: ContactRow;
  persona: Persona | null;
  facts: ContactResearch["facts"];
  sourceUrls: string[];
  userId: string | null;
}): Promise<ResearchBrief> {
  const { contact, persona, facts } = input;
  const factBlocks: [string, string | undefined][] = [
    ["Profil LinkedIn", facts.linkedin],
    ["Posts LinkedIn récents", facts.posts],
    ["Entreprise", facts.company],
    ["Actualités", facts.news],
    ["Recrutements", facts.hiring],
    ["Historique HubSpot", facts.hubspot],
    ["Emails déjà envoyés par l'équipe", facts.outreach],
  ];
  const present = factBlocks.filter(([, v]) => v && v.trim());

  const system = `Tu es analyste en prospection B2B chez Coachello (coaching de managers et d'équipes, humain + IA, AI roleplays pour les équipes sales). Tu prépares un brief court sur un prospect à partir des faits collectés.

Règles :
- N'utilise QUE les faits fournis. N'invente rien : pas de date, de chiffre, d'événement ni de source.
- Une accroche = un fait précis, récent de préférence, sur la personne ou son entreprise, utilisable en première phrase d'un message. Pas de flatterie générique.
- sourceUrl : recopie exactement une URL présente dans les faits, sinon chaîne vide. date : celle indiquée dans les faits, sinon chaîne vide.
- Pour un persona sales leaders, des recrutements de commerciaux (AE, SDR, BDR) sont un signal très fort (force 3). Une prise de poste de moins de 6 mois aussi.
- Les emails déjà envoyés par l'équipe et l'historique HubSpot indiquent la relation existante : signale-les dans le résumé et dans doNotMention si nécessaire (ex. ne pas faire comme si on ne s'était jamais parlé).
- language : "fr" si le prospect est francophone (France, Belgique francophone, Suisse romande, Québec, entreprise française, profil ou posts en français), sinon "en".
- Aujourd'hui : ${today()}. Un fait de plus de 12 mois est faible.
- ${DASH_RULE}
Réponds uniquement via l'outil research_brief.`;

  const user = [
    personaSummary(persona),
    "",
    renderProspect(contact),
    "",
    present.length ? present.map(([k, v]) => `## ${k}\n${clean(v)}`).join("\n\n") : "## Faits\nAucun fait collecté (sources indisponibles).",
  ].join("\n");

  const model = await getModelPreference("prospecting_research", FAST_MODEL_DEFAULT);
  const res = await callTool<BriefOutput>({
    model,
    system,
    messages: [{ role: "user", content: user }],
    tool: BRIEF_TOOL,
    maxTokens: 1800,
    label: "Prospecting research brief",
    userId: input.userId,
    feature: "prospecting_research",
    timeoutMs: 45_000,
  });
  return normalizeBrief(res.input, input.sourceUrls, contact);
}

function normDate(v: string): string | null {
  const t = v.trim();
  return /^\d{4}-\d{2}(-\d{2})?$/.test(t) ? t : null;
}

export function normalizeBrief(out: BriefOutput, sourceUrls: string[], contact: ContactRow): ResearchBrief {
  const known = new Set(sourceUrls.map((u) => u.trim()).filter(Boolean));
  const s = (v: unknown) => stripEmDashes(asString(v).trim());
  const hooks: ResearchHook[] = asRecordArray(out.hooks)
    .map((h): ResearchHook | null => {
      const text = s(h.text);
      if (!text) return null;
      const kind = HOOK_KINDS.includes(asString(h.kind) as HookKind) ? (asString(h.kind) as HookKind) : "company";
      const url = asString(h.sourceUrl).trim();
      const sourceUrl = url && known.has(url) ? url : null;
      const raw = Math.round(Number(h.strength));
      let strength: 1 | 2 | 3 = raw >= 3 ? 3 : raw <= 1 ? 1 : 2;
      // Un fait web sans source vérifiable est rétrogradé.
      if (!sourceUrl && (kind === "news" || kind === "post" || kind === "hiring") && strength > 1) strength = (strength - 1) as 1 | 2;
      return { text, kind, sourceUrl, date: normDate(asString(h.date)), strength };
    })
    .filter((h): h is ResearchHook => !!h)
    .slice(0, 5);
  const score = Math.max(0, Math.min(100, Math.round(Number(out.personaFitScore) || 0)));
  const lang = asString(out.language);
  return {
    summary: s(out.summary),
    hooks,
    pains: asStringArray(out.pains, 3).map((p) => stripEmDashes(p)),
    personaFit: { score, reason: s(out.personaFitReason) },
    suggestedAngle: s(out.suggestedAngle),
    language: lang === "fr" || lang === "en" ? lang : resolveLanguage("auto", null, contact),
    doNotMention: asStringArray(out.doNotMention, 6).map((p) => stripEmDashes(p)),
  };
}
