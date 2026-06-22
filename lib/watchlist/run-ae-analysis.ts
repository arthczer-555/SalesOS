import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { logUsage } from "@/lib/log-usage";
import { loadCompanyHubspotContext } from "@/lib/watchlist/fetch-company-recap";
import {
  loadClientsRoster,
  formatClientsRoster,
  type ClientRosterEntry,
} from "@/lib/watchlist/clients-roster";
import {
  startBriefRun,
  finishBriefOk,
  finishBriefError,
  type AeAnalysisContent,
  type AeContact,
  type HubspotRecapContent,
  type NewsContent,
  type BriefRow,
} from "@/lib/watchlist/briefs";
import { fetchWatchlistNews } from "@/lib/watchlist/fetch-news";
import { DEFAULT_PROSPECTION_GUIDE } from "@/lib/guides/prospection";
import { NO_EM_DASH_RULE, stripEmDashes } from "@/lib/no-em-dash";
import { SALES_CONTEXT_PROMPT_BLOCK } from "@/lib/business-context";
import type { AeRelationshipState } from "@/lib/watchlist/briefs";

const MODEL = "claude-sonnet-4-6";

const RELATIONSHIP_STATES: AeRelationshipState[] = [
  "never_contacted",
  "cold",
  "warm",
  "active",
  "lost_deal",
];

function buildSystemPrompt(prospectionGuide: string, withMessages: boolean): string {
  if (!withMessages) {
    return buildAnalysisOnlySystemPrompt();
  }
  return `Tu es un Account Executive sénior chez Coachello. Tu prépares la prospection d'un compte cible (Watch List) :
QUI contacter en priorité dans ce compte, et avec QUEL message d'ouverture. Sortie courte et actionnable, pas un rapport.

${SALES_CONTEXT_PROMPT_BLOCK}

## Guide de prospection (chaque opening_message doit le suivre)
${prospectionGuide}

Ton style : direct, concret.
${NO_EM_DASH_RULE}
LANGUE : écris dans la langue du PROSPECT, pas celle du contexte fourni. Détecte-la depuis le compte lui-même : pays et implantation de l'entreprise, langue de ses news et posts, langue des emails reçus de leur part. Une entreprise non francophone = anglais, même si le guide et les instructions sont en français. En cas de doute, écris en anglais. Cette règle s'applique surtout aux opening_subject et opening_message (ce sont eux qui partent au prospect).

Règles anti-générique :
- Chaque rationale tient en 1 phrase et cite un fait précis du contexte (un email daté, un deal, un signal news, un post LinkedIn, le job title). Si la phrase pourrait s'appliquer telle quelle à un autre compte, réécris-la.
- Pour rendre l'ouverture intéressante, complète le contexte fourni avec ce que tu sais réellement de cette entreprise (son marché, ses produits, son modèle, ses enjeux connus). Uniquement des faits dont tu es sûr, formulés prudemment, jamais de chiffres, de noms ou d'actualités inventés. Si tu utilises cette connaissance, mets sources_used.world_knowledge à true.
- Ne jamais inventer un fait, un nom, un chiffre, un email ou un client.
- Interdits : "mettre en avant la valeur", "proposer un échange", "construire la relation", et toute action vague du même genre.

Contacts à couvrir : liste TOUS les contacts du compte cohérents avec la vente (jusqu'à 10), pas seulement les meilleurs. Classés par priorité : buyer économique d'abord (CHRO, DRH, VP People, Head of L&D), puis influenceurs (L&D manager, HRBP, Talent), puis relais crédibles (Chief of Staff, direction, managers concernés). Exclus uniquement les contacts manifestement hors sujet (aucun lien avec les RH, le L&D ou la décision). Exception : un historique d'échange chaud bat un titre senior jamais contacté. Chaque contact listé reçoit son opening_subject et son opening_message complets.

Réponds UNIQUEMENT via l'outil emit_ae_analysis :
- relationship_state : never_contacted | cold (échanges anciens ou restés sans réponse) | warm (échanges récents et positifs) | active (deal ouvert en cours) | lost_deal (deal perdu récemment).
- state_summary : 1 à 2 phrases max. L'essentiel : où on en est avec ce compte et le point d'entrée. Pas de paragraphe, pas de liste d'actions (l'action, c'est contacter les contacts listés).
- story_to_tell : une accroche de social proof prête à dire/écrire, basée sur le secteur du prospect ET notre liste de clients actuels fournie en contexte. Cite uniquement des clients RÉELS de la liste fournie, du même secteur ou d'un secteur proche. Chaîne vide si aucun client pertinent.
- priority_contacts : tous les contacts cohérents (jusqu'à 10), classés par priorité. Pour chacun : name, role, rationale (1 phrase, fait précis), opening_subject (objet de mail court, 3 à 7 mots, spécifique au compte ou au signal, jamais "Coaching pour vos managers" ni un objet qui sent la prospection de masse), opening_message (le message complet prêt à adapter : signal réel ou fait entreprise en ouverture, problème nommé avant Coachello, 100-200 mots, un seul CTA, signé "[Prénom expéditeur]"), email et hubspot_id si connus. Varie les ouvertures et les objets d'un contact à l'autre, adaptés à son rôle.
- watch_outs : 0 à 3 points courts, uniquement des risques réels du contexte (contact parti, deal perdu récent, concurrent en place, mauvais timing). Liste vide si rien de réel.
- sources_used : { emails, news, sector, world_knowledge } selon ce qui a réellement servi.`;
}

/**
 * Variante "analyse seule" : on identifie QUI contacter et POURQUOI, sans rédiger
 * les messages d'ouverture. Plus rapide / moins cher, et utile quand l'AE ne veut
 * pas qu'on génère un message pour chaque contact.
 */
function buildAnalysisOnlySystemPrompt(): string {
  return `Tu es un Account Executive sénior chez Coachello. Tu prépares la prospection d'un compte cible (Watch List) :
QUI contacter en priorité dans ce compte et POURQUOI. Tu NE rédiges AUCUN message d'ouverture. Sortie courte et actionnable, pas un rapport.

${SALES_CONTEXT_PROMPT_BLOCK}

Ton style : direct, concret.
${NO_EM_DASH_RULE}
LANGUE : rédige state_summary, story_to_tell et chaque rationale dans la langue du PROSPECT, pas celle du contexte fourni. Détecte-la depuis le compte lui-même (pays et implantation de l'entreprise, langue de ses news et posts, langue des emails reçus). Une entreprise non francophone = anglais. En cas de doute, écris en anglais.

Règles anti-générique :
- Chaque rationale tient en 1 phrase et cite un fait précis du contexte (un email daté, un deal, un signal news, un post LinkedIn, le job title). Si la phrase pourrait s'appliquer telle quelle à un autre compte, réécris-la.
- Ne jamais inventer un fait, un nom, un chiffre, un email ou un client.

Contacts à couvrir : liste TOUS les contacts du compte cohérents avec la vente (jusqu'à 10), pas seulement les meilleurs. Classés par priorité : buyer économique d'abord (CHRO, DRH, VP People, Head of L&D), puis influenceurs (L&D manager, HRBP, Talent), puis relais crédibles (Chief of Staff, direction, managers concernés). Exclus uniquement les contacts manifestement hors sujet (aucun lien avec les RH, le L&D ou la décision). Exception : un historique d'échange chaud bat un titre senior jamais contacté.

Réponds UNIQUEMENT via l'outil emit_ae_analysis :
- relationship_state : never_contacted | cold (échanges anciens ou restés sans réponse) | warm (échanges récents et positifs) | active (deal ouvert en cours) | lost_deal (deal perdu récemment).
- state_summary : 1 à 2 phrases max. L'essentiel : où on en est avec ce compte et le point d'entrée.
- story_to_tell : une accroche de social proof prête à dire, basée sur le secteur du prospect ET notre liste de clients actuels fournie en contexte. Cite uniquement des clients RÉELS de la liste fournie, du même secteur ou d'un secteur proche. Chaîne vide si aucun client pertinent.
- priority_contacts : tous les contacts cohérents (jusqu'à 10), classés par priorité. Pour chacun : name, role, rationale (1 phrase, fait précis), email et hubspot_id si connus. NE génère PAS d'opening_subject ni d'opening_message (ce mode ne rédige aucun message).
- watch_outs : 0 à 3 points courts, uniquement des risques réels du contexte (contact parti, deal perdu récent, concurrent en place, mauvais timing). Liste vide si rien de réel.
- sources_used : { emails, news, sector, world_knowledge } selon ce qui a réellement servi.`;
}

function buildAnalysisTool(withMessages: boolean) {
  return {
  name: "emit_ae_analysis",
  description: "Émet l'analyse AE structurée (reco de prospection) pour la page détail Watch List.",
  input_schema: {
    type: "object" as const,
    properties: {
      relationship_state: {
        type: "string",
        enum: RELATIONSHIP_STATES,
        description: "État de la relation avec le compte",
      },
      state_summary: {
        type: "string",
        description: "1 à 2 phrases max : où on en est et le point d'entrée",
      },
      story_to_tell: {
        type: "string",
        description:
          "Accroche de social proof basée sur le secteur du prospect et nos clients actuels réels. Chaîne vide si aucun client comparable.",
      },
      priority_contacts: {
        type: "array",
        description: "Tous les contacts cohérents à cibler (jusqu'à 10), classés par priorité",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: ["string", "null"] },
            rationale: {
              type: "string",
              description: "1 phrase : pourquoi cibler cette personne, ancrée sur un fait précis du contexte",
            },
            opening_subject: {
              type: "string",
              description: "Objet de mail court (3 à 7 mots), spécifique au compte ou au signal",
            },
            opening_message: {
              type: "string",
              description:
                "Message d'ouverture complet prêt à adapter, conforme au guide de prospection (100-200 mots, 1 CTA)",
            },
            email: { type: ["string", "null"] },
            hubspot_id: { type: ["string", "null"] },
          },
          required: withMessages
            ? ["name", "rationale", "opening_subject", "opening_message"]
            : ["name", "rationale"],
        },
      },
      watch_outs: {
        type: "array",
        items: { type: "string" },
        description: "0 à 3 risques réels, courts. Vide si rien.",
      },
      sources_used: {
        type: "object",
        properties: {
          emails: { type: "boolean" },
          news: { type: "boolean" },
          sector: { type: "boolean" },
          world_knowledge: { type: "boolean" },
        },
        required: ["emails", "news", "sector", "world_knowledge"],
      },
    },
    required: [
      "relationship_state",
      "state_summary",
      "story_to_tell",
      "priority_contacts",
      "watch_outs",
      "sources_used",
    ],
  },
  };
}

/**
 * Résout le guide de prospection avec la même cascade que le drafter :
 * guide perso de l'utilisateur, sinon défaut global (admin), sinon hardcodé.
 */
async function loadProspectionGuide(userId: string): Promise<string> {
  const [{ data: userRow }, { data: globalGuide }] = await Promise.all([
    db.from("users").select("prospection_guide").eq("id", userId).maybeSingle(),
    db.from("guide_defaults").select("content").eq("key", "prospection").maybeSingle(),
  ]);
  return userRow?.prospection_guide ?? globalGuide?.content ?? DEFAULT_PROSPECTION_GUIDE;
}

interface ScopeCompanyRow {
  id: string;
  name: string;
  owner: string | null;
  sector: string | null;
  current_coaching_platform: string | null;
  notes: string | null;
}

/**
 * Run principal : charge le contexte HubSpot (emails inclus) + news + secteur,
 * appelle Claude, persiste l'Analyse AE. Appelable depuis la BG fn et depuis
 * `after()` en dev.
 */
export async function runAeAnalysis(input: {
  scopeCompanyId: string;
  userId: string;
  /** false = analyse seule (qui contacter + pourquoi), sans rédiger de message. Défaut true. */
  withMessages?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const { scopeCompanyId, userId } = input;
  const withMessages = input.withMessages ?? true;
  try {
    const { data: company, error } = await db
      .from("scope_companies")
      .select("id, name, owner, sector, current_coaching_platform, notes")
      .eq("id", scopeCompanyId)
      .single<ScopeCompanyRow>();
    if (error || !company) {
      throw new Error("Compte introuvable");
    }

    // Rafraîchit d'abord la recherche de news pour que l'analyse parte de
    // signaux frais (presse + LinkedIn), puis relit le brief news ci-dessous.
    await refreshNewsForAnalysis({ scopeCompanyId, companyName: company.name, userId });

    // Contexte HubSpot (emails/contacts/deals) + brief news + roster clients
    // + guide de prospection (pour les opening_message).
    const [hubspot, briefsRes, clientsRoster, prospectionGuide] = await Promise.all([
      loadCompanyHubspotContext(scopeCompanyId),
      db
        .from("watchlist_company_briefs")
        .select("*")
        .eq("scope_company_id", scopeCompanyId)
        .eq("kind", "news"),
      loadClientsRoster(),
      loadProspectionGuide(userId),
    ]);

    const newsBrief =
      ((briefsRes.data ?? [])[0] as BriefRow<NewsContent> | undefined) ?? null;
    const news = newsBrief?.content ?? null;

    const emailEngagements = hubspot.engagements.filter((e) => e.type === "email");
    const sourcesUsed = {
      emails: emailEngagements.length > 0,
      news: !!(news?.posts?.length || news?.signals?.length),
      sector: !!company.sector,
    };

    const userPrompt = buildPrompt({ company, hubspot, news, clientsRoster });

    // Jusqu'à 10 opening messages de 100-200 mots : plafond et timeout relevés
    // en conséquence (la BG fn Netlify laisse largement le temps). En mode
    // "analyse seule" (sans messages), la sortie est bien plus courte.
    const client = new Anthropic({ timeout: 300_000, maxRetries: 1 });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: withMessages ? 8000 : 2500,
      system: buildSystemPrompt(prospectionGuide, withMessages),
      messages: [{ role: "user", content: userPrompt }],
      tools: [buildAnalysisTool(withMessages)],
      tool_choice: { type: "tool", name: "emit_ae_analysis" },
    });

    logUsage(userId, MODEL, message.usage.input_tokens, message.usage.output_tokens, "watchlist_ae_analysis");

    const toolBlock = message.content.find((b) => b.type === "tool_use");
    if (!toolBlock || !("input" in toolBlock)) {
      throw new Error("Réponse Claude sans tool_use");
    }
    const parsed = toolBlock.input as Partial<AeAnalysisContent>;
    const content: AeAnalysisContent = {
      relationship_state: RELATIONSHIP_STATES.includes(parsed.relationship_state as AeRelationshipState)
        ? (parsed.relationship_state as AeRelationshipState)
        : null,
      state_summary: typeof parsed.state_summary === "string" ? stripEmDashes(parsed.state_summary) : "",
      strategy: "", // legacy v1, plus généré
      story_to_tell: typeof parsed.story_to_tell === "string" ? stripEmDashes(parsed.story_to_tell) : "",
      priority_contacts: Array.isArray(parsed.priority_contacts)
        ? (parsed.priority_contacts as unknown[])
            .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
            .map(normalizeContact)
        : [],
      next_actions: [], // legacy v1, redondant avec les contacts
      watch_outs: Array.isArray(parsed.watch_outs)
        ? parsed.watch_outs.filter((s): s is string => typeof s === "string").map(stripEmDashes)
        : [],
      sources_used: parsed.sources_used ?? sourcesUsed,
    };

    await finishBriefOk({
      scopeCompanyId,
      kind: "ae_analysis",
      content,
      model: MODEL,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finishBriefError({ scopeCompanyId, kind: "ae_analysis", error: msg });
    return { ok: false, error: msg };
  }
}

/**
 * Rafraîchit le brief news AVANT l'analyse AE, pour que l'AE parte de signaux
 * frais (presse + LinkedIn). Best-effort : un échec n'empêche pas l'analyse,
 * qui retombe alors sur le dernier brief news connu. Respecte le lock anti-
 * double-dispatch : si une génération news est déjà en cours (ex. l'utilisateur
 * a cliqué Refresh sur la News card), on la laisse finir sans refetch.
 */
async function refreshNewsForAnalysis(input: {
  scopeCompanyId: string;
  companyName: string;
  userId: string;
}): Promise<void> {
  const { scopeCompanyId, companyName, userId } = input;
  const { alreadyRunning } = await startBriefRun({ scopeCompanyId, kind: "news", userId });
  if (alreadyRunning) return;
  try {
    const content = await fetchWatchlistNews({ scopeCompanyId, userId, companyName });
    await finishBriefOk({ scopeCompanyId, kind: "news", content });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[watchlist/ae-analysis] refresh news échoué pour "${companyName}":`, msg);
    await finishBriefError({ scopeCompanyId, kind: "news", error: msg });
  }
}

function normalizeContact(c: Record<string, unknown>): AeContact {
  return {
    name: typeof c.name === "string" ? c.name : "",
    role: typeof c.role === "string" ? c.role : null,
    rationale: typeof c.rationale === "string" ? stripEmDashes(c.rationale) : "",
    angle: "", // legacy v1, plus généré
    opening_subject: typeof c.opening_subject === "string" ? stripEmDashes(c.opening_subject) : null,
    opening_message: typeof c.opening_message === "string" ? stripEmDashes(c.opening_message) : null,
    email: typeof c.email === "string" ? c.email : null,
    hubspot_id: typeof c.hubspot_id === "string" ? c.hubspot_id : null,
  };
}

function buildPrompt(input: {
  company: ScopeCompanyRow;
  hubspot: HubspotRecapContent;
  news: NewsContent | null;
  clientsRoster: ClientRosterEntry[];
}): string {
  const { company, hubspot, news, clientsRoster } = input;
  const lines: string[] = [];

  lines.push(`# Compte cible : ${company.name}`);
  if (company.owner) lines.push(`Owner sales : ${company.owner}`);
  if (company.sector) lines.push(`Secteur : ${company.sector}`);
  if (company.current_coaching_platform) lines.push(`Plateforme coaching actuelle : ${company.current_coaching_platform}`);
  if (company.notes) lines.push(`Notes internes : ${company.notes}`);
  lines.push("");

  // Société HubSpot
  if (hubspot.company) {
    const c = hubspot.company;
    const bits = [
      c.industry,
      c.numberofemployees ? `${c.numberofemployees} salariés` : null,
      c.city,
      c.country,
      c.lifecyclestage ? `lifecycle: ${c.lifecyclestage}` : null,
    ].filter(Boolean);
    if (bits.length > 0) lines.push(`Société HubSpot : ${bits.join(", ")}`);
  }

  // Contacts
  lines.push("");
  lines.push("## Contacts du compte (HubSpot)");
  if (hubspot.contacts.length > 0) {
    for (const c of hubspot.contacts) {
      const name = `${c.firstname ?? ""} ${c.lastname ?? ""}`.trim() || c.email || "?";
      lines.push(`- ${name}${c.jobtitle ? ` (${c.jobtitle})` : ""}${c.email ? ` <${c.email}>` : ""} [hubspot_id: ${c.id}]`);
    }
  } else {
    lines.push("Aucun contact HubSpot associé.");
  }

  // Deals
  lines.push("");
  lines.push("## Deals");
  if (hubspot.deals.length > 0) {
    for (const d of hubspot.deals.slice(0, 8)) {
      const stage = d.dealstage_label ?? d.dealstage ?? "?";
      const status = d.is_closed_won ? "won" : d.is_closed ? "lost" : "open";
      const amount = d.amount ? ` ${d.amount}€` : "";
      lines.push(`- ${d.dealname ?? "Sans nom"} [${stage}, ${status}]${amount}`);
    }
  } else {
    lines.push("Aucun deal lié.");
  }

  // Emails échangés (input central)
  const emails = hubspot.engagements.filter((e) => e.type === "email");
  lines.push("");
  lines.push(`## Emails échangés avec les contacts (${emails.length})`);
  if (emails.length > 0) {
    for (const e of emails.slice(0, 20)) {
      const date = e.date ? new Date(e.date).toLocaleDateString("fr-FR") : "?";
      const dir = e.direction === "in" ? "ENTRANT" : "SORTANT";
      const from = e.from_email ? ` de ${e.from_email}` : "";
      lines.push(`- [${date}] (${dir}${from}) ${e.title ?? "(sans objet)"} : ${e.body.slice(0, 400)}`);
    }
  } else {
    lines.push("Aucun email échangé trouvé dans HubSpot pour ce compte.");
  }

  // Autres engagements (meetings/calls/notes)
  const others = hubspot.engagements.filter((e) => e.type !== "email");
  if (others.length > 0) {
    lines.push("");
    lines.push(`## Autres interactions (meetings, calls, notes)`);
    for (const e of others.slice(0, 10)) {
      const date = e.date ? new Date(e.date).toLocaleDateString("fr-FR") : "?";
      lines.push(`- [${date}] ${e.type}${e.title ? ` ${e.title}` : ""}${e.body ? ` : ${e.body.slice(0, 200)}` : ""}`);
    }
  }

  // News / signaux
  lines.push("");
  lines.push("## News & signaux récents");
  let hasNews = false;
  if (news) {
    if (news.intel_summary) {
      hasNews = true;
      lines.push(`Synthèse veille : ${news.intel_summary}`);
    }
    if (news.signals.length > 0) {
      hasNews = true;
      lines.push(`### Signaux marché / presse (${news.signals.length})`);
      for (const s of news.signals.slice(0, 8)) {
        const date = s.created_at ? ` [${s.created_at}]` : "";
        lines.push(`- (${s.type})${date} ${s.title}${s.excerpt ? ` : ${s.excerpt}` : ""}`);
      }
    }
    if (news.posts.length > 0) {
      hasNews = true;
      lines.push(`### Posts LinkedIn (${news.posts.length})`);
      for (const p of news.posts.slice(0, 6)) {
        const date = p.postedAt ? new Date(p.postedAt).toLocaleDateString("fr-FR") : "?";
        lines.push(`- [${date}] ${p.text.slice(0, 250)}`);
      }
    }
  }
  if (!hasNews) {
    lines.push("Aucune news récente.");
  }

  // Nos clients actuels (référence sociale pour l'histoire à raconter).
  lines.push("");
  lines.push("## Nos clients actuels (référence sociale par secteur)");
  lines.push(
    "Utilise cette liste pour construire story_to_tell. Ne cite que des clients de cette liste, jamais inventés.",
  );
  lines.push(formatClientsRoster(clientsRoster));

  return lines.join("\n");
}
