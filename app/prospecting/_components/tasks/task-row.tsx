"use client";

import * as React from "react";
import { AlarmClock, CalendarCheck, Check, ChevronDown, ExternalLink, MessageSquareReply, Phone, PhoneMissed, PhoneOff, SkipForward, Voicemail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, type DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { Tag } from "@/components/ui/tag";
import { COLORS } from "@/lib/design/tokens";
import type { TaskListItem, TaskOutcome } from "@/lib/prospecting/types";
import { TaskContent } from "./task-content";
import {
  OUTCOME_LABELS,
  SNOOZE_LABELS,
  contactName,
  contactSubtitle,
  contentBlocks,
  dueLabel,
  isLinkedInTask,
  kindMeta,
  linkedinHref,
  outcomesFor,
  snoozeHint,
  telHref,
  type SnoozePreset,
} from "./task-utils";

const OUTCOME_ICONS: Record<TaskOutcome, React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>> = {
  done: Check,
  connected: Phone,
  no_answer: PhoneMissed,
  voicemail: Voicemail,
  replied: MessageSquareReply,
  meeting_booked: CalendarCheck,
};

const TONE_COLOR = { err: COLORS.err, warn: COLORS.warn, neutral: COLORS.ink3, ok: COLORS.ok } as const;

export interface TaskActions {
  onComplete: (item: TaskListItem, outcome: TaskOutcome) => void;
  onSkip: (item: TaskListItem) => void;
  onSnooze: (item: TaskListItem, preset: SnoozePreset) => void;
}

/** Bouton d'ouverture : profil LinkedIn (ou recherche) / numéro pour un appel. */
export function TaskOpenButton({ item, size = "sm" }: { item: TaskListItem; size?: "sm" | "md" }) {
  const kind = item.touch.kind;
  if (kind === "call") {
    const tel = telHref(item.contact.phone);
    if (!tel) {
      return (
        <Button size={size} variant="secondary" icon={PhoneOff} disabled title="No phone number on this prospect">
          No phone
        </Button>
      );
    }
    return (
      <a href={tel} className={`ch-btn ${size === "sm" ? "ch-btn-sm" : ""}`} title={item.contact.phone ?? undefined}>
        <Phone size={size === "sm" ? 13 : 14} />
        {item.contact.phone}
      </a>
    );
  }
  if (isLinkedInTask(kind) || kind === "task") {
    const { href, isSearch } = linkedinHref(item.contact);
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={`ch-btn ${size === "sm" ? "ch-btn-sm" : ""}`}
        title={isSearch ? "No LinkedIn URL saved: opens a LinkedIn search" : "Open their LinkedIn profile"}
      >
        <ExternalLink size={size === "sm" ? 13 : 14} />
        {isSearch ? "Find on LinkedIn" : "Open LinkedIn"}
      </a>
    );
  }
  return null;
}

export function TaskRow({ item, actions, busy }: { item: TaskListItem; actions: TaskActions; busy: boolean }) {
  const t = item.touch;
  const meta = kindMeta(t.kind);
  const KindIcon = meta.icon;
  const name = contactName(item.contact);
  const due = dueLabel(item);
  const closed = item.bucket === "done";
  const blocks = contentBlocks(t.kind, t.body, t.subject);
  const canSnooze = t.status === "due";

  const outcomeItems: DropdownMenuItem[] = outcomesFor(t.kind).map((o) => ({
    key: o,
    label: OUTCOME_LABELS[o],
    icon: OUTCOME_ICONS[o],
    description: o === "replied" || o === "meeting_booked" ? "Stops the sequence for this prospect" : undefined,
    onSelect: () => actions.onComplete(item, o),
  }));

  return (
    <div
      className="ds-rise"
      style={{
        display: "flex",
        gap: 12,
        padding: "14px 16px",
        borderTop: `1px solid ${COLORS.line}`,
        opacity: closed ? 0.72 : 1,
        background: "#fff",
      }}
    >
      <PersonAvatar name={name} size={36} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.ink0 }}>{name}</span>
              <Tag tone={t.kind === "call" ? "info" : isLinkedInTask(t.kind) ? "brand" : "neutral"} icon={KindIcon} size="sm">
                {meta.label}
              </Tag>
              {item.waitForCompletion && !closed ? (
                <Tag tone="warn" size="sm" title="The sequence waits until this task is done">
                  Blocks sequence
                </Tag>
              ) : null}
              {closed && t.task_outcome ? (
                <Tag tone={t.status === "skipped" ? "neutral" : "ok"} size="sm">
                  {t.status === "skipped" ? "Skipped" : OUTCOME_LABELS[t.task_outcome as TaskOutcome] ?? t.task_outcome}
                </Tag>
              ) : null}
            </div>
            <div style={{ fontSize: 12, color: COLORS.ink3, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {contactSubtitle(item.contact) || "No title"}
            </div>
            <div style={{ fontSize: 12, color: COLORS.ink3, marginTop: 2 }}>
              <span style={{ color: COLORS.ink2, fontWeight: 600 }}>{item.campaign.name}</span>
              {" · "}Step {item.stepPosition} of {item.stepCount || item.stepPosition}
              {item.enrollmentStatus === "paused" ? " · Sequence paused" : ""}
            </div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: TONE_COLOR[due.tone], whiteSpace: "nowrap", paddingTop: 2 }}>{due.text}</div>
        </div>

        {!closed ? <TaskContent blocks={blocks} idPrefix={t.id} /> : null}
        {closed && t.task_note ? <div style={{ fontSize: 12, color: COLORS.ink2 }}>Note: {t.task_note}</div> : null}

        {!closed ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <TaskOpenButton item={item} />
            <div style={{ flex: 1 }} />
            {t.kind !== "call" ? (
              <Button size="sm" variant="primary" icon={Check} loading={busy} onClick={() => actions.onComplete(item, "done")}>
                {t.status === "due" ? "Done" : "Done early"}
              </Button>
            ) : null}
            <DropdownMenu
              width={240}
              trigger={({ toggle, ref }) => (
                <Button
                  ref={ref}
                  size="sm"
                  variant={t.kind === "call" ? "primary" : "secondary"}
                  iconRight={ChevronDown}
                  disabled={busy}
                  onClick={toggle}
                >
                  {t.kind === "call" ? "Log call" : "Outcome"}
                </Button>
              )}
              groups={[
                { label: "Outcome", items: outcomeItems },
                { items: [{ key: "skip", label: "Skip this step", icon: SkipForward, onSelect: () => actions.onSkip(item) }] },
              ]}
            />
            {canSnooze ? (
              <DropdownMenu
                width={220}
                trigger={({ toggle, ref }) => (
                  <Button ref={ref} size="sm" variant="ghost" icon={AlarmClock} disabled={busy} onClick={toggle} aria-label="Snooze" title="Snooze" />
                )}
                groups={[
                  {
                    label: "Snooze until",
                    items: (Object.keys(SNOOZE_LABELS) as SnoozePreset[]).map((p) => ({
                      key: p,
                      label: SNOOZE_LABELS[p],
                      description: `${snoozeHint(p)}, 9:00`,
                      onSelect: () => actions.onSnooze(item, p),
                    })),
                  },
                ]}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
