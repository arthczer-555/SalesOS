"use client";

import * as React from "react";
import { Eye, Linkedin, Mail, MessageSquare, Phone, SquareCheckBig, UserPlus } from "lucide-react";
import type { TagTone } from "@/components/ui/tag";
import { Tag } from "@/components/ui/tag";
import type { CampaignStatus, ContactStatus, ContentStatus, EnrollmentStatus, StepKind } from "@/lib/prospecting/types";
import { COLORS } from "@/lib/design/tokens";

type IconType = React.ComponentType<{ size?: number | string; style?: React.CSSProperties; strokeWidth?: number }>;

export const STEP_ICONS: Record<StepKind, IconType> = {
  email: Mail,
  linkedin_visit: Eye,
  linkedin_invite: UserPlus,
  linkedin_message: MessageSquare,
  call: Phone,
  task: SquareCheckBig,
};

export const STEP_COLORS: Record<StepKind, { fg: string; bg: string }> = {
  email: { fg: COLORS.brand, bg: COLORS.brandTint },
  linkedin_visit: { fg: "#0a66c2", bg: "#e8f1fb" },
  linkedin_invite: { fg: "#0a66c2", bg: "#e8f1fb" },
  linkedin_message: { fg: "#0a66c2", bg: "#e8f1fb" },
  call: { fg: COLORS.ok, bg: COLORS.okBg },
  task: { fg: COLORS.info, bg: COLORS.infoBg },
};

export function StepKindIcon({ kind, size = 30 }: { kind: StepKind; size?: number }) {
  const Icon = STEP_ICONS[kind];
  const c = STEP_COLORS[kind];
  return (
    <span
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: Math.round(size * 0.32),
        display: "inline-grid",
        placeItems: "center",
        background: c.bg,
        color: c.fg,
        position: "relative",
      }}
    >
      <Icon size={Math.round(size * 0.5)} />
      {kind.startsWith("linkedin") ? (
        <span style={{ position: "absolute", right: -3, bottom: -3, background: "#fff", borderRadius: 4, display: "grid", placeItems: "center", padding: 1 }}>
          <Linkedin size={Math.max(9, Math.round(size * 0.3))} style={{ color: "#0a66c2" }} />
        </span>
      ) : null}
    </span>
  );
}

export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; tone: TagTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Running", tone: "ok" },
  paused: { label: "Paused", tone: "warn" },
  completed: { label: "Completed", tone: "info" },
  archived: { label: "Archived", tone: "neutral" },
};

export const ENROLLMENT_STATUS: Record<EnrollmentStatus, { label: string; tone: TagTone }> = {
  pending: { label: "Not started", tone: "neutral" },
  active: { label: "In sequence", tone: "brand" },
  paused: { label: "Paused", tone: "warn" },
  replied: { label: "Replied", tone: "ok" },
  completed: { label: "Finished", tone: "info" },
  bounced: { label: "Bounced", tone: "err" },
  unsubscribed: { label: "Unsubscribed", tone: "err" },
  stopped: { label: "Stopped", tone: "neutral" },
  error: { label: "Error", tone: "err" },
};

export const CONTENT_STATUS: Record<ContentStatus, { label: string; tone: TagTone }> = {
  none: { label: "No messages", tone: "neutral" },
  queued: { label: "Queued", tone: "info" },
  generating: { label: "Writing...", tone: "info" },
  ready: { label: "Ready", tone: "ok" },
  error: { label: "Failed", tone: "err" },
  outdated: { label: "Outdated", tone: "warn" },
};

export const CONTACT_STATUS: Record<ContactStatus, { label: string; tone: TagTone }> = {
  new: { label: "New", tone: "neutral" },
  in_sequence: { label: "In sequence", tone: "brand" },
  replied: { label: "Replied", tone: "ok" },
  interested: { label: "Interested", tone: "ok" },
  meeting: { label: "Meeting", tone: "solid" },
  not_interested: { label: "Not interested", tone: "neutral" },
  bounced: { label: "Bounced", tone: "err" },
  unsubscribed: { label: "Unsubscribed", tone: "err" },
  do_not_contact: { label: "Do not contact", tone: "err" },
};

export function StatusTag<T extends string>({ map, value, size }: { map: Record<T, { label: string; tone: TagTone }>; value: T; size?: "sm" | "md" }) {
  const m = map[value];
  if (!m) return null;
  return (
    <Tag tone={m.tone} dot={m.tone !== "solid"} size={size}>
      {m.label}
    </Tag>
  );
}

export function PersonaChip({ name, color }: { name: string | null; color?: string | null }) {
  if (!name) return <span style={{ fontSize: 12, color: COLORS.ink4 }}>Custom audience</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: COLORS.ink1, whiteSpace: "nowrap" }}>
      <span style={{ width: 8, height: 8, borderRadius: 3, background: color ?? COLORS.brand }} />
      {name}
    </span>
  );
}

/** Pastille de nombre avec erreur explicite quand la donnée n'a pas pu être chargée. */
export function MetricValue({ value, error, suffix }: { value: number | string | null | undefined; error?: boolean; suffix?: string }) {
  if (error || value === null || value === undefined) {
    return (
      <span title="This number could not be loaded" style={{ color: COLORS.err, fontWeight: 700 }}>
        Error
      </span>
    );
  }
  return (
    <>
      {typeof value === "number" ? value.toLocaleString("en-US") : value}
      {suffix}
    </>
  );
}
