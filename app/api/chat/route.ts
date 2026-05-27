import { NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { runChat, ChatAuthError } from "@/lib/chat/core";

export const maxDuration = 300;

/**
 * Wrapper SSE pour l'UI web : reçoit l'historique des messages côté client,
 * délègue à `runChat()` (cf. lib/chat/core.ts), et streame les events au
 * navigateur via Server-Sent Events.
 *
 * La même fonction `runChat()` est utilisée côté Slack
 * (netlify/functions/slack-chat-background.mts) pour les DMs/mentions, avec
 * un onEvent qui fait du chat.update progressif au lieu de SSE.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: "Non authentifié." })}\n\n`,
      { status: 401, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const { messages } = await req.json();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        await runChat({
          userId: user.id,
          messages,
          onEvent: send,
        });
      } catch (error) {
        if (error instanceof ChatAuthError) {
          send({ type: "error", message: error.message });
        } else {
          send({ type: "error", message: error instanceof Error ? error.message : "Erreur inconnue" });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
