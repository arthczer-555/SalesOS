import { db } from "@/lib/db";

/**
 * Fire-and-forget usage logging to usage_logs table.
 * Call after every client.messages.create() call.
 *
 * userId peut être null pour les appels système (cron, webhooks, résolveurs
 * internes sans contexte user). Ces appels sont quand même loggués (user_id
 * = null) sinon ils sont invisibles dans l'admin et on découvre la facture
 * sans pouvoir l'attribuer. Pré-requis : la colonne user_id doit être
 * nullable (cf. migration usage_logs_allow_null_user.sql).
 */
export function logUsage(
  userId: string | null,
  model: string,
  inputTokens: number,
  outputTokens: number,
  feature?: string,
): void {
  if (!process.env.SUPABASE_URL) return;
  void db.from("usage_logs").insert({
    user_id: userId,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    feature: feature ?? null,
  }).then(({ error }) => {
    if (error) console.error("[logUsage] insert failed:", error.message);
  });
}
