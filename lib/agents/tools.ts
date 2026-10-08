/**
 * Outils donnés à un agent à l'exécution : les MÊMES modules que CoachelloAI
 * (lib/chat/tools/), filtrés par les sources cochées. Un nouvel outil ajouté à
 * un module est donc disponible pour les agents sans rien toucher ici.
 *
 * Toujours inclus : load_guide (le cerveau de CoachelloAI, conventions HubSpot,
 * revenue, etc.). Toujours exclu : send_slack_message. L'agent ne poste
 * jamais lui-même, c'est lib/agents/slack.ts qui livre le message final à la
 * destination configurée : un agent ne peut pas écrire ailleurs que là où son
 * owner l'a décidé.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { hubspotTools } from "@/lib/chat/tools/hubspot";
import { slackTools } from "@/lib/chat/tools/slack";
import { gmailTools } from "@/lib/chat/tools/gmail";
import { driveTools } from "@/lib/chat/tools/drive";
import { billingTools } from "@/lib/chat/tools/billing";
import { revenueKpisTools } from "@/lib/chat/tools/revenue-kpis";
import { linkedinTools } from "@/lib/chat/tools/linkedin";
import { claapTools } from "@/lib/chat/tools/claap";
import { webTools } from "@/lib/chat/tools/web";
import { notionTools } from "@/lib/chat/tools/notion";
import { loadGuideTools } from "@/lib/chat/tools/load-guide";
import { clientsTools } from "@/lib/chat/tools/clients";
import { invoicesTools } from "@/lib/chat/tools/invoices";
import { revenuePlanTools } from "@/lib/chat/tools/revenue-plan";
import type { ToolModule } from "@/lib/chat/tools/types";
import type { AgentSourceKey } from "./sources";

const BLOCKED_TOOLS = new Set(["send_slack_message"]);

const MODULES_BY_SOURCE: Record<AgentSourceKey, ToolModule[]> = {
  hubspot: [hubspotTools],
  clients: [clientsTools],
  revenue: [billingTools, revenueKpisTools, invoicesTools, revenuePlanTools],
  claap: [claapTools],
  slack: [slackTools],
  gmail: [gmailTools],
  drive: [driveTools],
  notion: [notionTools],
  linkedin: [linkedinTools],
  web: [webTools],
};

/**
 * Définitions d'outils pour un agent (load_guide en tête, ordre stable).
 * `noGmail` : agent envoyé à une audience, un admin ne doit pas faire lire la
 * boîte d'un collègue.
 */
export function toolsForSources(sources: AgentSourceKey[], opts: { noGmail?: boolean } = {}): Anthropic.Tool[] {
  const allowed = opts.noGmail ? sources.filter((s) => s !== "gmail") : sources;
  const modules: ToolModule[] = [loadGuideTools, ...allowed.flatMap((s) => MODULES_BY_SOURCE[s] ?? [])];
  const seen = new Set<string>();
  const tools: Anthropic.Tool[] = [];
  for (const m of modules) {
    for (const def of m.defs) {
      if (BLOCKED_TOOLS.has(def.name) || seen.has(def.name)) continue;
      seen.add(def.name);
      tools.push(def);
    }
  }
  return tools;
}
