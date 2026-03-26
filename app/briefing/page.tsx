"use client";

import { useState, useEffect } from "react";
import { RefreshCw, Calendar, Mail, Globe, Send, ExternalLink } from "lucide-react";
import type { CalendarEvent } from "@/lib/google-calendar";

// ── Types ─────────────────────────────────────────────────────────────────────
interface GatheredData {
  contacts: Record<string, string>[];
  deals: { name: string; stage: string; amount: string | null; closedate: string | null }[];
  engagements: { type: string; date: string; subject: string | null; body: string | null; duration: number | null }[];
  gmailMessages: { subject: string; from: string; date: string; snippet: string }[];
  slackMessages: { channel: string; text: string; timestamp: string }[];
  webResults: { title: string; url: string; content: string; published_date: string | null }[];
  cached?: boolean;
  briefing?: BriefingResult;
}

interface DealQualification {
  budget: string | null;
  estimatedBudget: string | null;
  authority: string | null;
  need: string | null;
  champion: string | null;
  needDetailed: string | null;
  timeline: string | null;
  strategicFit: string | null;
}

interface BriefingResult {
  identity: { name: string; role: string; company: string; hubspotStage: string; lastContact: string };
  meetingType?: "discovery" | "follow_up";
  objective?: string;
  contextSummary?: string;
  companyInsights?: string;
  personInsights?: string;
  recentNews: { items: { type: string; text: string; url?: string; date: string }[] };
  questionsToAsk?: string[];
  nextStep?: string;
  confidence: "high" | "medium" | "low";
  dealQualification?: DealQualification;
}

type LoadState = "idle" | "loading" | "done" | "error";

// ── Helpers ───────────────────────────────────────────────────────────────────
function eventDateLabel(start: string): { label: string; color: string } {
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

function eventTime(start: string): string {
  if (!start.includes("T")) return "";
  return new Date(start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function isRoom(a: { email: string; displayName?: string; resource?: boolean }): boolean {
  if (a.resource) return true;
  if (a.email.includes("resource.calendar.google.com")) return true;
  // Salles nommées "Nom (X pers)" ou "Nom (X personnes)"
  if (a.displayName && /\(\d+\s*(pers|personnes?)\)/i.test(a.displayName)) return true;
  return false;
}

function externalAttendees(event: CalendarEvent) {
  return event.attendees.filter((a) => !a.self && !isRoom(a) && !a.email.includes("coachello"));
}

function companyFromEmail(email: string): string {
  const domain = email.split("@")[1] ?? "";
  const parts = domain.split(".");
  return parts.length >= 2 ? parts[parts.length - 2] : domain;
}

function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        if (line.startsWith("## ")) {
          return <p key={i} className="text-[10px] font-semibold uppercase tracking-wide mt-3 first:mt-0" style={{ color: "#aaa" }}>{line.slice(3)}</p>;
        }
        if (line.startsWith("# ")) {
          return <p key={i} className="text-xs font-bold mt-3 first:mt-0" style={{ color: "#111" }}>{line.slice(2)}</p>;
        }
        if (line.startsWith("- ") || line.startsWith("• ")) {
          return (
            <div key={i} className="flex items-start gap-1.5">
              <span className="mt-1 shrink-0" style={{ color: "#f01563", fontSize: 8 }}>●</span>
              <p className="text-xs leading-relaxed" style={{ color: "#444" }}>{line.slice(2)}</p>
            </div>
          );
        }
        if (line.trim() === "") return <div key={i} className="h-1" />;
        return <p key={i} className="text-xs leading-relaxed" style={{ color: "#444" }}>{line}</p>;
      })}
    </div>
  );
}

function confidenceBadge(c: "high" | "medium" | "low") {
  if (c === "high") return { bg: "#f0fdf4", color: "#166534", border: "#bbf7d0", label: "Données riches" };
  if (c === "medium") return { bg: "#fef3c7", color: "#92400e", border: "#fde68a", label: "Données partielles" };
  return { bg: "#f1f5f9", color: "#475569", border: "#e2e8f0", label: "Peu de données" };
}

function formatBriefingForSlack(briefing: BriefingResult, eventTitle: string): string {
  const lines: string[] = [
    `*Briefing — ${eventTitle}*`,
    "",
    `*${briefing.identity?.name}* — ${briefing.identity?.role} @ ${briefing.identity?.company}`,
    `Statut CRM : ${briefing.identity?.hubspotStage || "—"} | Dernier contact : ${briefing.identity?.lastContact || "—"}`,
  ];
  if (briefing.meetingType) {
    lines.push("", `Type : ${briefing.meetingType === "discovery" ? "Découverte" : "Point de suivi"}`);
  }
  if (briefing.objective) {
    lines.push("", `*Objectif* : ${briefing.objective}`);
  }
  if (briefing.contextSummary) {
    lines.push("", `*Contexte de la relation* :`, briefing.contextSummary);
  }
  if (briefing.companyInsights) {
    lines.push("", `*Entreprise* : ${briefing.companyInsights}`);
  }
  if (briefing.personInsights) {
    lines.push("", `*Interlocuteur* : ${briefing.personInsights}`);
  }
  if (briefing.recentNews?.items?.length) {
    lines.push("", `*Actualités* :`, ...briefing.recentNews.items.slice(0, 3).map((i) => `• ${i.text}`));
  }
  if (briefing.questionsToAsk?.length) {
    lines.push("", `*Questions à poser* :`, ...briefing.questionsToAsk.map((q, i) => `${i + 1}. ${q}`));
  }
  if (briefing.nextStep) {
    lines.push("", `*Prochaine étape* : ${briefing.nextStep}`);
  }
  return lines.join("\n");
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function BriefingPage() {
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [gatherState, setGatherState] = useState<LoadState>("idle");
  const [briefingState, setBriefingState] = useState<LoadState>("idle");
  const [rawData, setRawData] = useState<GatheredData | null>(null);
  const [briefing, setBriefing] = useState<BriefingResult | null>(null);
  const [sendingSlack, setSendingSlack] = useState(false);
  const [slackSent, setSlackSent] = useState(false);
  const [draftSent, setDraftSent] = useState(false);
  const [slackName, setSlackName] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/calendar/events?days=7")
      .then((r) => r.json())
      .then((data) => {
        setCalendarConnected(data.calendarConnected ?? false);
        setEvents(data.events ?? []);
      })
      .catch(() => setCalendarConnected(false))
      .finally(() => setLoadingEvents(false));

    fetch("/api/user/me")
      .then((r) => r.json())
      .then((data) => setSlackName(data.slack_display_name ?? null))
      .catch(() => null);
  }, []);

  async function selectEvent(event: CalendarEvent, forceRefresh = false) {
    setSelectedEvent(event);
    setBriefing(null);
    setRawData(null);
    setSlackSent(false);
    setDraftSent(false);

    const ext = externalAttendees(event);
    const company = ext[0] ? companyFromEmail(ext[0].email) : "";

    setGatherState("loading");
    setBriefingState("idle");

    try {
      const gatherRes = await fetch("/api/briefing/gather", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id, eventTitle: event.title, attendees: ext, company, forceRefresh }),
      });
      if (!gatherRes.ok) throw new Error("gather failed");
      const gathered: GatheredData = await gatherRes.json();
      setRawData(gathered);
      setGatherState("done");

      // Use cached briefing only if complete and not forcing refresh
      if (gathered.cached && gathered.briefing?.identity && !forceRefresh) {
        setBriefing(gathered.briefing);
        setBriefingState("done");
        return;
      }

      setBriefingState("loading");
      const synthRes = await fetch("/api/briefing/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: event.id,
          eventTitle: event.title,
          eventStart: event.start,
          attendees: ext,
          rawData: gathered,
        }),
      });
      if (!synthRes.ok) throw new Error("synthesize failed");
      const result: BriefingResult = await synthRes.json();
      setBriefing(result);
      setBriefingState("done");
    } catch {
      setGatherState("error");
    }
  }

  async function sendToSlack() {
    if (!briefing || !selectedEvent) return;
    setSendingSlack(true);
    try {
      const res = await fetch("/api/briefing/send-slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          briefingText: formatBriefingForSlack(briefing, selectedEvent.title),
          eventTitle: selectedEvent.title,
        }),
      });
      if (res.ok) setSlackSent(true);
    } finally {
      setSendingSlack(false);
    }
  }

  function createDraft() {
    if (!briefing || !selectedEvent) return;
    const content = formatBriefingForSlack(briefing, selectedEvent.title).replace(/\*/g, "").replace(/_/g, "");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Debrief - ${selectedEvent.title}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setDraftSent(true);
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const showCenter = !!selectedEvent;
  const showRight = briefingState === "done" && !!briefing;

  const leftWidth = showRight ? "20%" : showCenter ? "40%" : "100%";
  const centerWidth = showRight ? "50%" : showCenter ? "60%" : "0%";
  const rightWidth = showRight ? "30%" : "0%";

  return (
    <>
    <div className="flex h-full overflow-hidden" style={{ background: "#f8f8f8" }}>

      {/* ── LEFT: Calendar Events ───────────────────────────────────────────── */}
      <div className="flex flex-col border-r" style={{ width: leftWidth, flexShrink: 0, background: "#fff", borderColor: "#eee", transition: "width 0.3s ease", overflow: "hidden" }}>
        <div className="px-4 py-4 border-b" style={{ borderColor: "#eee" }}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "#111" }}>Meetings à venir</h2>
              <p className="text-xs mt-0.5" style={{ color: "#aaa" }}>7 prochains jours</p>
            </div>
            {selectedEvent && (
              <button
                onClick={() => { setSelectedEvent(null); setBriefing(null); setRawData(null); setGatherState("idle"); setBriefingState("idle"); }}
                className="text-xs px-2.5 py-1 rounded-lg border"
                style={{ color: "#888", borderColor: "#e5e5e5" }}
              >
                ← Calendrier
              </button>
            )}
          </div>
        </div>

        {/* ── Vue calendrier semaine (plein écran) ── */}
        {!showCenter && (
          <div className="flex-1 overflow-hidden flex flex-col">
            {calendarConnected === false && (
              <div className="m-4 rounded-xl p-4 text-center" style={{ background: "#fde8ef", border: "1px solid #f9b4cb" }}>
                <Calendar size={20} style={{ color: "#f01563", margin: "0 auto 8px" }} />
                <p className="text-xs font-semibold mb-1" style={{ color: "#c01252" }}>Calendar non connecté</p>
                <p className="text-xs mb-3" style={{ color: "#c01252" }}>Reconnecte Google pour activer l&apos;accès Calendar.</p>
                <a href="/api/gmail/connect" className="inline-block text-xs px-3 py-1.5 rounded-lg font-medium" style={{ background: "#f01563", color: "#fff" }}>
                  Reconnecter Google →
                </a>
              </div>
            )}

            {loadingEvents && calendarConnected !== false && (
              <div className="flex-1 grid grid-cols-7 gap-px p-4" style={{ background: "#f0f0f0" }}>
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="flex flex-col gap-2 p-2" style={{ background: "#fff" }}>
                    <div className="h-6 rounded animate-pulse" style={{ background: "#f5f5f5" }} />
                    <div className="h-16 rounded animate-pulse" style={{ background: "#f5f5f5" }} />
                  </div>
                ))}
              </div>
            )}

            {!loadingEvents && calendarConnected !== false && (() => {
              // Build 7 days starting today
              const days = Array.from({ length: 7 }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() + i);
                d.setHours(0, 0, 0, 0);
                return d;
              });

              const eventsByDay = days.map((day) =>
                events.filter((e) => {
                  const ed = new Date(e.start);
                  return ed.toDateString() === day.toDateString();
                })
              );

              const DAY_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
              const MONTH_SHORT = ["jan", "fév", "mar", "avr", "mai", "jun", "jul", "aoû", "sep", "oct", "nov", "déc"];
              const todayStr = new Date().toDateString();

              return (
                <div className="flex flex-1 overflow-hidden">
                  {days.map((day, di) => {
                    const isToday = day.toDateString() === todayStr;
                    const dayEvents = eventsByDay[di];

                    return (
                      <div
                        key={di}
                        className="flex flex-col flex-1 border-r overflow-hidden"
                        style={{ borderColor: "#f0f0f0", background: isToday ? "#fffbfc" : "#fff" }}
                      >
                        {/* Day header */}
                        <div
                          className="px-2 py-2 border-b text-center shrink-0"
                          style={{ borderColor: "#f0f0f0", background: isToday ? "#fde8ef" : "#fafafa" }}
                        >
                          <p className="text-[10px] font-medium" style={{ color: isToday ? "#f01563" : "#888" }}>
                            {DAY_LABELS[day.getDay()]}
                          </p>
                          <p className="text-sm font-bold" style={{ color: isToday ? "#f01563" : "#111" }}>
                            {day.getDate()}
                          </p>
                          <p className="text-[9px]" style={{ color: "#bbb" }}>
                            {MONTH_SHORT[day.getMonth()]}
                          </p>
                        </div>

                        {/* Events */}
                        <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                          {dayEvents.length === 0 && (
                            <div className="h-full flex items-start justify-center pt-4">
                              <span className="text-[10px]" style={{ color: "#e5e5e5" }}>—</span>
                            </div>
                          )}
                          {dayEvents.map((event) => {
                            const ext = externalAttendees(event);
                            const isInternal = ext.length === 0;
                            const time = eventTime(event.start);

                            return (
                              <button
                                key={event.id}
                                onClick={() => !isInternal && selectEvent(event)}
                                disabled={isInternal}
                                className="w-full text-left p-2 rounded-lg border transition-all"
                                style={{
                                  borderColor: isInternal ? "#f0f0f0" : "#e5e5e5",
                                  background: isInternal ? "#fafafa" : "#fff",
                                  opacity: isInternal ? 0.5 : 1,
                                  cursor: isInternal ? "default" : "pointer",
                                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                                }}
                                onMouseEnter={(e) => { if (!isInternal) e.currentTarget.style.borderColor = "#f01563"; }}
                                onMouseLeave={(e) => { if (!isInternal) e.currentTarget.style.borderColor = "#e5e5e5"; }}
                              >
                                {time && (
                                  <p className="text-[9px] font-semibold mb-0.5" style={{ color: "#f01563" }}>{time}</p>
                                )}
                                <p className="text-[10px] font-semibold leading-tight mb-1" style={{ color: "#111" }}>
                                  {event.title}
                                </p>
                                {!isInternal && (
                                  <p className="text-[9px] truncate" style={{ color: "#aaa" }}>
                                    {ext[0]?.displayName || ext[0]?.email}
                                    {ext.length > 1 ? ` +${ext.length - 1}` : ""}
                                  </p>
                                )}
                                <div className="flex gap-1 mt-1 flex-wrap">
                                  {isInternal && (
                                    <span className="text-[8px] px-1 py-0.5 rounded-full" style={{ background: "#f1f5f9", color: "#475569" }}>Interne</span>
                                  )}
                                  {event.meetingLink && (
                                    <span className="text-[8px] px-1 py-0.5 rounded-full" style={{ background: "#eff6ff", color: "#1d4ed8" }}>Visio</span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Vue liste (quand un event est sélectionné) ── */}
        {showCenter && (
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {events.map((event) => {
              const ext = externalAttendees(event);
              const { label, color } = eventDateLabel(event.start);
              const time = eventTime(event.start);
              const active = selectedEvent?.id === event.id;
              const isInternal = ext.length === 0;

              return (
                <button
                  key={event.id}
                  onClick={() => !isInternal && selectEvent(event)}
                  disabled={isInternal}
                  className="w-full text-left p-3 rounded-xl border transition-colors"
                  style={{
                    borderColor: active ? "#f01563" : "#e5e5e5",
                    background: active ? "#fff9fb" : "#fff",
                    opacity: isInternal ? 0.5 : 1,
                    cursor: isInternal ? "default" : "pointer",
                  }}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <p className="text-xs font-semibold leading-tight" style={{ color: "#111" }}>{event.title}</p>
                    <span className="text-[10px] shrink-0 font-medium" style={{ color }}>{label}</span>
                  </div>
                  {time && <p className="text-[10px] mb-1" style={{ color: "#888" }}>{time}</p>}
                  <div className="flex items-center gap-1.5">
                    {isInternal ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "#f1f5f9", color: "#475569" }}>Interne</span>
                    ) : (
                      <span className="text-[10px]" style={{ color: "#aaa" }}>
                        {ext[0]?.displayName || ext[0]?.email}
                        {ext.length > 1 ? ` +${ext.length - 1}` : ""}
                      </span>
                    )}
                    {event.meetingLink && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "#eff6ff", color: "#1d4ed8" }}>Visio</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── CENTER: Briefing Content ────────────────────────────────────────── */}
      <div className="flex flex-col" style={{ width: centerWidth, flexShrink: 0, overflowX: "hidden", overflowY: showCenter ? "auto" : "hidden", transition: "width 0.3s ease" }}>
        {!selectedEvent && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
            <Calendar size={40} style={{ color: "#e5e5e5" }} />
            <p className="text-sm font-medium" style={{ color: "#888" }}>Sélectionne un meeting</p>
            <p className="text-xs" style={{ color: "#bbb" }}>Clique sur un événement pour générer le briefing</p>
          </div>
        )}

        {selectedEvent && (
          <div className="px-6 py-5 space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold" style={{ color: "#111" }}>{selectedEvent.title}</h2>
                <p className="text-xs mt-0.5" style={{ color: "#888" }}>
                  {selectedEvent.start
                    ? new Date(selectedEvent.start).toLocaleDateString("fr-FR", {
                        weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
                      })
                    : ""}
                  {selectedEvent.meetingLink && (
                    <a href={selectedEvent.meetingLink} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-0.5" style={{ color: "#1d4ed8" }}>
                      Rejoindre <ExternalLink size={10} />
                    </a>
                  )}
                </p>
              </div>
              {briefingState === "done" && (
                <button
                  onClick={() => selectEvent(selectedEvent, true)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
                  style={{ background: "#f5f5f5", color: "#555" }}
                >
                  <RefreshCw size={11} />
                  Régénérer
                </button>
              )}
            </div>

            {/* Loading: gather */}
            {gatherState === "loading" && (
              <div className="space-y-3">
                {["HubSpot CRM…", "Gmail…", "Slack…", "Web…"].map((src) => (
                  <div key={src} className="flex items-center gap-3 p-3 rounded-xl border animate-pulse" style={{ borderColor: "#f0f0f0", background: "#fafafa" }}>
                    <div className="w-4 h-4 rounded-full" style={{ background: "#f5f5f5" }} />
                    <p className="text-xs" style={{ color: "#aaa" }}>Recherche dans {src}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Loading: synthesize */}
            {gatherState === "done" && briefingState === "loading" && (
              <div className="flex items-center gap-3 p-4 rounded-xl border" style={{ borderColor: "#fde8ef", background: "#fff9fb" }}>
                <div className="w-2 h-2 rounded-full animate-ping" style={{ background: "#f01563" }} />
                <p className="text-xs" style={{ color: "#c01252" }}>Claude analyse les données…</p>
              </div>
            )}

            {/* Error */}
            {gatherState === "error" && (
              <div className="p-4 rounded-xl border text-xs" style={{ borderColor: "#fecaca", background: "#fef2f2", color: "#991b1b" }}>
                Erreur lors de la récupération des données. Réessaie dans un moment.
              </div>
            )}

            {/* Data sources summary */}
            {gatherState === "done" && rawData && (
              <div className="flex gap-2 flex-wrap">
                {[
                  { icon: "🏢", label: `${rawData.contacts.length} contact${rawData.contacts.length > 1 ? "s" : ""} HubSpot`, active: rawData.contacts.length > 0 },
                  { icon: "💼", label: `${rawData.deals.length} deal${rawData.deals.length > 1 ? "s" : ""}`, active: rawData.deals.length > 0 },
                  { icon: "✉️", label: `${rawData.gmailMessages.length} email${rawData.gmailMessages.length > 1 ? "s" : ""}`, active: rawData.gmailMessages.length > 0 },
                  { icon: "💬", label: `${rawData.slackMessages.length} Slack`, active: rawData.slackMessages.length > 0 },
                  { icon: "🌐", label: `${rawData.webResults.length} web`, active: rawData.webResults.length > 0 },
                ].map(({ icon, label, active }) => (
                  <span key={label} className="text-[10px] px-2 py-1 rounded-full" style={{
                    background: active ? "#f0fdf4" : "#f5f5f5",
                    color: active ? "#166534" : "#aaa",
                    border: `1px solid ${active ? "#bbf7d0" : "#e5e5e5"}`,
                  }}>
                    {icon} {label}
                  </span>
                ))}
                {rawData.cached && (
                  <span className="text-[10px] px-2 py-1 rounded-full" style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}>
                    Cache
                  </span>
                )}
              </div>
            )}

            {/* Objective banner */}
            {briefingState === "done" && briefing?.objective && (
              <div className="rounded-xl px-4 py-3" style={{ background: "#fde8ef", border: "1px solid #f9b4cb" }}>
                <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "#c01252" }}>Objectif de la réunion</p>
                <p className="text-xs leading-relaxed" style={{ color: "#7a0e3a" }}>{briefing.objective}</p>
              </div>
            )}

            {/* Briefing sections */}
            {briefingState === "done" && briefing && !briefing.identity && (
              <div className="rounded-xl border px-4 py-3 flex items-center gap-3" style={{ borderColor: "#fde68a", background: "#fffbeb" }}>
                <span style={{ fontSize: 13 }}>⚠️</span>
                <p className="text-xs" style={{ color: "#92400e" }}>
                  Le briefing en cache est incomplet. Clique sur <strong>Régénérer</strong> pour relancer l'analyse.
                </p>
              </div>
            )}

            {briefingState === "done" && briefing && briefing.identity && (
              <div className="space-y-4">

                {/* Identity */}
                <div className="rounded-xl border p-4" style={{ borderColor: "#e5e5e5", background: "#fff" }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#aaa" }}>Qui tu rencontres</p>
                      {briefing.meetingType && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: briefing.meetingType === "discovery" ? "#eff6ff" : "#fef3c7", color: briefing.meetingType === "discovery" ? "#1e40af" : "#92400e" }}>
                          {briefing.meetingType === "discovery" ? "Découverte" : "Suivi"}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {briefing.identity?.hubspotStage && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0" style={{ background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0" }}>
                          {briefing.identity?.hubspotStage}
                        </span>
                      )}
                      {briefing.confidence && (() => {
                        const badge = confidenceBadge(briefing.confidence);
                        return (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0" style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}>
                            {badge.label}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold uppercase shrink-0" style={{ background: "#fde8ef", color: "#f01563" }}>
                      {briefing.identity?.name?.split(" ").map((n: string) => n[0]).slice(0, 2).join("") ?? "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color: "#111" }}>{briefing.identity?.name}</p>
                      <p className="text-[11px] truncate" style={{ color: "#888" }}>
                        {briefing.identity?.role}{briefing.identity?.company ? ` · ${briefing.identity?.company}` : ""}
                      </p>
                      {briefing.identity?.lastContact && (
                        <p className="text-[10px] mt-0.5" style={{ color: "#bbb" }}>Dernier contact : {briefing.identity?.lastContact}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Company insights */}
                {briefing.companyInsights && (
                  <div className="rounded-xl border p-4" style={{ borderColor: "#e5e5e5", background: "#fff" }}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "#aaa" }}>Entreprise</p>
                    <p className="text-xs leading-relaxed" style={{ color: "#555" }}>{briefing.companyInsights}</p>
                  </div>
                )}

                {/* Person insights */}
                {briefing.personInsights && (
                  <div className="rounded-xl border p-4" style={{ borderColor: "#e5e5e5", background: "#fff" }}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "#aaa" }}>Interlocuteur</p>
                    <p className="text-xs leading-relaxed" style={{ color: "#555" }}>{briefing.personInsights}</p>
                  </div>
                )}

                {/* Recent news */}
                {briefing.recentNews?.items?.length > 0 && (
                  <div className="rounded-xl border p-4" style={{ borderColor: "#e5e5e5", background: "#fff" }}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "#aaa" }}>Actualités récentes</p>
                    <div className="space-y-2">
                      {briefing.recentNews.items.map((item, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <span className="text-sm shrink-0 mt-0.5">
                            {item.type === "web" ? "🌐" : item.type === "slack" ? "💬" : "✉️"}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs" style={{ color: "#444" }}>{item.text}</p>
                            {item.url && (
                              <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-[10px] flex items-center gap-0.5 mt-0.5" style={{ color: "#1d4ed8" }}>
                                Source <ExternalLink size={9} />
                              </a>
                            )}
                          </div>
                          {item.date && <span className="text-[10px] shrink-0" style={{ color: "#bbb" }}>{item.date}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Questions to ask */}
                {briefing.questionsToAsk && briefing.questionsToAsk.length > 0 && (
                  <div className="rounded-xl border p-4" style={{ borderColor: "#e5e5e5", background: "#fff" }}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "#aaa" }}>Questions à poser</p>
                    <ol className="space-y-2">
                      {briefing.questionsToAsk.map((q, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-xs" style={{ color: "#444" }}>
                          <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5" style={{ background: "#f5f5f5", color: "#888" }}>
                            {i + 1}
                          </span>
                          {q}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

              </div>
            )}
          </div>
        )}
      </div>

      {/* ── RIGHT: Context + Actions ─────────────────────────────────────── */}
      <div className="flex flex-col border-l" style={{ width: rightWidth, flexShrink: 0, background: "#fff", borderColor: "#eee", transition: "width 0.3s ease", overflow: "hidden" }}>
        <div className="px-4 py-4 border-b" style={{ borderColor: "#eee" }}>
          <h2 className="text-sm font-semibold" style={{ color: "#111" }}>Contexte de la relation</h2>
          <p className="text-xs mt-0.5" style={{ color: "#aaa" }}>Historique complet des échanges</p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!selectedEvent && (
            <p className="text-xs text-center mt-12" style={{ color: "#bbb" }}>Sélectionne un meeting pour voir le contexte</p>
          )}

          {(briefingState === "loading" || gatherState === "loading") && selectedEvent && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-xl animate-pulse" style={{ background: "#f5f5f5" }} />
              ))}
            </div>
          )}

          {briefingState === "done" && briefing && (
            <div className="space-y-3">
              {briefing.contextSummary && (
                <div className="p-3.5 rounded-xl border" style={{ borderColor: "#e5e5e5", background: "#fafafa" }}>
                  <MarkdownBlock text={briefing.contextSummary} />
                </div>
              )}
              {briefing.nextStep && (
                <div className="p-3.5 rounded-xl border" style={{ borderColor: "#bbf7d0", background: "#f0fdf4" }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "#166534" }}>Prochaine étape</p>
                  <p className="text-xs leading-relaxed" style={{ color: "#15803d" }}>{briefing.nextStep}</p>
                </div>
              )}

              {/* Deal qualification checklist */}
              {briefing.dealQualification && (() => {
                const fields: { key: keyof DealQualification; label: string }[] = [
                  { key: "budget",          label: "Budget" },
                  { key: "estimatedBudget", label: "Budget estimé" },
                  { key: "authority",       label: "Autorité (décisionnaire)" },
                  { key: "need",            label: "Besoin" },
                  { key: "champion",        label: "Champion interne" },
                  { key: "needDetailed",    label: "Besoin détaillé" },
                  { key: "timeline",        label: "Timeline" },
                  { key: "strategicFit",    label: "Fit stratégique" },
                ];
                const known = fields.filter((f) => !!briefing.dealQualification![f.key]);
                const missing = fields.filter((f) => !briefing.dealQualification![f.key]);
                return (
                  <div className="rounded-xl border overflow-hidden" style={{ borderColor: "#e5e5e5" }}>
                    <div className="px-3.5 py-2.5 border-b" style={{ borderColor: "#f0f0f0", background: "#fafafa" }}>
                      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#aaa" }}>
                        Qualification deal
                      </p>
                      <p className="text-[10px] mt-0.5" style={{ color: "#bbb" }}>
                        {known.length}/{fields.length} informations collectées
                      </p>
                    </div>
                    <div className="divide-y" style={{ borderColor: "#f5f5f5" }}>
                      {known.map((f) => (
                        <div key={f.key} className="flex items-start gap-2.5 px-3.5 py-2.5">
                          <span className="mt-0.5 shrink-0 text-[11px]">✅</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-semibold" style={{ color: "#555" }}>{f.label}</p>
                            <p className="text-[11px] leading-relaxed" style={{ color: "#111" }}>{briefing.dealQualification![f.key]}</p>
                          </div>
                        </div>
                      ))}
                      {missing.length > 0 && (
                        <div className="px-3.5 py-2.5" style={{ background: "#fffbfb" }}>
                          <p className="text-[10px] font-semibold mb-1.5" style={{ color: "#aaa" }}>À collecter</p>
                          <div className="flex flex-wrap gap-1.5">
                            {missing.map((f) => (
                              <span key={f.key} className="text-[10px] px-2 py-0.5 rounded-full border" style={{ background: "#fff", borderColor: "#fecaca", color: "#dc2626" }}>
                                {f.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Actions */}
        {briefingState === "done" && briefing && selectedEvent && (
          <div className="px-4 py-3 border-t space-y-2" style={{ borderColor: "#eee" }}>
            <button
              onClick={sendToSlack}
              disabled={sendingSlack || slackSent || !slackName}
              className="w-full flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg transition-colors disabled:opacity-50"
              style={{ background: slackSent ? "#f0fdf4" : "#f5f5f5", color: slackSent ? "#166534" : "#333" }}
              title={!slackName ? "Configurez votre nom Slack dans Admin" : undefined}
            >
              <Send size={12} />
              {slackSent ? "Envoyé en DM Slack" : sendingSlack ? "Envoi…" : !slackName ? "User Slack non défini" : "Envoyer en DM Slack"}
            </button>
            <button
              onClick={createDraft}
              className="w-full flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg transition-colors"
              style={{ background: draftSent ? "#f0fdf4" : "#f5f5f5", color: draftSent ? "#166534" : "#333" }}
            >
              <Mail size={12} />
              {draftSent ? "Téléchargé" : "Télécharger le debrief (.txt)"}
            </button>
            <button
              onClick={() => selectEvent(selectedEvent, true)}
              className="w-full flex items-center justify-center gap-1.5 text-xs py-2 rounded-lg transition-colors"
              style={{ background: "#f5f5f5", color: "#555", border: "1px solid #ddd" }}
            >
              <Globe size={12} />
              Régénérer le briefing
            </button>
          </div>
        )}
      </div>

    </div>
    </>
  );
}
