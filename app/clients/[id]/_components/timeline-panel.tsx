"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { DiscoveredRecording } from "@/lib/clients/types";

export type ClientMeeting = {
  id: string;
  claap_recording_id: string;
  meeting_title: string | null;
  meeting_started_at: string | null;
  meeting_kind: string | null;
  audience: string | null;
  recap_summary: string | null;
  score_global: number | null;
};

// Item unifié pour le rendu — provient soit de sales_coach_analyses (indexed)
// soit de la discovery Claap live (discovered). On les mélange dans la liste
// finale, triés par date desc, avec un tag visuel distinct.
type TimelineItem =
  | { kind: "indexed"; data: ClientMeeting }
  | { kind: "discovered"; data: DiscoveredRecording };

function itemDate(item: TimelineItem): string | null {
  if (item.kind === "indexed") return item.data.meeting_started_at;
  return item.data.meeting_started_at;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "?";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function IndexedRow({ m }: { m: ClientMeeting }) {
  return (
    <Link
      href={`/sales-coach?id=${m.id}`}
      style={{
        display: "flex",
        gap: 12,
        padding: "12px 16px",
        borderBottom: `1px solid ${COLORS.line}`,
        textDecoration: "none",
        color: "inherit",
        alignItems: "flex-start",
      }}
    >
      <div style={{ fontSize: 11, color: COLORS.ink3, width: 80, flexShrink: 0, paddingTop: 2 }}>
        {fmtDate(m.meeting_started_at)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>
          {m.meeting_title ?? "Untitled meeting"}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 2, alignItems: "center" }}>
          {m.meeting_kind && <span style={{ fontSize: 11, color: COLORS.ink3 }}>{m.meeting_kind}</span>}
          {m.audience && <span style={{ fontSize: 11, color: COLORS.ink3 }}>· {m.audience}</span>}
          {m.score_global != null && (
            <span style={{ fontSize: 11, color: COLORS.ink3 }}>· {m.score_global}/10</span>
          )}
        </div>
        {m.recap_summary && (
          <div
            style={{
              fontSize: 12,
              color: COLORS.ink2,
              marginTop: 6,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {m.recap_summary}
          </div>
        )}
      </div>
    </Link>
  );
}

function DiscoveredRow({ r }: { r: DiscoveredRecording }) {
  const content = (
    <>
      <div style={{ fontSize: 11, color: COLORS.ink3, width: 80, flexShrink: 0, paddingTop: 2 }}>
        {fmtDate(r.meeting_started_at)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>
            {r.meeting_title ?? "Untitled meeting"}
          </span>
          <span
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 4,
              background: COLORS.bgSoft,
              color: COLORS.ink3,
              fontWeight: 600,
              letterSpacing: 0.3,
            }}
            title="Found on Claap but not yet analyzed by Sales Coach"
          >
            discovered
          </span>
          {r.claap_url && <ExternalLink size={11} style={{ color: COLORS.ink4 }} />}
        </div>
        <div style={{ fontSize: 11, color: COLORS.ink3, marginTop: 2 }}>
          claap · {r.recording_id}
        </div>
      </div>
    </>
  );

  const wrapperStyle: React.CSSProperties = {
    display: "flex",
    gap: 12,
    padding: "12px 16px",
    borderBottom: `1px solid ${COLORS.line}`,
    textDecoration: "none",
    color: "inherit",
    alignItems: "flex-start",
  };

  if (r.claap_url) {
    return (
      <a href={r.claap_url} target="_blank" rel="noreferrer" style={wrapperStyle}>
        {content}
      </a>
    );
  }
  // Pas d'URL Claap : on rend en static (cas rare où Claap renvoie un
  // recording sans URL publique — on garde quand même la trace).
  return <div style={wrapperStyle}>{content}</div>;
}

export function TimelinePanel({
  meetings,
  discoveredRecordings = [],
}: {
  meetings: ClientMeeting[];
  discoveredRecordings?: DiscoveredRecording[];
}) {
  // Dédoublonne par recording_id (au cas où) — on garde la version indexed
  // qui a plus d'info.
  const indexedIds = new Set(meetings.map((m) => m.claap_recording_id));
  const dedupedDiscovered = discoveredRecordings.filter((r) => !indexedIds.has(r.recording_id));

  const items: TimelineItem[] = [
    ...meetings.map((m) => ({ kind: "indexed" as const, data: m })),
    ...dedupedDiscovered.map((r) => ({ kind: "discovered" as const, data: r })),
  ];

  // Tri global par date desc — sans date, on push à la fin.
  items.sort((a, b) => {
    const da = itemDate(a) ? new Date(itemDate(a)!).getTime() : 0;
    const db = itemDate(b) ? new Date(itemDate(b)!).getTime() : 0;
    return db - da;
  });

  if (items.length === 0) {
    return (
      <div
        style={{
          background: COLORS.bgCard,
          border: `1px solid ${COLORS.line}`,
          borderRadius: 12,
          padding: 20,
          color: COLORS.ink3,
          fontSize: 13,
          textAlign: "center",
        }}
      >
        No Claap meeting analyzed on this deal.
      </div>
    );
  }

  const indexedCount = items.filter((i) => i.kind === "indexed").length;
  const discoveredCount = items.filter((i) => i.kind === "discovered").length;

  return (
    <div
      style={{
        background: COLORS.bgCard,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${COLORS.line}`,
          background: COLORS.bgSoft,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: COLORS.ink0 }}>
          Meetings timeline ({items.length})
        </h3>
        {discoveredCount > 0 && (
          <span style={{ fontSize: 11, color: COLORS.ink3 }}>
            {indexedCount} analyzed · {discoveredCount} discovered
          </span>
        )}
      </div>
      <div>
        {items.map((it) =>
          it.kind === "indexed" ? (
            <IndexedRow key={`i-${it.data.id}`} m={it.data} />
          ) : (
            <DiscoveredRow key={`d-${it.data.recording_id}`} r={it.data} />
          ),
        )}
      </div>
    </div>
  );
}
