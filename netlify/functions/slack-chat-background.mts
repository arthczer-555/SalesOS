import { runChat, ChatAuthError } from "../../lib/chat/core";
import { resolveSlackUser } from "../../lib/slack/user-resolve";
import { loadThreadMessages, saveThreadMessages } from "../../lib/slack/chat-thread";
import { postMessage, updateMessage } from "../../lib/slack/api";

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
 * Mapping des noms de tools internes vers des labels lisibles pour l'utilisateur,
 * affichés progressivement dans le message Slack pendant que Claude travaille.
 */
const TOOL_LABELS: Record<string, string> = {
  search_contacts: "📇 Recherche HubSpot (contacts)",
  search_deals: "💼 Recherche HubSpot (deals)",
  get_deals: "💼 Récupération du pipeline HubSpot",
  get_companies: "🏢 Recherche HubSpot (entreprises)",
  get_contact_details: "📋 Détails contact",
  get_contact_activity: "📋 Historique contact",
  get_deal_activity: "📋 Historique deal",
  get_deal_contacts: "👥 Contacts du deal",
  search_slack: "💬 Recherche Slack",
  get_slack_channel_history: "💬 Lecture canal Slack",
  send_slack_message: "📤 Envoi Slack",
  web_search: "🌐 Recherche web",
  search_drive: "📂 Google Drive",
  read_drive_file: "📂 Lecture fichier Drive",
  read_drive_excel: "📊 Lecture Excel Drive",
  list_drive_folder: "📂 Liste dossier Drive",
  search_gmail: "📧 Recherche Gmail",
  read_gmail_message: "📧 Lecture email",
  search_linkedin_people: "🔗 Recherche LinkedIn (profils)",
  get_linkedin_profile: "🔗 Profil LinkedIn",
  get_linkedin_profile_by_email: "🔗 LinkedIn par email",
  get_linkedin_activity: "🔗 Activité LinkedIn",
  get_linkedin_likes: "🔗 Likes LinkedIn",
  get_linkedin_posts: "🔗 Posts LinkedIn",
  get_linkedin_similar_profiles: "🔗 Profils similaires",
  get_linkedin_company: "🏢 Entreprise LinkedIn",
  get_linkedin_company_posts: "🏢 Posts entreprise LinkedIn",
  get_linkedin_company_jobs: "🏢 Offres LinkedIn",
  search_linkedin_companies: "🔗 Recherche entreprises LinkedIn",
  search_linkedin_posts: "🔗 Recherche posts LinkedIn",
  get_linkedin_post_reactions: "🔗 Réactions post LinkedIn",
  find_email_by_linkedin: "📧 Email finder",
  find_decision_maker_email: "📧 Email décideur",
};

function labelForTool(name: string): string {
  return TOOL_LABELS[name] ?? `🛠️ ${name}`;
}

/**
 * Tronque un texte Slack à la limite raisonnable. Slack accepte ~40k chars
 * dans chat.postMessage mais l'expérience devient illisible. On coupe à 8k
 * et on indique la troncature.
 */
function truncateForSlack(text: string): string {
  const cap = 8000;
  if (text.length <= cap) return text;
  return text.slice(0, cap) + "\n\n_…(réponse tronquée à 8000 caractères)_";
}

/**
 * Convertit le markdown standard de Claude vers le mrkdwn de Slack :
 *  - **gras** → *gras*
 *  - *italique* → _italique_
 * Les listes, code blocks, links restent compatibles.
 */
function toSlackMrkdwn(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g, "_$1_");
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

  // ── 1) Map Slack user → SalesOS user (sinon refus poli) ───────────────────
  const user = await resolveSlackUser(slackUserId);
  if (!user) {
    await postMessage({
      channel,
      thread_ts: threadTs || undefined,
      text: "Désolé, je ne reconnais pas ton compte Slack. Demande à Arthur de te configurer dans SalesOS.",
    });
    return;
  }

  // ── 2) Placeholder "🤔" pour que l'utilisateur ait un feedback instant ────
  let placeholderTs: string;
  try {
    const posted = await postMessage({
      channel,
      thread_ts: threadTs || undefined,
      text: "🤔 Je réfléchis…",
    });
    placeholderTs = posted.ts;
  } catch (e) {
    console.error("[slack-chat-bg] postMessage placeholder failed:", e);
    return;
  }

  // ── 3) Charger l'historique du thread (si existant) + append message user ─
  const history = await loadThreadMessages({ channel, threadTs });
  const newMessages = [
    ...history,
    { role: "user" as const, content: text },
  ];

  // ── 4) Lance runChat avec updates progressifs (throttled) ─────────────────
  const toolsCalled: string[] = [];
  let lastUpdateAt = 0;
  const MIN_UPDATE_MS = 1100; // Slack rate-limit ~1/sec par message

  const renderProgress = (): string => {
    if (toolsCalled.length === 0) return "🤔 Je réfléchis…";
    const last = toolsCalled[toolsCalled.length - 1];
    const lines = ["🤔 _En cours…_", ""];
    for (const t of toolsCalled.slice(0, -1)) lines.push(`✅ ${labelForTool(t)}`);
    lines.push(`⏳ ${labelForTool(last)}`);
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
      onEvent: (event) => {
        if (event.type === "tool") {
          toolsCalled.push(event.name);
          void flushProgress();
        }
      },
    });

    const finalText = result.finalText.trim()
      ? truncateForSlack(toSlackMrkdwn(result.finalText))
      : "_(Pas de réponse générée — réessaie en reformulant.)_";

    await updateMessage({ channel, ts: placeholderTs, text: finalText });

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
      : `Erreur : ${e instanceof Error ? e.message : "inconnue"}`;
    console.error("[slack-chat-bg] runChat failed:", e);
    try {
      await updateMessage({ channel, ts: placeholderTs, text: `⚠️ ${errMsg}` });
    } catch {
      /* dernier recours, on a déjà loggé */
    }
  }
};
