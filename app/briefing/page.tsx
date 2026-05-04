"use client";

import { useState } from "react";
import { useCalendarEvents } from "@/lib/hooks/use-calendar-events";
import { useUserMe } from "@/lib/hooks/use-user-me";
import { Calendar } from "lucide-react";
import type { CalendarEvent } from "@/lib/google-calendar";
import { AskClaude } from "@/components/ask-claude";
import { COLORS } from "@/lib/design/tokens";
import { ScrollText } from "lucide-react";

import {
  BriefingResult,
  GatheredData,
  LoadState,
  externalAttendees,
  companyFromEmail,
  formatBriefingForSlack,
} from "./_helpers";
import { CalendarWeek } from "./_components/calendar-week";
import { MeetingSidebar } from "./_components/meeting-sidebar";
import { BriefingActions } from "./_components/briefing-actions";
import { BriefingHeader } from "./_components/briefing-header";
import { BriefingObjective } from "./_components/briefing-objective";
import { BriefingContext } from "./_components/briefing-context";
import { BriefingDealSummary } from "./_components/briefing-deal-summary";
import { BriefingTakeaways } from "./_components/briefing-takeaways";
import { BriefingCompanyProfile } from "./_components/briefing-company-profile";
import { BriefingCompanyLinkedin } from "./_components/briefing-company-linkedin";
import { BriefingNews } from "./_components/briefing-news";
import { BriefingPerson } from "./_components/briefing-person";

export default function BriefingPage() {
  const { events, calendarConnected, isLoading: loadingEvents } = useCalendarEvents(7);
  const { slackName } = useUserMe();
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [gatherState, setGatherState] = useState<LoadState>("idle");
  const [briefingState, setBriefingState] = useState<LoadState>("idle");
  const [rawData, setRawData] = useState<GatheredData | null>(null);
  const [briefing, setBriefing] = useState<BriefingResult | null>(null);
  const [sendingSlack, setSendingSlack] = useState(false);
  const [slackSent, setSlackSent] = useState(false);
  const [draftSent, setDraftSent] = useState(false);
  const [askOpen, setAskOpen] = useState(false);

  async function selectEvent(event: CalendarEvent, forceRefresh = false) {
    setSelectedEvent(event);
    setBriefing(null);
    setRawData(null);
    setSlackSent(false);
    setDraftSent(false);
    setAskOpen(false);

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
    const content = formatBriefingForSlack(briefing, selectedEvent.title)
      .replace(/\*/g, "")
      .replace(/_/g, "");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Debrief - ${selectedEvent.title}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setDraftSent(true);
  }

  function backToCalendar() {
    setSelectedEvent(null);
    setBriefing(null);
    setRawData(null);
    setGatherState("idle");
    setBriefingState("idle");
    setAskOpen(false);
  }

  // ── Render: no event selected → calendar week view ──────────────────────────
  if (!selectedEvent) {
    return (
      <div className="flex flex-col h-full" style={{ background: COLORS.bgPage }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 24px",
            background: COLORS.bgCard,
            borderBottom: `1px solid ${COLORS.line}`,
          }}
        >
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: COLORS.ink0, margin: 0, letterSpacing: "-0.01em" }}>
              Meetings à venir
            </h1>
            <p style={{ fontSize: 12, color: COLORS.ink3, margin: 0, marginTop: 2 }}>7 prochains jours</p>
          </div>
          <Calendar size={18} style={{ color: COLORS.ink3 }} />
        </div>
        <div className="flex-1" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <CalendarWeek
            events={events}
            loading={loadingEvents}
            calendarConnected={calendarConnected}
            onSelectEvent={selectEvent}
          />
        </div>
      </div>
    );
  }

  // ── Render: event selected → maquette layout ────────────────────────────────
  const showLoading = gatherState === "loading" || (gatherState === "done" && briefingState === "loading");
  const showError = gatherState === "error";
  const briefingReady = briefingState === "done" && briefing && briefing.identity;
  const briefingIncomplete = briefingState === "done" && briefing && !briefing.identity;

  return (
    <>
      <div className="flex h-full" style={{ background: COLORS.bgPage, overflow: "hidden" }}>
        <MeetingSidebar
          events={events}
          selectedId={selectedEvent.id}
          onSelect={(e) => selectEvent(e)}
          onBackToCalendar={backToCalendar}
        />

        <div className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
          {briefingReady && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 12,
                padding: "12px 24px",
                background: COLORS.bgCard,
                borderBottom: `1px solid ${COLORS.line}`,
              }}
            >
              <BriefingActions
                onRefresh={() => selectEvent(selectedEvent, true)}
                onSendSlack={sendToSlack}
                sendingSlack={sendingSlack}
                slackSent={slackSent}
                slackName={slackName}
              />
            </div>
          )}

          <div className="flex-1 overflow-y-auto thin-scrollbar" style={{ padding: "20px 24px" }}>
            <div style={{ maxWidth: 1280, margin: "0 auto" }}>
            {/* Loading: gather */}
            {gatherState === "loading" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {["HubSpot CRM…", "Gmail…", "Slack…", "Web…"].map((src) => (
                  <div
                    key={src}
                    className="animate-pulse"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: 14,
                      borderRadius: 12,
                      border: `1px solid ${COLORS.line}`,
                      background: COLORS.bgSoft,
                    }}
                  >
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#f5f5f5" }} />
                    <p style={{ fontSize: 12, color: COLORS.ink4, margin: 0 }}>Recherche dans {src}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Loading: synthesize */}
            {gatherState === "done" && briefingState === "loading" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: 16,
                  borderRadius: 12,
                  border: `1px solid ${COLORS.brandTint}`,
                  background: COLORS.brandTintSoft,
                }}
              >
                <div className="animate-ping" style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS.brand }} />
                <p style={{ fontSize: 12, color: "#c01252", margin: 0 }}>Claude analyse les données…</p>
              </div>
            )}

            {/* Error */}
            {showError && (
              <div
                style={{
                  padding: 16,
                  borderRadius: 12,
                  border: "1px solid #fecaca",
                  background: "#fef2f2",
                  color: "#991b1b",
                  fontSize: 13,
                }}
              >
                Erreur lors de la récupération des données. Réessaie dans un moment.
              </div>
            )}

            {/* Briefing incomplete from cache */}
            {briefingIncomplete && (
              <div
                style={{
                  padding: 14,
                  borderRadius: 12,
                  border: "1px solid #fde68a",
                  background: "#fffbeb",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  fontSize: 13,
                  color: "#92400e",
                }}
              >
                <ScrollText size={16} />
                Le briefing en cache est incomplet. Clique sur <strong>Rafraîchir</strong> pour relancer l&apos;analyse.
              </div>
            )}

            {/* Briefing ready: header + objective + 2-col body */}
            {briefingReady && (
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <BriefingHeader
                  selectedEvent={selectedEvent}
                  briefing={briefing!}
                  rawData={rawData}
                  onAskAI={() => setAskOpen((v) => !v)}
                  onDownloadDraft={createDraft}
                  onLinkedIn={() => {
                    document.getElementById("briefing-person-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                />

                {briefing!.objective && <BriefingObjective objective={briefing!.objective} />}

                {briefing!.isSalesMeeting !== false && <BriefingDealSummary rawData={rawData} />}

                {/* Data sources summary */}
                {rawData && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {[
                      { label: `${rawData.contacts.length} contact${rawData.contacts.length > 1 ? "s" : ""} HubSpot`, active: rawData.contacts.length > 0 },
                      ...(briefing!.isSalesMeeting !== false ? [{ label: `${rawData.deals.length} deal${rawData.deals.length > 1 ? "s" : ""}`, active: rawData.deals.length > 0 }] : []),
                      { label: `${rawData.gmailMessages.length} email${rawData.gmailMessages.length > 1 ? "s" : ""}`, active: rawData.gmailMessages.length > 0 },
                      { label: `${rawData.slackMessages.length} Slack`, active: rawData.slackMessages.length > 0 },
                      { label: `${rawData.webResults.length} web`, active: rawData.webResults.length > 0 },
                    ].map(({ label, active }) => (
                      <span
                        key={label}
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: active ? COLORS.okBg : COLORS.bgSoft,
                          color: active ? COLORS.ok : COLORS.ink4,
                          border: `1px solid ${active ? "#bbf7d0" : COLORS.line}`,
                        }}
                      >
                        {label}
                      </span>
                    ))}
                    {rawData.cached && (
                      <span
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: COLORS.warnBg,
                          color: COLORS.warn,
                          border: "1px solid #fde68a",
                        }}
                      >
                        Cache
                      </span>
                    )}
                  </div>
                )}

                {/* 2-column body */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)",
                    gap: 18,
                    alignItems: "flex-start",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <BriefingContext briefing={briefing!} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {briefing!.meetingTakeaways && briefing!.meetingTakeaways.length > 0 && (
                      <BriefingTakeaways takeaways={briefing!.meetingTakeaways} />
                    )}
                    <BriefingCompanyProfile briefing={briefing!} />
                    <BriefingCompanyLinkedin briefing={briefing!} />
                    <BriefingNews briefing={briefing!} />
                    <div id="briefing-person-section">
                      <BriefingPerson briefing={briefing!} />
                    </div>
                  </div>
                </div>

                {askOpen && (
                  <div>
                    <AskClaude
                      context={{
                        meeting: selectedEvent.title,
                        briefing,
                        rawData: rawData
                          ? {
                              contacts: rawData.contacts,
                              deals: rawData.deals,
                              engagements: rawData.engagements,
                              company: rawData.companyHubspot,
                              gmailMessages: rawData.gmailMessages,
                              slackMessages: rawData.slackMessages,
                              webResults: rawData.webResults,
                            }
                          : undefined,
                      }}
                      placeholder="Poser une question sur ce meeting…"
                    />
                  </div>
                )}

                {draftSent && (
                  <p style={{ fontSize: 11, color: COLORS.ok, textAlign: "center", margin: 0 }}>
                    Debrief téléchargé ✓
                  </p>
                )}

                {showLoading && !briefingReady && (
                  <div style={{ height: 20 }} />
                )}
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
