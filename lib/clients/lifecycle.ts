// Phase de vie d'un compte client, pour cadrer les Next actions (et ne plus
// traiter un compte signé il y a 8 mois comme un closed-won tout frais).
//  - onboarding : kickoff à venir (ou inconnu) et signature il y a moins de
//    120 jours, ou signature il y a moins de 60 jours ;
//  - renewal : fin de contrat dans moins de 120 jours (prime sur le reste) ;
//  - running : le reste.

export type AccountPhase = "onboarding" | "running" | "renewal";

const DAY = 24 * 60 * 60 * 1000;

// Dates HubSpot : ISO ("2026-11-01") ou timestamp ms en chaîne selon la propriété.
function parseDate(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = (/^\d+$/.test(v) ? new Date(Number(v)) : new Date(v)).getTime();
  return Number.isFinite(t) ? t : null;
}

export function computeAccountPhase(input: {
  closedwonAt: string | null;
  kickoffDate: string | null;
  contractEndDate: string | null;
  now?: number;
}): { phase: AccountPhase; daysSinceSignature: number | null; daysToContractEnd: number | null } {
  const now = input.now ?? Date.now();
  const signed = parseDate(input.closedwonAt);
  const kickoff = parseDate(input.kickoffDate);
  const end = parseDate(input.contractEndDate);
  const daysSinceSignature = signed !== null ? Math.floor((now - signed) / DAY) : null;
  const daysToContractEnd = end !== null ? Math.ceil((end - now) / DAY) : null;

  if (daysToContractEnd !== null && daysToContractEnd >= 0 && daysToContractEnd <= 120) {
    return { phase: "renewal", daysSinceSignature, daysToContractEnd };
  }
  const kickoffAhead = kickoff === null || kickoff > now;
  if (
    (daysSinceSignature !== null && daysSinceSignature < 60) ||
    (kickoffAhead && (daysSinceSignature === null || daysSinceSignature < 120))
  ) {
    return { phase: "onboarding", daysSinceSignature, daysToContractEnd };
  }
  return { phase: "running", daysSinceSignature, daysToContractEnd };
}

export const PHASE_GUIDANCE: Record<AccountPhase, string> = {
  onboarding:
    "ONBOARDING: the program is being set up. Focus on what blocks the launch (IT access, app install, provisioning, kickoff date, key contacts, communication to coachees).",
  running:
    "RUNNING: the program is live. Focus on adoption, satisfaction of the HR sponsor, risks raised in recent exchanges, and expansion opportunities (new populations, new cohorts).",
  renewal:
    "RENEWAL: the contract ends soon. Focus on securing the renewal: impact results to share, decision makers to meet, budget timing, and risks to the renewal.",
};
