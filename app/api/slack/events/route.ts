import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack/verify";
import { getUserInfo, publishHomeView } from "@/lib/slack/api";
import { buildHomeView } from "@/lib/slack/home-view";

export const dynamic = "force-dynamic";

/**
 * Endpoint Slack Events API pour SalesOS / CoachelloGPT.
 *
 * Reçoit tous les events que l'app souscrit côté api.slack.com :
 *  - `url_verification` : challenge initial pour valider l'URL.
 *  - `app_home_opened`  : publie la vue Home Tab personnalisée.
 *  - `app_mention`      : @SalesOS dans un canal → déclenche CoachelloGPT.
 *  - `message.im`       : DM direct au bot → déclenche CoachelloGPT.
 *
 * Contraintes Slack :
 *  - ACK 200 en moins de 3s sinon retry automatique.
 *  - Signature HMAC-SHA256 vérifiée avec SLACK_SIGNING_SECRET.
 *  - Le body doit être lu BRUT (req.text()) pour que la signature matche.
 *
 * Pour les events lourds (DMs/mentions → boucle agentic 30s-2min), on ACK
 * immédiatement et on délègue à la Background Function Netlify
 * `slack-chat-background`. Elle poste un placeholder dans Slack et fait du
 * chat.update progressif au fur et à mesure que les tools sont appelés.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!verifySlackSignature({
    rawBody,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
  })) {
    console.warn("[slack/events] signature invalide");
    return new NextResponse("invalid signature", { status: 401 });
  }

  let payload: SlackEventPayload;
  try {
    payload = JSON.parse(rawBody) as SlackEventPayload;
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }

  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  if (payload.type === "event_callback" && payload.event) {
    const event = payload.event;

    try {
      if (event.type === "app_home_opened" && event.tab === "home") {
        await handleAppHomeOpened(event);
        return NextResponse.json({ ok: true });
      }

      // ── DM directe au bot ────────────────────────────────────────────────
      if (event.type === "message" && event.channel_type === "im") {
        if (event.bot_id || event.subtype === "bot_message") {
          // Skip nos propres messages (sinon boucle infinie)
          return NextResponse.json({ ok: true });
        }
        await dispatchToBackground(req, {
          channel: event.channel!,
          threadTs: event.thread_ts ?? "",
          slackUserId: event.user!,
          text: event.text ?? "",
          teamId: payload.team_id,
        });
        return NextResponse.json({ ok: true });
      }

      // ── @mention du bot dans un canal ────────────────────────────────────
      if (event.type === "app_mention") {
        const cleaned = stripBotMention(event.text ?? "");
        await dispatchToBackground(req, {
          channel: event.channel!,
          // Toujours répondre en thread sur les mentions pour pas polluer le canal
          threadTs: event.thread_ts ?? event.ts ?? "",
          slackUserId: event.user!,
          text: cleaned,
          teamId: payload.team_id,
        });
        return NextResponse.json({ ok: true });
      }
    } catch (e) {
      console.error("[slack/events] handler error:", e);
      // ACK 200 quand même pour éviter le retry storm.
      return NextResponse.json({ ok: true });
    }
  }

  return NextResponse.json({ ok: true });
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleAppHomeOpened(event: SlackEvent) {
  const userId = event.user;
  if (!userId) return;

  let userName: string | null = null;
  try {
    const info = await getUserInfo(userId);
    userName = info.profile?.display_name || info.profile?.real_name || info.real_name || null;
    if (userName) userName = userName.split(" ")[0];
  } catch (e) {
    console.warn("[slack/events] users.info failed:", e);
  }

  await publishHomeView({
    user_id: userId,
    view: buildHomeView({ userName }),
  });
}

/**
 * Déclenche la Background Function Netlify qui gère l'agentic loop.
 * En dev (NETLIFY non set), exécute en inline (sans timeout strict du
 * Next dev server). En prod, fire-and-forget POST avec timeout court
 * pour qu'on ACK Slack en <3s.
 */
async function dispatchToBackground(
  req: NextRequest,
  payload: {
    channel: string;
    threadTs: string;
    slackUserId: string;
    text: string;
    teamId?: string;
  },
) {
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret) {
    console.error("[slack/events] INTERNAL_SECRET manquant");
    return;
  }

  const triggerUrl = `${req.nextUrl.origin}/.netlify/functions/slack-chat-background`;
  try {
    await fetch(triggerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": internalSecret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("aborted") && !msg.includes("timeout")) {
      console.error("[slack/events] bg dispatch failed:", msg);
    }
    // Le timeout volontaire est normal — la bg fn continue en arrière-plan.
  }
}

/**
 * Retire le `<@U12345>` du texte d'une @mention pour passer à Claude le
 * contenu utile sans bruit. Slack envoie `<@UXXXX> ta question` quand on
 * mentionne le bot.
 */
function stripBotMention(text: string): string {
  return text.replace(/<@U[A-Z0-9]+>\s*/g, "").trim();
}

// ── Types ────────────────────────────────────────────────────────────────────

type SlackEvent = {
  type: string;
  user?: string;
  channel?: string;
  channel_type?: string;
  tab?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  subtype?: string;
};

type SlackEventPayload =
  | { type: "url_verification"; challenge: string }
  | {
      type: "event_callback";
      event: SlackEvent;
      team_id?: string;
      api_app_id?: string;
    };
