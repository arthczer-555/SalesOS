// Email ponctuel hors séquence (drawer prospect > "Quick email") : même règle
// d'or et même connaissance que les séquences, un seul message. L'envoi se fait
// côté UI par /api/gmail/send.
import type Anthropic from "@anthropic-ai/sdk";
import { getModelPreference } from "@/lib/models/get-model-preference";
import { stripEmDashes } from "@/lib/no-em-dash";
import { matchPersona } from "../personas";
import { getContactResearch } from "../research/contact";
import { getPersona, loadPersonas } from "../store/personas";
import { ANGLES } from "../templates";
import type { AngleKey, ContactRow, Persona } from "../types";
import { baseSystem, loadRosterText, loadSender } from "./context";
import { loadKnowledgeForPersona } from "./knowledge";
import { asString, callTool, WRITE_MODEL_DEFAULT } from "./llm";
import { clean, languageName, renderHouseStyle, renderProspect, renderResearch, resolveLanguage } from "./prompt";
import type { QuickEmailDraft } from "./types";

const QUICK_TOOL: Anthropic.Tool = {
  name: "write_email",
  description: "Retourne l'email (sujet + corps en texte brut).",
  input_schema: {
    type: "object",
    properties: {
      subject: { type: "string", description: "Sujet court, 2 à 6 mots." },
      body: { type: "string", description: "Corps en texte brut, prénom de l'expéditeur seul en dernière ligne." },
    },
    required: ["subject", "body"],
  },
};

async function personaFor(contact: ContactRow): Promise<Persona | null> {
  if (contact.persona_id) return getPersona(contact.persona_id);
  const { personas } = await loadPersonas();
  return matchPersona(contact.title, personas);
}

export async function writeQuickEmail(input: {
  contact: ContactRow;
  userId: string;
  instructions?: string;
  angle?: AngleKey | null;
}): Promise<QuickEmailDraft> {
  const { contact } = input;
  const persona = await personaFor(contact);
  const [knowledge, roster, sender, model] = await Promise.all([
    loadKnowledgeForPersona(persona),
    loadRosterText(),
    loadSender(input.userId),
    getModelPreference("prospecting_write", WRITE_MODEL_DEFAULT),
  ]);
  // Recherche en cache, sinon recherche courte bornée à 18 s (route synchrone) :
  // au-delà on écrit sans, plutôt que de dépasser la limite de la fonction.
  const research = await Promise.race([
    getContactResearch(contact, persona, { background: false, userId: input.userId }).catch(() => contact.research),
    new Promise<ContactRow["research"]>((resolve) => setTimeout(() => resolve(contact.research), 18_000)),
  ]);
  const language = resolveLanguage("auto", research, contact);
  const first = sender.senderName.trim().split(/\s+/)[0] || sender.senderName;

  const angle = input.angle && ANGLES[input.angle] ? ANGLES[input.angle] : null;
  const system: Anthropic.TextBlockParam[] = [
    ...baseSystem({ persona, knowledge, roster }),
    {
      type: "text",
      text: [
        renderHouseStyle(sender.houseStyle),
        `## Email ponctuel
Un seul email, hors séquence, écrit par ${clean(sender.senderName)} (Coachello). Sujet court et corps en texte brut de 50 à 120 mots, un seul CTA. Termine par le prénom ${clean(first)} seul sur la dernière ligne (la signature complète est ajoutée automatiquement).`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
  const ask = (input.instructions ?? "").trim();
  const user = [
    renderProspect(contact),
    renderResearch(research),
    `## À faire
Écris l'email.${angle ? `\nAngle : ${angle.label} (${angle.hint})` : ""}${ask ? `\nConsignes du commercial (prioritaires, sauf contre la règle d'or) : ${clean(ask)}` : ""}
Langue imposée : ${languageName(language)}.
Réponds via l'outil write_email.`,
  ].join("\n\n");

  const res = await callTool<{ subject?: unknown; body?: unknown }>({
    model,
    system,
    messages: [{ role: "user", content: user }],
    tool: QUICK_TOOL,
    maxTokens: 1500,
    label: "Prospecting quick email",
    userId: input.userId,
    feature: "prospecting_step",
    timeoutMs: 45_000,
  });
  const body = stripEmDashes(asString(res.input.body)).trim();
  if (!body) throw new Error("The AI returned an empty email. Retry.");
  return { subject: stripEmDashes(asString(res.input.subject)).trim(), body };
}
