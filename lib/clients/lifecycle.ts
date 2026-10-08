// Phase de vie d'un compte client, pour cadrer les Next actions (et ne plus
// traiter un compte signé il y a 8 mois comme un closed-won tout frais).
//  - onboarding : kickoff à venir (ou inconnu) et signature il y a moins de
//    120 jours, ou signature il y a moins de 60 jours ;
//  - renewal : fin de contrat dans moins de 120 jours (prime sur le reste),
//    date HubSpot ou trouvée dans les échanges (cf. resolveContractEnd) ;
//  - running : le reste.

import type { ClientFieldValue } from "./types";

export type AccountPhase = "onboarding" | "running" | "renewal";

const DAY = 24 * 60 * 60 * 1000;

// Dates HubSpot : ISO ("2026-11-01") ou timestamp ms en chaîne selon la propriété
// (l'API v3 renvoie closedate en ISO, jamais en ms : ne pas faire Number()).
export function parseHubspotDate(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = (/^\d+$/.test(v) ? new Date(Number(v)) : new Date(v)).getTime();
  return Number.isFinite(t) ? t : null;
}

// Fin de contrat retenue partout (phase, santé, Key dates, Billing, vue
// portefeuille, CoachelloAI). Deux sources seulement, jamais une règle de durée :
//  1. contract_end_date du deal HubSpot, la source de vérité ;
//  2. sinon une date trouvée dans les échanges (field planning.fin_contrat_le,
//     extrait avec sa source, cf. prompt.ts), retenue à partir d'une confiance
//     de 0.7 (info écrite ou dite clairement, pas une déduction).
// Une date antérieure à la signature est écartée (saisie fausse, souvent
// l'année) : la valeur HubSpot rejetée est gardée pour l'afficher comme à corriger.
const CONVERSATION_MIN_CONFIDENCE = 0.7;

export type ContractEnd = {
  // ISO. null = aucune date valable.
  date: string | null;
  from: "hubspot" | "conversations" | null;
  // Field de la fiche quand la date vient des échanges (source, preuve datée).
  field: ClientFieldValue | null;
  // Valeur HubSpot écartée car antérieure à la signature.
  rejected: string | null;
};

export function resolveContractEnd(input: {
  contractEndDate: string | null | undefined;
  closedwonAt: string | null | undefined;
  conversationsField?: ClientFieldValue | null;
}): ContractEnd {
  const signed = parseHubspotDate(input.closedwonAt);
  // Comparaison au jour : contract_end_date est une date sans heure (minuit UTC).
  const signedDay = signed === null ? null : signed - (signed % DAY);
  const valid = (t: number | null): t is number => t !== null && (signedDay === null || t >= signedDay);

  const hubspot = parseHubspotDate(input.contractEndDate);
  if (valid(hubspot)) return { date: new Date(hubspot).toISOString(), from: "hubspot", field: null, rejected: null };
  const rejected = hubspot !== null ? new Date(hubspot).toISOString() : null;

  const f = input.conversationsField;
  const fromConversations =
    f && typeof f.value === "string" && f.confidence >= CONVERSATION_MIN_CONFIDENCE ? parseHubspotDate(f.value) : null;
  if (valid(fromConversations)) {
    return { date: new Date(fromConversations).toISOString(), from: "conversations", field: f ?? null, rejected };
  }
  return { date: null, from: null, field: null, rejected };
}

export function computeAccountPhase(input: {
  closedwonAt: string | null;
  kickoffDate: string | null;
  contractEndDate: string | null;
  contractEndField?: ClientFieldValue | null;
  now?: number;
}): {
  phase: AccountPhase;
  daysSinceSignature: number | null;
  daysToContractEnd: number | null;
  contractEnd: ContractEnd;
} {
  const now = input.now ?? Date.now();
  const signed = parseHubspotDate(input.closedwonAt);
  const kickoff = parseHubspotDate(input.kickoffDate);
  const contractEnd = resolveContractEnd({
    contractEndDate: input.contractEndDate,
    closedwonAt: input.closedwonAt,
    conversationsField: input.contractEndField,
  });
  const end = parseHubspotDate(contractEnd.date);
  const daysSinceSignature = signed !== null ? Math.floor((now - signed) / DAY) : null;
  const daysToContractEnd = end !== null ? Math.ceil((end - now) / DAY) : null;
  const base = { daysSinceSignature, daysToContractEnd, contractEnd };

  if (daysToContractEnd !== null && daysToContractEnd >= 0 && daysToContractEnd <= 120) {
    return { phase: "renewal", ...base };
  }
  const kickoffAhead = kickoff === null || kickoff > now;
  if (
    (daysSinceSignature !== null && daysSinceSignature < 60) ||
    (kickoffAhead && (daysSinceSignature === null || daysSinceSignature < 120))
  ) {
    return { phase: "onboarding", ...base };
  }
  return { phase: "running", ...base };
}

export const PHASE_GUIDANCE: Record<AccountPhase, string> = {
  onboarding:
    "ONBOARDING: the program is being set up. Focus on what blocks the launch (IT access, app install, provisioning, kickoff date, key contacts, communication to coachees).",
  running:
    "RUNNING: the program is live. Focus on adoption, satisfaction of the HR sponsor, risks raised in recent exchanges, and expansion opportunities (new populations, new cohorts).",
  renewal:
    "RENEWAL: the contract ends soon. Focus on securing the renewal: impact results to share, decision makers to meet, budget timing, and risks to the renewal.",
};
