import { db } from "@/lib/db";

/**
 * Fire-and-forget usage logging to usage_logs table.
 * Call after every client.messages.create() call.
 */
export function logUsage(
  userId: string | null,
  model: string,
  inputTokens: number,
  outputTokens: number,
  feature?: string,
): void {
  if (!userId || !process.env.SUPABASE_URL) return;
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
