// Labels lisibles affichés progressivement dans la barre de chat web pendant que
// CoachelloGPT travaille. Partagés entre le worker (lib/chat/run-job.ts, qui
// écrit les étapes dans chat_jobs.tool_steps) et le rendu front (app/page.tsx).
// La version Slack a son propre jeu de labels (avec emojis) dans
// netlify/functions/slack-chat-background.mts.
export const CHAT_TOOL_LABELS: Record<string, string> = {
  search_contacts: "Searching contacts…",
  search_deals: "Searching deals…",
  get_deals: "Loading pipeline…",
  get_companies: "Loading companies…",
  get_contact_details: "Contact details…",
  get_contact_activity: "Exchange history…",
  get_deal_activity: "Deal history…",
  get_deal_contacts: "Contacts associated with the deal…",
  search_slack: "Searching Slack…",
  get_slack_channel_history: "Reading Slack channel…",
  send_slack_message: "Sending Slack message…",
  web_search: "Searching the web…",
  search_drive: "Searching Google Drive…",
  read_drive_file: "Reading document…",
  list_drive_folder: "Browsing Drive…",
  search_gmail: "Searching your emails…",
  read_gmail_message: "Reading email…",
  search_claap_meetings: "Searching Claap meetings…",
  get_claap_meeting_transcript: "Reading Claap transcript…",
};

export function chatToolLabel(name: string): string {
  return CHAT_TOOL_LABELS[name] ?? name;
}
