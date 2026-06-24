import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { runChat, ChatAuthError, type ChatEvent } from "@/lib/chat/core";
import { chatToolLabel } from "@/lib/chat/tool-labels";

// Throttle des écritures DB : on ne persiste jamais à chaque token. On flush au
// plus toutes les MIN_FLUSH_MS, plus un flush forcé à la fin (done/error).
const MIN_FLUSH_MS = 1000;

type JobRow = {
  user_id: string;
  status: string;
  input_messages: Anthropic.MessageParam[] | null;
  better_thinking: boolean | null;
};

/**
 * Worker du chat web : charge la job chat_jobs, exécute runChat() (le MÊME
 * agentic loop que Slack) et écrit la progression dans la ligne (texte streamé,
 * étapes outils, coût) pour que le navigateur la lise par polling. Sorti du
 * chemin sync car la boucle dépasse souvent les ~26s d'une fonction Netlify sync.
 * Best-effort : ne laisse jamais le statut bloqué sur "running".
 */
export async function runChatJob(input: { jobId: string }): Promise<{ ok: boolean; error?: string }> {
  const { jobId } = input;

  // État local accumulé, miroir de la logique onEvent du front (app/page.tsx).
  let streamingText = "";
  let toolSteps: string[] = [];
  let cost: number | null = null;
  let history: Anthropic.MessageParam[] | null = null;

  let lastFlushAt = 0;
  let isFlushing = false;
  let flushPromise: Promise<void> = Promise.resolve();

  const writeRow = async (): Promise<void> => {
    await db
      .from("chat_jobs")
      .update({
        streaming_text: streamingText,
        tool_steps: toolSteps,
        cost,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .then(undefined, () => {});
  };

  // Flush throttlé : au plus une écriture toutes les MIN_FLUSH_MS, sans jamais
  // empiler les requêtes (on attend la précédente avant d'en relancer une).
  const maybeFlush = (now: number) => {
    if (isFlushing || now - lastFlushAt < MIN_FLUSH_MS) return;
    lastFlushAt = now;
    isFlushing = true;
    flushPromise = writeRow().finally(() => {
      isFlushing = false;
    });
  };

  try {
    const { data, error } = await db
      .from("chat_jobs")
      .select("user_id, status, input_messages, better_thinking")
      .eq("id", jobId)
      .single<JobRow>();
    if (error || !data) throw new Error(error?.message ?? "job not found");

    // Idempotence : si la job n'est plus "running", on ne refait rien.
    if (data.status !== "running") return { ok: true };

    const messages: Anthropic.MessageParam[] = Array.isArray(data.input_messages)
      ? data.input_messages
      : [];

    const onEvent = (event: ChatEvent) => {
      switch (event.type) {
        case "text":
          streamingText += event.text;
          break;
        case "tool":
          toolSteps = [...toolSteps, chatToolLabel(event.name)];
          break;
        case "tool_progress":
          // Remplace la dernière étape (cf. app/page.tsx, event "tool_progress").
          toolSteps = toolSteps.length > 0
            ? [...toolSteps.slice(0, -1), event.message]
            : [event.message];
          break;
        case "cost_warning":
          cost = Number(event.cost);
          break;
        case "history":
          history = event.messages;
          break;
        // "done"/"error" : gérés après le retour de runChat (flush final).
        default:
          break;
      }
      maybeFlush(Date.now());
    };

    const result = await runChat({
      userId: data.user_id,
      messages,
      onEvent,
      betterThinking: data.better_thinking === true,
    });

    await flushPromise.catch(() => {});

    await db
      .from("chat_jobs")
      .update({
        status: "done",
        streaming_text: result.finalText || streamingText,
        final_text: result.finalText || streamingText,
        tool_steps: toolSteps,
        cost,
        history: history ?? result.messages,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return { ok: true };
  } catch (e) {
    await flushPromise.catch(() => {});
    const message =
      e instanceof ChatAuthError
        ? e.message
        : e instanceof Error
          ? e.message
          : String(e);
    await db
      .from("chat_jobs")
      .update({ status: "error", error: message, updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .then(undefined, () => {});
    return { ok: false, error: message };
  }
}
