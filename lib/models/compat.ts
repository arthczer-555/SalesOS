import type Anthropic from "@anthropic-ai/sdk";

/**
 * Compatibilité des paramètres de requête selon le modèle Claude choisi.
 *
 * Les modèles sont interchangeables via /admin > Modèles IA, donc un même appel
 * peut partir sur Haiku 4.5, Sonnet 5.5 ou Opus 4.x. Or Sonnet 5.5 (comme
 * Opus 5.5 et Fable 5.1) change la surface de l'API :
 *  - tool_choice forcé ({ type: "tool" } / { type: "any" }) -> 400 ;
 *  - thinking { type: "disabled" } -> 400, le réglage le plus bas est
 *    { type: "between_tools" } (Sonnet 5.5 uniquement) ;
 *  - `thinking` omis = adaptive thinking, là où Sonnet 4.6 et Haiku 4.5
 *    répondaient sans réfléchir. Le thinking consomme `max_tokens` : une sortie
 *    calibrée pour l'ancien modèle peut être tronquée, et il est facturé.
 *
 * Règle : tout appel dont le modèle vient d'une préférence (ou d'une constante
 * Sonnet) passe par ces helpers plutôt que d'écrire tool_choice / thinking en
 * dur. Le SDK installé (0.79) ne type ni `between_tools` ni les messages
 * `role: "system"` en cours de conversation : les casts restent cantonnés ici.
 */

/** Modèles qui refusent le tool_choice forcé. */
const REJECTS_FORCED_TOOL_CHOICE = /^claude-(sonnet-5-5|opus-5-5|fable-5-1|mythos-5-1)/;

/** Modèles qui acceptent thinking { type: "between_tools" } (et refusent "disabled"). */
const SUPPORTS_BETWEEN_TOOLS = /^claude-sonnet-5-5/;

/**
 * Pas de thinking étendu, quel que soit le modèle : même profil de coût, de
 * latence et de budget `max_tokens` que Sonnet 4.6 / Haiku 4.5. À étaler dans
 * les paramètres d'un appel "simple" (génération de texte, extraction).
 */
export function noExtendedThinking(model: string): { thinking?: Anthropic.ThinkingConfigParam } {
  if (!SUPPORTS_BETWEEN_TOOLS.test(model)) return {};
  return { thinking: { type: "between_tools" } as unknown as Anthropic.ThinkingConfigParam };
}

/**
 * Oblige le modèle à répondre via l'outil `toolName` (sortie structurée).
 *  - Modèles qui l'acceptent : tool_choice forcé, comme avant.
 *  - Sonnet 5.5 & co : tool_choice auto + message système en fin de
 *    conversation qui nomme l'outil (n'invalide pas le cache du prompt
 *    système) + pas de thinking étendu.
 * `auto` ne garantit pas l'appel à 100 % : les appelants gardent leur contrôle
 * "pas de bloc tool_use" existant.
 */
export function withForcedTool<T extends Anthropic.MessageStreamParams>(params: T, toolName: string): T {
  if (!REJECTS_FORCED_TOOL_CHOICE.test(params.model)) {
    return { ...params, tool_choice: { type: "tool", name: toolName } } as T;
  }
  const instruction = {
    role: "system",
    content: `Respond only by calling the \`${toolName}\` tool. Do not answer in plain text.`,
  } as unknown as Anthropic.MessageParam;
  return {
    ...params,
    ...noExtendedThinking(params.model),
    tool_choice: { type: "auto" },
    messages: [...params.messages, instruction],
  } as T;
}

/**
 * Texte de la réponse, tous blocs `text` concaténés. Ne jamais lire
 * `content[0]` : avec le thinking, le premier bloc peut être un bloc `thinking`.
 */
export function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
