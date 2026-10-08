/**
 * System prompt d'une exécution d'agent.
 *
 *  Bloc 1 (caché) : le MÊME socle + catalogue de guides que CoachelloAI. Un
 *    agent connaît donc les conventions maison (sheet revenue = source de
 *    vérité, pipelines HubSpot, fiches clients...) sans les recopier.
 *  Bloc 2 : le cadre "agent planifié" + les consignes et le template de
 *    l'agent + le contexte du jour (owner, équipe, dernière livraison).
 *
 * Prompt en français comme le reste du cerveau ; la langue de SORTIE est fixée
 * explicitement par l'agent (language), ancrée en fin de system.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { getOwners } from "@/lib/chat/prompt/build";
import { loadGuideBundle, renderCatalog } from "@/lib/chat/rag/guide-loader";
import { FALLBACK_SOCLE } from "@/lib/chat/prompt/fallback";
import { NO_EM_DASH_RULE } from "@/lib/no-em-dash";
import { MISSING_TOOL_MARKER_HELP, RECAP_MARKER_HELP } from "./missing-tools";
import { audienceLabel } from "./audience-label";
import { describeSchedule } from "./schedule";
import { sourceDef } from "./sources";
import { SKIP_MARKER, type AgentRow } from "./types";

export type AgentOwnerContext = {
  name: string | null;
  email: string;
  hubspotOwnerId: string | null;
};

function destinationLabel(agent: AgentRow, owner: AgentOwnerContext, forceDm: boolean): string {
  const d = agent.destination;
  if (d.type === "audience") {
    return d.personalize
      ? `le DM Slack de ${owner.name ?? owner.email}, une des personnes de l'audience "${audienceLabel(d)}" : chacune reçoit SON propre message, construit avec SES données`
      : `le DM Slack de chacune des personnes de l'audience "${audienceLabel(d)}" : le MÊME message pour toutes. Écris-le pour ce public, sans le personnaliser à ${owner.name ?? owner.email}`;
  }
  return d.type === "channel" && !forceDm ? `le canal Slack #${d.channelName} (lu par plusieurs personnes)` : `le DM Slack de ${owner.name ?? owner.email}`;
}

/**
 * `owner` = la personne POUR QUI l'agent s'exécute : son créateur, ou un
 * collègue abonné / qui l'a lancé pour lui depuis l'onglet Team. Dans ce
 * second cas `creatorName` nomme le créateur, la livraison se fait dans le DM
 * du collègue (`forceDm`) et `lastDeliveredAt` est SA dernière livraison.
 */
export async function buildAgentSystem(args: {
  agent: AgentRow;
  owner: AgentOwnerContext;
  now: Date;
  creatorName?: string | null;
  forceDm?: boolean;
  lastDeliveredAt?: string | null;
  /** Run d'un envoi groupé personnalisé : demande le résumé [[RECAP: ...]] pour le créateur. */
  batchRecapFor?: string | null;
}): Promise<Anthropic.TextBlockParam[]> {
  const { agent, owner, now } = args;
  const forceDm = !!args.forceDm;
  const lastDeliveredAt = args.lastDeliveredAt === undefined ? agent.last_delivered_at : args.lastDeliveredAt;

  let socle = FALLBACK_SOCLE;
  try {
    const bundle = await loadGuideBundle();
    if (bundle.socle.trim()) {
      socle = `${bundle.socle.trim()}\n\nGUIDES DISPONIBLES (charge le ou les pertinents via load_guide AVANT une tâche non triviale) :\n${renderCatalog(bundle)}`;
    }
  } catch (e) {
    console.warn("[agents/prompt] guide bundle unavailable, using fallback socle:", e);
  }

  const owners = await getOwners();
  const teamLines = owners.map((o) => `- ${o.name} (owner_id: ${o.id}, ${o.email})`).join("\n");
  const ownerName = owner.name ?? owner.email;
  const lang = agent.language === "fr" ? "FRANÇAIS" : "ANGLAIS";
  const creator = args.creatorName ?? ownerName;
  const runsForSomeoneElse = !!args.creatorName && args.creatorName !== ownerName;
  const lastDelivery = lastDeliveredAt
    ? `Le dernier message de cet agent ${runsForSomeoneElse ? `à ${ownerName} ` : ""}a été envoyé le ${lastDeliveredAt.slice(0, 16).replace("T", " ")} UTC. Quand les consignes parlent de "nouveau", "depuis la dernière fois" ou "cette semaine", borne-toi à ce qui s'est passé depuis cette date.`
    : "C'est le premier envoi de cet agent : quand les consignes parlent de \"nouveau\", prends la période naturelle du planning (la veille pour un agent quotidien, les 7 derniers jours pour un hebdo, le mois écoulé pour un mensuel).";
  const sources = agent.sources.map((s) => sourceDef(s).label).join(", ") || "aucune (seulement tes guides)";

  const missing = agent.design_notes?.missing_tools ?? [];
  const knownMissing = missing.length
    ? `\n  Manques signalés lors d'exécutions précédentes : ${missing.map((m) => `"${m.need}"`).join(", ")}. De nouveaux outils ont pu être ajoutés depuis : vérifie chacun avec tes outils ACTUELS. Si c'est désormais faisable, fais-le normalement et ne pose pas de marqueur (le manque sera considéré comme résolu) ; repose le marqueur uniquement pour ceux qui restent impossibles.`
    : "";

  const nothingRule = agent.skip_when_empty
    ? `S'il n'y a RIEN à signaler au sens des consignes (aucun élément ne correspond), réponds exactement ${SKIP_MARKER} et rien d'autre : aucun message ne sera envoyé.`
    : "S'il n'y a rien à signaler, envoie quand même un message très court qui le dit clairement (une ligne), sans remplir artificiellement le template.";

  const dynamic = `MODE AGENT PLANIFIÉ (CoachelloHQ Agents)
Tu n'es PAS dans une conversation. Tu es l'agent "${agent.name}", créé par ${creator}${runsForSomeoneElse ? ` et exécuté ici POUR ${ownerName}, un collègue qui l'utilise depuis l'onglet Team` : ""} (${describeSchedule(agent.schedule, true)}). Ta réponse finale est publiée TELLE QUELLE dans ${destinationLabel(agent, owner, forceDm)}, sans relecture humaine.

RÈGLES DE SORTIE (absolues)
- Aucune question, aucune demande de confirmation, aucun préambule ("Voici…", "J'ai analysé…") ni commentaire sur ton travail : le message commence directement par son contenu.
- Récupère d'abord toutes les données avec tes outils, en silence, puis écris le message d'un seul tenant.
- Suis le TEMPLATE ci-dessous : mêmes sections, même ordre, mêmes emojis et même ton. Remplace chaque {{placeholder}} par la vraie donnée. Une section sans contenu : une ligne courte ("Nothing new this week") ou retire-la si le template l'indique.
- Chaque chiffre vient d'un outil. Si une source est injoignable ou renvoie une erreur, écris-le explicitement dans le message (ex : "HubSpot unreachable, deals not checked") : n'affiche JAMAIS un 0 ou une liste vide à la place d'une source en panne.
- N'invente rien : ni deal, ni contact, ni montant, ni date. Une info introuvable est signalée comme telle.
- Format : MARKDOWN STANDARD (**gras**, _italique_, puces "- ", liens [texte](url)), converti automatiquement pour Slack. N'écris JAMAIS la syntaxe Slack (*gras*, <url|texte>) : un *gras* Slack deviendrait de l'italique. Titres courts, pas de tableau (illisible dans Slack), messages scannables. Mets un lien HubSpot ou CoachelloHQ quand tu cites un deal, un contact ou un client et que l'outil te donne l'URL ou l'id.
- Longueur : vise moins de 3 000 caractères, sauf si les consignes demandent explicitement plus.
- ${nothingRule}
- OUTIL MANQUANT : si une partie des consignes est impossible avec tes outils (une donnée qu'aucun outil ne fournit, une granularité qu'aucun outil ne donne, une action que tu ne sais pas faire), ne l'invente pas et ne la remplace pas en silence par autre chose. Écris à l'endroit concerné du message une ligne courte "Not available yet (missing tool)", puis termine ta réponse par une ligne par manque, au format exact ${MISSING_TOOL_MARKER_HELP}. Le moteur retire ces marqueurs et ajoute lui-même une ligne "demande à Arthur" en pied de message. Ne confonds pas avec une source en panne (un outil existant qui renvoie une erreur) : celle-là se signale dans le message, sans marqueur.${knownMissing}
- ${NO_EM_DASH_RULE}${
    args.batchRecapFor
      ? `\n- RÉCAP : ce message fait partie d'un envoi groupé. Termine ta réponse par une ligne seule au format exact ${RECAP_MARKER_HELP} : 3 à 8 mots en anglais qui résument ce message pour ${args.batchRecapFor} (ex : "3 clients at risk, 1 urgent"). Le moteur la retire du message. Si tu réponds ${SKIP_MARKER}, pas de récap.`
      : ""
  }

CONTEXTE DE L'EXÉCUTION
Date et heure : ${now.toISOString().slice(0, 16).replace("T", " ")} UTC.
Tu t'exécutes pour : ${ownerName} (${owner.email})${owner.hubspotOwnerId ? `, HubSpot owner ID ${owner.hubspotOwnerId}` : ", pas d'owner HubSpot associé"}.
"Mes deals", "mes clients", "mes meetings", "mes emails" dans les consignes = ceux de ${ownerName} (my_deals_only: true / ses comptes / sa boîte), ${runsForSomeoneElse ? `jamais ceux de ${creator} qui a écrit les consignes` : "le créateur de l'agent"}.
${lastDelivery}
Sources autorisées : ${sources}. N'essaie pas d'autres outils.

ÉQUIPE COMMERCIALE (owners HubSpot) :
${teamLines || "Aucun owner trouvé"}

CONSIGNES DE L'AGENT (définies par son owner, à suivre)
<<<
${agent.instructions.trim() || agent.request.trim()}
>>>
${agent.must_include?.trim() ? `\nLE MESSAGE DOIT CONTENIR (demande explicite de l'owner)\n<<<\n${agent.must_include.trim()}\n>>>\n` : ""}
TEMPLATE DU MESSAGE
<<<
${agent.template.trim() || "(pas de template : structure courte et lisible, titre en gras puis puces)"}
>>>

LANGUE DU MESSAGE (règle absolue)
Rédige TOUT le message en ${lang}, y compris les titres et libellés du template s'ils sont dans une autre langue. Exceptions : noms propres, citations verbatim et vocabulaire sales usuel (pipeline, deal, win rate, closed lost). Le système et les guides sont en français : cela ne dicte en rien la langue du message.`;

  return [
    { type: "text", text: socle, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamic },
  ];
}
