/**
 * Orchestration de CoachelloGPT, architecture "manifest" (remplace le runChat
 * monolithique de l'ancien core.ts, même signature publique) :
 *
 *  1. Clé Claude du user (table user_keys chiffrée, fallback .env en dev)
 *  2. user_prompt + modèle (préférence admin "chat", fallback Sonnet) + owner
 *  3. System prompt : socle + catalogue (cachés) + contexte dynamique
 *  4. Tools : registre complet en LECTURE (l'agent choisit et charge ses
 *     guides lui-même via load_guide), cache_control sur la dernière définition
 *  5. Boucle agentique (lib/chat/loop.ts)
 *
 * Réutilisé par : le worker web (lib/chat/run-job.ts) et la fonction Slack
 * (netlify/functions/slack-chat-background.mts), via l'alias runChat.
 */

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { logUsage } from "@/lib/log-usage";
import { getModelPreference } from "@/lib/models/get-model-preference";
import { TOOLS } from "./tools/registry";
import { buildSystem } from "./prompt/build";
import { runLoop } from "./loop";
import { ChatAuthError, type ChatEvent, type ChatResult } from "./events";
import { anthropicClient } from "@/lib/anthropic-client";

// Sonnet par défaut : l'agent porte lui-même la décision de charger les bons
// guides (pattern manifest), ce qui demande mieux que Haiku. Surchargeable par
// l'admin via /admin > Modèles IA (clé "chat").
const DEFAULT_CHAT_MODEL = "claude-sonnet-4-6";

export async function runChat(args: {
  userId: string;
  messages: Anthropic.MessageParam[];
  onEvent?: (event: ChatEvent) => void;
  /**
   * Nom du canal Slack d'où vient la question (sans le `#`). Permet à
   * CoachelloGPT de cadrer le périmètre compte (ex: question posée dans
   * #engie → demander si on cherche seulement sur Engie).
   */
  channelName?: string;
  /** Mode "réflexion approfondie" (toggle de la barre de chat web). */
  betterThinking?: boolean;
}): Promise<ChatResult> {
  const { userId, messages, onEvent, channelName, betterThinking } = args;
  const emit = onEvent ?? (() => {});

  // 1) Clé Claude chiffrée du user (ou fallback .env en dev sans Supabase)
  let claudeApiKey: string;
  if (process.env.SUPABASE_URL) {
    const { data: keyRow } = await db
      .from("user_keys")
      .select("encrypted_key, iv, auth_tag, is_active")
      .eq("user_id", userId)
      .eq("service", "claude")
      .single();
    if (!keyRow?.is_active) {
      throw new ChatAuthError("Ton accès Claude n'est pas encore configuré. Contacte Arthur.", 402);
    }
    claudeApiKey = decrypt({
      encryptedKey: keyRow.encrypted_key,
      iv: keyRow.iv,
      authTag: keyRow.auth_tag,
    });
  } else {
    claudeApiKey = process.env.ANTHROPIC_API_KEY ?? "";
  }

  const client = anthropicClient({ apiKey: claudeApiKey, timeout: 600_000 });

  // 2) user_prompt + modèle + owner + identité
  let chatModel = DEFAULT_CHAT_MODEL;
  let userOwnerId: string | null = null;
  let userEmail: string | null = null;
  let userDisplay = userId;
  let userPrompt = "";
  if (process.env.SUPABASE_URL) {
    const [{ data: userData }, model] = await Promise.all([
      db.from("users").select("user_prompt, email, name, hubspot_owner_id").eq("id", userId).single(),
      getModelPreference("chat", DEFAULT_CHAT_MODEL),
    ]);
    chatModel = model;
    userPrompt = userData?.user_prompt?.trim() ?? "";
    userOwnerId = userData?.hubspot_owner_id ?? null;
    userEmail = userData?.email ?? null;
    userDisplay = userData?.name ?? userData?.email ?? userId;
  }

  // 3) System prompt (socle + catalogue cachés, contexte dynamique en fin)
  const { system } = await buildSystem({
    userDisplay,
    userOwnerId,
    userPrompt,
    channelName,
    betterThinking,
  });

  // 4) Tools : cache_control sur la DERNIÈRE définition -> tout le bloc tools
  // entre dans le préfixe caché. L'ordre du registre est stable par contrat.
  const tools: Anthropic.Tool[] = TOOLS.map((t, i) =>
    i === TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" as const } } : t
  );

  // 5) Boucle agentique
  const result = await runLoop({
    client,
    model: chatModel,
    system,
    tools,
    messages,
    toolContext: { userId, userOwnerId, userEmail },
    emit,
  });

  // usage_logs n'a que input/output : on loggue un input "équivalent-coût"
  // (frais x1 + cache write x1.25 + cache read x0.1) pour que le dashboard
  // admin, qui multiplie par le tarif input du modèle, reflète le coût réel
  // malgré le prompt caching.
  const costEquivalentInput = Math.round(
    result.inputTokens + result.cacheWriteTokens * 1.25 + result.cacheReadTokens * 0.1
  );
  logUsage(userId, chatModel, costEquivalentInput, result.outputTokens, "chat");
  return result;
}
