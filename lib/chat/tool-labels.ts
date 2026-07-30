// Libellés des outils affichés à l'utilisateur pendant que CoachelloGPT
// travaille. Source de vérité unique pour les deux surfaces :
//  - chat web  : `chatToolLabel` (lib/chat/run-job.ts écrit les étapes dans
//                chat_jobs.tool_steps, app/_components/chat-workspace.tsx rend)
//  - Slack     : `slackToolLabel` (netlify/functions/slack-chat-background.mts),
//                même texte préfixé de l'emoji de la famille d'outils.
// Produit en anglais (voir CLAUDE.md), sans ponctuation finale : chaque surface
// ajoute son propre suffixe.
const TOOL_LABELS: Record<string, { emoji: string; label: string }> = {
  load_guide: { emoji: "📖", label: "Loading internal guide" },
  notion_fetch: { emoji: "📚", label: "Reading Coachello knowledge base" },
  notion_search: { emoji: "📚", label: "Searching Coachello knowledge base" },
  get_billing_revenue: { emoji: "💶", label: "Reading revenue sheet" },
  get_revenue_kpis: { emoji: "📈", label: "Reading revenue KPIs" },
  search_clients: { emoji: "🤝", label: "Searching client accounts" },
  get_client: { emoji: "🤝", label: "Reading client file" },
  search_contacts: { emoji: "📇", label: "Searching HubSpot contacts" },
  search_deals: { emoji: "💼", label: "Searching HubSpot deals" },
  get_deals: { emoji: "💼", label: "Loading HubSpot pipeline" },
  get_companies: { emoji: "🏢", label: "Searching HubSpot companies" },
  get_contact_details: { emoji: "📋", label: "Reading contact details" },
  get_contact_activity: { emoji: "📋", label: "Reading contact history" },
  get_deal_activity: { emoji: "📋", label: "Reading deal history" },
  get_deal_contacts: { emoji: "👥", label: "Loading contacts on the deal" },
  search_slack: { emoji: "💬", label: "Searching Slack" },
  get_slack_channel_history: { emoji: "💬", label: "Reading Slack channel" },
  send_slack_message: { emoji: "📤", label: "Sending Slack message" },
  web_search: { emoji: "🌐", label: "Searching the web" },
  search_drive: { emoji: "📂", label: "Searching Google Drive" },
  read_drive_file: { emoji: "📂", label: "Reading Drive document" },
  read_drive_excel: { emoji: "📊", label: "Reading Drive spreadsheet" },
  list_drive_folder: { emoji: "📂", label: "Browsing Drive folder" },
  search_gmail: { emoji: "📧", label: "Searching emails" },
  read_gmail_message: { emoji: "📧", label: "Reading email" },
  search_claap_meetings: { emoji: "🎥", label: "Searching Claap meetings" },
  get_claap_meeting_transcript: { emoji: "🎥", label: "Reading Claap transcript" },
  search_linkedin_people: { emoji: "🔗", label: "Searching LinkedIn profiles" },
  get_linkedin_profile: { emoji: "🔗", label: "Reading LinkedIn profile" },
  get_linkedin_activity: { emoji: "🔗", label: "Reading LinkedIn activity" },
  get_linkedin_posts: { emoji: "🔗", label: "Reading LinkedIn posts" },
  search_linkedin_companies: { emoji: "🔗", label: "Searching LinkedIn companies" },
  get_linkedin_company: { emoji: "🏢", label: "Reading LinkedIn company" },
  get_linkedin_company_posts: { emoji: "🏢", label: "Reading LinkedIn company posts" },
  get_linkedin_company_jobs: { emoji: "🏢", label: "Reading LinkedIn job postings" },
};

/** Chat web : libellé en cours d'exécution, avec ellipse. */
export function chatToolLabel(name: string): string {
  const entry = TOOL_LABELS[name];
  return entry ? `${entry.label}…` : name;
}

/** Slack : libellé préfixé de l'emoji de la famille d'outils. */
export function slackToolLabel(name: string): string {
  const entry = TOOL_LABELS[name];
  return entry ? `${entry.emoji} ${entry.label}` : `🛠️ ${name}`;
}
