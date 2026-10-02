"use client";

import Link from "next/link";
import { ExternalLink, Video } from "lucide-react";
import { Card, CardHeader } from "./ui";
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

function DiscoveredRow({
  r,
  onDecline,
  declining,
}: {
  r: DiscoveredRecording;
  onDecline?: (r: DiscoveredRecording) => void;
  declining?: boolean;
}) {
  const title = (
    <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{r.meeting_title ?? "Untitled meeting"}</span>
  );
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: "12px 16px",
        borderBottom: `1px solid ${COLORS.line}`,
        alignItems: "flex-start",
      }}
    >
      <div style={{ fontSize: 11, color: COLORS.ink3, width: 80, flexShrink: 0, paddingTop: 2 }}>
        {fmtDate(r.meeting_started_at)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {r.claap_url ? (
            <a href={r.claap_url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>
              {title}
              <ExternalLink size={11} style={{ color: COLORS.ink4 }} />
            </a>
          ) : (
            title
          )}
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
            title="Matched on Claap by participant domain or title, added automatically"
          >
            auto-matched
          </span>
        </div>
        <div style={{ fontSize: 11, color: COLORS.ink3, marginTop: 2 }}>
          Found on Claap by participant domain or title
          {onDecline && (
            <>
              {" · "}
              <button type="button" className="ch-link" style={{ fontSize: 11 }} disabled={declining} onClick={() => onDecline(r)}>
                {declining ? "Removing…" : "Not this account"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function TimelinePanel({
  meetings,
  discoveredRecordings = [],
  onDecline,
  decliningId,
}: {
  meetings: ClientMeeting[];
  discoveredRecordings?: DiscoveredRecording[];
  onDecline?: (r: DiscoveredRecording) => void;
  decliningId?: string | null;
}) {
  // Dédoublonne par recording_id (au cas où) : on garde la version indexed
  // qui a plus d'info.
  const indexedIds = new Set(meetings.map((m) => m.claap_recording_id));
  const dedupedDiscovered = discoveredRecordings.filter((r) => !indexedIds.has(r.recording_id));

  const items: TimelineItem[] = [
    ...meetings.map((m) => ({ kind: "indexed" as const, data: m })),
    ...dedupedDiscovered.map((r) => ({ kind: "discovered" as const, data: r })),
  ];

  // Tri global par date desc, sans date en fin de liste.
  items.sort((a, b) => {
    const da = itemDate(a) ? new Date(itemDate(a)!).getTime() : 0;
    const db = itemDate(b) ? new Date(itemDate(b)!).getTime() : 0;
    return db - da;
  });

  const indexedCount = items.filter((i) => i.kind === "indexed").length;
  const discoveredCount = items.filter((i) => i.kind === "discovered").length;

  return (
    <Card id="k-meetings" padding="18px 20px 6px" style={{ scrollMarginTop: 64 }}>
      <CardHeader
        icon={Video}
        title={`Meetings (${items.length})`}
        meta={discoveredCount > 0 ? `${indexedCount} analyzed · ${discoveredCount} auto-matched` : "Claap"}
        style={{ marginBottom: 6 }}
      />
      {items.length === 0 ? (
        <div style={{ color: COLORS.ink3, fontSize: 13, padding: "8px 0 14px" }}>No Claap meeting found for this account yet.</div>
      ) : (
        <div style={{ margin: "0 -20px" }}>
          {items.map((it) =>
            it.kind === "indexed" ? (
              <IndexedRow key={`i-${it.data.id}`} m={it.data} />
            ) : (
              <DiscoveredRow
                key={`d-${it.data.recording_id}`}
                r={it.data}
                onDecline={onDecline}
                declining={decliningId === it.data.recording_id}
              />
            ),
          )}
        </div>
      )}
    </Card>
  );
}
