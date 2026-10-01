import type { ClientEnrichmentContext } from "./context";
import type { Health, HealthLabel, Insights } from "./types";

// Calcul du health score d'un client. Version v1 sans IA — signaux simples
// extraits du contexte HubSpot + Claap déjà chargé pour l'enrichissement.
// L'objectif est d'avoir un score utile dès maintenant, on raffinera (IA,
// cron mensuel, alertes Slack) dans les itérations suivantes.
//
// Score 0..100 :
//   - 100 = full healthy (engagement régulier, sources fraîches, gros volume)
//   - 60..75 = à surveiller (signal d'engagement décroît)
//   - <50 = risque (silence ou signaux négatifs)
//
// Label dérivé du score :
//   - green ≥ 70
//   - yellow 40..70
//   - red < 40

type SignalContext = ReturnType<typeof extractSignals>;

function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

function extractSignals(ctx: ClientEnrichmentContext) {
  const engagements = ctx.deal?.engagements ?? [];
  const meetings = ctx.meetings ?? [];

  const lastEngagementDate = engagements
    .map((e) => (e.date ? new Date(e.date).getTime() : null))
    .filter((t): t is number => t !== null && Number.isFinite(t))
    .sort((a, b) => b - a)[0] ?? null;

  const lastMeetingDate = meetings
    .map((m) => (m.meeting_started_at ? new Date(m.meeting_started_at).getTime() : null))
    .filter((t): t is number => t !== null && Number.isFinite(t))
    .sort((a, b) => b - a)[0] ?? null;

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const meetingsLast90 = meetings.filter((m) => {
    if (!m.meeting_started_at) return false;
    const t = new Date(m.meeting_started_at).getTime();
    return Number.isFinite(t) && now - t <= 90 * day;
  }).length;

  const engagementsLast30 = engagements.filter((e) => {
    if (!e.date) return false;
    const t = new Date(e.date).getTime();
    return Number.isFinite(t) && now - t <= 30 * day;
  }).length;

  return {
    daysSinceLastEngagement: lastEngagementDate ? Math.floor((now - lastEngagementDate) / day) : null,
    daysSinceLastMeeting: lastMeetingDate ? Math.floor((now - lastMeetingDate) / day) : null,
    meetingsLast90,
    engagementsLast30,
    totalMeetings: meetings.length,
    totalEngagements: engagements.length,
    contactsCount: ctx.deal?.contacts?.length ?? 0,
  };
}

function scoreFromSignals(s: SignalContext): { score: number; drivers: string[] } {
  let score = 50; // baseline neutre
  const drivers: string[] = [];

  // ── Dernier contact = min(engagement HubSpot, meeting Claap)
  // Sans ça on rate les meetings post-signature (kickoff, QBR, follow-up CS)
  // qui sont des Claap mais pas forcément des engagements HubSpot sur le deal.
  const candidates = [s.daysSinceLastEngagement, s.daysSinceLastMeeting]
    .filter((d): d is number => d !== null);
  const daysSinceLastContact = candidates.length > 0 ? Math.min(...candidates) : null;

  if (daysSinceLastContact !== null) {
    if (daysSinceLastContact <= 14) {
      score += 20;
      drivers.push(`Recent contact (${daysSinceLastContact}d)`);
    } else if (daysSinceLastContact <= 45) {
      score += 5;
      drivers.push(`Last contact ${daysSinceLastContact}d ago`);
    } else if (daysSinceLastContact <= 90) {
      score -= 10;
      drivers.push(`${daysSinceLastContact}d of silence on the account`);
    } else {
      score -= 25;
      drivers.push(`Prolonged silence (${daysSinceLastContact}d), high risk`);
    }
  } else {
    score -= 15;
    drivers.push("No known engagement or meeting");
  }

  // ── Meetings dans les 90 derniers jours
  if (s.meetingsLast90 >= 3) {
    score += 15;
    drivers.push(`${s.meetingsLast90} meetings in 90d, sustained engagement`);
  } else if (s.meetingsLast90 === 2) {
    score += 5;
  } else if (s.meetingsLast90 === 1) {
    score -= 5;
    drivers.push("Only one meeting analyzed in 90d");
  } else {
    score -= 15;
    drivers.push("No Claap meeting in the last 90 days");
  }

  // ── Volume d'engagements (proxy d'activité)
  if (s.engagementsLast30 >= 5) {
    score += 10;
    drivers.push(`${s.engagementsLast30} interactions (emails/calls/notes) in 30d`);
  } else if (s.engagementsLast30 === 0) {
    score -= 5;
  }

  // ── Couverture contacts (champion fragile = peu de contacts mappés)
  if (s.contactsCount === 0) {
    score -= 5;
    drivers.push("No associated HubSpot contact, limited visibility");
  } else if (s.contactsCount >= 3) {
    score += 5;
  }

  // Clamp 0..100
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Top 5 drivers max, on les a déjà ajoutés du plus impactant au moins
  // impactant en parcourant le score ci-dessus, donc slice est OK.
  return { score, drivers: drivers.slice(0, 5) };
}

function labelFromScore(score: number): HealthLabel {
  if (score >= 70) return "green";
  if (score >= 40) return "yellow";
  return "red";
}

export function computeHealth(ctx: ClientEnrichmentContext, previousScore: number | null): Health {
  const signals = extractSignals(ctx);
  const { score, drivers } = scoreFromSignals(signals);
  const label = labelFromScore(score);

  let trend: "up" | "down" | "stable" | undefined;
  if (previousScore !== null) {
    if (score > previousScore + 5) trend = "up";
    else if (score < previousScore - 5) trend = "down";
    else trend = "stable";
  }

  return {
    score,
    label,
    drivers,
    computed_at: new Date().toISOString(),
    trend,
  };
}

// Insights = 3-5 actions concrètes que le CS devrait faire ce mois-ci. v1 :
// règles dérivées des signaux (pas d'IA). On peut passer Sonnet plus tard
// pour des recommandations plus contextuelles.
export function computeInsights(ctx: ClientEnrichmentContext, health: Health): Insights {
  const s = extractSignals(ctx);
  const actions: Array<{ title: string; rationale?: string; priority?: "high" | "medium" | "low" }> = [];
  const observations: string[] = [];

  // Idem que dans scoreFromSignals : "dernier contact" = min(engagement, meeting)
  const lastContactCandidates = [s.daysSinceLastEngagement, s.daysSinceLastMeeting]
    .filter((d): d is number => d !== null);
  const daysSinceLastContact = lastContactCandidates.length > 0 ? Math.min(...lastContactCandidates) : null;

  if (health.label === "red") {
    if (daysSinceLastContact !== null && daysSinceLastContact > 60) {
      actions.push({
        title: "Re-engage immediately",
        rationale: `${daysSinceLastContact}d of silence, high churn risk.`,
        priority: "high",
      });
    }
    if (s.meetingsLast90 === 0) {
      actions.push({
        title: "Schedule a QBR / adoption review",
        rationale: "No CS meeting analyzed in the last 90 days.",
        priority: "high",
      });
    }
  }

  if (health.label === "yellow") {
    if (daysSinceLastContact !== null && daysSinceLastContact > 30) {
      actions.push({
        title: "Send a check-in",
        rationale: `Last exchange ${daysSinceLastContact}d ago.`,
        priority: "medium",
      });
    }
    if (s.meetingsLast90 < 2) {
      actions.push({
        title: "Schedule a feedback session",
        rationale: "Exchange cadence is dropping, capture how they feel.",
        priority: "medium",
      });
    }
  }

  if (s.contactsCount <= 1) {
    actions.push({
      title: "Identify a backup sponsor",
      rationale: "Only one contact mapped in HubSpot, fragile champion.",
      priority: "medium",
    });
  }

  if (s.meetingsLast90 >= 3 && health.label === "green") {
    actions.push({
      title: "Document the winning pattern",
      rationale: `${s.meetingsLast90} meetings in 90d on a healthy account, best practice worth formalizing.`,
      priority: "low",
    });
  }

  // Observations
  if (s.totalEngagements > 30) observations.push(`Mature account: ${s.totalEngagements} HubSpot engagements.`);
  if (s.totalMeetings > 5) observations.push(`${s.totalMeetings} meetings analyzed across the deal history.`);
  if (s.daysSinceLastMeeting !== null && s.daysSinceLastMeeting < 7) {
    observations.push(`Recent meeting (${s.daysSinceLastMeeting}d ago) — good moment to iterate.`);
  }

  return {
    generated_at: new Date().toISOString(),
    actions: actions.slice(0, 5),
    observations: observations.slice(0, 3),
  };
}
