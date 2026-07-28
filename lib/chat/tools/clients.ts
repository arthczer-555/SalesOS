/**
 * Outils "fiche client" de CoachelloGPT : lecture seule de la table `clients`
 * (Supabase), exactement la donnée que sert l'onglet Clients de SalesOS.
 *
 * Une fiche client agrège déjà HubSpot + les meetings Claap analysés + le sheet
 * revenue : c'est donc la source la PLUS riche sur un compte signé, et une
 * question de détail ("le contact RH chez X ?") doit se répondre avec un seul
 * appel, sans rien croiser. Cette règle vit dans les descriptions ci-dessous,
 * lues par le modèle au moment exact où il choisit son outil.
 *
 * LECTURE SEULE : aucun handler n'écrit dans `clients`. Modifier une fiche
 * reste un geste explicite dans l'onglet Clients.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { normalizeCompany, pickBestFuzzy } from "@/lib/fuzzy-match";
import { SECTION_DEFINITIONS, type ClientFields, type ClientRow } from "@/lib/clients/types";
import type { ToolContext, ToolModule } from "./types";

// Colonnes de la liste : jamais select("*") ici, fields_json et health_history
// pèsent lourd et n'ont aucun intérêt dans une liste.
const LIST_COLUMNS =
  "id, hubspot_deal_id, company_name, owner_email, owner_name, am_email, am_name, cs_email, cs_name, closedwon_at, deal_amount, billing, health, enrichment_status, last_enriched_at, last_refreshed_at";

// Colonnes de la fiche : tout ce que get_client peut rendre, section par
// section. Explicite plutôt que "*" pour ne pas embarquer les colonnes de
// travail (candidats de meetings en attente, brouillon d'email, etc.).
const DETAIL_COLUMNS = `${LIST_COLUMNS}, hubspot_company_id, billing_refreshed_at, am_cs_notified_at, fields_json, deal_recap, insights, news, coach_brief, coach_brief_generated_at, health_history, onboarding_checklist, hubspot_field_suggestions, enrichment_error`;

// Les 6 sections du brief (SECTION_DEFINITIONS) sont adressables une par une :
// chacune pèse 1 à 3 ko, les 6 ensemble 9 à 14 ko. Rendre la fiche entière à
// chaque appel ferait payer 4 ko de tokens pour "qui est le contact RH ?".
// L'agent cible donc la section utile en UN appel (mapping topic -> section
// écrit dans la description), et "fields" reste un alias pour tout charger.
const FIELD_SECTIONS = ["general_info", "program_scope", "goals", "org", "history", "planning"] as const;
type FieldSectionName = (typeof FIELD_SECTIONS)[number];

const SECTION_KEYS = [
  ...FIELD_SECTIONS,
  "fields",
  "health",
  "deal_recap",
  "insights",
  "news",
  "coach_brief",
  "checklist",
  "meetings",
] as const;
type SectionName = (typeof SECTION_KEYS)[number];

/** Ce que contient chaque section : sert au tail "non chargé" pour que l'agent sache quoi rappeler. */
const FIELD_SECTION_HINTS: Record<FieldSectionName, string> = {
  general_info: "contacts (signataire, RH principal, RH opérationnel, facturation, IT), autres parties prenantes, langues, zones géographiques",
  program_scope: "type de coaching, nom du programme, population accompagnée, nb de coachés, cohortes, offres associées",
  goals: "objectifs business/RH, KPIs clés, attentes spécifiques",
  org: "intégration IT (SSO, HRIS, Slack), documents de référence, contraintes organisationnelles",
  history: "relation commerciale (nouveau/renouvellement/upsell), initiatives RH parallèles, points de vigilance",
  planning: "date de kickoff, suivi CS attendu, engagements pris par le sales",
};

// Défaut : qui est le client, ce qu'il a acheté, comment il va. Le reste est
// annoncé dans `sections_disponibles_non_chargees` avec son contenu.
const DEFAULT_SECTIONS: SectionName[] = ["general_info", "program_scope", "health", "meetings"];

// Seuil Jaro-Winkler du repêchage flou. 0.85 = "Adyen" retrouve "ADYEN N.V."
// sans confondre deux sociétés distinctes.
const FUZZY_THRESHOLD = 0.85;

// En dessous, l'extraction IA n'était pas sûre d'elle : on le signale au modèle
// pour qu'il nuance au lieu d'affirmer.
const LOW_CONFIDENCE = 0.5;

type ListRow = Pick<
  ClientRow,
  | "id" | "hubspot_deal_id" | "company_name" | "owner_email" | "owner_name"
  | "am_email" | "am_name" | "cs_email" | "cs_name" | "closedwon_at"
  | "deal_amount" | "billing" | "health" | "enrichment_status"
  | "last_enriched_at" | "last_refreshed_at"
>;

type DetailRow = ListRow &
  Pick<
    ClientRow,
    | "hubspot_company_id" | "billing_refreshed_at" | "am_cs_notified_at" | "fields_json"
    | "deal_recap" | "insights" | "news" | "coach_brief" | "coach_brief_generated_at"
    | "health_history" | "onboarding_checklist" | "hubspot_field_suggestions" | "enrichment_error"
  >;

// ── Helpers de rendu ─────────────────────────────────────────────────────────

/** Filtre "clients qui me concernent" : owner du deal, ou AM/CS du handover. */
function mineFilter(email: string): string {
  return `owner_email.eq.${email},am_email.eq.${email},cs_email.eq.${email}`;
}

function slimHealth(h: ClientRow["health"]) {
  if (!h) return null;
  return { score: h.score, label: h.label, trend: h.trend, summary: h.summary, computed_at: h.computed_at };
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * fields_json[section][key] = { value, confidence, source, updated_at }.
 * On ne renvoie que `value`, sous le libellé humain de SECTION_DEFINITIONS
 * (source de vérité partagée avec l'UI), et on remonte à part les champs que
 * l'IA a extraits sans confiance.
 */
function flattenFields(
  fields: Partial<ClientFields>,
  keep: Set<string>
): {
  sections: Record<string, Record<string, unknown>>;
  low_confidence: string[];
} {
  const raw = fields as Record<string, Record<string, { value?: unknown; confidence?: number } | undefined>>;
  const sections: Record<string, Record<string, unknown>> = {};
  const low_confidence: string[] = [];

  for (const section of SECTION_DEFINITIONS) {
    if (!keep.has(section.key)) continue;
    const bucket: Record<string, unknown> = {};
    for (const field of section.fields) {
      const cell = raw[section.key]?.[field.key];
      if (!cell || isEmpty(cell.value)) continue;
      bucket[field.label] = cell.value;
      if (typeof cell.confidence === "number" && cell.confidence < LOW_CONFIDENCE) {
        low_confidence.push(field.label);
      }
    }
    if (Object.keys(bucket).length > 0) sections[section.label] = bucket;
  }

  return { sections, low_confidence };
}

/** Meetings Claap analysés du deal, SANS transcript (l'agent enchaîne sur get_claap_meeting_transcript). */
async function loadMeetings(dealId: string) {
  const { data, error } = await db
    .from("sales_coach_analyses")
    .select("claap_recording_id, meeting_title, meeting_started_at, meeting_kind, meeting_recap, score_global")
    .eq("hubspot_deal_id", dealId)
    .eq("status", "done")
    .order("meeting_started_at", { ascending: false, nullsFirst: false });
  if (error) return [];
  type Row = {
    claap_recording_id: string;
    meeting_title: string | null;
    meeting_started_at: string | null;
    meeting_kind: string | null;
    meeting_recap: { summary?: string | null } | null;
    score_global: number | null;
  };
  return (data as Row[] | null ?? []).map((m) => ({
    recording_id: m.claap_recording_id,
    title: m.meeting_title,
    date: m.meeting_started_at,
    kind: m.meeting_kind,
    recap: m.meeting_recap?.summary ?? null,
    score: m.score_global,
  }));
}

/**
 * Résolution d'un nom de société : exact/contient d'abord (SQL), repêchage
 * Jaro-Winkler ensuite. Renvoie toujours les lignes candidates : c'est
 * l'appelant qui décide quoi faire de l'ambiguïté (une société peut avoir
 * plusieurs deals closed-won, hubspot_deal_id est unique mais pas company_name).
 */
async function resolveByCompany(company: string, columns: string): Promise<ListRow[]> {
  const { data } = await db.from("clients").select(columns).ilike("company_name", `%${company}%`);
  const hits = (data as ListRow[] | null) ?? [];
  if (hits.length > 0) return hits;

  const { data: all } = await db.from("clients").select("id, company_name");
  const names = (all as { id: string; company_name: string }[] | null) ?? [];
  const best = pickBestFuzzy(names, normalizeCompany(company), (c) => normalizeCompany(c.company_name), FUZZY_THRESHOLD);
  if (!best) return [];

  const { data: row } = await db.from("clients").select(columns).eq("id", best.item.id);
  return (row as ListRow[] | null) ?? [];
}

/**
 * Échec actionnable, et il n'est PAS rare : la table ne couvre que les deals
 * passés à closed-won depuis la mise en place de la feature. Beaucoup de
 * clients historiques n'y sont pas. L'absence de fiche ne prouve donc rien sur
 * la relation commerciale : le modèle doit enchaîner sur ses autres outils
 * sans jamais conclure "je ne trouve rien sur ce client".
 */
async function notFound(company: string): Promise<string> {
  const { data } = await db.from("clients").select("company_name").order("company_name");
  const available = ((data as { company_name: string }[] | null) ?? []).map((r) => r.company_name);
  return JSON.stringify({
    matched: false,
    message: `Aucune fiche client pour "${company}". ATTENTION : cela ne veut PAS dire que ce compte est inconnu de Coachello. La table clients ne couvre que les deals signés depuis la mise en place de la fiche client, beaucoup de clients historiques n'y figurent pas. Enchaîne MAINTENANT sur tes autres outils, dans le même tour si possible : search_deals / get_companies (HubSpot), get_billing_revenue (le sheet revenue liste tous les clients facturés, y compris ceux absents d'ici), search_claap_meetings, search_slack. Ne réponds jamais "je n'ai pas d'information sur ce client" sur la seule base de cet échec.`,
    warning: `⚠️ ${company} n'a pas de fiche client dans SalesOS. Si c'est bien un client signé, il doit être IMPORTÉ dans la table clients pour que son contexte (programme, contacts, objectifs, santé) soit disponible ici.`,
    action_required: "Aller sur /clients et importer le compte (bouton d'import des deals closed-won), puis confirmer ses meetings Claap pour lancer l'enrichissement.",
    tell_the_user:
      "DIS-LE À L'UTILISATEUR, explicitement, à la fin de ta réponse : c'est une action concrète de sa part qui manque. Mais réponds d'abord à sa question avec tes autres outils : l'absence de fiche n'est pas une absence d'information.",
    fallback_tools: ["search_deals", "get_companies", "get_billing_revenue", "search_claap_meetings", "search_slack"],
    available_clients: available,
  });
}

// ── Définitions ──────────────────────────────────────────────────────────────

const defs: Anthropic.Tool[] = [
  {
    name: "search_clients",
    description:
      "Liste les clients ayant une FICHE CLIENT dans SalesOS (table clients, un compte par deal closed-won). Utilise-le pour toute question de portefeuille : 'mes clients', 'les comptes en risque', 'qui gère X', 'les derniers clients signés'. Renvoie par compte : société, owner du deal, AM et CS assignés, date de signature, montant, santé (score + label vert/jaune/rouge) et CA total facturé. Passe 'mine_only' pour ne garder que les comptes de l'utilisateur connecté (owner, AM ou CS). Passe 'query' pour cibler une société (matching flou : 'Adyen' matche 'ADYEN N.V.'). " +
      "COUVERTURE PARTIELLE, à ne jamais oublier : cette table ne contient que les deals signés depuis la mise en place de la fiche client. De nombreux clients historiques n'y sont PAS. L'absence d'un compte ici ne prouve rien : enchaîne sur HubSpot (search_deals, get_companies) et sur get_billing_revenue, dont le sheet liste tous les clients facturés. Pour un total de clients ou un classement, c'est le sheet revenue qui fait foi, pas cette table. " +
      "Si le résultat contient un champ commençant par 'warning' (fiches dont les meetings Claap restent à confirmer, ou jamais enrichies), relaie-le à l'utilisateur : leur contexte est vide tant qu'il n'a pas fait l'action.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Nom de société à chercher. Omets pour lister tous les clients." },
        mine_only: { type: "boolean", description: "true = seulement les comptes où l'utilisateur connecté est owner, AM ou CS." },
        health: { type: "string", enum: ["green", "yellow", "red"], description: "Filtre sur la santé du compte." },
        limit: { type: "number", description: "Nombre max de clients renvoyés (défaut 50)." },
      },
      required: [],
    },
  },
  {
    name: "get_client",
    description:
      "Fiche client SalesOS : LA source de vérité sur l'état d'un compte signé, quand elle existe. Elle agrège déjà HubSpot, les meetings Claap analysés et le sheet revenue. " +
      "RÉFLEXE : dès qu'une question nomme un client Coachello, commence par ici. " +
      "QUESTION DE DÉTAIL = CET OUTIL SEUL. 'Qui est le contact RH chez X', 'quel est le programme de X', 'la date de kickoff de X', 'qui est l'AM sur X' : UN appel, tu réponds, tu n'ouvres RIEN d'autre. N'appelle pas HubSpot, Claap, le sheet revenue ni Notion 'pour compléter'. Ne croise que pour une question d'ANALYSE (point de compte, QBR, risque de churn, upsell). " +
      "CIBLE LA BONNE SECTION en un seul appel, via 'sections' : general_info = les contacts (signataire, RH principal, RH opérationnel, facturation, IT), parties prenantes, langues, zones. program_scope = type de coaching, nom du programme, population, nb de coachés, cohortes, offres. goals = objectifs business/RH, KPIs, attentes. org = intégration IT (SSO, HRIS, Slack), documents, contraintes. history = relation commerciale, initiatives RH parallèles, POINTS DE VIGILANCE. planning = date de KICKOFF, suivi CS attendu, engagements pris par le sales. Plus : health, deal_recap (comment le deal s'est signé, objections, promesses), insights, news, coach_brief, checklist (onboarding), meetings. Utilise 'fields' pour charger les 6 sections d'un coup, seulement si la question est large. " +
      "SI AUCUNE FICHE N'EXISTE : ne conclus jamais que le client est inconnu. La table ne couvre que les deals signés depuis la mise en place de la fiche, beaucoup de clients historiques y manquent. Bascule immédiatement sur HubSpot (search_deals, get_companies), get_billing_revenue, search_claap_meetings et search_slack, ET préviens l'utilisateur que ce client devrait être importé dans la table clients. " +
      "AVERTISSEMENTS À RELAYER : si le résultat contient un champ 'warning' (fiche absente, meetings Claap à confirmer, enrichissement jamais lancé ou en échec), reprends-le tel quel à la fin de ta réponse avec l'action à faire. C'est une action concrète de l'utilisateur qui manque, pas une information inexistante : ne le laisse jamais croire l'inverse. " +
      "Les pages clients de Notion sont des use cases et références commerciales, jamais l'état opérationnel d'un compte. Les valeurs sont extraites par IA et datées (last_enriched_at) : signale une fiche ancienne, et ne présente jamais un champ listé dans low_confidence comme un fait acquis. Le bloc billing est un instantané ; pour un chiffre de CA à jour ou le détail par année, get_billing_revenue fait foi.",
    input_schema: {
      type: "object" as const,
      properties: {
        company: { type: "string", description: "Nom de la société (matching flou). Voie normale." },
        client_id: { type: "string", description: "UUID de la fiche, si tu l'as déjà obtenu via search_clients." },
        sections: {
          type: "array",
          items: { type: "string", enum: [...SECTION_KEYS] },
          description:
            "Sections à charger, ciblées sur la question (chaque section coûte 1 à 3 ko). Défaut : general_info + program_scope + health + meetings. Pour les points de vigilance → history. Pour la date de kickoff ou les engagements sales → planning. Pour l'intégration IT → org. Pour les objectifs/KPIs → goals. 'fields' charge les 6 d'un coup.",
        },
      },
      required: [],
    },
  },
];

// ── Handlers ─────────────────────────────────────────────────────────────────

async function searchClients(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  ctx.onProgress("Searching client accounts...");

  const query = (input.query as string | undefined)?.trim();
  const limit = typeof input.limit === "number" ? input.limit : 50;

  let q = db.from("clients").select(LIST_COLUMNS).order("closedwon_at", { ascending: false, nullsFirst: false });

  if (input.mine_only === true) {
    if (!ctx.userEmail) {
      return "Impossible d'appliquer mine_only : l'email de l'utilisateur connecté est inconnu. Relance sans mine_only.";
    }
    q = q.or(mineFilter(ctx.userEmail));
  }
  if (typeof input.health === "string") q = q.eq("health->>label", input.health);
  if (query) q = q.ilike("company_name", `%${query}%`);

  const { data, error } = await q;
  if (error) return `Erreur lecture des clients : ${error.message}`;

  let rows = (data as ListRow[] | null) ?? [];

  // Repêchage flou seulement si le "contient" SQL n'a rien donné. Il repart
  // d'une requête sans filtre : on ré-applique mine_only et health à la main,
  // sinon le fallback les contournerait silencieusement.
  if (rows.length === 0 && query) {
    let fuzzy = await resolveByCompany(query, LIST_COLUMNS);
    if (input.mine_only === true && ctx.userEmail) {
      const me = ctx.userEmail;
      fuzzy = fuzzy.filter((r) => r.owner_email === me || r.am_email === me || r.cs_email === me);
    }
    if (typeof input.health === "string") fuzzy = fuzzy.filter((r) => r.health?.label === input.health);
    if (fuzzy.length === 0) return notFound(query);
    rows = fuzzy;
  }
  if (rows.length === 0) {
    return JSON.stringify({
      count: 0,
      message:
        "Aucune fiche client ne correspond à ces critères. Rappel : la table ne couvre que les deals signés depuis la mise en place de la fiche client, elle n'est pas la liste complète des clients Coachello. Si la question porte sur le portefeuille global, appuie-toi sur get_billing_revenue (sheet revenue).",
    });
  }

  const capped = rows.slice(0, limit);
  for (const r of capped.slice(0, 5)) {
    ctx.onSource({ kind: "client", title: r.company_name, url: `/clients/${r.id}` });
  }

  // Fiches bloquées sur une action humaine : à relayer, sinon l'utilisateur
  // croit que la donnée n'existe pas.
  const toConfirm = capped.filter((r) => r.enrichment_status === "awaiting_meetings").map((r) => r.company_name);
  const notEnriched = capped
    .filter((r) => r.enrichment_status === "pending" || r.enrichment_status === "error")
    .map((r) => r.company_name);

  return JSON.stringify({
    source: "table clients SalesOS (fiches clients)",
    coverage_note:
      "Liste des clients AYANT UNE FICHE, pas la liste des clients Coachello. Ne présente jamais ce total comme le nombre de clients de l'entreprise : pour un décompte ou un classement, c'est get_billing_revenue (sheet revenue) qui fait foi.",
    count: rows.length,
    returned: capped.length,
    clients: capped.map((r) => ({
      client_id: r.id,
      company: r.company_name,
      owner: r.owner_name ?? r.owner_email,
      am: r.am_name ?? r.am_email,
      cs: r.cs_name ?? r.cs_email,
      closedwon_at: r.closedwon_at,
      deal_amount: r.deal_amount,
      total_billed: r.billing?.total_contract_value ?? null,
      health: slimHealth(r.health),
      enrichment_status: r.enrichment_status,
    })),
    ...(toConfirm.length > 0 && {
      warning_meetings_to_confirm: `⚠️ Fiches en attente : ${toConfirm.join(", ")}. Leurs meetings Claap doivent être CONFIRMÉS sur la fiche pour que l'enrichissement démarre ; d'ici là leur contexte est vide. Signale-le à l'utilisateur.`,
    }),
    ...(notEnriched.length > 0 && {
      warning_not_enriched: `⚠️ Fiches non enrichies : ${notEnriched.join(", ")}. Leur enrichissement n'a jamais tourné ou a échoué, leur contexte est vide. Signale-le à l'utilisateur.`,
    }),
  });
}

async function getClient(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  ctx.onProgress("Reading client file...");

  const clientId = (input.client_id as string | undefined)?.trim();
  const company = (input.company as string | undefined)?.trim();
  if (!clientId && !company) return "Précise 'company' (nom de la société) ou 'client_id'.";

  let rows: DetailRow[];
  if (clientId) {
    const { data, error } = await db.from("clients").select(DETAIL_COLUMNS).eq("id", clientId);
    if (error) return `Erreur lecture de la fiche client : ${error.message}`;
    rows = (data as DetailRow[] | null) ?? [];
  } else {
    rows = (await resolveByCompany(company!, DETAIL_COLUMNS)) as DetailRow[];
  }

  if (rows.length === 0) return company ? notFound(company) : "Aucune fiche client pour cet identifiant.";

  // Plusieurs closed-won pour la même société : on ne tranche pas au hasard.
  if (rows.length > 1) {
    return JSON.stringify({
      matched: false,
      multiple: true,
      message: `Plusieurs fiches clients correspondent à "${company}". Rappelle get_client avec le client_id voulu (le plus récent est en général le bon).`,
      candidates: rows
        .map((r) => ({
          client_id: r.id,
          company: r.company_name,
          closedwon_at: r.closedwon_at,
          deal_amount: r.deal_amount,
          owner: r.owner_name ?? r.owner_email,
        }))
        .sort((a, b) => (b.closedwon_at ?? "").localeCompare(a.closedwon_at ?? "")),
    });
  }

  const row = rows[0];
  ctx.onSource({ kind: "client", title: row.company_name, url: `/clients/${row.id}` });

  const requested = new Set<SectionName>(
    Array.isArray(input.sections) && input.sections.length > 0
      ? (input.sections as SectionName[]).filter((s) => (SECTION_KEYS as readonly string[]).includes(s))
      : DEFAULT_SECTIONS
  );

  // Identité + handover + poids financier : toujours là, c'est le minimum
  // vital pour situer le compte, et ça pèse quelques lignes.
  const out: Record<string, unknown> = {
    source: "fiche client SalesOS",
    client_id: row.id,
    company: row.company_name,
    url: `/clients/${row.id}`,
    hubspot_deal_id: row.hubspot_deal_id,
    closedwon_at: row.closedwon_at,
    deal_amount: row.deal_amount,
    owner: row.owner_name ?? row.owner_email,
    am: row.am_name ?? row.am_email,
    cs: row.cs_name ?? row.cs_email,
    handover_notified_at: row.am_cs_notified_at,
    billing_snapshot: row.billing
      ? {
          total_contract_value: row.billing.total_contract_value,
          current_year_revenue: row.billing.current_year_revenue,
          refreshed_at: row.billing_refreshed_at,
          note: "Instantané du sheet revenue. Pour un chiffre à jour ou le détail par année : get_billing_revenue.",
        }
      : null,
    enrichment_status: row.enrichment_status,
    last_enriched_at: row.last_enriched_at,
    last_refreshed_at: row.last_refreshed_at,
  };

  // Fiche pas encore enrichie : la donnée ci-dessous est vide ou partielle, et
  // il y a une action humaine à faire dans SalesOS. On la remonte pour que
  // l'agent la RELAIE à l'utilisateur au lieu de répondre "je ne trouve rien".
  if (row.enrichment_status !== "done") {
    const warnings: Record<string, string> = {
      awaiting_meetings: `⚠️ La fiche de ${row.company_name} n'est pas encore enrichie : les meetings Claap doivent d'abord être CONFIRMÉS. Tant que ce n'est pas fait, l'analyse ne démarre pas et les champs ci-dessous sont vides.`,
      pending: `⚠️ La fiche de ${row.company_name} a été importée mais n'a jamais été enrichie : les champs ci-dessous sont vides.`,
      running: `⚠️ L'enrichissement de la fiche de ${row.company_name} est en cours : les champs ci-dessous sont incomplets, ils le seront dans quelques minutes.`,
      error: `⚠️ L'enrichissement de la fiche de ${row.company_name} a échoué (${row.enrichment_error ?? "raison inconnue"}) : les champs ci-dessous peuvent être vides ou dater d'une run précédente.`,
    };
    const actions: Record<string, string> = {
      awaiting_meetings: `Ouvrir la fiche (${`/clients/${row.id}`}) et confirmer la liste des meetings Claap (bouton "Meetings to confirm") pour lancer l'enrichissement.`,
      pending: `Ouvrir la fiche (${`/clients/${row.id}`}) et lancer l'enrichissement.`,
      running: "Rien à faire, attendre la fin de la run.",
      error: `Ouvrir la fiche (${`/clients/${row.id}`}) et relancer l'enrichissement.`,
    };
    out.warning = warnings[row.enrichment_status] ?? `Fiche au statut ${row.enrichment_status} : données partielles.`;
    out.action_required = actions[row.enrichment_status];
    out.tell_the_user =
      "DIS-LE À L'UTILISATEUR, explicitement, dans ta réponse : il ne doit pas croire que l'information n'existe pas alors qu'il manque juste une action de sa part. Puis complète avec tes autres outils (HubSpot, Claap, sheet revenue, Slack) pour répondre quand même à sa question.";
  }

  // "fields" = alias des 6 sections du brief.
  const wantedFieldSections = new Set<string>(
    requested.has("fields") ? FIELD_SECTIONS : FIELD_SECTIONS.filter((s) => requested.has(s))
  );
  if (wantedFieldSections.size > 0) {
    const { sections, low_confidence } = flattenFields(row.fields_json ?? {}, wantedFieldSections);
    out.fields = sections;
    if (low_confidence.length > 0) {
      out.low_confidence = low_confidence;
      out.low_confidence_note = "Champs extraits par l'IA avec une confiance faible : à annoncer comme incertains, pas comme des faits.";
    }
  }
  if (requested.has("health")) {
    out.health = slimHealth(row.health);
    out.health_history = (row.health_history ?? []).slice(-6).map((h) => ({ score: h.score, label: h.label, computed_at: h.computed_at }));
    out.health_note = "Le score de santé est un JUGEMENT produit par IA à la date indiquée, pas une mesure. Cite-le comme tel.";
  }
  if (requested.has("deal_recap")) out.deal_recap = row.deal_recap;
  if (requested.has("insights")) out.insights = row.insights;
  if (requested.has("news")) out.news = row.news;
  if (requested.has("coach_brief")) {
    out.coach_brief = row.coach_brief;
    out.coach_brief_generated_at = row.coach_brief_generated_at;
  }
  if (requested.has("checklist")) {
    const items = row.onboarding_checklist?.items ?? [];
    out.onboarding_checklist = {
      done: items.filter((i) => i.done).length,
      total: items.length,
      remaining: items.filter((i) => !i.done).map((i) => `${i.category} > ${i.section} : ${i.label}`),
    };
    out.hubspot_fields_to_fill = (row.hubspot_field_suggestions?.fields ?? []).map((f) => f.label);
  }
  if (requested.has("meetings")) {
    out.analyzed_meetings = await loadMeetings(row.hubspot_deal_id);
    out.meetings_note = "Transcript non inclus. Pour le détail d'un meeting : get_claap_meeting_transcript(recording_id).";
  }

  // Ce qui existe mais n'a pas été chargé : l'agent sait quoi rappeler au lieu
  // d'aller chercher ailleurs une info déjà présente ici.
  const availableElsewhere: string[] = [];
  const raw = (row.fields_json ?? {}) as Record<string, Record<string, { value?: unknown }> | undefined>;
  for (const s of FIELD_SECTIONS) {
    if (wantedFieldSections.has(s)) continue;
    const filled = Object.values(raw[s] ?? {}).filter((c) => !isEmpty(c?.value)).length;
    if (filled > 0) availableElsewhere.push(`${s} : ${FIELD_SECTION_HINTS[s]}`);
  }
  if (!requested.has("deal_recap") && row.deal_recap) availableElsewhere.push("deal_recap (comment le deal s'est signé, objections, promesses sales, risques onboarding)");
  if (!requested.has("insights") && row.insights) availableElsewhere.push("insights (actions recommandées)");
  if (!requested.has("news") && row.news?.items?.length) availableElsewhere.push(`news (${row.news.items.length} actualités)`);
  if (!requested.has("coach_brief") && row.coach_brief) availableElsewhere.push("coach_brief (brief de staffing des coachs)");
  if (!requested.has("checklist") && row.onboarding_checklist?.items?.length) availableElsewhere.push("checklist (avancement onboarding)");
  if (!requested.has("meetings")) availableElsewhere.push("meetings (meetings Claap analysés)");
  if (availableElsewhere.length > 0) out.sections_disponibles_non_chargees = availableElsewhere;

  return JSON.stringify(out);
}

const module_: ToolModule = {
  defs,
  handlers: {
    search_clients: async (input, ctx) => {
      try {
        return await searchClients(input, ctx);
      } catch (e) {
        return `Erreur lecture des clients : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    },
    get_client: async (input, ctx) => {
      try {
        return await getClient(input, ctx);
      } catch (e) {
        return `Erreur lecture de la fiche client : ${e instanceof Error ? e.message : "inconnue"}`;
      }
    },
  },
};

export const clientsTools = module_;
