import { runChat, ChatAuthError } from "../../lib/chat/core";
import { resolveSlackUser } from "../../lib/slack/user-resolve";
import { loadThreadMessages, saveThreadMessages } from "../../lib/slack/chat-thread";
import { postMessage, updateMessage, getRecentMessages, getChannelName } from "../../lib/slack/api";
import { toSlackMrkdwn } from "../../lib/slack/mrkdwn";
import { slackToolLabel } from "../../lib/chat/tool-labels";

const UNRECOGNIZED_TEXT =
  "Sorry, I don't recognize your Slack account. Ask Arthur to set you up in SalesOS.";

/** Premier feedback posté avant tout appel d'outil, et repli du rendu d'avancement. */
const THINKING_TEXT = "🤔 Thinking…";

/**
 * Évite de répéter le refus : si le dernier message du bot dans ce canal est
 * déjà le refus, on reste silencieux plutôt que de spammer à chaque message
 * envoyé par un user non reconnu. On re-prévient si une vraie conversation a
 * eu lieu entre-temps (le dernier message du bot n'est alors plus le refus).
 */
async function refusalAlreadyShown(channel: string): Promise<boolean> {
  try {
    const messages = await getRecentMessages(channel, 15);
    const lastBot = messages.find((m) => m.bot_id || m.subtype === "bot_message");
    return lastBot?.text === UNRECOGNIZED_TEXT;
  } catch {
    return false;
  }
}

export const config = {
  // Background functions Netlify ont jusqu'à 15min, contre ~26s pour une
  // fonction sync. Indispensable pour l'agentic loop avec HubSpot/LinkedIn
  // qui peut dépasser 30s sur certaines questions.
  type: "background",
};

type Payload = {
  channel: string;
  threadTs: string;
  slackUserId: string;
  text: string;
  teamId?: string;
};

/**
 * Découpe un texte en blocs sûrs pour Slack. La limite du champ `text` de
 * chat.update est de 12 000 caractères, mais Slack compte en octets UTF-8 :
 * un texte français (accents = 2 octets, emojis = 4) peut dépasser la limite
 * bien avant 12 000 caractères JS, ce qui renvoyait `msg_too_long`. On coupe
 * donc à 3 500 caractères par message, sur des frontières de paragraphe/ligne
 * quand c'est possible, et on limite à 6 blocs pour ne pas inonder le thread
 * (le dernier est tronqué si la réponse est vraiment énorme).
 */
function splitForSlack(text: string, cap = 3500, maxChunks = 6): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > cap && chunks.length < maxChunks - 1) {
    // Cherche une coupure propre (paragraphe > ligne > espace) dans la 2e
    // moitié du bloc, sinon coupe net à `cap`.
    let cut = rest.lastIndexOf("\n\n", cap);
    if (cut < cap * 0.5) cut = rest.lastIndexOf("\n", cap);
    if (cut < cap * 0.5) cut = rest.lastIndexOf(" ", cap);
    if (cut < cap * 0.5) cut = cap;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > cap) rest = rest.slice(0, cap) + "\n\n_…(answer truncated)_";
  if (rest) chunks.push(rest);
  return balanceFences(chunks.length ? chunks : [text]);
}

/**
 * Une coupure au milieu d'un bloc de code laisse un ``` non fermé : Slack rend
 * alors tout le reste du message en monospace. On referme le bloc à la fin du
 * chunk et on le rouvre au début du suivant.
 */
function balanceFences(chunks: string[]): string[] {
  let open = false;
  return chunks.map((chunk) => {
    let out = open ? "```\n" + chunk : chunk;
    const fences = (out.match(/```/g) ?? []).length;
    open = fences % 2 === 1;
    if (open) out += "\n```";
    return out;
  });
}

export default async (req: Request) => {
  if (req.headers.get("x-internal-secret") !== process.env.INTERNAL_SECRET) {
    console.error("[slack-chat-bg] unauthorized");
    return;
  }

  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    console.error("[slack-chat-bg] invalid JSON");
    return;
  }

  const { channel, threadTs, slackUserId, text, teamId } = payload;

  // Garde-fou : un message vide (ex: mention seule d'un collègue) produirait un
  // message user vide rejeté par l'API Anthropic. On ne déclenche rien.
  if (!text?.trim()) {
    return;
  }

  // ── 1) Map Slack user → SalesOS user (sinon refus poli) ───────────────────
  const user = await resolveSlackUser(slackUserId);
  if (!user) {
    if (!(await refusalAlreadyShown(channel))) {
      await postMessage({
        channel,
        thread_ts: threadTs || undefined,
        text: UNRECOGNIZED_TEXT,
      });
    }
    return;
  }

  // ── 2) Placeholder "🤔" pour que l'utilisateur ait un feedback instant ────
  let placeholderTs: string;
  try {
    const posted = await postMessage({
      channel,
      thread_ts: threadTs || undefined,
      text: THINKING_TEXT,
    });
    placeholderTs = posted.ts;
  } catch (e) {
    console.error("[slack-chat-bg] postMessage placeholder failed:", e);
    return;
  }

  // ── 3) Charger l'historique du thread (si existant) + append message user ─
  // En parallèle, résoudre le nom du canal pour que CoachelloGPT déduise le
  // client par défaut (ex: question dans #engie → compte Engie). null en DM.
  const [history, channelName] = await Promise.all([
    loadThreadMessages({ channel, threadTs }),
    getChannelName(channel),
  ]);
  const newMessages = [
    ...history,
    { role: "user" as const, content: text },
  ];

  // ── 4) Lance runChat avec updates progressifs (throttled) ─────────────────
  const toolsCalled: string[] = [];
  let lastUpdateAt = 0;
  const MIN_UPDATE_MS = 1100; // Slack rate-limit ~1/sec par message

  const renderProgress = (): string => {
    if (toolsCalled.length === 0) return THINKING_TEXT;
    const last = toolsCalled[toolsCalled.length - 1];
    const lines = ["🤔 _Working on it…_", ""];
    for (const t of toolsCalled.slice(0, -1)) lines.push(`✅ ${slackToolLabel(t)}`);
    lines.push(`⏳ ${slackToolLabel(last)}`);
    return lines.join("\n");
  };

  const flushProgress = async () => {
    const now = Date.now();
    if (now - lastUpdateAt < MIN_UPDATE_MS) return;
    lastUpdateAt = now;
    try {
      await updateMessage({ channel, ts: placeholderTs, text: renderProgress() });
    } catch (e) {
      console.warn("[slack-chat-bg] chat.update progress failed:", e);
    }
  };

  try {
    const result = await runChat({
      userId: user.id,
      messages: newMessages,
      channelName: channelName ?? undefined,
      onEvent: (event) => {
        if (event.type === "tool") {
          toolsCalled.push(event.name);
          void flushProgress();
        }
      },
    });

    const finalText = result.finalText.trim()
      ? toSlackMrkdwn(result.finalText)
      : "_(No answer generated. Try rephrasing your question.)_";

    // Le placeholder reçoit le 1er bloc ; les suivants sont postés en réponse
    // dans le fil. Évite le msg_too_long de chat.update sur les longues réponses.
    const chunks = splitForSlack(finalText);
    await updateMessage({ channel, ts: placeholderTs, text: chunks[0] });
    for (const chunk of chunks.slice(1)) {
      await postMessage({ channel, thread_ts: threadTs || undefined, text: chunk });
    }

    // ── 5) Persister le nouvel historique pour la prochaine question ────────
    await saveThreadMessages({
      key: { channel, threadTs },
      userId: user.id,
      teamId,
      messages: result.messages,
    });
  } catch (e) {
    const errMsg = e instanceof ChatAuthError
      ? e.message
      : `Error: ${e instanceof Error ? e.message : "unknown"}`;
    console.error("[slack-chat-bg] runChat failed:", e);
    try {
      await updateMessage({ channel, ts: placeholderTs, text: `⚠️ ${errMsg}` });
    } catch {
      /* dernier recours, on a déjà loggé */
    }
  }
};
