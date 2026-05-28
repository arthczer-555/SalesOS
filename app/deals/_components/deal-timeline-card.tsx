"use client";

import * as React from "react";
import Link from "next/link";
import {
  Video,
  Flag,
  Sparkles,
  FileText,
  FileSignature,
  Star,
  AlertTriangle,
  Send,
  CheckCircle2,
  Users,
  Circle,
  type LucideIcon,
} from "lucide-react";
import { COLORS, meetingKindBadgeStyle } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import {
  meetingKindBadge,
  type AnalysisEvent,
  type AnalysisEventType,
  type DealEvent,
  type DealMeeting,
} from "../_helpers";

interface TimelineItem {
  key: string;
  ts: number;
  dateLabel: string;
  label: string;
  fullTitle: string;
  icon: LucideIcon;
  fg: string;
  bg: string;
  score?: number | null;
  href?: string;
}

const COL_WIDTH = 116;

// Style (icône + couleurs) par type d'événement clé extrait par l'IA.
const AI_EVENT_STYLE: Record<AnalysisEventType, { icon: LucideIcon; fg: string; bg: string }> = {
  devis: { icon: FileText, fg: "#0369a1", bg: "#e0f2fe" },
  contrat: { icon: FileSignature, fg: COLORS.ok, bg: COLORS.okBg },
  echange_important: { icon: Star, fg: COLORS.brand, bg: COLORS.brandTint },
  objection: { icon: AlertTriangle, fg: COLORS.err, bg: COLORS.errBg },
  relance: { icon: Send, fg: COLORS.ink2, bg: COLORS.bgSoft },
  decision: { icon: CheckCircle2, fg: COLORS.ok, bg: COLORS.okBg },
  reunion: { icon: Users, fg: COLORS.warn, bg: COLORS.warnBg },
  autre: { icon: Circle, fg: COLORS.ink2, bg: COLORS.bgSoft },
};

function shortDate(ts: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" });
}

function eventToItem(e: DealEvent, i: number): TimelineItem {
  const ts = e.iso ? new Date(e.iso).getTime() : 0;
  const isCreated = e.kind === "created";
  return {
    key: `ev-${i}`,
    ts: Number.isNaN(ts) ? 0 : ts,
    dateLabel: shortDate(ts),
    label: e.label,
    fullTitle: e.label,
    icon: isCreated ? Sparkles : Flag,
    fg: isCreated ? COLORS.ink3 : COLORS.info,
    bg: isCreated ? COLORS.bgSoft : COLORS.infoBg,
  };
}

function meetingToItem(m: DealMeeting): TimelineItem {
  const ts = m.meeting_started_at ? new Date(m.meeting_started_at).getTime() : 0;
  const { fg, bg } = meetingKindBadgeStyle(m.meeting_kind);
  return {
    key: `m-${m.id}`,
    ts: Number.isNaN(ts) ? 0 : ts,
    dateLabel: shortDate(ts),
    label: meetingKindBadge(m.meeting_kind),
    fullTitle: m.meeting_title ?? "Réunion Claap",
    icon: Video,
    fg,
    bg,
    score: m.score_global,
    href: `/sales-coach?id=${m.id}`,
  };
}

function aiEventToItem(e: AnalysisEvent, i: number): TimelineItem | null {
  const ts = e.date ? new Date(e.date).getTime() : NaN;
  if (Number.isNaN(ts)) return null; // pas de date fiable -> on n'affiche pas
  const style = AI_EVENT_STYLE[e.type] ?? AI_EVENT_STYLE.autre;
  return {
    key: `ai-${i}`,
    ts,
    dateLabel: shortDate(ts),
    label: e.label,
    fullTitle: e.description ? `${e.label} — ${e.description}` : e.label,
    icon: style.icon,
    fg: style.fg,
    bg: style.bg,
  };
}

function Col({ item }: { item: TimelineItem }) {
  const Icon = item.icon;
  const inner = (
    <>
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 999,
          background: item.bg,
          color: item.fg,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: `2px solid ${COLORS.bgCard}`,
          zIndex: 1,
        }}
      >
        <Icon size={14} strokeWidth={2.25} />
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: COLORS.ink0,
          marginTop: 8,
          lineHeight: 1.3,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}
      >
        {item.label}
      </span>
      {item.dateLabel && (
        <span style={{ fontSize: 10, color: COLORS.ink3, marginTop: 2 }}>{item.dateLabel}</span>
      )}
      {item.score != null && (
        <span style={{ fontSize: 10, color: COLORS.ink3 }}>{item.score}/10</span>
      )}
    </>
  );

  const colStyle: React.CSSProperties = {
    width: COL_WIDTH,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    padding: "0 4px",
    textDecoration: "none",
    color: "inherit",
  };

  if (item.href) {
    return (
      <Link href={item.href} style={colStyle} title={item.fullTitle}>
        {inner}
      </Link>
    );
  }
  return (
    <div style={colStyle} title={item.fullTitle}>
      {inner}
    </div>
  );
}

export function DealEventsTimeline({
  events,
  meetings,
  analysisEvents,
}: {
  events: DealEvent[];
  meetings: DealMeeting[];
  analysisEvents?: AnalysisEvent[];
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const items = React.useMemo(() => {
    // Dédoublonne les events IA (scoring + analyse peuvent produire le même
    // événement) par date + label normalisés.
    const seen = new Set<string>();
    const dedupedAi = (analysisEvents ?? []).filter((e) => {
      const key = `${e.date}|${(e.label ?? "").trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const merged: TimelineItem[] = [
      ...(events ?? []).map(eventToItem),
      ...(meetings ?? []).map(meetingToItem),
      ...dedupedAi.map(aiEventToItem).filter((it): it is TimelineItem => it !== null),
    ];
    // Ordre chronologique (ancien → récent, gauche → droite) pour retracer le
    // parcours du deal. Items sans date poussés au début.
    merged.sort((a, b) => a.ts - b.ts);
    return merged;
  }, [events, meetings, analysisEvents]);

  // Au montage / changement de deal, scroll vers la fin pour montrer l'état le
  // plus récent (à droite).
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [items]);

  if (items.length === 0) {
    return (
      <Card padding={16}>
        <SectionHeader title="Timeline" />
        <div style={{ fontSize: 12, color: COLORS.ink3, fontStyle: "italic" }}>
          Aucun événement marquant sur ce deal.
        </div>
      </Card>
    );
  }

  return (
    <Card padding={16}>
      <SectionHeader title={`Timeline (${items.length})`} />
      <div ref={scrollRef} style={{ overflowX: "auto", paddingBottom: 4, marginTop: 4 }}>
        <div style={{ position: "relative", display: "flex", width: "max-content", paddingTop: 2 }}>
          {/* Rail horizontal reliant les pastilles (entre le 1er et le dernier point) */}
          {items.length > 1 && (
            <div
              style={{
                position: "absolute",
                left: COL_WIDTH / 2,
                right: COL_WIDTH / 2,
                top: 16,
                height: 2,
                background: COLORS.line,
              }}
            />
          )}
          {items.map((item) => (
            <Col key={item.key} item={item} />
          ))}
        </div>
      </div>
    </Card>
  );
}
