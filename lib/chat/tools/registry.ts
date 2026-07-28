/**
 * Registre des outils de CoachelloGPT : fusionne les modules par famille en un
 * tableau de définitions (ordre déterministe et stable, important pour le
 * prompt caching) + un dispatcher d'exécution.
 *
 * LECTURE SEULE sur Notion : ce registre ne contient (et ne doit jamais
 * contenir) aucun outil d'écriture Notion. Cf. plan §6.3.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { hubspotTools } from "./hubspot";
import { slackTools } from "./slack";
import { gmailTools } from "./gmail";
import { driveTools } from "./drive";
import { billingTools } from "./billing";
import { revenueKpisTools } from "./revenue-kpis";
import { linkedinTools } from "./linkedin";
import { claapTools } from "./claap";
import { webTools } from "./web";
import { notionTools } from "./notion";
import { loadGuideTools } from "./load-guide";
import { clientsTools } from "./clients";
import type { ToolContext, ToolHandler } from "./types";

// Ordre stable : ne pas réordonner sans raison (chaque changement d'ordre
// invalide le cache Anthropic de tous les utilisateurs).
const MODULES = [
  loadGuideTools,
  hubspotTools,
  billingTools,
  revenueKpisTools,
  claapTools,
  slackTools,
  gmailTools,
  driveTools,
  notionTools,
  linkedinTools,
  webTools,
  // Ajouté en fin : tout nouveau module se met ICI, pour ne pas décaler les
  // définitions déjà cachées côté Anthropic.
  clientsTools,
];

export const TOOLS: Anthropic.Tool[] = MODULES.flatMap((m) => m.defs);

const HANDLERS: Record<string, ToolHandler> = Object.assign({}, ...MODULES.map((m) => m.handlers));

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  const handler = HANDLERS[name];
  if (!handler) return "Outil inconnu.";
  return handler(input, ctx);
}
