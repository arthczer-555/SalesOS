/**
 * Outils "fiche client" de CoachelloAI : lecture seule de la table `clients`
 * (Supabase), exactement la donnée que sert l'onglet Clients de CoachelloHQ.
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
import {
  HUBSPOT_CHECKLIST_FIELDS,
  SECTION_DEFINITIONS,
  getMissingHubspotFields,
  isHubspotFieldEmpty,
  mergeOnboardingItems,
  type ClientFieldValue,
  type ClientFields,
  type ClientRow,
  type HubspotChecklistFieldDef,
  type HubspotDealFields,
} from "@/lib/clients/types";
import { toClientTier } from "@/lib/clients/tier";
import { getClientTodo } from "@/lib/clients/todo";
import { fetchDealsContractInfo, fetchHubspotDealFields } from "@/lib/clients/hubspot-fields";
import { resolveContractEnd, type ContractEnd } from "@/lib/clients/lifecycle";
import { openActions } from "@/lib/clients/portfolio";
import { hubspotRecordUrl } from "@/lib/hubspot";
import type { ToolContext, ToolModule } from "./types";

// Colonnes de la liste : jamais select("*") ici, fields_json et health_history
// pèsent lourd et n'ont aucun intérêt dans une liste.
const LIST_COLUMNS =
  "id, hubspot_deal_id, company_name, tier, owner_email, owner_name, am_email, am_name, cs_email, cs_name, closedwon_at, deal_amount, billing, health, enrichment_status, last_enriched_at, last_refreshed_at, next_billing_date";

// search_clients lit en plus, comme la vue portefeuille (api/clients/list) :
// insights pour la prochaine action, et la fin de contrat trouvée dans les
// échanges (repli de HubSpot, cf. resolveContractEnd), seule, sans fields_json.
const SEARCH_COLUMNS = `${LIST_COLUMNS}, insights, contract_end_field:fields_json->planning->fin_contrat_le`;

// Colonnes de la fiche : tout ce que get_client peut rendre, section par
// section. Explicite plutôt que "*" pour ne pas embarquer les colonnes de
// travail (candidats de meetings en attente, brouillon d'email, etc.).
const DETAIL_COLUMNS = `${LIST_COLUMNS}, hubspot_company_id, billing_refreshed_at, am_cs_notified_at, fields_json, deal_recap, insights, news, coach_brief, coach_brief_generated_at, health_history, onboarding_checklist, hubspot_field_suggestions, enrichment_error, last_refresh_report, declined_claap_recording_ids, discovered_claap_recordings, account_companies`;

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
  "whats_new",
  "hubspot",
] as const;
type SectionName = (typeof SECTION_KEYS)[number];

// Où vit chaque section sur la fiche (?tab= + ancre #k-… de l'onglet
// Knowledge, cf. knowledge-tab.tsx) : l'agent renvoie l'utilisateur pile sur
// l'info qu'il cite. "" = onglet par défaut (Key insights).
const SECTION_PAGE_PATHS: Record<SectionName, string> = {
  general_info: "?tab=knowledge#k-contacts",
  program_scope: "?tab=knowledge#k-program",
  goals: "?tab=knowledge#k-goals",
  org: "?tab=knowledge#k-it",
  history: "?tab=knowledge#k-history",
  planning: "?tab=knowledge#k-planning",
  fields: "?tab=knowledge",
  health: "",
  deal_recap: "?tab=knowledge#k-recap",
  insights: "",
  news: "?tab=knowledge#k-news",
  coach_brief: "?tab=knowledge#k-brief",
  checklist: "?tab=todo",
  meetings: "?tab=knowledge#k-meetings",
  whats_new: "?tab=knowledge#k-activity",
  hubspot: "?tab=hubspot",
};

// URL absolue : la réponse part aussi dans Slack, où "/clients/…" ne mène nulle part.
function clientsPageUrl(path = ""): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.URL || "").replace(/\/$/, "");
  return `${appUrl}/clients${path}`;
}

/** Ce que contient chaque section : sert au tail "non chargé" pour que l'agent sache quoi rappeler. */
const FIELD_SECTION_HINTS: Record<FieldSectionName, string> = {
  general_info: "contacts (signataire, RH principal, RH opérationnel, facturation, IT), autres parties prenantes, langues, zones géographiques",
  program_scope: "type de coaching, nom du programme, population accompagnée, nb de coachés, cohortes, offres associées",
  goals: "objectifs business/RH, KPIs clés, attentes spécifiques",
  org: "IT et accès (SSO, provisioning, canal Slack/Teams et statut de l'app, visio, sécurité, DPA, résidence des données), documents de référence, contraintes organisationnelles",
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
  | "id" | "hubspot_deal_id" | "company_name" | "tier" | "owner_email" | "owner_name"
  | "am_email" | "am_name" | "cs_email" | "cs_name" | "closedwon_at"
  | "deal_amount" | "billing" | "health" | "enrichment_status"
  | "last_enriched_at" | "last_refreshed_at" | "next_billing_date"
>;

type SearchRow = ListRow & Pick<ClientRow, "insights"> & { contract_end_field?: ClientFieldValue | null };

type DetailRow = ListRow &
  Pick<
    ClientRow,
    | "hubspot_company_id" | "billing_refreshed_at" | "am_cs_notified_at" | "fields_json"
    | "deal_recap" | "insights" | "news" | "coach_brief" | "coach_brief_generated_at"
    | "health_history" | "onboarding_checklist" | "hubspot_field_suggestions" | "enrichment_error"
    | "last_refresh_report" | "declined_claap_recording_ids" | "discovered_claap_recordings" | "account_companies"
  >;

// ── Helpers de rendu ─────────────────────────────────────────────────────────

/** Filtre "clients qui me concernent" : owner du deal, ou AM/CS du handover. */
function mineFilter(email: string): string {
  return `owner_email.eq.${email},am_email.eq.${email},cs_email.eq.${email}`;
}

function slimHealth(h: ClientRow["health"]) {
  if (!h) return null;
  // drivers : libellés courts avec leurs points ("Recent contact (5d ago) (+20)"),
  // assez pour expliquer un score sans charger la décomposition complète.
  return {
    score: h.score,
    label: h.label,
    trend: h.trend,
    summary: h.summary,
    drivers: h.drivers,
    phase: h.phase?.key ?? null,
    data_gaps: h.data_gaps?.length ? h.data_gaps : undefined,
    // Tuile "Last touch" de la fiche : répond à "quand a-t-on parlé à X ?".
    last_contact_at: h.last_contact_at ?? null,
    last_contact_source: h.last_contact_source ?? null,
    tone: h.tone ? { label: h.tone.label, reason: h.tone.reason } : null,
    computed_at: h.computed_at,
  };
}

/**
 * Next actions de la fiche. Une action cochée sur la page garde sa place dans
 * `actions` avec un done_at : on la sort de la liste ouverte, sinon l'agent
 * présente comme "à faire" ce que l'équipe a déjà fait.
 */
function slimInsights(i: ClientRow["insights"]) {
  if (!i) return null;
  const open = i.actions.filter((a) => !a.done_at);
  const done = i.actions.filter((a) => a.done_at);
  return {
    generated_at: i.generated_at,
    next_actions: open.map((a) => ({
      title: a.title,
      why: a.why ?? a.rationale ?? null,
      owner: a.owner ?? null,
      due: a.due ?? null,
      priority: a.priority ?? null,
      source: a.source ?? null,
    })),
    done_actions: done.length > 0 ? done.map((a) => ({ title: a.title, done_at: a.done_at, done_by: a.done_by ?? null })) : undefined,
    highlights: i.highlights?.length ? i.highlights : undefined,
    watch_points: i.watch_points?.length ? i.watch_points : undefined,
    observations: i.observations?.length ? i.observations : undefined,
    note: "'due' est relatif à generated_at (this_week = la semaine de la génération), pas à aujourd'hui.",
  };
}

/** Carte "What's new" : ce que le dernier refresh (manuel ou cron hebdo) a trouvé et changé. */
function slimRefreshReport(r: ClientRow["last_refresh_report"]) {
  if (!r) return null;
  return {
    refreshed_at: r.refreshed_at,
    trigger: r.trigger ?? null,
    health_before: r.health_before,
    health_after: r.health_after,
    new_activity_count: r.new_activity_count,
    // Par source : une source en erreur n'a pas été lue, ce n'est pas "rien de neuf".
    sources: r.sources ?? undefined,
    changed_fields: r.changed_fields.map((f) => ({ field: f.label, before: f.before, after: f.after, overrode_manual: f.overrode_manual })),
    meetings_added: r.auto_added_meetings?.length ? r.auto_added_meetings : undefined,
    notes: r.notes?.length ? r.notes : undefined,
    skipped_no_activity: r.skipped_no_activity ?? false,
    error: r.error ?? undefined,
  };
}

/**
 * Fin de contrat, même règle que Key dates sur la fiche et que la vue
 * portefeuille : contract_end_date du deal HubSpot, lue en live (un appel batch
 * pour toute la liste), sinon la date trouvée dans les échanges
 * (resolveContractEnd). HubSpot injoignable = aucun repli sur les échanges (on
 * ne sait pas si HubSpot a une date) et une erreur explicite, jamais "pas de date".
 */
async function loadContractEnds(
  rows: Array<{ hubspot_deal_id: string; closedwon_at: string | null; contract_end_field?: ClientFieldValue | null }>,
): Promise<{ ok: true; byDeal: Map<string, ContractEnd> } | { ok: false; error: string }> {
  const deals = await fetchDealsContractInfo(rows.map((r) => r.hubspot_deal_id));
  if (!deals.ok) return deals;
  const byDeal = new Map<string, ContractEnd>();
  for (const r of rows) {
    byDeal.set(
      r.hubspot_deal_id,
      resolveContractEnd({
        contractEndDate: deals.deals.get(r.hubspot_deal_id)?.contractEnd ?? null,
        closedwonAt: r.closedwon_at,
        conversationsField: r.contract_end_field,
      }),
    );
  }
  return { ok: true, byDeal };
}

// Même calcul que daysUntil (ui.tsx de la fiche) : les jours cités par l'agent
// sont ceux affichés sur la page.
function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.ceil((t - Date.now()) / 86_400_000) : null;
}

// Facturé du sheet revenue, comme la vue portefeuille : une société absente du
// sheet n'est jamais un 0. billing null = fiche jamais enrichie, le sheet n'a
// pas encore été lu pour elle (il peut très bien la contenir).
function slimBilled(b: ClientRow["billing"]) {
  if (!b) return "not loaded on this client file yet: use get_billing_revenue";
  if (!b.matched) return "not in revenue sheet";
  return { current_year: b.current_year_revenue ?? null, all_time: b.total_contract_value ?? null };
}

const CONTRACT_END_UNREACHABLE = "unknown: HubSpot unreachable";

function slimContractEnd(end: ContractEnd | undefined) {
  if (!end) return CONTRACT_END_UNREACHABLE;
  return {
    date: end.date?.slice(0, 10) ?? null,
    days_left: daysLeft(end.date),
    from: end.from,
    ...(end.rejected && { invalid_hubspot_date: end.rejected.slice(0, 10) }),
  };
}

const CONTRACT_END_NOTE =
  "contract_end = fin de contrat, même règle que la fiche. from='hubspot' : contract_end_date du deal, la source de vérité. from='conversations' : absente de HubSpot, date dite ou écrite dans un échange, à présenter comme telle (\"not in HubSpot, from the conversations\"). date null : aucune date connue (\"Missing in HubSpot\" sur la fiche), à signaler, jamais à deviner d'une durée habituelle. invalid_hubspot_date : date HubSpot antérieure à la signature, écartée, à faire corriger. days_left négatif = contrat terminé.";

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * fields_json[section][key] = { value, confidence, source, updated_at }.
 * On ne renvoie que `value`, sous le libellé humain de SECTION_DEFINITIONS
 * (source de vérité partagée avec l'UI), enums traduits comme sur la page
 * ("installee" -> "Installed", sinon l'agent recopie la valeur brute dans
 * Slack), et on remonte à part les champs que l'IA a extraits sans confiance.
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
      bucket[field.label] =
        field.kind === "enum" && typeof cell.value === "string" ? field.optionLabels?.[cell.value] ?? cell.value : cell.value;
      if (typeof cell.confidence === "number" && cell.confidence < LOW_CONFIDENCE) {
        low_confidence.push(field.label);
      }
    }
    if (Object.keys(bucket).length > 0) sections[section.label] = bucket;
  }

  return { sections, low_confidence };
}

/**
 * Meetings Claap de la fiche, comme la timeline Knowledge > Meetings : les
 * analysés (recap, score) puis ceux que la découverte Claap a associés au
 * compte sans les analyser (discovered_claap_recordings, dédoublonnés). Sur la
 * plupart des fiches, ces derniers sont la majorité : les omettre ferait dire
 * "aucun meeting" à l'agent. SANS transcript (get_claap_meeting_transcript).
 * Les meetings retirés à la main de la fiche sont exclus partout.
 */
async function loadMeetings(
  row: Pick<DetailRow, "hubspot_deal_id" | "declined_claap_recording_ids" | "discovered_claap_recordings">,
) {
  const { data, error } = await db
    .from("sales_coach_analyses")
    .select("claap_recording_id, meeting_title, meeting_started_at, meeting_kind, audience, meeting_recap, score_global")
    .eq("hubspot_deal_id", row.hubspot_deal_id)
    .eq("status", "done")
    .order("meeting_started_at", { ascending: false, nullsFirst: false });
  if (error) return { error: `Meetings analysés illisibles (${error.message}) : n'en conclus pas qu'il n'y en a pas.` };
  type Row = {
    claap_recording_id: string;
    meeting_title: string | null;
    meeting_started_at: string | null;
    meeting_kind: string | null;
    audience: string | null;
    meeting_recap: { summary?: string | null } | null;
    score_global: number | null;
  };
  const declined = new Set(row.declined_claap_recording_ids ?? []);
  const analyzed = (data as Row[] | null ?? []).filter((m) => !declined.has(m.claap_recording_id)).map((m) => ({
    recording_id: m.claap_recording_id,
    title: m.meeting_title,
    date: m.meeting_started_at,
    kind: m.meeting_kind,
    audience: m.audience,
    recap: m.meeting_recap?.summary ?? null,
    score: m.score_global,
  }));
  const seen = new Set(analyzed.map((m) => m.recording_id));
  const matched = (row.discovered_claap_recordings ?? [])
    .filter((r) => !seen.has(r.recording_id) && !declined.has(r.recording_id))
    .sort((a, b) => (b.meeting_started_at ?? "").localeCompare(a.meeting_started_at ?? ""))
    .map((r) => ({ recording_id: r.recording_id, title: r.meeting_title, date: r.meeting_started_at, claap_url: r.claap_url }));
  return { analyzed, matched };
}

/** Lien HubSpot du deal, comme "Open in HubSpot" sur la fiche. */
function hubspotDealUrl(dealId: string): string | null {
  const portalId = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID;
  return portalId && dealId ? hubspotRecordUrl(portalId, "deals", dealId) : null;
}

// Valeur HubSpot telle qu'affichée par l'onglet HubSpot cleaner : libellé de
// l'option pour un enum (les multi-select HubSpot sont séparés par ";").
function hubspotDisplayValue(def: HubspotChecklistFieldDef, raw: string): string {
  if (!def.options) return raw;
  return raw
    .split(";")
    .map((v) => def.options?.find((o) => o.value === v.trim())?.label ?? v.trim())
    .join(", ");
}

/**
 * Onglet HubSpot cleaner : champs surveillés du deal, lus en live comme la
 * page (un seul GET pour tous), remplis avec leur valeur, vides listés à part
 * (c'est le compteur de l'onglet).
 */
function slimHubspotDeal(dealFields: HubspotDealFields) {
  const filled: Record<string, string> = {};
  for (const f of HUBSPOT_CHECKLIST_FIELDS) {
    const v = dealFields[f.property];
    if (!isHubspotFieldEmpty(v)) filled[f.label] = hubspotDisplayValue(f, String(v));
  }
  return { fields: filled, missing_in_hubspot: getMissingHubspotFields(dealFields).map((f) => f.label) };
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
    warning: `⚠️ ${company} n'a pas de fiche client dans CoachelloHQ. Si c'est bien un client signé, il doit être IMPORTÉ dans la table clients pour que son contexte (programme, contacts, objectifs, santé) soit disponible ici.`,
    action_required: `Aller sur ${clientsPageUrl()} et importer le compte (bouton d'import des deals closed-won), puis confirmer ses meetings Claap pour lancer l'enrichissement.`,
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
      "Liste les clients ayant une FICHE CLIENT dans CoachelloHQ (table clients, un compte par deal closed-won). Utilise-le pour toute question de portefeuille : 'mes clients', 'les comptes en risque', 'qui gère X', 'les derniers clients signés'. Renvoie par compte : société, tier, owner du deal, AM et CS assignés, date de signature, montant, santé (score + label vert/jaune/rouge, phase, DERNIER CONTACT), CA facturé (année en cours et all time, sheet revenue), FIN DE CONTRAT (contract_end : date, jours restants, origine, lue en live dans HubSpot comme sur la fiche), prochaine facturation et prochaine action ouverte de la fiche. Passe 'mine_only' pour ne garder que les comptes de l'utilisateur connecté (owner, AM ou CS), 'health' ou 'phase' (onboarding / running / renewal, comme la colonne Phase) pour filtrer. Passe 'query' pour cibler une société (matching flou : 'Adyen' matche 'ADYEN N.V.'). " +
      "RENOUVELLEMENTS : 'les contrats qui se terminent dans les 90 jours', 'mes renouvellements à venir' → passe contract_ends_within_days (ex : 90), le résultat est trié par fin de contrat (la plus proche d'abord) et no_contract_end liste les comptes sans date exploitable, à signaler plutôt qu'à ignorer en silence. " +
      "TIER = importance du compte fixée à la main par l'équipe : 1 = stratégique (priorité maximale), 2 = important, 3 = standard, null = pas encore classé. Passe 'tier' pour ne garder qu'un niveau ('mes comptes prioritaires', 'les Tier 1'). Quand tu listes, classes ou résumes plusieurs comptes, traite les Tier 1 en premier, et un Tier 1 en risque passe avant tout le reste. " +
      "COUVERTURE PARTIELLE, à ne jamais oublier : cette table ne contient que les deals signés depuis la mise en place de la fiche client. De nombreux clients historiques n'y sont PAS. L'absence d'un compte ici ne prouve rien : enchaîne sur HubSpot (search_deals, get_companies) et sur get_billing_revenue, dont le sheet liste tous les clients facturés. Pour un total de clients ou un classement, c'est le sheet revenue qui fait foi, pas cette table. " +
      "Si le résultat contient un champ commençant par 'warning' (fiches dont les meetings Claap restent à confirmer, ou jamais enrichies), relaie-le à l'utilisateur : leur contexte est vide tant qu'il n'a pas fait l'action.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Nom de société à chercher. Omets pour lister tous les clients." },
        mine_only: { type: "boolean", description: "true = seulement les comptes où l'utilisateur connecté est owner, AM ou CS." },
        health: { type: "string", enum: ["green", "yellow", "red"], description: "Filtre sur la santé du compte." },
        tier: { type: "integer", enum: [1, 2, 3], description: "Filtre sur le tier du compte (1 = stratégique, 2 = important, 3 = standard)." },
        phase: {
          type: "string",
          enum: ["onboarding", "running", "renewal"],
          description: "Filtre sur la phase du compte (colonne Phase de la liste, calculée avec la santé) : onboarding = programme en lancement, running = programme en cours, renewal = fin de contrat à 120 jours ou moins.",
        },
        contract_ends_within_days: {
          type: "integer",
          description: "Ne garde que les comptes dont la fin de contrat tombe entre aujourd'hui et aujourd'hui + N jours (ex : 90). Trie par fin de contrat.",
        },
        sort: {
          type: "string",
          enum: ["signed", "contract_end"],
          description: "signed (défaut) = signés les plus récents d'abord. contract_end = fin de contrat la plus proche d'abord, comptes sans date en dernier (défaut quand contract_ends_within_days est passé).",
        },
        limit: { type: "number", description: "Nombre max de clients renvoyés (défaut 50)." },
      },
      required: [],
    },
  },
  {
    name: "get_client",
    description:
      "Fiche client CoachelloHQ : LA source de vérité sur l'état d'un compte signé, quand elle existe. Elle agrège déjà HubSpot, les meetings Claap analysés et le sheet revenue. " +
      "RÉFLEXE : dès qu'une question nomme un client Coachello, commence par ici. " +
      "QUESTION DE DÉTAIL = CET OUTIL SEUL. 'Qui est le contact RH chez X', 'quel est le programme de X', 'la date de kickoff de X', 'quand se termine le contrat de X', 'qui est l'AM sur X' : UN appel, tu réponds, tu n'ouvres RIEN d'autre. TOUJOURS RENVOYÉ, quelles que soient les sections : key_dates, la carte Key dates de la fiche (signature, kickoff, dernier contact, prochaine facturation, FIN DE CONTRAT lue en live dans HubSpot, sinon trouvée dans les échanges). N'appelle pas HubSpot, Claap, le sheet revenue ni Notion 'pour compléter'. Ne croise que pour une question d'ANALYSE (point de compte, QBR, risque de churn, upsell). " +
      "CIBLE LA BONNE SECTION en un seul appel, via 'sections' : general_info = les contacts (signataire, RH principal, RH opérationnel, facturation, IT), parties prenantes, langues, zones. program_scope = type de coaching, nom du programme, population, nb de coachés, cohortes, offres. goals = objectifs business/RH, KPIs, attentes. org = organisation et IT : mode d'accès (SSO, magic link), provisioning (SCIM, CSV, SIRH), canal Slack/Teams et statut de l'app, visio, questionnaire sécurité, DPA, résidence des données, documents, contraintes. history = relation commerciale, initiatives RH parallèles, POINTS DE VIGILANCE. planning = date de KICKOFF, suivi CS attendu, engagements pris par le sales. Plus : health (score, drivers, DERNIER CONTACT, ton des derniers meetings), deal_recap (comment le deal s'est signé, objections, promesses), insights (NEXT ACTIONS avec owner et échéance, faits récents), whats_new (QUOI DE NEUF : ce que le dernier refresh a trouvé et changé), news, coach_brief, checklist (ce qui reste à faire : handover, champs à compléter, onboarding, champs HubSpot vides), meetings (analysés avec recap ET associés au compte sans analyse), hubspot (onglet HubSpot cleaner : champs du deal lus en live, qualification, champion, budget, need, timeline, next step HubSpot, durée et dates du contrat, mode de facturation, champs vides et suggestions). Utilise 'fields' pour charger les 6 sections d'un coup, seulement si la question est large. " +
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
            "Sections à charger, ciblées sur la question (chaque section coûte 1 à 3 ko). Défaut : general_info + program_scope + health + meetings. Pour les points de vigilance → history. Pour la date de kickoff ou les engagements sales → planning. Pour l'IT (SSO, provisioning, app Teams/Slack, sécurité) → org. Pour les objectifs/KPIs → goals. Pour 'quoi de neuf' → whats_new + insights. Pour 'que reste-t-il à faire / à compléter' → checklist. Pour 'dernier contact' → health. Pour la qualification du deal, le champion, le budget, la durée du contrat ou les champs HubSpot → hubspot. Les dates clés (signature, kickoff, facturation, début et fin de contrat) sont toujours renvoyées dans key_dates. 'fields' charge les 6 d'un coup.",
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
  const tier = toClientTier(input.tier);
  const within = typeof input.contract_ends_within_days === "number" && input.contract_ends_within_days >= 0
    ? Math.floor(input.contract_ends_within_days)
    : null;
  const sortByEnd = input.sort === "contract_end" || (within !== null && input.sort !== "signed");

  let q = db.from("clients").select(SEARCH_COLUMNS).order("closedwon_at", { ascending: false, nullsFirst: false });

  if (input.mine_only === true) {
    if (!ctx.userEmail) {
      return "Impossible d'appliquer mine_only : l'email de l'utilisateur connecté est inconnu. Relance sans mine_only.";
    }
    q = q.or(mineFilter(ctx.userEmail));
  }
  const phase = typeof input.phase === "string" ? input.phase : null;
  if (typeof input.health === "string") q = q.eq("health->>label", input.health);
  if (phase) q = q.eq("health->phase->>key", phase);
  if (tier) q = q.eq("tier", tier);
  if (query) q = q.ilike("company_name", `%${query}%`);

  const { data, error } = await q;
  if (error) return `Erreur lecture des clients : ${error.message}`;

  let rows = (data as SearchRow[] | null) ?? [];

  // Repêchage flou seulement si le "contient" SQL n'a rien donné. Il repart
  // d'une requête sans filtre : on ré-applique mine_only, health, phase et tier
  // à la main, sinon le fallback les contournerait silencieusement.
  if (rows.length === 0 && query) {
    let fuzzy = (await resolveByCompany(query, SEARCH_COLUMNS)) as SearchRow[];
    if (input.mine_only === true && ctx.userEmail) {
      const me = ctx.userEmail;
      fuzzy = fuzzy.filter((r) => r.owner_email === me || r.am_email === me || r.cs_email === me);
    }
    if (typeof input.health === "string") fuzzy = fuzzy.filter((r) => r.health?.label === input.health);
    if (phase) fuzzy = fuzzy.filter((r) => r.health?.phase?.key === phase);
    if (tier) fuzzy = fuzzy.filter((r) => r.tier === tier);
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

  ctx.onProgress("Reading contract end dates in HubSpot...");
  const ends = await loadContractEnds(rows);
  if (!ends.ok && (within !== null || sortByEnd)) {
    return JSON.stringify({
      error: `HubSpot injoignable (${ends.error}) : impossible de lire les fins de contrat, donc de filtrer ou trier dessus.`,
      tell_the_user:
        "Dis explicitement que les fins de contrat n'ont pas pu être lues (HubSpot injoignable). N'affirme JAMAIS qu'aucun contrat ne se termine sur la période.",
    });
  }
  const endOf = (r: SearchRow) => (ends.ok ? ends.byDeal.get(r.hubspot_deal_id) : undefined);

  // Comptes sans date exploitable : sortis du filtre mais nommés, pour que
  // l'agent les signale au lieu de les faire disparaître en silence.
  let noContractEnd: string[] = [];
  if (within !== null) {
    noContractEnd = rows
      .filter((r) => !endOf(r)?.date)
      .map((r) => {
        const rejected = endOf(r)?.rejected;
        return rejected ? `${r.company_name} (invalid date in HubSpot: ${rejected.slice(0, 10)})` : r.company_name;
      });
    rows = rows.filter((r) => {
      const d = daysLeft(endOf(r)?.date ?? null);
      return d !== null && d >= 0 && d <= within;
    });
    if (rows.length === 0) {
      return JSON.stringify({
        count: 0,
        message: `Aucune fiche client (avec ces critères) dont la fin de contrat tombe dans les ${within} prochains jours.`,
        ...(noContractEnd.length > 0 && {
          no_contract_end: noContractEnd,
          no_contract_end_note: "Comptes sans fin de contrat connue (ni dans HubSpot ni dans les échanges) : impossible de dire s'ils renouvellent sur la période. Signale-les.",
        }),
      });
    }
  }
  if (sortByEnd) {
    // Plus proche d'abord, comptes sans date en dernier.
    const key = (r: SearchRow) => endOf(r)?.date ?? "9999";
    rows = [...rows].sort((a, b) => key(a).localeCompare(key(b)));
  }

  const capped = rows.slice(0, limit);
  for (const r of capped.slice(0, 5)) {
    ctx.onSource({ kind: "client", title: r.company_name, url: clientsPageUrl(`/${r.id}`) });
  }

  // Fiches bloquées sur une action humaine : à relayer, sinon l'utilisateur
  // croit que la donnée n'existe pas.
  const toConfirm = capped.filter((r) => r.enrichment_status === "awaiting_meetings").map((r) => r.company_name);
  const notEnriched = capped
    .filter((r) => r.enrichment_status === "pending" || r.enrichment_status === "error")
    .map((r) => r.company_name);

  return JSON.stringify({
    source: "table clients CoachelloHQ (fiches clients)",
    coverage_note:
      "Liste des clients AYANT UNE FICHE, pas la liste des clients Coachello. Ne présente jamais ce total comme le nombre de clients de l'entreprise : pour un décompte ou un classement, c'est get_billing_revenue (sheet revenue) qui fait foi.",
    count: rows.length,
    returned: capped.length,
    // Un gabarit plutôt qu'une URL par ligne : 50 URLs complètes pèseraient ~1k tokens.
    client_page_url: clientsPageUrl("/{client_id}"),
    client_page_note: "Pour renvoyer vers la fiche d'un compte cité, remplace {client_id} par son client_id.",
    contract_end_note: CONTRACT_END_NOTE,
    ...(!ends.ok && {
      contract_end_error: `⚠️ HubSpot injoignable (${ends.error}) : fins de contrat non lues. Dis-le, n'en conclus jamais qu'un compte n'a pas de date.`,
    }),
    clients: capped.map((r) => {
      const open = openActions(r.insights);
      const next = open[0];
      return {
        client_id: r.id,
        company: r.company_name,
        tier: r.tier ?? null,
        owner: r.owner_name ?? r.owner_email,
        am: r.am_name ?? r.am_email,
        cs: r.cs_name ?? r.cs_email,
        closedwon_at: r.closedwon_at,
        deal_amount: r.deal_amount,
        billed: slimBilled(r.billing),
        contract_end: slimContractEnd(endOf(r)),
        next_billing_date: r.next_billing_date ?? null,
        health: slimHealth(r.health),
        next_action: next ? { title: next.title, owner: next.owner ?? null, due: next.due ?? null } : null,
        open_actions: open.length,
        enrichment_status: r.enrichment_status,
      };
    }),
    ...(noContractEnd.length > 0 && {
      no_contract_end: noContractEnd,
      no_contract_end_note: "Comptes écartés du filtre faute de fin de contrat connue (ni dans HubSpot ni dans les échanges) : signale-les, leur renouvellement peut tomber sur la période.",
    }),
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
          tier: r.tier ?? null,
          closedwon_at: r.closedwon_at,
          deal_amount: r.deal_amount,
          owner: r.owner_name ?? r.owner_email,
        }))
        .sort((a, b) => (b.closedwon_at ?? "").localeCompare(a.closedwon_at ?? "")),
    });
  }

  const row = rows[0];
  const pageUrl = clientsPageUrl(`/${row.id}`);
  ctx.onSource({ kind: "client", title: row.company_name, url: pageUrl });

  // Champs surveillés du deal, lus en live comme le GET de la fiche (un seul
  // appel : fin de contrat de Key dates, contrat de Billing, onglet HubSpot
  // cleaner). Lancé tout de suite, il tourne pendant la lecture des meetings.
  // null = HubSpot illisible, jamais "champs vides".
  const dealFieldsP = fetchHubspotDealFields(row.hubspot_deal_id);

  const requested = new Set<SectionName>(
    Array.isArray(input.sections) && input.sections.length > 0
      ? (input.sections as SectionName[]).filter((s) => (SECTION_KEYS as readonly string[]).includes(s))
      : DEFAULT_SECTIONS
  );

  // Un lien par section chargée, vers l'onglet et l'ancre qui l'affichent.
  const pageLinks: Record<string, string> = { overview: pageUrl };
  for (const s of requested) pageLinks[s] = `${pageUrl}${SECTION_PAGE_PATHS[s]}`;

  // Identité + handover + poids financier : toujours là, c'est le minimum
  // vital pour situer le compte, et ça pèse quelques lignes.
  const out: Record<string, unknown> = {
    source: "fiche client CoachelloHQ",
    client_id: row.id,
    company: row.company_name,
    page_links: pageLinks,
    page_links_note:
      "Termine ta réponse par un lien markdown vers la section de la fiche qui contient l'info citée, URL prise telle quelle dans page_links (overview si la réponse couvre plusieurs sections), libellé dans la langue de l'utilisateur.",
    tier: row.tier ?? null,
    tier_note: "Importance du compte fixée par l'équipe : 1 = stratégique, 2 = important, 3 = standard, null = pas encore classé.",
    hubspot_deal_id: row.hubspot_deal_id,
    hubspot_deal_url: hubspotDealUrl(row.hubspot_deal_id),
    closedwon_at: row.closedwon_at,
    deal_amount: row.deal_amount,
    owner: row.owner_name ?? row.owner_email,
    am: row.am_name ?? row.am_email,
    cs: row.cs_name ?? row.cs_email,
    handover_notified_at: row.am_cs_notified_at,
    // Carte Billing de la fiche : année en cours, YoY, lifetime, barres par année.
    billing_snapshot: row.billing?.matched
      ? {
          total_contract_value: row.billing.total_contract_value,
          current_year_revenue: row.billing.current_year_revenue,
          prev_year_revenue: row.billing.prev_year_revenue ?? null,
          yoy_growth: row.billing.yoy_growth ?? null,
          revenue_by_year: row.billing.revenue_by_year ?? null,
          ...(row.billing.is_rfp && { rfp: true }),
          refreshed_at: row.billing_refreshed_at,
          note: "Instantané du sheet revenue. Pour un chiffre à jour ou le détail par année : get_billing_revenue.",
        }
      : slimBilled(row.billing),
    enrichment_status: row.enrichment_status,
    last_enriched_at: row.last_enriched_at,
    last_refreshed_at: row.last_refreshed_at,
  };

  // Companies HubSpot rattachées au compte par le refresh (filiales, autres
  // entités), panneau en haut à droite de la fiche. "pending" = à confirmer.
  const companies = row.account_companies ?? [];
  if (companies.length > 0) {
    out.account_companies = companies.map((c) => ({
      name: c.name ?? c.domain ?? "Unnamed company",
      domain: c.domain,
      status: c.status,
      why: c.detail,
    }));
    const pending = companies.filter((c) => c.status === "pending");
    if (pending.length > 0) {
      out.warning_account_companies = `⚠️ ${pending.length} company(s) HubSpot rattachée(s) au compte attendent une confirmation (Keep / Remove) sur la fiche (${pageUrl}) : leur activité est comptée d'ici là. Signale-le.`;
    }
  }

  // Fiche pas encore enrichie : la donnée ci-dessous est vide ou partielle, et
  // il y a une action humaine à faire dans CoachelloHQ. On la remonte pour que
  // l'agent la RELAIE à l'utilisateur au lieu de répondre "je ne trouve rien".
  if (row.enrichment_status !== "done") {
    const warnings: Record<string, string> = {
      awaiting_meetings: `⚠️ La fiche de ${row.company_name} n'est pas encore enrichie : les meetings Claap doivent d'abord être CONFIRMÉS. Tant que ce n'est pas fait, l'analyse ne démarre pas et les champs ci-dessous sont vides.`,
      pending: `⚠️ La fiche de ${row.company_name} a été importée mais n'a jamais été enrichie : les champs ci-dessous sont vides.`,
      running: `⚠️ L'enrichissement de la fiche de ${row.company_name} est en cours : les champs ci-dessous sont incomplets, ils le seront dans quelques minutes.`,
      error: `⚠️ L'enrichissement de la fiche de ${row.company_name} a échoué (${row.enrichment_error ?? "raison inconnue"}) : les champs ci-dessous peuvent être vides ou dater d'une run précédente.`,
    };
    const actions: Record<string, string> = {
      awaiting_meetings: `Ouvrir la fiche (${pageUrl}) et confirmer la liste des meetings Claap (bouton "Confirm meetings") pour lancer l'enrichissement.`,
      pending: `Ouvrir la fiche (${pageUrl}) et lancer l'enrichissement.`,
      running: "Rien à faire, attendre la fin de la run.",
      error: `Ouvrir la fiche (${pageUrl}) et relancer l'enrichissement.`,
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
  if (requested.has("insights")) out.insights = slimInsights(row.insights);
  if (requested.has("whats_new")) out.whats_new = slimRefreshReport(row.last_refresh_report);
  if (requested.has("news")) out.news = row.news;
  if (requested.has("coach_brief")) {
    out.coach_brief = row.coach_brief;
    out.coach_brief_generated_at = row.coach_brief_generated_at;
  }
  if (requested.has("meetings")) {
    const meetings = await loadMeetings(row);
    if ("error" in meetings) {
      out.meetings_error = meetings.error;
    } else {
      out.analyzed_meetings = meetings.analyzed;
      out.other_matched_meetings = meetings.matched;
    }
    out.meetings_note =
      "Même liste que Knowledge > Meetings. analyzed_meetings : analysés, avec recap. other_matched_meetings : associés au compte par la découverte Claap mais pas analysés (pas de recap), ce sont bien des meetings du compte. Transcript non inclus : get_claap_meeting_transcript(recording_id), valable pour les deux listes.";
  }

  const dealFields = await dealFieldsP;
  const hubspotUnreachable = "⚠️ HubSpot injoignable : champs du deal non lus. Dis-le, n'en conclus jamais qu'ils sont vides.";

  if (requested.has("checklist")) {
    // Même calcul que l'onglet To do (getClientTodo) : les compteurs que
    // l'agent cite sont ceux que l'utilisateur voit sur la page.
    const todo = getClientTodo(row);
    const items = mergeOnboardingItems(row.onboarding_checklist);
    out.todo = {
      handover_pending: todo.handoverPending,
      fields_to_fill: todo.missingFields.map((f) => `${f.group} > ${f.label}${f.required ? " (required)" : ""}`),
      onboarding_checklist:
        todo.onboarding.applicable && !todo.onboarding.dismissed
          ? {
              done: todo.onboarding.done,
              total: todo.onboarding.total,
              remaining: items.filter((i) => !i.done).map((i) => `${i.category} > ${i.section} : ${i.label}`),
            }
          : todo.onboarding.dismissed
            ? "hidden on the client file (checklist dismissed by the team)"
            : "not applicable (AI coaching or coaching type unknown)",
    };
    // Compteur de l'onglet HubSpot cleaner : champs vides en live, pas les
    // suggestions IA stockées (qui peuvent dater d'avant un remplissage).
    out.hubspot_fields_to_fill = dealFields ? getMissingHubspotFields(dealFields).map((f) => f.label) : hubspotUnreachable;
  }
  if (requested.has("hubspot")) {
    if (!dealFields) {
      out.hubspot_deal = hubspotUnreachable;
    } else {
      // Suggestions IA de l'onglet, pour les seuls champs encore vides.
      const missing = new Set(getMissingHubspotFields(dealFields).map((f) => f.property));
      const suggestions = (row.hubspot_field_suggestions?.fields ?? [])
        .filter((s) => missing.has(s.property) && s.property !== "contract_end_date")
        .map((s) => ({ field: s.label, suggestion: s.suggestion, why: s.rationale }));
      out.hubspot_deal = {
        ...slimHubspotDeal(dealFields),
        ...(suggestions.length > 0 && { suggestions_for_missing: suggestions }),
        note: "Valeurs lues en live sur le deal HubSpot (onglet HubSpot cleaner). Les suggestions sont des propositions IA non écrites dans HubSpot : jamais à présenter comme des faits.",
      };
    }
  }

  // Carte Key dates de la fiche (key-dates-card.tsx), mêmes sources : toujours
  // là, ça pèse quelques lignes et "quand se termine le contrat" est une
  // question de détail comme une autre.
  const kickoff = row.fields_json?.planning?.kickoff_envisage_le?.value;
  const contractEnd = dealFields
    ? resolveContractEnd({
        contractEndDate: dealFields.contract_end_date,
        closedwonAt: row.closedwon_at,
        conversationsField: row.fields_json?.planning?.fin_contrat_le,
      })
    : undefined;
  out.key_dates = {
    signed: row.closedwon_at?.slice(0, 10) ?? null,
    kickoff: typeof kickoff === "string" && kickoff.trim() ? kickoff : null,
    last_touch: row.health?.last_contact_at ?? null,
    last_touch_source: row.health?.last_contact_source ?? null,
    next_billing: row.next_billing_date ?? null,
    // Carte Billing : début de contrat et mode de facturation du deal.
    contract_start: dealFields ? dealFields.contract_start_date?.slice(0, 10) ?? null : CONTRACT_END_UNREACHABLE,
    contract_end: slimContractEnd(contractEnd),
    note: CONTRACT_END_NOTE,
    ...(!dealFields && { contract_end_error: hubspotUnreachable }),
  };
  pageLinks.key_dates = pageUrl;

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
  if (!requested.has("insights") && row.insights) availableElsewhere.push("insights (next actions ouvertes et faites, faits récents, points de vigilance courts)");
  if (!requested.has("whats_new") && row.last_refresh_report) availableElsewhere.push(`whats_new (dernier refresh du ${row.last_refresh_report.refreshed_at.slice(0, 10)} : champs modifiés, activité nouvelle par source, meetings ajoutés)`);
  if (!requested.has("news") && row.news?.items?.length) availableElsewhere.push(`news (${row.news.items.length} actualités)`);
  if (!requested.has("coach_brief") && row.coach_brief) availableElsewhere.push("coach_brief (brief de staffing des coachs)");
  if (!requested.has("checklist") && row.onboarding_checklist?.items?.length) availableElsewhere.push("checklist (avancement onboarding)");
  if (!requested.has("meetings")) availableElsewhere.push("meetings (meetings Claap du compte : analysés avec recap, et associés non analysés)");
  if (!requested.has("hubspot")) availableElsewhere.push("hubspot (champs du deal HubSpot en live : qualification, champion, budget, need, timeline, next step, durée et dates du contrat, facturation, champs vides)");
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
