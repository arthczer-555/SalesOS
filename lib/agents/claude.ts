import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { anthropicClient } from "@/lib/anthropic-client";
import { getModelPreference } from "@/lib/models/get-model-preference";

// Sonnet par défaut, comme le chat : l'agent enchaîne seul ses outils et doit
// suivre un template, Haiku s'y perd. Surchargeable dans /admin > Modèles IA
// (clé "agents"), qui vaut pour le designer ET les exécutions.
export const DEFAULT_AGENTS_MODEL = "claude-sonnet-5-5";

export function agentsModel(): Promise<string> {
  return getModelPreference("agents", DEFAULT_AGENTS_MODEL);
}

/**
 * Client Claude d'un agent : la clé de son owner (même règle que le chat, la
 * dépense est imputée à sa clé), sinon la clé globale comme les autres jobs de
 * fond (refresh clients, RAG Insights). Un agent planifié ne doit pas tomber
 * en silence parce que son owner n'a pas encore de clé perso.
 */
export async function agentClient(ownerId: string, creditContext: string): Promise<Anthropic> {
  let apiKey: string | undefined;
  if (process.env.SUPABASE_URL) {
    const { data } = await db
      .from("user_keys")
      .select("encrypted_key, iv, auth_tag, is_active")
      .eq("user_id", ownerId)
      .eq("service", "claude")
      .maybeSingle();
    if (data?.is_active) {
      try {
        apiKey = decrypt({ encryptedKey: data.encrypted_key, iv: data.iv, authTag: data.auth_tag });
      } catch (e) {
        console.warn(`[agents] owner key unreadable for ${ownerId}, using global key:`, e instanceof Error ? e.message : e);
      }
    }
  }
  if (!apiKey && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("No Claude access for this agent's owner. Ask an admin to set up a Claude key.");
  }
  return anthropicClient({ ...(apiKey ? { apiKey } : {}), timeout: 600_000, creditContext });
}
