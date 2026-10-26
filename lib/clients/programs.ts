import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import { withAnthropicRetry } from "../anthropic-retry";
import { logUsage } from "../log-usage";
import { anthropicClient } from "@/lib/anthropic-client";
import { withForcedTool } from "../models/compat";
import { NO_EM_DASH_RULE } from "@/lib/no-em-dash";
import type { DealSnapshot } from "../hubspot";
import { field } from "./prompt";
import { toFieldValue } from "./parse-output";
import { mergeFieldValue } from "./merge-fields";
import {
  AI_MODULE_VALUES,
  ASSESSMENT_VALUES,
  PROGRAM_FIELD_DEFINITIONS,
  PROGRAM_STATUSES,
  PROGRAM_STATUS_LABELS,
  programFieldApplies,
  programStatusOf,
  type ClientFieldValue,
  type ClientProgram,
  type CoachBrief,
  type ProgramChange,
  type ProgramFieldKey,
  type ProgramScopeFields,
} from "./types";

// Programmes d'un compte (Knowledge > Program scope) : détection IA à partir
// des échanges, puis fusion avec ceux déjà sur la fiche.
//  - Appel dédié (pas une section de plus dans CLIENT_FIELDS_TOOL, déjà lourd),
//    même contexte que l'extraction des fields, lancé en parallèle par le
//    refresh et l'enrichissement.
//  - L'IA reçoit les programmes connus avec leur id et renvoie le même id pour
//    le même programme : le kanban reste stable d'un refresh à l'autre.
//  - Fusion attribut par attribut avec la règle des fields (mergeFieldValue) :
//    l'IA ne vide jamais un attribut, une édition manuelle (dont un statut
//    déplacé dans le kanban) n'est remplacée que par une source datée après
//    l'édition. Un programme que l'IA ne renvoie plus est conservé ; un
//    programme supprimé à la main (declined) n'est jamais recréé.
// Pas de donnée d'adoption ici : elle viendra de la DB plateforme.

const MAX_PROGRAMS = 10;
// Alias gardés par programme : ils s'ajoutent d'un refresh à l'autre, les plus
// anciens d'abord.
const MAX_ALIASES = 10;

// Attributs dont le changement figure dans le refresh report (les phrases
// d'explication sont reformulées à chaque passage : ce serait du bruit).
const UNREPORTED_KEYS = new Set<ProgramFieldKey>([
  "status_reason", "risk_reason", "objective", "three_way_details", "rp_content_details", "deployment_details",
]);

// Attributs dont le changement rend le coach brief obsolète.
const BRIEF_KEYS = new Set<ProgramFieldKey>([
  "coaching_type", "catalog_program", "population", "nb_coachees", "sessions_per_coachee", "three_way",
  "ai_modules", "start_date", "end_date",
]);

export const PROGRAMS_SYSTEM_PROMPT = `Tu es un analyste Customer Success chez Coachello (coaching de leaders et managers : coaching humain 1:1 avec des coachs, et AI Role-Play).
Tu reçois l'historique d'un compte client : contexte HubSpot (deal, deals liés, contacts, notes, emails, meetings), transcripts et recaps des meetings Claap, messages Slack du canal client.

Ton job : lister les PROGRAMMES de coaching de ce compte et, pour chacun, son statut et ses infos clés. Le churn et le pilotage se suivent programme par programme : un compte peut avoir un programme live qui va bien, un autre en set-up, un troisième arrêté.

QU'EST-CE QU'UN PROGRAMME
- Une offre Coachello déployée pour une population donnée, avec son objectif et son set-up propres (ex : "Manager", "Executive coaching", "Prise de poste MPRO", "Women leadership", "AI Role-Play commerciaux").
- MÊME programme, pas un nouveau : la même offre reconduite pour la même population (nouvelle édition, vague, cohorte ou année : "Évolution 2025" puis "Évolution 2026", "vague 1" puis "vague 2"), un groupe régional, un sous-groupe. Le statut et les infos suivent l'édition la plus récente.
- DEUX programmes distincts : deux parcours qui tournent en parallèle pour des populations ou des objectifs différents (ex : coaching managers et coaching executives, parcours "développement" et parcours "executive"), même s'ils ont été vendus dans un seul deal.
- PAS un programme : un atelier, un webinar, un 360, une option ou un add-on (ils vont dans add_ons du programme concerné). Une idée seulement pitchée ou évoquée, sans engagement du client, n'est pas un programme.
- Lis avec soin : les noms du deal et des deals liés (souvent un deal par programme ou par édition), les kickoffs, les QBR, les emails de set-up (création des groupes, licences, communication aux coachés), les échanges Slack de l'équipe, les renouvellements et upsells.
- Un compte qui a signé a au moins un programme. S'il n'y en a qu'un, nomme-le comme le client ou l'équipe le nomme, sinon d'après la population ("Manager program").

STATUT (status), un seul parmi :
- not_started : programme engagé (signé ou confirmé par le client), set-up pas encore commencé.
- set_up : onboarding en cours (scoping, configuration de la plateforme, communication, staffing des coachs, kickoff planifié), pas encore de coachés en session.
- poc : pilote sur un périmètre restreint, avec une décision de déploiement à venir.
- live : des coachés sont en sessions (lancé, kickoff passé, sessions en cours).
- turned_off : terminé, en pause, annulé ou non renouvelé.
L'information la plus RÉCENTE prime. status_reason : une phrase qui justifie le statut avec la date de la source.

RISQUE (risk), seulement pour un programme non arrêté, d'après les échanges : on_track (signaux positifs explicites), watch (signal faible : retard, adoption timide évoquée, interlocuteur moins présent), at_risk (adoption faible, sponsor parti, budget remis en cause, insatisfaction exprimée). risk_reason : une phrase datée. Aucun signal : value=null.

TYPE (coaching_type) ET CHAMPS PAR TYPE
- humain : coaching 1:1 avec un coach humain, sans IA pour les coachés.
- hybride : coaching humain augmenté par l'IA (coach IA entre les sessions et/ou role-plays, en plus du coach humain).
- ia : IA seule, sans coach humain (AI Role-Play et/ou AI coach).
Remplis le socle pour tout programme : status, status_reason, coaching_type, objective, population, nb_coachees, start_date, end_date, cohorts, languages, risk, risk_reason, add_ons. Puis SEULEMENT les blocs qui s'appliquent au type, et omets tous les autres champs :
- coaching humain (humain, hybride) : catalog_program, sessions_per_coachee, journey_months, three_way, three_way_details, coach_pool, internal_coaches, assessments, credits.
- IA (ia, hybride) : ai_modules, client_context.
- role-play (ia ou hybride avec le module "Role-play") : rp_program_type, rp_content, rp_content_details, scenarios_count, skills, evaluation_grid.
- IA seule (ia) : deployment, deployment_details, licences, licence_months.
Un programme ia n'a ni coach, ni sessions par coaché, ni tripartite : ne remplis jamais ces champs pour lui.
Un debrief d'assessment, une certification ou un entraînement avec un avatar ou un personnage IA = module "Role-play" (ai_modules), avec rp_program_type assessment_debrief, certification ou upskilling. "AI coach" seul = conversations de coaching avec l'IA, sans scénario ni personnage.

PROGRAMMES DÉJÀ CONNUS
La liste des programmes déjà sur la fiche est donnée en fin de message avec leur id. Si un programme que tu détectes est le même (même nom, alias, édition ou même offre), renvoie son id ; sinon id=null. Ne renvoie jamais un programme dont le nom figure dans les noms refusés. Les programmes connus que tu ne renvoies pas sont conservés tels quels : ne renvoie que ceux sur lesquels le contexte dit quelque chose.

Règles des fields :
- Ne JAMAIS inventer. Sans signal, value=null et confidence=0.
- source : "hubspot:note:<id>" / "hubspot:email:<id>" / "hubspot:meeting:<id>" / "hubspot:call:<id>" / "hubspot:deal:<id>" / "claap:<recordingId>" / "inferred" (déduit de signaux indirects, confidence ≤ 0.5).
- confidence : 0.9..1.0 écrit tel quel dans une source citée ; 0.6..0.8 reformulé ou recoupé ; 0.3..0.5 inféré.
- evidence_date : date YYYY-MM-DD de la source la plus récente qui appuie la valeur, null si non datable.
- LANGUE DES VALEURS : celle du client. Si le contexte contient le moindre passage significatif en anglais, écris toutes les valeurs en anglais, sinon en français. Ne traduis jamais les noms de programmes.

Au plus ${MAX_PROGRAMS} programmes. Tu réponds UNIQUEMENT via l'outil client_programs.`;

const FIELD_SPECS: Record<ProgramFieldKey, Parameters<typeof field>[0]> = {
  // Socle
  status: { type: "enum", enum: PROGRAM_STATUSES, description: "not_started | set_up | poc | live | turned_off" },
  status_reason: { type: "string", description: "Une phrase de 30 mots au plus : pourquoi ce statut, avec la date de la source" },
  coaching_type: { type: "enum", enum: ["humain", "hybride", "ia"], description: "humain (coach humain seul), hybride (coach humain + IA), ia (IA seule : role-play et/ou AI coach)" },
  objective: { type: "string", description: "Ce que le client veut obtenir avec ce programme" },
  population: { type: "string", description: "Qui est accompagné : managers de proximité, top 50, commerciaux, hauts potentiels..." },
  nb_coachees: { type: "number", description: "Nombre de participants prévus pour l'édition en cours" },
  start_date: { type: "date", description: "Lancement auprès des participants de l'édition en cours, dit ou écrit (jamais déduit d'une année ou d'un contrat)" },
  end_date: { type: "date", description: "Fin prévue de l'édition en cours, dite ou écrite (jamais déduite)" },
  cohorts: { type: "string", description: "Cohortes ou vagues et leur rythme (ex : 3 vagues de 40, une par trimestre)" },
  languages: { type: "array_string", description: "Langues du programme (FR, EN, ES...)" },
  risk: { type: "enum", enum: ["on_track", "watch", "at_risk"] },
  risk_reason: { type: "string", description: "Une phrase datée de 30 mots au plus qui justifie le risque (le signal principal)" },
  add_ons: { type: "array_string", description: "Ateliers, webinars, contenus annexes rattachés à ce programme" },
  // Coaching humain (humain, hybride)
  catalog_program: {
    type: "enum",
    enum: [
      "first_time_manager", "womens_leadership_boost", "womens_leadership_lead", "professional_development",
      "executive_transition", "leadership_transition", "return_sick_leave", "parenthood", "flash", "extension", "custom",
    ],
    description:
      "Programme du catalogue humain Coachello : first_time_manager (prise de poste managériale, Primo Manager), womens_leadership_boost (Ariane Boost, potentiels), womens_leadership_lead (Ariane Lead, dirigeantes), professional_development, executive_transition, leadership_transition, return_sick_leave (retour après longue maladie), parenthood, flash (coaching flash, 3-4 sessions), extension (extension de coaching), custom (programme construit pour le client)",
  },
  sessions_per_coachee: { type: "number", description: "Nombre de sessions par coaché (7 en standard, 3-4 en Flash)" },
  journey_months: { type: "number", description: "Durée du parcours d'un coaché, en mois (6 en standard, 3 en Flash / Extension)" },
  three_way: {
    type: "enum",
    enum: ["none", "tripartite", "quadripartite"],
    description: "Session à plusieurs prévue ou pratiquée : tripartite (coaché + coach + N+1), quadripartite (+ RH), none (explicitement aucune). Seulement évoquée ou en discussion : value=null.",
  },
  three_way_details: { type: "string", description: "Obligatoire ou optionnelle, à quelles sessions" },
  coach_pool: { type: "enum", enum: ["standard", "executive"], description: "executive = pool de coachs executive (offre executive), sinon standard" },
  internal_coaches: { type: "bool_with_details", description: "Coachs internes du client utilisés dans le programme (details : qui, quelle part des sessions)" },
  assessments: { type: "array_string", description: `Assessments activés, valeurs parmi : ${ASSESSMENT_VALUES.join(", ")}` },
  credits: { type: "string", description: "Crédits ou licences du programme (ex : 140 licences de 7 sessions, 500 crédits)" },
  // IA (ia, hybride)
  ai_modules: { type: "array_string", description: `Modules IA déployés, valeurs parmi : ${AI_MODULE_VALUES.join(", ")}` },
  client_context: { type: "bool_with_details", description: "Contexte du client chargé dans l'IA : frameworks, valeurs, documents (details : lesquels)" },
  // Role-play
  rp_program_type: {
    type: "enum",
    enum: ["upskilling", "assessment_debrief", "certification"],
    description: "upskilling (s'entraîner pour monter en compétence), assessment_debrief (debrief d'un assessment par role-play), certification (évaluer ou certifier les participants sur un référentiel)",
  },
  rp_content: { type: "enum", enum: ["catalog", "custom", "mixed"], description: "catalog (programmes role-play Coachello), custom (construit pour le client), mixed" },
  rp_content_details: { type: "string", description: "Noms des programmes ou scénarios de role-play" },
  scenarios_count: { type: "number", description: "Nombre de scénarios de role-play" },
  skills: { type: "array_string", description: "Compétences travaillées (feedback, négociation, objections, conversations difficiles...)" },
  evaluation_grid: { type: "string", description: "Grille d'évaluation : Coachello par défaut, ou grille du client (DESC, SPIN, BOOST, référentiel maison...)" },
  // IA seule (ia)
  deployment: { type: "enum", enum: ["standalone", "embedded", "annual_licenses"], description: "standalone (programme porté par Coachello), embedded (intégré à une formation existante du client), annual_licenses (licences annuelles)" },
  deployment_details: { type: "string", description: "Si embedded : dans quelle formation" },
  licences: { type: "number", description: "Nombre de licences (utilisateurs)" },
  licence_months: { type: "number", description: "Durée des licences, en mois" },
};

const PROGRAM_KEYS = PROGRAM_FIELD_DEFINITIONS.map((d) => d.key);
// Seul le socle est exigé : les blocs d'un autre type sont omis (sortie plus courte).
const COMMON_KEYS = PROGRAM_FIELD_DEFINITIONS.filter((d) => !d.types && !d.rolePlay).map((d) => d.key);

export const CLIENT_PROGRAMS_TOOL: Anthropic.Tool = {
  name: "client_programs",
  description: "Liste les programmes de coaching du compte, chacun avec son statut et ses infos clés (value, confidence, source citée).",
  input_schema: {
    type: "object",
    properties: {
      programs: {
        type: "array",
        description: `Programmes détectés, au plus ${MAX_PROGRAMS}.`,
        items: {
          type: "object",
          properties: {
            id: { type: ["string", "null"], description: "id d'un programme déjà connu si c'est le même, sinon null" },
            name: { type: "string", description: "Nom du programme, tel que le client ou l'équipe le nomme" },
            aliases: {
              type: "array",
              items: { type: "string" },
              description:
                "Autres NOMS sous lesquels ce programme est désigné (nom d'une édition ou d'une année, nom du groupe sur la plateforme, ancien nom), 6 au plus, courts. Pas de numéros de cohorte, de dates de kickoff, de populations ni de descriptions.",
            },
            fields: {
              type: "object",
              properties: Object.fromEntries(PROGRAM_KEYS.map((k) => [k, field(FIELD_SPECS[k])])),
              required: COMMON_KEYS,
            },
          },
          required: ["id", "name", "aliases", "fields"],
        },
      },
    },
    required: ["programs"],
  },
};

// ── Noms ─────────────────────────────────────────────────────────────────

export function normalizeProgramName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function namesOf(p: { name: string; aliases?: string[] }): string[] {
  return [p.name, ...(p.aliases ?? [])].map(normalizeProgramName).filter(Boolean);
}

function uniqueAliases(name: string, aliases: string[]): string[] {
  const seen = new Set([normalizeProgramName(name)]);
  const out: string[] = [];
  for (const a of aliases) {
    const t = a.trim();
    const n = normalizeProgramName(t);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(t);
  }
  return out.slice(0, MAX_ALIASES);
}

// ── Prompt ───────────────────────────────────────────────────────────────

// Ancien bloc unique program_scope : ses champs, et leur traduction en
// attributs de programme (tripartite + quadripartite -> three_way,
// auto-assessment + flash feedback -> assessments).
const LEGACY_KEYS: Array<keyof ProgramScopeFields> = [
  "type_coaching", "population_accompagnee", "nb_coaches_estime", "cohortes_format",
  "tripartite", "quadripartite", "auto_assessment", "flash_feedback", "offres_associees",
];

const LEGACY_SAME: Array<[keyof ProgramScopeFields, ProgramFieldKey]> = [
  ["type_coaching", "coaching_type"],
  ["population_accompagnee", "population"],
  ["nb_coaches_estime", "nb_coachees"],
  ["cohortes_format", "cohorts"],
  ["offres_associees", "add_ons"],
];

type BoolDetails = { enabled?: boolean; details?: string } | null;
type BoolField = ClientFieldValue<BoolDetails> | undefined;

// Deux anciens Oui/Non (tripartite, quadripartite) -> "session à plusieurs".
function threeWayFrom(out: Partial<Record<ProgramFieldKey, ClientFieldValue>>, tri: BoolField, quad: BoolField) {
  const from = quad?.value?.enabled ? quad : tri?.value ? tri : null;
  if (!from) return;
  out.three_way = { ...from, value: quad?.value?.enabled ? "quadripartite" : tri?.value?.enabled ? "tripartite" : "none" };
  if (from.value?.details) out.three_way_details = { ...from, value: from.value.details };
}

// Anciens Oui/Non auto-assessment et flash feedback -> liste Assessments.
function assessmentsFrom(out: Partial<Record<ProgramFieldKey, ClientFieldValue>>, auto: BoolField, flash: BoolField) {
  const values = [...(auto?.value?.enabled ? ["Self-assessment"] : []), ...(flash?.value?.enabled ? ["Peer feedback (Flash 360)"] : [])];
  const from = auto?.value?.enabled ? auto : flash;
  if (values.length > 0 && from) out.assessments = { ...from, value: values };
}

function legacyProgramFields(legacy: Partial<ProgramScopeFields>): Partial<Record<ProgramFieldKey, ClientFieldValue>> {
  const out: Partial<Record<ProgramFieldKey, ClientFieldValue>> = {};
  for (const [from, to] of LEGACY_SAME) {
    const f = legacy[from] as ClientFieldValue | undefined;
    if (f && !isEmptyValue(f.value)) out[to] = f;
  }
  threeWayFrom(out, legacy.tripartite as BoolField, legacy.quadripartite as BoolField);
  assessmentsFrom(out, legacy.auto_assessment as BoolField, legacy.flash_feedback as BoolField);
  return out;
}

const PROGRAM_KEY_SET = new Set<string>(PROGRAM_FIELD_DEFINITIONS.map((d) => d.key));

// Programmes stockés avant les champs par type (premières détections du
// 2026-10-26) : tripartite / quadripartite, auto_assessment / flash_feedback
// et format passent sur les nouvelles clés (source, confiance et éditions
// manuelles gardées), les clés inconnues sont retirées. Appliqué à chaque
// fusion : la prochaine écriture enregistre le nouveau format.
export function upgradeProgramFields(raw: ClientProgram["fields"]): ClientProgram["fields"] {
  const old = raw as Record<string, ClientFieldValue | undefined>;
  const out: Partial<Record<ProgramFieldKey, ClientFieldValue>> = {};
  for (const [k, v] of Object.entries(old)) if (v && PROGRAM_KEY_SET.has(k)) out[k as ProgramFieldKey] = v;
  if (!out.three_way) threeWayFrom(out, old.tripartite as BoolField, old.quadripartite as BoolField);
  if (!out.assessments) assessmentsFrom(out, old.auto_assessment as BoolField, old.flash_feedback as BoolField);
  if (!out.cohorts && old.format && !isEmptyValue(old.format.value)) out.cohorts = old.format;
  return out;
}

// Même conversion à la lecture (fiche, route d'édition, outils CoachelloAI).
export function upgradePrograms<T extends ClientProgram[] | null | undefined>(programs: T): T {
  if (!Array.isArray(programs)) return programs;
  return programs.map((p) => ({ ...p, fields: upgradeProgramFields(p.fields) })) as T;
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "?";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") {
    const o = v as { enabled?: boolean; details?: string };
    if ("enabled" in o) return o.enabled ? `oui${o.details ? ` (${o.details})` : ""}` : "non";
    return JSON.stringify(v);
  }
  return String(v);
}

export type ProgramsPromptInput = {
  existing: ClientProgram[];
  declined: string[];
  deal: DealSnapshot | null;
  coachBrief: CoachBrief | null;
  // Ancien bloc unique fields_json.program_scope : indice tant qu'aucun
  // programme n'a été détecté.
  legacyScope: Partial<ProgramScopeFields> | null;
};

export function renderProgramsPromptAddendum(input: ProgramsPromptInput): string {
  const lines: string[] = ["---", "# Programmes"];

  lines.push("", "## Programmes déjà sur la fiche (renvoie leur id si c'est le même)");
  if (input.existing.length === 0) {
    lines.push("(aucun)");
  } else {
    for (const p of input.existing) {
      const status = programStatusOf(p);
      const manual = p.fields.status?.source?.kind === "manual" ? ", statut fixé à la main" : "";
      const aliases = p.aliases.length ? ` · alias : ${p.aliases.join(", ")}` : "";
      lines.push(`- id=${p.id} · ${p.name}${aliases} · statut : ${status ? PROGRAM_STATUS_LABELS[status] : "?"}${manual}`);
    }
  }

  if (input.declined.length > 0) {
    lines.push("", "## Noms refusés (pas des programmes de ce compte, ne jamais les renvoyer)");
    lines.push(input.declined.map((n) => `- ${n}`).join("\n"));
  }

  const deals = [
    ...(input.deal ? [`${input.deal.name || input.deal.id}${input.deal.pipeline_label ? ` (pipeline ${input.deal.pipeline_label})` : ""}${input.deal.close_date ? `, close ${input.deal.close_date.slice(0, 10)}` : ""}`] : []),
    ...(input.deal?.linked_deals ?? []).map((d) => `${d.name || d.id}${d.pipeline_label ? ` (pipeline ${d.pipeline_label})` : ""}`),
  ];
  if (deals.length > 0) {
    lines.push("", "## Deals HubSpot du compte (indice : souvent un deal par programme ou par édition)");
    lines.push(deals.map((d) => `- ${d}`).join("\n"));
  }

  const briefPrograms = input.coachBrief?.programs ?? [];
  if (briefPrograms.length > 0) {
    lines.push("", "## Programmes cités dans le brief coachs (indice, à vérifier dans le contexte)");
    for (const p of briefPrograms) {
      lines.push(`- ${p.name}${p.population ? ` · ${p.population}` : ""}${p.nb_sessions ? ` · ${p.nb_sessions} sessions` : ""}${p.description ? ` : ${p.description}` : ""}`);
    }
  }

  const legacy = input.legacyScope;
  if (legacy && input.existing.length === 0) {
    const parts = [
      legacy.nom_programme?.value ? `nom : ${fmtValue(legacy.nom_programme.value)}` : null,
      ...LEGACY_KEYS.map((k) => (legacy[k]?.value != null ? `${k} : ${fmtValue(legacy[k]?.value)}` : null)),
    ].filter((p): p is string => !!p);
    if (parts.length > 0) {
      lines.push("", "## Ancienne fiche (un seul programme, indice à vérifier)");
      lines.push(parts.map((p) => `- ${p}`).join("\n"));
    }
  }

  return lines.join("\n");
}

// ── Appel IA ─────────────────────────────────────────────────────────────

export type DetectedProgram = {
  id: string | null;
  name: string;
  aliases: string[];
  fields: Partial<Record<ProgramFieldKey, ClientFieldValue>>;
};

// Listes à choix : on ramène les libellés de l'IA aux valeurs connues.
const AI_MODULE_RULES: Array<[RegExp, string]> = [
  [/role/i, "Role-play"],
  [/coach/i, "AI coach"],
];
const ASSESSMENT_RULES: Array<[RegExp, string]> = [
  [/self|auto/i, "Self-assessment"],
  [/impact/i, "Impact assessment"],
  [/flash|360|peer|pair/i, "Peer feedback (Flash 360)"],
];

function pickChoices(value: unknown, rules: Array<[RegExp, string]>): string[] | null {
  if (!Array.isArray(value)) return null;
  const picked = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string") continue;
    const hit = rules.find(([re]) => re.test(v));
    if (hit) picked.add(hit[1]);
  }
  return picked.size > 0 ? rules.map(([, label]) => label).filter((l) => picked.has(l)) : null;
}

export function parseProgramsFromClaude(raw: unknown): DetectedProgram[] {
  const list = (raw && typeof raw === "object" ? (raw as { programs?: unknown }).programs : null) ?? [];
  if (!Array.isArray(list)) return [];
  const out: DetectedProgram[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as { id?: unknown; name?: unknown; aliases?: unknown; fields?: unknown };
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name) continue;
    const rawFields = (r.fields && typeof r.fields === "object" ? r.fields : {}) as Record<string, unknown>;
    const fields: Partial<Record<ProgramFieldKey, ClientFieldValue>> = {};
    for (const def of PROGRAM_FIELD_DEFINITIONS) {
      const value = toFieldValue(rawFields[def.key]);
      // Enum hors liste : on ne garde pas une valeur que l'UI ne sait pas afficher.
      if (def.kind === "enum" && value.value != null && !(def.options ?? []).includes(String(value.value))) {
        fields[def.key] = { ...value, value: null, confidence: 0, source: null, evidence_at: null };
      } else {
        fields[def.key] = value;
      }
    }
    for (const [key, rules] of [["ai_modules", AI_MODULE_RULES], ["assessments", ASSESSMENT_RULES]] as const) {
      const f = fields[key];
      if (f && f.value != null) fields[key] = { ...f, value: pickChoices(f.value, rules) };
    }
    // Champ d'un autre type (tripartite sur un programme AI...) : écarté. Une
    // valeur déjà sur la fiche n'est pas touchée (l'IA ne vide jamais un champ).
    for (const def of PROGRAM_FIELD_DEFINITIONS) {
      const f = fields[def.key];
      if (f && f.value != null && !programFieldApplies(def, fields)) {
        fields[def.key] = { ...f, value: null, confidence: 0, source: null, evidence_at: null };
      }
    }
    out.push({
      id: typeof r.id === "string" && r.id.trim() ? r.id.trim() : null,
      name,
      aliases: Array.isArray(r.aliases) ? r.aliases.filter((a): a is string => typeof a === "string" && !!a.trim()) : [],
      fields,
    });
  }
  return out.slice(0, MAX_PROGRAMS);
}

export async function detectClientPrograms(opts: {
  contextPrompt: string;
  prompt: ProgramsPromptInput;
  model: string;
  userId: string | null;
  label: string;
  refresh?: boolean;
}): Promise<DetectedProgram[]> {
  const client = anthropicClient({ timeout: 600_000 });
  const refreshNote = opts.refresh
    ? "\n\nCONTEXTE REFRESH : le compte est client depuis un moment, le contexte contient aussi les échanges post-signature. Quand deux sources se contredisent, la plus RÉCENTE prime."
    : "";
  const msg = await withAnthropicRetry(
    () =>
      client.messages.create(withForcedTool({
        model: opts.model,
        max_tokens: 12000,
        system: `${PROGRAMS_SYSTEM_PROMPT}${refreshNote}\n\n${NO_EM_DASH_RULE}`,
        messages: [{ role: "user", content: `${opts.contextPrompt}\n\n${renderProgramsPromptAddendum(opts.prompt)}` }],
        tools: [CLIENT_PROGRAMS_TOOL],
      }, "client_programs")),
    { label: opts.label },
  );
  logUsage(opts.userId, opts.model, msg.usage.input_tokens, msg.usage.output_tokens, "clients_programs");
  const toolBlock = msg.content.find((b) => b.type === "tool_use");
  if (!toolBlock || !("input" in toolBlock)) throw new Error("No tool_use block in the programs response");
  return parseProgramsFromClaude(toolBlock.input);
}

// ── Fusion ───────────────────────────────────────────────────────────────

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "string") return !v.trim();
  return false;
}

function changeOf(program: ClientProgram, key: ProgramFieldKey, before: unknown, after: unknown, overrode?: boolean): ProgramChange | null {
  if (UNREPORTED_KEYS.has(key)) return null;
  const def = PROGRAM_FIELD_DEFINITIONS.find((d) => d.key === key);
  return {
    program_id: program.id,
    program_name: program.name,
    key,
    label: def?.label ?? key,
    before: before ?? null,
    after: after ?? null,
    ...(overrode ? { overrode_manual: true } : {}),
  };
}

// Première détection : les éditions manuelles de l'ancien bloc program_scope
// passent sur le programme correspondant (même règle : une source plus récente
// que l'édition l'emporte). Sans programme détecté, l'ancien bloc devient le
// premier programme : un compte signé en a au moins un.
function seedFromLegacy(programs: ClientProgram[], legacy: Partial<ProgramScopeFields> | null, seedId?: string): ClientProgram[] {
  if (!legacy) return programs;
  const legacyName = typeof legacy.nom_programme?.value === "string" ? legacy.nom_programme.value.trim() : "";

  const converted = legacyProgramFields(legacy);

  if (programs.length === 0) {
    const fields = converted;
    if (!legacyName && Object.keys(fields).length === 0) return programs;
    const manualName = legacy.nom_programme?.source?.kind === "manual";
    return [{
      id: seedId ?? randomUUID(),
      name: legacyName || "Program",
      aliases: [],
      created_by: manualName ? "manual" : "ai",
      created_at: new Date().toISOString(),
      fields,
    }];
  }

  const target =
    (legacyName && programs.find((p) => namesOf(p).includes(normalizeProgramName(legacyName)))) ||
    (programs.length === 1 ? programs[0] : null);
  if (!target) return programs;
  const fields = { ...target.fields };
  for (const [key, f] of Object.entries(converted) as Array<[ProgramFieldKey, ClientFieldValue]>) {
    if (f.source?.kind !== "manual" || isEmptyValue(f.value)) continue;
    const decision = mergeFieldValue(f, fields[key], new Set());
    fields[key] = decision ? decision.field : f;
  }
  return programs.map((p) => (p.id === target.id ? { ...p, fields } : p));
}

export function mergePrograms(
  prev: ClientProgram[] | null,
  detected: DetectedProgram[],
  opts: {
    declined: string[];
    legacyScope?: Partial<ProgramScopeFields> | null;
    // id du programme créé depuis l'ancien bloc (première détection sans résultat).
    seedId?: string;
    purgeRecordingIds?: ReadonlySet<string>;
  },
): { programs: ClientProgram[]; changes: ProgramChange[] } {
  const purgeIds = opts.purgeRecordingIds ?? new Set<string>();
  const declined = new Set(opts.declined.map(normalizeProgramName));
  const previous = upgradePrograms(prev ?? []);
  const byId = new Map(previous.map((p) => [p.id, p]));
  const matched = new Map<string, DetectedProgram>();
  const added: ClientProgram[] = [];
  const changes: ProgramChange[] = [];
  const now = new Date().toISOString();

  for (const d of detected) {
    let target = d.id ? byId.get(d.id) : undefined;
    if (target && matched.has(target.id)) target = undefined;
    if (!target) {
      const names = new Set(namesOf(d));
      target = previous.find((p) => !matched.has(p.id) && namesOf(p).some((n) => names.has(n)));
    }
    if (target) {
      matched.set(target.id, d);
      continue;
    }
    if (namesOf(d).some((n) => declined.has(n))) continue;
    // Doublon dans la même réponse : on garde le premier.
    const names = new Set(namesOf(d));
    if (added.some((a) => namesOf(a).some((n) => names.has(n)))) continue;
    // id pré-attribué (assignProgramIds) : deux fusions de la même détection
    // donnent les mêmes ids (le refresh refusionne sur la version fraîche).
    const id = d.id && !byId.has(d.id) && !added.some((a) => a.id === d.id) ? d.id : randomUUID();
    const program: ClientProgram = {
      id,
      name: d.name,
      aliases: uniqueAliases(d.name, d.aliases),
      created_by: "ai",
      created_at: now,
      fields: d.fields,
    };
    added.push(program);
    if (prev) changes.push({ program_id: program.id, program_name: program.name, added: true });
  }

  const kept: ClientProgram[] = [];
  for (const p of previous) {
    const d = matched.get(p.id);
    const fields = { ...p.fields };
    const purged = Object.values(p.fields).some(
      (f) => f?.source?.kind === "claap" && !!f.source.recordingId && purgeIds.has(f.source.recordingId),
    );
    for (const def of PROGRAM_FIELD_DEFINITIONS) {
      const before = p.fields[def.key];
      // Programme non renvoyé : seuls ses attributs appuyés par un meeting
      // retiré à la main sont revus (vidés).
      const decision = mergeFieldValue(before, d ? d.fields[def.key] : undefined, purgeIds);
      if (!decision) continue;
      fields[def.key] = decision.field;
      if (decision.changed) {
        const c = changeOf(p, def.key, before?.value, decision.field.value, decision.overrode_manual);
        if (c) changes.push(c);
      }
    }
    // Programme créé par l'IA dont plus rien ne tient (tout venait d'un meeting
    // retiré) : il disparaît.
    if (!d && purged && p.created_by === "ai" && Object.values(fields).every((f) => isEmptyValue(f?.value))) continue;
    kept.push({ ...p, aliases: d ? uniqueAliases(p.name, [...p.aliases, d.name, ...d.aliases]) : p.aliases, fields });
  }

  const programs = [...kept, ...added];
  return { programs: prev ? programs : seedFromLegacy(programs, opts.legacyScope ?? null, opts.seedId), changes };
}

// ids de la réponse IA : celui d'un programme connu est gardé, tout autre
// (null ou inventé) est remplacé par un uuid neuf, fixé une fois pour toutes.
export function assignProgramIds(detected: DetectedProgram[], knownIds: ReadonlySet<string>): DetectedProgram[] {
  return detected.map((d) => ({ ...d, id: d.id && knownIds.has(d.id) ? d.id : randomUUID() }));
}

// Le coach brief décrit les programmes : il est obsolète si l'un d'eux arrive
// ou change de type, de population, de sessions, de tripartite ou de dates.
export function programChangesTouchBrief(changes: ProgramChange[]): boolean {
  return changes.some((c) => c.added || (c.key && BRIEF_KEYS.has(c.key)));
}

// Relu juste avant l'écriture : un statut déplacé ou un programme supprimé
// pendant le refresh (1 à 2 min d'IA) ne doit pas être écrasé par la version
// lue au départ. null si la lecture échoue (on garde alors la version de départ).
export async function loadLatestPrograms(clientId: string): Promise<{ programs: ClientProgram[] | null; declined: string[] } | null> {
  const { data, error } = await db.from("clients").select("programs, declined_program_names").eq("id", clientId).single();
  if (error || !data) return null;
  return {
    programs: (data.programs as ClientProgram[] | null) ?? null,
    declined: (data.declined_program_names as string[] | null) ?? [],
  };
}

// Fusion de deux fiches (merge.ts) : les programmes des deux, dédoublonnés par
// nom ou alias, ceux de la fiche gardée d'abord (ils font foi). Le refresh qui
// suit la fusion redétecte sur le compte complet.
export function concatPrograms(kept: ClientProgram[] | null, other: ClientProgram[] | null): ClientProgram[] | null {
  if (!kept && !other) return null;
  const out = (kept ?? []).map((p) => ({ ...p }));
  for (const p of other ?? []) {
    const names = new Set(namesOf(p));
    const dup = out.find((k) => namesOf(k).some((n) => names.has(n)));
    if (dup) dup.aliases = uniqueAliases(dup.name, [...dup.aliases, p.name, ...p.aliases]);
    else out.push(p);
  }
  return out;
}
