"use client";

import * as React from "react";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import {
  COMMITTEE_ROLES,
  requiredThreads,
  retroplan,
  THREADS_BIG_DEAL_THRESHOLD,
  type CommitteeStatus,
  type DealCommittee,
  type DealThreading,
} from "@/lib/deals/kuna";
import type { Stage } from "../_helpers";
import { timeAgo } from "../_helpers";
import { BlockTitle } from "./kuna-ui";

const GO_LIVE_QUESTION =
  "“If everything goes well on our side, when would you like your first employees to have access to Coachello?”";

const COMMITTEE_STATUS_LABEL: Record<CommitteeStatus, string> = {
  talked: "talked",
  known: "known, never met",
  unknown: "not identified",
};

function StatusDot({ status, danger }: { status: CommitteeStatus; danger?: boolean }) {
  const base: React.CSSProperties = { width: 12, height: 12, borderRadius: "50%", flexShrink: 0, boxSizing: "border-box", marginTop: 3 };
  if (danger) return <span aria-hidden="true" style={{ ...base, background: "#b91c1c" }} />;
  if (status === "talked") return <span aria-hidden="true" style={{ ...base, background: "#16a34a" }} />;
  if (status === "known") return <span aria-hidden="true" style={{ ...base, background: "#fff", border: "3px solid #f59e0b" }} />;
  return <span aria-hidden="true" style={{ ...base, background: "#fff", border: "2px dashed #dc2626" }} />;
}

// ─── Buying committee ──────────────────────────────────────────────────────

export function DealCommitteeCard({ committee }: { committee: DealCommittee }) {
  const byRole = new Map(committee.members.map((m) => [m.role, m]));
  return (
    <Card padding={20}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <BlockTitle title="Buying committee" subtitle="From HubSpot contacts, emails and Claap meetings" />
        {COMMITTEE_ROLES.map((r) => {
          const m = byRole.get(r.key);
          const status = m?.status ?? "unknown";
          const danger = r.key === "gatekeeper" && committee.championIsGatekeeper;
          return (
            <div key={r.key} style={{ display: "flex", gap: 12, alignItems: "flex-start", paddingTop: 12, borderTop: `1px solid ${COLORS.line}` }}>
              <StatusDot status={status} danger={danger} />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 11, color: COLORS.ink3 }}>{r.label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: m?.name ? COLORS.ink0 : COLORS.ink3 }}>
                  {m?.name ?? "Not identified"}
                </span>
                <span style={{ fontSize: 12, color: COLORS.ink2 }}>
                  {[m?.title, danger ? "also the champion" : committeeStatusLabel(status, !!m?.name)].filter(Boolean).join(" · ")}
                </span>
              </div>
            </div>
          );
        })}
        {committee.championIsGatekeeper && (
          <p style={{ margin: "2px 0 0", padding: "9px 11px", borderRadius: 8, background: COLORS.errBg, fontSize: 12, lineHeight: 1.5, color: "#991b1b" }}>
            The champion also controls access to the Economic Buyer. Test them: can they set up a call with the EB?
          </p>
        )}
      </div>
    </Card>
  );
}

function committeeStatusLabel(status: CommitteeStatus, hasName: boolean): string | null {
  if (!hasName) return null;
  // Nom avancé par l'IA mais rôle incertain.
  if (status === "unknown") return "not confirmed";
  return COMMITTEE_STATUS_LABEL[status];
}

// ─── Threading ─────────────────────────────────────────────────────────────

export function DealThreadingCard({ threading, amount }: { threading: DealThreading; amount: number }) {
  const needed = requiredThreads(amount);
  const count = threading.active.length;
  return (
    <Card padding={20}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <BlockTitle title="Threading" subtitle={`Active = wrote an email or joined a meeting in the last ${threading.windowDays} days`} />
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 36, fontWeight: 700, lineHeight: 1, color: COLORS.ink0, fontVariantNumeric: "tabular-nums" }}>{count}</span>
          <span style={{ fontSize: 13, color: COLORS.ink2 }}>
            active contact{count > 1 ? "s" : ""} out of {needed} needed
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }} aria-hidden="true">
          {Array.from({ length: Math.max(needed, count) }).map((_, i) => (
            <span
              key={i}
              style={{
                flex: 1,
                height: 8,
                borderRadius: 4,
                background: i < count ? "#16a34a" : "#f1f1f4",
                outline: i < count ? "none" : "1px dashed #d4d4d8",
                outlineOffset: -1,
              }}
            />
          ))}
        </div>
        {count > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {threading.active.slice(0, 6).map((a) => (
              <div key={a.email} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: COLORS.ink0, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.email}>
                  {a.name || a.email}
                </span>
                <span style={{ color: COLORS.ink2, flexShrink: 0 }}>
                  {a.via === "meeting" ? "meeting" : "email"} {timeAgo(a.lastInboundAt).toLowerCase()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: COLORS.ink2 }}>No reply from the prospect logged in the last {threading.windowDays} days.</p>
        )}
        <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: COLORS.ink3 }}>
          Deals above {THREADS_BIG_DEAL_THRESHOLD / 1000}k€ need 3 active contacts, one of them close to the Economic Buyer. 2 below.
        </p>
      </div>
    </Card>
  );
}

// ─── Retroplanning ─────────────────────────────────────────────────────────

export function DealRetroplanningCard({ goLiveDate }: { goLiveDate: string | null }) {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });

  if (!goLiveDate) {
    return (
      <Card padding={20}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <BlockTitle title="Retroplanning" subtitle="Built backwards from the go-live date" />
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>No go-live date from the prospect yet.</p>
          <p style={{ margin: 0, padding: "10px 12px", borderRadius: 8, background: COLORS.bgSoft, fontSize: 12, lineHeight: 1.5, color: COLORS.ink1 }}>
            Ask: {GO_LIVE_QUESTION} A date can be retroplanned. &ldquo;Maybe 2027&rdquo; is a deal without a deadline.
          </p>
        </div>
      </Card>
    );
  }

  const milestones = retroplan(goLiveDate);
  return (
    <Card padding={20}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <BlockTitle title="Retroplanning" subtitle={`Suggested, backwards from a go-live on ${fmt(goLiveDate)}`} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          {milestones.map((m) => (
            <div key={m.label} style={{ display: "flex", gap: 12, padding: "6px 0", opacity: m.past && m.kind !== "target" ? 0.55 : 1 }}>
              <span style={{ flexShrink: 0, width: 50, fontSize: 12, color: COLORS.ink1, paddingTop: 1, fontVariantNumeric: "tabular-nums" }}>
                {fmt(m.date)}
              </span>
              <span
                aria-hidden="true"
                style={{
                  flexShrink: 0,
                  width: 12,
                  height: 12,
                  marginTop: 3,
                  borderRadius: "50%",
                  boxSizing: "border-box",
                  background: "#fff",
                  border: m.kind === "target" ? `2px dashed ${COLORS.brand}` : `2px solid ${m.past ? COLORS.ink4 : COLORS.ink3}`,
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>
                  {m.label}
                  {m.past && m.kind !== "target" ? <span style={{ fontWeight: 400, color: COLORS.ink3 }}> · date passed</span> : null}
                </span>
                <span style={{ fontSize: 12, color: COLORS.ink2 }}>{m.note}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── Stage stepper ─────────────────────────────────────────────────────────

const shortStage = (label: string) => label.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();

export function DealStageStepper({ stages, currentStageId }: { stages: Stage[]; currentStageId: string }) {
  const current = stages.findIndex((s) => s.id === currentStageId);
  if (current < 0) return null;
  return (
    <div style={{ display: "flex", gap: 6 }} aria-label={`Stage ${current + 1} of ${stages.length}: ${stages[current].label}`}>
      {stages.map((s, i) => {
        const state = i < current ? "past" : i === current ? "now" : "next";
        return (
          <div key={s.id} title={s.label} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              style={{
                height: 5,
                borderRadius: 3,
                background: state === "past" ? COLORS.ink1 : state === "now" ? COLORS.brand : COLORS.line,
              }}
            />
            <span
              style={{
                fontSize: 11,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                color: state === "now" ? COLORS.brand : state === "past" ? COLORS.ink1 : COLORS.ink3,
                fontWeight: state === "now" ? 600 : 400,
              }}
            >
              {shortStage(s.label)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
