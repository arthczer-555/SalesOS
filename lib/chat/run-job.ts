import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { friendlyErrorMessage } from "@/lib/credit-error";
import { runChat, ChatAuthError, type ChatEvent, type ChatSource } from "@/lib/chat/core";
import { chatToolLabel } from "@/lib/chat/tool-labels";

// Throttle des écritures DB : on ne persiste jamais à chaque token. On flush au
// plus toutes les MIN_FLUSH_MS, plus un flush forcé à la fin (done/error).
const MIN_FLUSH_MS = 1000;

// Watchdog : la Background Function Netlify est tuée à ~15 min. On clôt nous-
// mêmes AVANT (réponse partielle + note) pour ne jamais laisser une job bloquée
// sur "running" si le modèle enchaîne trop d'outils (typiquement Better thinking).
const WATCHDOG_MS = 6 * 60 * 1000;

// Heartbeat : touche updated_at régulièrement tant que le process tourne, même
// pendant un long appel d'outil sans event. Permet au front de distinguer
// "lent mais vivant" (heartbeat frais) de "process tué" (heartbeat gelé).
const HEARTBEAT_MS = 8000;

const STOP_NOTE =
  "\n\n_(Stopped: the request ran too long. Try a narrower question or turn off Better thinking.)_";

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
  // tool_steps porte {name, label} : le front affiche le LOGO de l'outil à côté
  // du libellé (les anciennes rows en string[] restent lisibles côté front).
  let streamingText = "";
  let toolSteps: { name: string | null; label: string }[] = [];
  let sources: ChatSource[] = [];
  let cost: number | null = null;
  let history: Anthropic.MessageParam[] | null = null;

  let lastFlushAt = 0;
  let isFlushing = false;
  let flushPromise: Promise<void> = Promise.resolve();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stopHeartbeat = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const writeRow = async (): Promise<void> => {
    await db
      .from("chat_jobs")
      .update({
        streaming_text: streamingText,
        tool_steps: toolSteps,
        sources,
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

    // Bat le cœur tant que le worker tourne (front: détection de process tué).
    heartbeat = setInterval(() => {
      db.from("chat_jobs")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", jobId)
        .then(undefined, () => {});
    }, HEARTBEAT_MS);

    const onEvent = (event: ChatEvent) => {
      switch (event.type) {
        case "text":
          streamingText += event.text;
          break;
        case "text_reset":
          // Tour qui bascule vers des outils : on jette le préambule éventuel
          // pour que seule la réponse finale s'affiche dans la bulle.
          streamingText = "";
          break;
        case "tool":
          toolSteps = [...toolSteps, { name: event.name, label: chatToolLabel(event.name) }];
          break;
        case "tool_progress":
          // Remplace le libellé de la dernière étape en gardant son outil.
          toolSteps = toolSteps.length > 0
            ? [...toolSteps.slice(0, -1), { name: toolSteps[toolSteps.length - 1].name, label: event.message }]
            : [{ name: null, label: event.message }];
          break;
        case "source":
          // Dédup par (kind, title) : une page relue ne s'affiche qu'une fois.
          if (!sources.some((s) => s.kind === event.source.kind && s.title === event.source.title)) {
            sources = [...sources, event.source];
          }
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

    // Course runChat vs watchdog : le 1er à finir gagne. Si le watchdog gagne,
    // runChat continue en arrière-plan (non annulable) jusqu'à ce que Netlify
    // tue le process, mais la job est déjà clôturée avec la réponse partielle.
    const TIMED_OUT = Symbol("timeout");
    const result = await Promise.race([
      runChat({
        userId: data.user_id,
        messages,
        onEvent,
        betterThinking: data.better_thinking === true,
      }),
      new Promise<typeof TIMED_OUT>((resolve) =>
        setTimeout(() => resolve(TIMED_OUT), WATCHDOG_MS)
      ),
    ]);

    stopHeartbeat();
    await flushPromise.catch(() => {});

    if (result === TIMED_OUT) {
      const text = (streamingText ? streamingText + STOP_NOTE : STOP_NOTE.trim());
      await db
        .from("chat_jobs")
        .update({
          status: "done",
          streaming_text: text,
          final_text: text,
          tool_steps: toolSteps,
          sources,
          cost,
          history: history ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      return { ok: true };
    }

    await db
      .from("chat_jobs")
      .update({
        status: "done",
        streaming_text: result.finalText || streamingText,
        final_text: result.finalText || streamingText,
        tool_steps: toolSteps,
        sources,
        cost,
        history: history ?? result.messages,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return { ok: true };
  } catch (e) {
    stopHeartbeat();
    await flushPromise.catch(() => {});
    // friendlyErrorMessage : filet pour un crédit à sec remonté par un chemin
    // non instrumenté (le message brut du fournisseur ne dit rien à un sales).
    const message = friendlyErrorMessage(
      e instanceof ChatAuthError
        ? e.message
        : e instanceof Error
          ? e.message
          : String(e),
    );
    await db
      .from("chat_jobs")
      .update({ status: "error", error: message, updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .then(undefined, () => {});
    return { ok: false, error: message };
  }
}
