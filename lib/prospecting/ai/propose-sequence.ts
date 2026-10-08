// "Build with AI" : Sonnet propose une séquence (types d'étapes, délais,
// threads, angles, consignes) conforme aux best practices, pour un persona et
// un objectif. Le résultat est normalisé comme n'importe quel brouillon.
import { getModelPreference } from "@/lib/models/get-model-preference";
import { stripEmDashes } from "@/lib/no-em-dash";
import { BEST_PRACTICES_PROMPT } from "../best-practices";
import { ANGLE_KEYS, normalizeStepDraft, STEP_KINDS } from "../settings";
import { ANGLES, STEP_KIND_META } from "../templates";
import type { Persona, StepDraft } from "../types";
import { asRecordArray, asString, callTool, WRITE_MODEL_DEFAULT } from "./llm";
import { clean, DASH_RULE } from "./prompt";

const PROPOSE_TOOL = {
  name: "propose_sequence",
  description: "Retourne la séquence de prospection proposée.",
  input_schema: {
    type: "object" as const,
    properties: {
      name: { type: "string", description: "Nom court de la campagne, en anglais (ex. 'Heads of Sales, ramp time Q4')." },
      steps: {
        type: "array",
        description: "4 à 8 étapes dans l'ordre.",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: STEP_KINDS },
            delayDays: { type: "integer", description: "Jours d'envoi après l'étape précédente (0 pour la première)." },
            threadMode: { type: "string", enum: ["new", "reply"], description: "Pour un email : nouveau thread ou réponse dans le thread précédent." },
            angle: { type: "string", enum: ANGLE_KEYS },
            instructions: { type: "string", description: "Consigne d'écriture pour l'IA, 1 à 2 phrases en anglais, spécifiques au persona." },
            length: { type: "string", enum: ["short", "standard", "long"] },
            cta: { type: "string", description: "CTA souhaité en anglais, ou chaîne vide." },
          },
          required: ["kind", "delayDays", "threadMode", "angle", "instructions", "length", "cta"],
        },
      },
    },
    required: ["name", "steps"],
  },
};

export async function proposeSequence(input: {
  persona: Persona | null;
  goal: string;
  language?: "en" | "fr" | "auto";
  userId: string;
}): Promise<{ name: string; steps: StepDraft[] }> {
  const p = input.persona;
  const kinds = STEP_KINDS.map((k) => `- ${k} : ${STEP_KIND_META[k].label}. ${STEP_KIND_META[k].description}`).join("\n");
  const angles = ANGLE_KEYS.map((k) => `- ${k} : ${ANGLES[k].label}. ${ANGLES[k].description}`).join("\n");
  const system = `Tu conçois des séquences de prospection B2B multicanal pour Coachello (coaching de managers, humain + IA dans Teams et Slack ; AI roleplays pour les équipes sales).

${BEST_PRACTICES_PROMPT}

## Contraintes de conception
- 4 à 8 touches sur 14 à 21 jours d'envoi, multicanal : emails + au moins une touche LinkedIn (1 à 2 jours après le premier email) + un appel vers le jour 5 à 8 si le persona décroche le téléphone.
- La première relance email est en réponse dans le thread du premier email (threadMode "reply"). Un email plus tard peut ouvrir un nouveau thread avec un nouvel angle.
- Jamais deux emails à moins de 2 jours d'écart. Chaque email a un angle différent. La dernière étape est un email break-up.
- delayDays = jours d'envoi depuis l'étape précédente ; 0 pour la première étape.
- Les consignes (instructions) sont en anglais, concrètes et propres au persona : quel signal utiliser, quelle douleur, quelle preuve (sans inventer de chiffre).

## Types d'étapes
${kinds}

## Angles
${angles}

${DASH_RULE}
Réponds uniquement via l'outil propose_sequence.`;

  const personaBlock = p
    ? [
        `Persona : ${clean(p.name)}. ${clean(p.description)}`,
        p.targeting.titles.length ? `Intitulés : ${p.targeting.titles.slice(0, 10).join(", ")}` : "",
        p.targeting.hiringTitles.length ? `Signal fort : recrute des ${p.targeting.hiringTitles.join(", ")}` : "",
        p.messaging.pains.length ? `Douleurs : ${p.messaging.pains.map(clean).join(" ; ")}` : "",
        p.messaging.valueProps.length ? `Ce que Coachello apporte : ${p.messaging.valueProps.map(clean).join(" ; ")}` : "",
        p.messaging.proofPoints.length ? `Preuves disponibles : ${p.messaging.proofPoints.map((x) => clean(x.text)).join(" ; ")}` : "Aucune preuve chiffrée validée : évite les angles qui en exigent.",
      ]
        .filter(Boolean)
        .join("\n")
    : "Persona : non précisé (offre générale Coachello).";
  const user = [
    personaBlock,
    `Objectif de la campagne : ${clean(input.goal) || "obtenir un premier échange de découverte"}`,
    input.language && input.language !== "auto" ? `Les messages seront écrits en ${input.language === "fr" ? "français" : "anglais"}.` : "",
    "Propose la séquence.",
  ]
    .filter(Boolean)
    .join("\n");

  const model = await getModelPreference("prospecting_write", WRITE_MODEL_DEFAULT);
  const res = await callTool<{ name?: unknown; steps?: unknown }>({
    model,
    system,
    messages: [{ role: "user", content: user }],
    tool: PROPOSE_TOOL,
    maxTokens: 3000,
    label: "Prospecting propose sequence",
    userId: input.userId,
    feature: "prospecting_propose",
    timeoutMs: 55_000,
  });
  const steps = asRecordArray(res.input.steps)
    .slice(0, 10)
    .map((s, i) =>
      normalizeStepDraft(
        {
          kind: asString(s.kind),
          delayDays: Number(s.delayDays),
          threadMode: asString(s.threadMode),
          config: {
            mode: "ai",
            angle: asString(s.angle),
            instructions: stripEmDashes(asString(s.instructions)),
            length: asString(s.length),
            cta: stripEmDashes(asString(s.cta)),
          },
        },
        i,
      ),
    );
  if (!steps.length) throw new Error("The AI did not propose any step. Retry.");
  // Un email ne peut répondre dans un thread que si un email le précède.
  let emailSeen = false;
  for (const s of steps) {
    if (s.kind !== "email") continue;
    if (!emailSeen) s.threadMode = "new";
    emailSeen = true;
  }
  const name = stripEmDashes(asString(res.input.name).trim()) || (p ? `${p.name} sequence` : "New sequence");
  return { name: name.slice(0, 120), steps };
}
