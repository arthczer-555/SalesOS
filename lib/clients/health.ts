import type { ClientEnrichmentContext, ClaapMeetingForClient } from "./context";
import type { DealEngagementSnapshot } from "../hubspot";
import { computeAccountPhase, type AccountPhase } from "./lifecycle";
import type {
  Health,
  HealthDriver,
  HealthDriverSource,
  HealthLabel,
  HealthRuleTier,
  HealthSignal,
  HealthTone,
  ClientFieldValue,
  InsightAction,
  Insights,
  News,
  NewsCategory,
  NewsItem,
} from "./types";

// Calcul du health score d'un client (v2). Règles simples sur le contexte
// HubSpot + Claap déjà chargé, plus le ton des derniers meetings jugé par IA
// (health-summary.ts, passé en entrée).
//
//   score = clamp(50 + somme des points des 6 signaux, 0, 100)
//     1. Dernier contact (email / call / meeting HubSpot ou meeting Claap),
//        seuils selon la phase du compte (lifecycle.ts) ;
//     2. Meetings Claap sur 90 j ;
//     3. Activité HubSpot (emails, calls, notes, meetings) sur 30 j ;
//     4. Interlocuteurs client actifs sur 90 j (participants Claap présents +
//        expéditeurs d'emails entrants) ;
//     5. Ton des derniers meetings ;
//     6. News à risque (leadership, restructuration, M&A d'importance haute, 90 j).
//   Label : green >= 70, yellow 40..69, red < 40.
//
// Règle de fiabilité : une source illisible ne coûte jamais de points. Les
// signaux qui en dépendent gardent leurs points positifs (ce qu'on a vu est
// vrai), leurs pénalités sont neutralisées et marquées `skipped`, et la source
// part dans `data_gaps` (bandeau sur la carte).
//
// Chaque signal produit un driver, même à 0 point : c'est la décomposition
// affichée dans le popup "How is this computed?". Les libellés sont en anglais
// (affichés tels quels dans le produit).

const DAY = 24 * 60 * 60 * 1000;
const BASELINE = 50;
const OWN_DOMAINS = new Set(["coachello.io"]);
const NOREPLY = /no-?reply|notifications?@|mailer-daemon|postmaster/i;

// Silence toléré selon la phase : un compte en onboarding ou en renouvellement
// doit être suivi de près, un programme en régime de croisière beaucoup moins.
const PHASE_RULES: Record<AccountPhase, { fresh: number; ok: number; quiet: number; oneMeetingIsNormal: boolean }> = {
  onboarding: { fresh: 14, ok: 30, quiet: 60, oneMeetingIsNormal: false },
  running: { fresh: 21, ok: 45, quiet: 90, oneMeetingIsNormal: true },
  renewal: { fresh: 14, ok: 30, quiet: 60, oneMeetingIsNormal: false },
};

const PHASE_NAME: Record<AccountPhase, string> = {
  onboarding: "Onboarding",
  running: "Running",
  renewal: "Renewal",
};

const RISK_NEWS: Partial<Record<NewsCategory, string>> = {
  leadership: "Leadership change in the news",
  restructuring: "Restructuring in the news",
  acquisition: "M&A in the news",
};

export type HealthInputs = {
  closedwonAt: string | null;
  kickoffDate: string | null;
  contractEndDate: string | null;
  // Fin de contrat trouvée dans les échanges (field planning.fin_contrat_le),
  // utilisée seulement sans date HubSpot valable.
  contractEndField?: ClientFieldValue | null;
  news: News | null;
  // null = rien à juger (aucun meeting récent) ou jugement en échec (toneError).
  tone: HealthTone | null;
  toneError?: string | null;
};

function ts(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function short(text: string | null | undefined, max = 60): string | null {
  const t = text?.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0";
}

export function meetingLink(m: ClaapMeetingForClient): string | null {
  if (m.analysis_id) return `/sales-coach?id=${m.analysis_id}`;
  return m.claap_url ?? null;
}

function meetingSource(m: ClaapMeetingForClient): HealthDriverSource {
  return {
    kind: "claap",
    date: m.meeting_started_at,
    label: short(m.meeting_title) ?? "Claap meeting",
    url: meetingLink(m),
  };
}

const ENGAGEMENT_NAME: Record<DealEngagementSnapshot["type"], string> = {
  email: "Email",
  call: "Call",
  meeting: "HubSpot meeting",
  note: "Note",
  engagement: "Activity",
};

function engagementSource(e: DealEngagementSnapshot): HealthDriverSource {
  const title = short(e.title, 50);
  return { kind: "hubspot", date: e.date, label: title ? `${ENGAGEMENT_NAME[e.type]}: ${title}` : ENGAGEMENT_NAME[e.type] };
}

// Signaux bruts, dans le passé uniquement (un meeting HubSpot planifié la
// semaine prochaine n'est pas un contact).
function extractSignals(ctx: ClientEnrichmentContext, now: number) {
  const past = <T>(items: T[], date: (x: T) => string | null | undefined) =>
    items
      .map((x) => ({ x, t: ts(date(x)) }))
      .filter((r): r is { x: T; t: number } => r.t !== null && r.t <= now)
      .sort((a, b) => b.t - a.t);

  const engagements = past(ctx.deal?.engagements ?? [], (e) => e.date);
  const meetings = past(ctx.meetings ?? [], (m) => m.meeting_started_at);

  // Contact = échange avec le client. Une note HubSpot est interne : elle
  // compte dans l'activité, pas comme contact.
  const lastEngagement = engagements.find((r) => r.x.type !== "note") ?? null;
  const lastMeeting = meetings[0] ?? null;
  const lastContact =
    lastMeeting && (!lastEngagement || lastMeeting.t >= lastEngagement.t)
      ? { t: lastMeeting.t, kind: "claap" as const, source: meetingSource(lastMeeting.x) }
      : lastEngagement
        ? { t: lastEngagement.t, kind: "hubspot" as const, source: engagementSource(lastEngagement.x) }
        : null;

  const meetings90 = meetings.filter((r) => now - r.t <= 90 * DAY).map((r) => r.x);
  const engagements30 = engagements.filter((r) => now - r.t <= 30 * DAY).map((r) => r.x);

  // Interlocuteurs client actifs : présents à un meeting Claap ou auteurs d'un
  // email entrant, sur 90 j. Clé = email, valeur = nom affichable.
  const people = new Map<string, string>();
  const addPerson = (email: string | null | undefined, name: string | null | undefined) => {
    const e = email?.trim().toLowerCase();
    const domain = e?.split("@")[1];
    if (!e || !domain || OWN_DOMAINS.has(domain) || NOREPLY.test(e)) return;
    if (!people.has(e) || (name && people.get(e) === e)) people.set(e, name?.trim() || e);
  };
  for (const m of meetings90) {
    for (const p of m.participants ?? []) if (p.attended !== false) addPerson(p.email, p.name);
  }
  for (const r of engagements) {
    if (now - r.t > 90 * DAY) break;
    if (r.x.type === "email" && r.x.direction === "in") addPerson(r.x.from_email, null);
  }

  return {
    lastContact,
    meetings90,
    engagements30,
    people: [...people.values()],
    contactsCount: ctx.deal?.contacts?.length ?? 0,
  };
}

type Signals = ReturnType<typeof extractSignals>;

// Un driver = un signal noté : la règle complète en paliers, le palier atteint
// (applied) et les points qui en découlent.
function driver(
  signal: HealthSignal,
  label: string,
  rules: HealthRuleTier[],
  applied: number,
  extra?: Partial<HealthDriver>,
): HealthDriver {
  const points = rules[applied]?.points ?? 0;
  return {
    signal,
    label,
    points,
    impact: points > 0 ? "positive" : points < 0 ? "negative" : "neutral",
    rules,
    applied,
    ...extra,
  };
}

// Neutralise une pénalité quand la source qui la justifie n'a pas pu être lue.
// Le palier atteint reste affiché (ce qu'on aurait compté), à 0 point.
function guard(d: HealthDriver, missing: string | null): HealthDriver {
  if (!missing || (d.points ?? 0) >= 0) return d;
  return { ...d, points: 0, impact: "neutral", skipped: `Not scored because ${missing}` };
}

function buildBreakdown(s: Signals, ctx: ClientEnrichmentContext, phase: AccountPhase, inputs: HealthInputs, now: number) {
  const r = PHASE_RULES[phase];
  const hubspotDown = ctx.sourceErrors?.hubspot ? "HubSpot could not be read" : null;
  const claapDown = ctx.sourceErrors?.claap ? "Claap could not be fully read" : null;
  const anyDown = hubspotDown ?? claapDown;
  const out: HealthDriver[] = [];

  // 1. Dernier contact
  {
    const rules: HealthRuleTier[] = [
      { when: `Within ${r.fresh} days`, points: 20 },
      { when: `${r.fresh + 1} to ${r.ok} days`, points: 5 },
      { when: `${r.ok + 1} to ${r.quiet} days`, points: -10 },
      { when: `Over ${r.quiet} days`, points: -25 },
      { when: "No contact found", points: -15 },
    ];
    const extra: Partial<HealthDriver> = {
      source: s.lastContact?.source ?? null,
      rule_note: `Thresholds for ${phase === "onboarding" ? "an" : "a"} ${PHASE_NAME[phase]} account. Emails, calls and meetings count, internal notes do not.`,
    };
    const days = s.lastContact ? Math.floor((now - s.lastContact.t) / DAY) : null;
    let d: HealthDriver;
    if (days === null) d = driver("contact", "No dated contact with the client", rules, 4, extra);
    else if (days <= r.fresh) d = driver("contact", `Recent contact (${days}d ago)`, rules, 0, extra);
    else if (days <= r.ok) d = driver("contact", `Last contact ${days}d ago`, rules, 1, extra);
    else if (days <= r.quiet) d = driver("contact", `${days} days without contact`, rules, 2, extra);
    else d = driver("contact", `Long silence (${days} days)`, rules, 3, extra);
    // Source illisible : on ne voit qu'une partie des échanges, "silence" serait
    // une affirmation qu'on ne peut pas tenir.
    if (anyDown && (d.points ?? 0) < 0) d = { ...d, label: days === null ? "No contact found in the readable sources" : `Last known contact ${days}d ago` };
    out.push(guard(d, anyDown));
  }

  // 2. Meetings Claap sur 90 j
  {
    const n = s.meetings90.length;
    const rules: HealthRuleTier[] = [
      { when: "3 or more meetings", points: 15 },
      { when: "2 meetings", points: 5 },
      { when: "1 meeting", points: r.oneMeetingIsNormal ? 0 : -5 },
      { when: "No meeting", points: -15 },
    ];
    const extra: Partial<HealthDriver> = {
      source: s.meetings90[0] ? meetingSource(s.meetings90[0]) : null,
      rule_note: r.oneMeetingIsNormal ? "One meeting a quarter is normal once the program is live." : null,
    };
    let d: HealthDriver;
    if (n >= 3) d = driver("meetings", `${n} meetings in 90 days`, rules, 0, extra);
    else if (n === 2) d = driver("meetings", "2 meetings in 90 days", rules, 1, extra);
    else if (n === 1) d = driver("meetings", r.oneMeetingIsNormal ? "1 meeting in 90 days" : "Only 1 meeting in 90 days", rules, 2, extra);
    else d = driver("meetings", "No meeting in 90 days", rules, 3, extra);
    out.push(guard(d, claapDown));
  }

  // 3. Activité HubSpot sur 30 j
  {
    const n = s.engagements30.length;
    const rules: HealthRuleTier[] = [
      { when: "5 or more activities", points: 10 },
      { when: "1 to 4 activities", points: 0 },
      { when: "No activity", points: -5 },
    ];
    const latest = s.engagements30[0];
    const extra: Partial<HealthDriver> = {
      source: latest ? { kind: "hubspot", date: latest.date, label: "Latest HubSpot activity" } : null,
      rule_note: "Everything logged on the deal and the company in HubSpot, internal notes included.",
    };
    let d: HealthDriver;
    if (n >= 5) d = driver("activity", `${n} emails, calls and notes in 30 days`, rules, 0, extra);
    else if (n > 0) d = driver("activity", `${n} email${n > 1 ? "s, calls or notes" : ", call or note"} in 30 days`, rules, 1, extra);
    else d = driver("activity", hubspotDown ? "HubSpot activity unknown" : "No email, call or note in 30 days", rules, 2, extra);
    out.push(guard(d, hubspotDown));
  }

  // 4. Interlocuteurs client actifs sur 90 j
  {
    const n = s.people.length;
    const rules: HealthRuleTier[] = [
      { when: "3 or more people", points: 5 },
      { when: "2 people", points: 0 },
      { when: "Only 1 person", points: -10 },
      { when: "Nobody identified", points: 0 },
    ];
    const extra: Partial<HealthDriver> = {
      detail: n > 0 ? s.people.slice(0, 6).join(", ") + (n > 6 ? `, +${n - 6}` : "") : null,
      rule_note: "People who attended a Claap meeting or emailed us. A single contact means a fragile champion. Nobody identified is already penalized by Last contact.",
    };
    let d: HealthDriver;
    if (n >= 3) d = driver("stakeholders", `${n} active client contacts`, rules, 0, extra);
    else if (n === 2) d = driver("stakeholders", "2 active client contacts", rules, 1, extra);
    else if (n === 1) d = driver("stakeholders", "Single active client contact", rules, 2, extra);
    else d = driver("stakeholders", "No identified client contact in 90 days", rules, 3, extra);
    out.push(guard(d, anyDown));
  }

  // 5. Ton des derniers meetings
  {
    const tone = inputs.tone;
    const rules: HealthRuleTier[] = [
      { when: "Positive", points: 10 },
      { when: "Neutral", points: 0 },
      { when: "Negative", points: -15 },
    ];
    const k = tone?.meetings.length ?? 0;
    const m = tone?.meetings[0];
    const extra: Partial<HealthDriver> = {
      detail: tone?.reason || null,
      source: m ? { kind: "claap", date: m.date, label: short(m.title) ?? "Claap meeting", url: m.url ?? null } : null,
      rule_note:
        k > 0
          ? `Read by AI from the last ${k === 1 ? "meeting" : `${k} meetings`} of the last 90 days. It judges the client, not our team.`
          : "Read by AI from the last 3 meetings of the last 90 days.",
    };
    if (tone?.label === "positive") out.push(driver("tone", "Positive tone in recent meetings", rules, 0, extra));
    else if (tone?.label === "negative") out.push(driver("tone", "Concerns raised in recent meetings", rules, 2, extra));
    else if (tone) out.push(driver("tone", "Neutral tone in recent meetings", rules, 1, extra));
    else if (inputs.toneError)
      out.push({ ...driver("tone", "Tone unknown", rules, 1, extra), applied: null, skipped: "Not scored because the AI could not read the meetings" });
    else out.push({ ...driver("tone", "No recent meeting to read", rules, 1, extra), applied: null });
  }

  // 6. News à risque sur 90 j
  {
    const rules: HealthRuleTier[] = [
      { when: "Leadership change, restructuring or M&A", points: -10 },
      { when: "No risk news", points: 0 },
    ];
    const rule_note = "Only news rated high importance for the account, published in the last 90 days.";
    const risky = (inputs.news?.items ?? [])
      .filter((n) => n.importance === "high" && n.category && RISK_NEWS[n.category])
      .map((n) => ({ n, t: ts(n.published_at) ?? ts(n.first_seen_at) }))
      .filter((x): x is { n: NewsItem; t: number } => x.t !== null && now - x.t <= 90 * DAY)
      .sort((a, b) => b.t - a.t)[0];
    if (risky) {
      const n = risky.n;
      out.push(
        driver("news", RISK_NEWS[n.category as NewsCategory] as string, rules, 0, {
          rule_note,
          detail: n.title,
          source: { kind: "news", date: n.published_at ?? n.first_seen_at ?? null, label: n.source_name ?? null, url: n.url },
        }),
      );
    } else {
      out.push(driver("news", "No risk news in 90 days", rules, 1, { rule_note }));
    }
  }

  return out;
}

function labelFromScore(score: number): HealthLabel {
  if (score >= 70) return "green";
  if (score >= 40) return "yellow";
  return "red";
}

export function computeHealth(ctx: ClientEnrichmentContext, previousScore: number | null, inputs: HealthInputs): Health {
  const now = Date.now();
  const signals = extractSignals(ctx, now);
  const { phase, daysSinceSignature, daysToContractEnd, contractEnd } = computeAccountPhase({
    closedwonAt: inputs.closedwonAt,
    kickoffDate: inputs.kickoffDate,
    contractEndDate: inputs.contractEndDate,
    contractEndField: inputs.contractEndField,
    now,
  });
  const breakdown = buildBreakdown(signals, ctx, phase, inputs, now);
  const total = BASELINE + breakdown.reduce((sum, d) => sum + (d.points ?? 0), 0);
  const score = Math.max(0, Math.min(100, Math.round(total)));
  const label = labelFromScore(score);

  // Chips de la carte : ce qui a bougé le score, du plus au moins impactant.
  const driversDetail = breakdown
    .filter((d) => (d.points ?? 0) !== 0)
    .sort((a, b) => Math.abs(b.points ?? 0) - Math.abs(a.points ?? 0));

  const dataGaps = [
    ctx.sourceErrors?.hubspot,
    ctx.sourceErrors?.claap,
    inputs.toneError ? "Tone of recent meetings could not be read" : null,
  ].filter((g): g is string => !!g);

  let trend: "up" | "down" | "stable" | undefined;
  if (previousScore !== null) {
    if (score > previousScore + 5) trend = "up";
    else if (score < previousScore - 5) trend = "down";
    else trend = "stable";
  }

  return {
    score,
    label,
    drivers: driversDetail.map((d) => `${d.label} (${signed(d.points ?? 0)})`),
    drivers_detail: driversDetail,
    breakdown,
    baseline: BASELINE,
    phase: {
      key: phase,
      days_since_signature: daysSinceSignature,
      days_to_contract_end: daysToContractEnd,
      contract_end_from: contractEnd.from,
    },
    data_gaps: dataGaps,
    tone: inputs.tone,
    computed_at: new Date(now).toISOString(),
    trend,
    last_contact_at: signals.lastContact ? new Date(signals.lastContact.t).toISOString() : null,
    last_contact_source: signals.lastContact?.kind ?? null,
  };
}

// Fallback par règles des Next actions, quand la génération IA (insights-ai.ts)
// échoue : 3 actions max, même format que l'IA (owner, échéance, why).
export function computeInsights(ctx: ClientEnrichmentContext, health: Health): Insights {
  const now = Date.now();
  const s = extractSignals(ctx, now);
  const actions: InsightAction[] = [];
  const daysSinceLastContact = s.lastContact ? Math.floor((now - s.lastContact.t) / DAY) : null;
  const meetingsLast90 = s.meetings90.length;

  if (health.label === "red") {
    if (daysSinceLastContact !== null && daysSinceLastContact > 60) {
      actions.push({ title: "Re-engage the client contact this week", why: `${daysSinceLastContact} days of silence, high churn risk.`, owner: "CS", due: "this_week", priority: "high", source: { kind: "fiche" } });
    }
    if (meetingsLast90 === 0) {
      actions.push({ title: "Schedule an adoption review", why: "No meeting with the client in the last 90 days.", owner: "CS", due: "next_2_weeks", priority: "high", source: { kind: "fiche" } });
    }
  }

  if (health.label === "yellow") {
    if (daysSinceLastContact !== null && daysSinceLastContact > 30) {
      actions.push({ title: "Send a check-in to the HR contact", why: `Last exchange ${daysSinceLastContact} days ago.`, owner: "CS", due: "this_week", priority: "medium", source: { kind: "fiche" } });
    }
    if (meetingsLast90 < 2) {
      actions.push({ title: "Schedule a feedback session", why: "Exchange cadence is dropping, capture how they feel.", owner: "CS", due: "next_2_weeks", priority: "medium", source: { kind: "fiche" } });
    }
  }

  if (s.people.length === 1) {
    actions.push({ title: "Identify a backup sponsor", why: `Only one client contact active in the last 90 days (${s.people[0]}), fragile champion.`, owner: "AM", due: "this_month", priority: "medium", source: { kind: "fiche" } });
  } else if (s.people.length === 0 && s.contactsCount <= 1) {
    actions.push({ title: "Identify a backup sponsor", why: "Only one contact mapped in HubSpot, fragile champion.", owner: "AM", due: "this_month", priority: "medium", source: { kind: "hubspot" } });
  }

  return {
    generated_at: new Date().toISOString(),
    actions: actions.slice(0, 3).map((a, i) => ({ ...a, id: `rule-${i}` })),
    highlights: [],
  };
}
