import type { CalendarEvent } from "@/lib/google-calendar";

export interface DealQualification {
  budget: string | null;
  estimatedBudget: string | null;
  authority: string | null;
  need: string | null;
  champion: string | null;
  needDetailed: string | null;
  timeline: string | null;
  strategicFit: string | null;
}

export interface CompanyProfile {
  revenue: string | null;
  headcount: string | null;
  clients: string | null;
  businessModel: string | null;
  industry: string | null;
  keyFact: string | null;
}

export interface StrategicHistoryItem {
  year: string | null;
  type: "acquisition" | "partnership" | "merger" | "divestiture";
  entity: string;
  description: string;
}

export interface BriefingResult {
  identity: { name: string; role: string; company: string; hubspotStage: string; lastContact: string };
  meetingType?: "discovery" | "follow_up";
  isSalesMeeting?: boolean;
  objective?: string;
  contextSummary?: string;
  companyProfile?: CompanyProfile;
  companyInsights?: string;
  personInsights?: string;
  linkedinInsights?: { name: string; currentRole: string; experience?: string; skills?: string; education?: string; keyInsight: string }[];
  recentNews: { items: { type: string; text: string; url?: string; date: string }[] };
  strategicHistory?: StrategicHistoryItem[];
  growthDynamics?: { summary: string } | null;
  meetingTakeaways?: string[];
  questionsToAsk?: string[];
  nextStep?: string;
  confidence: "high" | "medium" | "low";
  dealQualification?: DealQualification;
}

export interface GatheredData {
  contacts: Record<string, string>[];
  deals: { name: string; stage: string; amount: string | null; closedate: string | null; ownerName: string | null; scoreTotal: number | null; scoreReliability: number | null; reasoning: string | null; nextAction: string | null; scoredAt: string | null }[];
  engagements: { type: string; date: string; subject: string | null; body: string | null; duration: number | null }[];
  companyHubspot: Record<string, string> | null;
  gmailMessages: { subject: string; from: string; date: string; snippet: string }[];
  slackMessages: { channel: string; text: string; timestamp: string }[];
  webResults: { title: string; url: string; content: string; published_date: string | null }[];
  companyProfileResults: { title: string; url: string; content: string; published_date: string | null }[];
  strategicResults: { title: string; url: string; content: string; published_date: string | null }[];
  cached?: boolean;
  briefing?: BriefingResult;
}

export type LoadState = "idle" | "loading" | "done" | "error";

export function eventDateLabel(start: string): { label: string; color: string } {
  const d = new Date(start);
  const now = new Date();
  const todayStr = now.toDateString();
  const tomorrowStr = new Date(now.getTime() + 86400000).toDateString();
  if (d.toDateString() === todayStr) return { label: "Aujourd'hui", color: "#f01563" };
  if (d.toDateString() === tomorrowStr) return { label: "Demain", color: "#f97316" };
  return {
    label: d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }),
    color: "#888",
  };
}

export function eventTime(start: string): string {
  if (!start.includes("T")) return "";
  return new Date(start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function isRoom(a: { email: string; displayName?: string; resource?: boolean }): boolean {
  if (a.resource) return true;
  if (a.email.includes("resource.calendar.google.com")) return true;
  if (a.displayName && /\(\d+\s*(pers|personnes?)\)/i.test(a.displayName)) return true;
  return false;
}

export function externalAttendees(event: CalendarEvent) {
  return event.attendees.filter((a) => !a.self && !isRoom(a) && !a.email.includes("coachello"));
}

export function companyFromEmail(email: string): string {
  const domain = email.split("@")[1] ?? "";
  const parts = domain.split(".");
  return parts.length >= 2 ? parts[parts.length - 2] : domain;
}

export function isToday(start: string): boolean {
  return new Date(start).toDateString() === new Date().toDateString();
}

export function formatMeetingPillLabel(event: CalendarEvent, ext: ReturnType<typeof externalAttendees>): string {
  const time = eventTime(event.start);
  const company = ext[0] ? companyFromEmail(ext[0].email) : event.title;
  const cap = company.charAt(0).toUpperCase() + company.slice(1);
  return time ? `${cap} · ${time}` : cap;
}

export function formatBriefingForSlack(briefing: BriefingResult, eventTitle: string): string {
  const lines: string[] = [
    `*Briefing — ${eventTitle}*`,
    "",
    `*${briefing.identity?.name}* — ${briefing.identity?.role} @ ${briefing.identity?.company}`,
    `Statut CRM : ${briefing.identity?.hubspotStage || "—"} | Dernier contact : ${briefing.identity?.lastContact || "—"}`,
  ];
  if (briefing.isSalesMeeting !== false && briefing.meetingType) {
    lines.push("", `Type : ${briefing.meetingType === "discovery" ? "Découverte" : "Point de suivi"}`);
  }
  if (briefing.objective) lines.push("", `*Objectif* : ${briefing.objective}`);
  if (briefing.meetingTakeaways?.length) {
    lines.push("", `*Points clés* :`, ...briefing.meetingTakeaways.map((t, i) => `${i + 1}. ${t}`));
  }
  if (briefing.companyProfile) {
    const cp = briefing.companyProfile;
    const pl = [
      cp.revenue ? `CA : ${cp.revenue}` : null,
      cp.headcount ? `Effectifs : ${cp.headcount}` : null,
      cp.clients ? `Clients : ${cp.clients}` : null,
      cp.businessModel ? `Modèle : ${cp.businessModel}` : null,
      cp.industry ? `Secteur : ${cp.industry}` : null,
    ].filter(Boolean);
    if (pl.length > 0) lines.push("", `*Entreprise* :`, ...pl.map((l) => `• ${l}`));
  } else if (briefing.companyInsights) {
    lines.push("", `*Entreprise* : ${briefing.companyInsights}`);
  }
  if (briefing.contextSummary) lines.push("", `*Contexte* :`, briefing.contextSummary);
  if (briefing.personInsights) lines.push("", `*Interlocuteur* : ${briefing.personInsights}`);
  if (briefing.recentNews?.items?.length) {
    lines.push("", `*Actualités* :`, ...briefing.recentNews.items.slice(0, 4).map((i) => `• [${i.type}] ${i.text}`));
  }
  if (briefing.questionsToAsk?.length) {
    lines.push("", `*Questions à poser* :`, ...briefing.questionsToAsk.map((q, i) => `${i + 1}. ${q}`));
  }
  if (briefing.nextStep) lines.push("", `*Prochaine étape* : ${briefing.nextStep}`);
  return lines.join("\n");
}
