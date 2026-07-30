import type { SlackBlock } from "./api";

/**
 * Vue Block Kit affichée dans l'onglet "Accueil" de l'app SalesOS sur Slack.
 * Publiée à chaque event `app_home_opened` via /views.publish.
 *
 * On reste sobre : un header personnalisé, une explication, et 3 actions
 * rapides pour amorcer une conversation. Les boutons posent simplement un
 * message-template dans la DM (le bot interceptera ensuite la réponse comme
 * un message normal).
 */
export function buildHomeView(args: {
  userName: string | null;
}): { type: "home"; blocks: SlackBlock[] } {
  const greeting = args.userName ? `Hi ${args.userName} 👋` : "Hi 👋";

  return {
    type: "home",
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: greeting, emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "I'm *CoachelloGPT*, your sales assistant connected to HubSpot, Gmail, Drive, LinkedIn and Slack.\n" +
            "Ask me anything in the *Chat* tab and I'll answer with the context of your deals and your team.",
        },
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Example questions*" },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "• _Which of my deals are in the \"Demo completed\" stage?_\n" +
            "• _Summarize the last meeting with Lacoste._\n" +
            "• _Find the Head of L&D at Danone and their email._\n" +
            "• _Search Slack for what we said about Engie this week._",
        },
      },
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Type your question in the *Chat* tab above, or mention *@SalesOS* in any channel.",
          },
        ],
      },
    ],
  };
}
