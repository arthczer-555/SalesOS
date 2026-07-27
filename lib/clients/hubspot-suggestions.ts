import { withAnthropicRetry } from "@/lib/anthropic-retry";
import { logUsage } from "@/lib/log-usage";
import { getModelPreference } from "@/lib/models/get-model-preference";
import { fetchHubspotDealFields } from "./hubspot-fields";
import {
  HUBSPOT_CHECKLIST_FIELDS,
  getMissingHubspotFields,
  type HubspotDealFields,
  type HubspotFieldSuggestion,
  type HubspotFieldSuggestions,
} from "./types";
import { anthropicClient } from "@/lib/anthropic-client";

// Haiku : on genere jusqu'a ~30 suggestions de champs en un appel. Sonnet est
// trop lent ici (~30s pour tout le batch) et depasse le timeout des fonctions
// synchrones Netlify (~26s). Haiku fait le meme batch en ~15s avec une qualite
// suffisante pour des suggestions de remplissage (l'AE valide chaque champ).
const MODEL = "claude-haiku-4-5-20251001";

const TOOL = {
  name: "hubspot_field_suggestions",
  description: "Return suggested fill values for the empty HubSpot deal qualification fields.",
  input_schema: {
    type: "object" as const,
    properties: {
      fields: {
        type: "array",
        description: "One entry per requested empty field. Skip a field if you truly have no basis to suggest a value.",
        items: {
          type: "object",
          properties: {
            property: { type: "string", description: "The exact HubSpot property internal name from the request." },
            suggestion: { type: "string", description: "Concise concrete value to put in the field, grounded in the data." },
            rationale: { type: "string", description: "One short sentence: why this value, citing the evidence." },
          },
          required: ["property", "suggestion", "rationale"],
        },
      },
    },
    required: ["fields"],
  },
};

// Genere les propositions IA de remplissage pour les champs HubSpot de
// qualification actuellement vides, a partir d'un contexte textuel du compte.
// Reutilise par la route on-demand (bouton Analyze) ET le pipeline
// d'enrichissement (genere d'office a la fin de l'enrichissement).
//
// Renvoie aussi les valeurs live du deal (dealFields) pour que l'appelant les
// renvoie au front sans re-lire HubSpot. Throw si le modele est tronque
// (stop_reason=max_tokens) -> l'appelant decide (erreur 502 cote route,
// best-effort cote enrichissement).
export async function generateHubspotSuggestions(
  dealId: string,
  contextText: string,
  userId: string | null,
): Promise<{ suggestions: HubspotFieldSuggestions; dealFields: HubspotDealFields | null }> {
  const dealFields = await fetchHubspotDealFields(dealId);
  const missing = getMissingHubspotFields(dealFields);

  // Aucun champ vide : rien a suggerer.
  if (missing.length === 0) {
    return { suggestions: { generated_at: new Date().toISOString(), fields: [] }, dealFields };
  }

  const labelByProp = new Map(HUBSPOT_CHECKLIST_FIELDS.map((f) => [f.property, f.label]));
  // Pour les enums, on liste les valeurs autorisees (value) afin que l'IA en
  // choisisse une exactement. La validation post-hoc rejette toute valeur hors
  // options.
  const missingList = missing
    .map((m) => {
      if (m.type === "enumeration") {
        const opts = (m.options ?? []).map((o) => `"${o.value}"`).join(" | ");
        return `- ${m.property} (${m.label}) [enumeration: choisir exactement une valeur parmi ${opts}]`;
      }
      const hint = m.type === "number" ? "nombre" : m.type === "date" ? "date YYYY-MM-DD" : "texte court";
      return `- ${m.property} (${m.label}) [${hint}]`;
    })
    .join("\n");

  const prompt = `Tu aides un Account Executive à compléter la fiche d'un deal HubSpot qui vient d'être signé (closed-won), à partir du contexte réel du compte (meetings, fiche enrichie, recap du deal).

${contextText}

CHAMPS HUBSPOT À REMPLIR (actuellement vides)
${missingList}

Appelle l'outil hubspot_field_suggestions. Pour chaque champ vide, propose une valeur concrète directement insérable dans HubSpot, ancrée dans les données ci-dessus. Pour un champ "enumeration", renvoie EXACTEMENT une des valeurs autorisées listées entre guillemets (copie la valeur telle quelle). Pour un nombre, renvoie un nombre. Pour une date, renvoie YYYY-MM-DD. Une justification TRÈS courte par champ (max ~12 mots). N'invente pas : si aucune base ne permet de proposer une valeur, omets le champ. Rédige le texte libre dans la langue source des données (ne traduis pas). N'utilise jamais de tiret long (-).`;

  const model = await getModelPreference("clients", MODEL);
  const client = anthropicClient({ timeout: 120_000 });
  const msg = await withAnthropicRetry(
    () =>
      client.messages.create({
        model,
        // ~30 champs possibles, chacun property+suggestion+rationale. A 1200 le
        // tool_use etait tronque (stop_reason=max_tokens) -> fields vides. 4000
        // laisse une marge confortable (sortie observee ~2000 tokens).
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
        tools: [TOOL],
        tool_choice: { type: "tool" as const, name: "hubspot_field_suggestions" },
      }),
    { label: "clients/hubspot-suggestions" },
  );

  logUsage(userId, model, msg.usage.input_tokens, msg.usage.output_tokens, "clients_hubspot_suggestions");

  // Si le modele a ete coupe par max_tokens, le bloc tool_use est tronque et
  // `fields` ressort vide : on le signale plutot que de persister du vide.
  if (msg.stop_reason === "max_tokens") {
    throw new Error("Réponse IA tronquée (max_tokens). Réessaie.");
  }

  const toolBlock = msg.content.find((b) => b.type === "tool_use");
  const input = toolBlock && "input" in toolBlock ? (toolBlock.input as { fields?: unknown }) : { fields: [] };

  const defByProp = new Map(HUBSPOT_CHECKLIST_FIELDS.map((f) => [f.property, f]));
  const fields: HubspotFieldSuggestion[] = (Array.isArray(input.fields) ? input.fields : [])
    .map((f) => f as { property?: unknown; suggestion?: unknown; rationale?: unknown })
    .filter((f) => typeof f.property === "string" && defByProp.has(f.property) && typeof f.suggestion === "string" && (f.suggestion as string).trim())
    .map((f) => {
      const prop = f.property as string;
      const def = defByProp.get(prop)!;
      let suggestion = (f.suggestion as string).trim();
      // Pour un enum, on ramene la suggestion a une valeur d'option valide
      // (match value ou label). Si rien ne matche, on droppe (eviter un select
      // pre-rempli sur une valeur que HubSpot rejetterait).
      if (def.type === "enumeration") {
        const opt = (def.options ?? []).find(
          (o) => o.value === suggestion || o.value.toLowerCase() === suggestion.toLowerCase() || o.label.toLowerCase() === suggestion.toLowerCase(),
        );
        if (!opt) return null;
        suggestion = opt.value;
      }
      return {
        property: prop,
        label: labelByProp.get(prop) ?? prop,
        suggestion,
        rationale: typeof f.rationale === "string" ? (f.rationale as string).trim() : "",
      };
    })
    .filter((f): f is HubspotFieldSuggestion => f !== null);

  return { suggestions: { generated_at: new Date().toISOString(), fields }, dealFields };
}
