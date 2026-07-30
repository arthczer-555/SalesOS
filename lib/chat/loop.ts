/**
 * Boucle agentique de CoachelloGPT (extraite de l'ancien lib/chat/core.ts) :
 * stream Anthropic + exécution des tool calls + pruning + cost warning.
 *
 * Nouveautés vs l'ancienne version :
 *  - Filet d'auto-injection : si un outil Notion est appelé alors que le guide
 *    notion_knowledge n'a jamais été chargé dans la conversation, le registre
 *    est préfixé au tool_result (déterministe, ne dépend pas de la discipline
 *    du modèle).
 *  - Breakpoint de cache glissant sur le dernier message (appliqué au moment de
 *    l'appel API, JAMAIS persisté dans l'historique : la limite Anthropic est
 *    de 4 breakpoints, en persister accumulerait des marqueurs à chaque tour).
 *  - Les tool_results de guides (load_guide) ne sont jamais élagués.
 *  - Les tool calls d'un même tour sont exécutés en PARALLÈLE : c'est ce qui
 *    rend abordable la règle de couverture (fetcher d'un coup toutes les pages
 *    Notion plausibles plutôt qu'une seule, puis une autre au tour suivant).
 */

import Anthropic from "@anthropic-ai/sdk";
import { guardCredit } from "@/lib/credit-alert";
import { executeTool } from "./tools/registry";
import type { ToolContext } from "./tools/types";
import { loadGuideBundle } from "./rag/guide-loader";
import { stripAttachmentPayloads } from "./attachments";
import type { ChatEvent, ChatResult } from "./events";

const COST_WARNING_USD = 0.5;
const MAX_RESULT_CHARS = 8000;
const GUIDE_RESULT_PREFIX = 'GUIDE "';
const GUIDE_RESULT_RE = /^GUIDE "([^"]+)"/;

// Tarifs par MTok (USD) selon le modèle effectif. Cache write = input x1.25,
// cache read = input x0.1 (contrat Anthropic). L'ancien monolithe estimait en
// tarif Haiku sans caching : avec Sonnet par défaut + 3 breakpoints de cache,
// ignorer les tokens cache sous-estimait le coût d'un facteur 4-10x.
function pricingFor(model: string): { input: number; output: number } {
  if (model.includes("haiku")) return { input: 1, output: 5 };
  // Opus 4.6 / 4.8 / 5 sont à 5/25 par MTok, pas 15/75 (tarif Opus 4.1 et
  // antérieurs). Garder ce tarif aligné sur PRICING de app/admin/logs/page.tsx.
  if (model.includes("opus")) return { input: 5, output: 25 };
  return { input: 3, output: 15 }; // sonnet et défaut
}

function estimateCost(
  model: string,
  t: { input: number; cacheWrite: number; cacheRead: number; output: number }
): number {
  const p = pricingFor(model);
  return (
    (t.input + t.cacheWrite * 1.25 + t.cacheRead * 0.1) * (p.input / 1_000_000) +
    t.output * (p.output / 1_000_000)
  );
}

/**
 * Packs déjà chargés dans l'historique rejoué : via un tool_use load_guide, OU
 * via un tool_result commençant par 'GUIDE "<slug>"' (résultat de load_guide ou
 * auto-injection d'un tour précédent : évite de ré-injecter 16k chars par tour).
 */
function collectLoadedGuides(messages: Anthropic.MessageParam[]): Set<string> {
  const loaded = new Set<string>();
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (typeof block !== "object") continue;
      if (msg.role === "assistant" && block.type === "tool_use" && block.name === "load_guide") {
        const pack = (block.input as { pack?: string } | undefined)?.pack;
        if (pack) loaded.add(pack);
      }
      if (msg.role === "user" && block.type === "tool_result" && typeof block.content === "string") {
        const m = block.content.match(GUIDE_RESULT_RE);
        if (m) loaded.add(m[1]);
      }
    }
  }
  return loaded;
}

/**
 * Copie transiente des messages avec cache_control sur le dernier bloc du
 * dernier message (pattern de cache incrémental Anthropic). Ne mute jamais
 * l'historique persisté.
 */
function withCacheBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  const cacheable = new Set(["text", "tool_result", "tool_use", "image", "document"]);
  let content: Anthropic.MessageParam["content"];
  if (typeof last.content === "string") {
    content = [{ type: "text", text: last.content, cache_control: { type: "ephemeral" } }];
  } else {
    const blocks = last.content as Anthropic.ContentBlockParam[];
    if (blocks.length === 0) return messages;
    const lastBlock = blocks[blocks.length - 1];
    if (typeof lastBlock !== "object" || !cacheable.has(lastBlock.type)) return messages;
    content = [
      ...blocks.slice(0, -1),
      { ...lastBlock, cache_control: { type: "ephemeral" } } as Anthropic.ContentBlockParam,
    ];
  }
  return [...messages.slice(0, -1), { ...last, content }];
}

export async function runLoop(args: {
  client: Anthropic;
  model: string;
  system: Anthropic.TextBlockParam[];
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  toolContext: Omit<ToolContext, "onProgress" | "onSource">;
  emit: (event: ChatEvent) => void;
}): Promise<ChatResult> {
  const { client, model, system, tools, toolContext, emit } = args;

  let currentMessages: Anthropic.MessageParam[] = args.messages;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheWriteTokens = 0;
  let totalCacheReadTokens = 0;
  let costWarned = false;
  let finalText = "";

  // Multi-tours : les guides chargés aux tours précédents (présents dans
  // l'historique rejoué) comptent comme chargés.
  const loadedGuides = collectLoadedGuides(currentMessages);

  const ctx: ToolContext = {
    ...toolContext,
    onProgress: (msg) => emit({ type: "tool_progress", message: msg }),
    onSource: (source) => emit({ type: "source", source }),
  };

  while (true) {
    const apiStream = client.messages.stream({
      model,
      max_tokens: 8192,
      system,
      tools,
      messages: withCacheBreakpoint(currentMessages),
    });

    apiStream.on("text", (delta) => emit({ type: "text", text: delta }));

    // guardCredit : un crédit Anthropic à sec devient "Insufficient credit.
    // See with Gaspard." dans la bulle + DM Slack à Gaspard/Arthur.
    const message = await guardCredit(() => apiStream.finalMessage(), {
      provider: "Claude (Anthropic)",
      context: "CoachelloGPT chat",
    });
    totalInputTokens += message.usage.input_tokens;
    totalOutputTokens += message.usage.output_tokens;
    totalCacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;
    totalCacheReadTokens += message.usage.cache_read_input_tokens ?? 0;

    const currentCost = estimateCost(model, {
      input: totalInputTokens,
      cacheWrite: totalCacheWriteTokens,
      cacheRead: totalCacheReadTokens,
      output: totalOutputTokens,
    });
    if (!costWarned && currentCost >= COST_WARNING_USD) {
      costWarned = true;
      emit({ type: "cost_warning", cost: currentCost });
    }

    if (message.stop_reason === "end_turn") {
      finalText = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      currentMessages = [...currentMessages, { role: "assistant", content: message.content }];
      // L'historique émis/persisté ne porte JAMAIS les payloads base64 des
      // pièces jointes (limite ~6 Mo des fonctions Netlify au polling et au
      // POST du tour suivant) : seuls les marqueurs restent, ré-expandés
      // serveur au tour suivant.
      const persistable = stripAttachmentPayloads(currentMessages);
      emit({ type: "history", messages: persistable });
      emit({ type: "done" });
      return {
        finalText,
        messages: persistable,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheWriteTokens: totalCacheWriteTokens,
        cacheReadTokens: totalCacheReadTokens,
      };
    }

    if (message.stop_reason === "tool_use") {
      const toolBlocks = message.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      currentMessages = [...currentMessages, { role: "assistant", content: message.content }];

      // Ce tour appelle des outils : tout texte streamé avant (préambule type
      // "je regarde…") n'appartient pas à la réponse finale. On le retire de la
      // bulle pour que l'écriture ne démarre visiblement qu'au dernier tour, en
      // continu. Le prompt demande déjà au modèle de ne pas narrer ici ; ce reset
      // est le filet déterministe si le modèle glisse.
      emit({ type: "text_reset" });

      // Filet d'auto-injection : décidé AVANT l'exécution, parce que les outils
      // tournent en parallèle. Sans réservation en amont, 3 notion_fetch d'un
      // même tour injecteraient 3 fois le registre (~16k chars x3).
      const injectIndex = loadedGuides.has("notion_knowledge")
        ? -1
        : toolBlocks.findIndex((t) => t.name === "notion_fetch" || t.name === "notion_search");
      if (injectIndex >= 0) loadedGuides.add("notion_knowledge");
      for (const tool of toolBlocks) {
        if (tool.name === "load_guide") {
          const pack = (tool.input as { pack?: string }).pack;
          if (typeof pack === "string") loadedGuides.add(pack);
        }
      }

      // Exécution PARALLÈLE des tool calls d'un même tour. Le modèle est
      // explicitement invité à fetcher plusieurs pages Notion / guides d'un
      // coup (couverture large) : en série, cette couverture coûterait N fois
      // la latence d'un fetch et serait de fait dissuadée. Promise.all préserve
      // l'ordre des résultats (contrat Anthropic : un tool_result par tool_use).
      toolBlocks.forEach((tool) => emit({ type: "tool", name: tool.name }));
      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolBlocks.map(async (tool, idx): Promise<Anthropic.ToolResultBlockParam> => {
          const input = tool.input as Record<string, unknown>;
          try {
            let result = await executeTool(tool.name, input, ctx);

            // Le préfixe 'GUIDE "' est CONTRACTUEL : il protège ce tool_result
            // du pruning (ci-dessous) et le rend détectable par
            // collectLoadedGuides au tour suivant (pas de ré-injection).
            if (idx === injectIndex) {
              try {
                const bundle = await loadGuideBundle();
                const knowledge = bundle.packs.get("notion_knowledge");
                if (knowledge) {
                  result =
                    `${GUIDE_RESULT_PREFIX}notion_knowledge" (injecté automatiquement : il n'avait pas été chargé ; suis-le pour la suite de la conversation) :\n\n${knowledge.body}\n\n--- RÉSULTAT DE L'OUTIL ---\n${result}`;
                }
              } catch { /* best-effort : le résultat brut part quand même */ }
            }

            return { type: "tool_result", tool_use_id: tool.id, content: result };
          } catch (e) {
            return {
              type: "tool_result",
              tool_use_id: tool.id,
              content: `Erreur: ${e instanceof Error ? e.message : "inconnue"}`,
              is_error: true,
            };
          }
        })
      );
      currentMessages.push({ role: "user", content: results });

      // Prune les tool results volumineux des messages anciens pour rester sous
      // 200k. Les guides (load_guide) ne sont JAMAIS élagués : ils portent les
      // instructions actives de la conversation.
      const lastMsgIndex = currentMessages.length - 1;
      currentMessages = currentMessages.map((msg, idx) => {
        if (msg.role !== "user" || !Array.isArray(msg.content)) return msg;
        if (idx === lastMsgIndex) return msg;
        const pruned = (msg.content as Anthropic.ToolResultBlockParam[]).map((block) => {
          if (block.type !== "tool_result" || typeof block.content !== "string") return block;
          if (block.content.length <= MAX_RESULT_CHARS) return block;
          if (block.content.startsWith(GUIDE_RESULT_PREFIX)) return block;
          // Coupe sur les CARACTÈRES, pas sur la première ligne : les handlers
          // renvoient du JSON.stringify sans indentation (une seule ligne, zéro
          // \n), donc un split("\n")[0] rendait ce pruning totalement inopérant
          // et laissait les gros résultats (transcripts Claap, threads HubSpot)
          // dans le contexte à tous les tours suivants.
          const head = block.content.slice(0, MAX_RESULT_CHARS);
          return { ...block, content: `${head}\n[résultat volumineux tronqué - données déjà traitées]` };
        });
        return { ...msg, content: pruned };
      });
      continue;
    }

    // Stop_reason inattendu (max_tokens, refusal...) : on récupère quand même
    // le texte partiel et on le persiste dans l'historique (l'ancien monolithe
    // perdait la réponse : Slack affichait "pas de réponse générée" et le fil
    // repartait d'un historique sans le message assistant).
    finalText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (message.content.length > 0) {
      currentMessages = [...currentMessages, { role: "assistant", content: message.content }];
    }
    const persistable = stripAttachmentPayloads(currentMessages);
    emit({ type: "history", messages: persistable });
    emit({ type: "done" });
    return {
      finalText,
      messages: persistable,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cacheWriteTokens: totalCacheWriteTokens,
      cacheReadTokens: totalCacheReadTokens,
    };
  }
}
