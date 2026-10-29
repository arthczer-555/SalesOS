"use client";

import * as React from "react";
import { ArrowDown, CheckCircle, RefreshCw } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import {
  CHAIN_LEVEL_LABELS,
  CONTROLLABLE_LABELS,
  EXECUTION_AXES,
  LOSS_REASONS,
  PHASE_LABELS,
  daysBetween,
  executionOverall,
  lossReasonLabel,
  type LossAnalysis,
  type LossChainStep,
  type LossExecution,
  type LossPhase,
  type LossReopen,
  type LostFacts,
  type PhaseKind,
} from "@/lib/deals/loss-analysis";
import { BlockTitle } from "./kuna-ui";

// Blocs de l'analyse de perte (fiche d'un deal closed lost), dans l'ordre :
// classification, exécution, phases, chaîne des causes, relance.

const LOST_RED = "#b91c1c";
const PHASE_COLOR: Record<PhaseKind, string> = { momentum: "#15803d", stall: "#f59e0b", silence: LOST_RED };

const dayMonth = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function sourcesLine(a: LossAnalysis, analyzedAt: string | null): string {
  const s = a.sources;
  const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""}`;
  const parts = [
    s.emails ? plural(s.emails, "email") : null,
    s.meetings ? plural(s.meetings, "meeting") : null,
    s.calls ? plural(s.calls, "call") : null,
    s.notes ? plural(s.notes, "note") : null,
    s.slack ? plural(s.slack, "Slack message") : null,
  ].filter((x): x is string => !!x);
  const when = analyzedAt ? `Analyzed ${dayMonth(analyzedAt)}` : "Analyzed";
  return parts.length ? `${when} from ${joinList(parts)}` : `${when}, no exchange logged on this deal`;
}

const btnDark: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "9px 14px",
  borderRadius: 8,
  border: "none",
  background: COLORS.ink0,
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 12px",
  borderRadius: 8,
  border: `1px solid ${COLORS.lineStrong}`,
  background: COLORS.bgCard,
  color: COLORS.ink1,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", border: `1px solid ${COLORS.line}`, borderRadius: 10, minWidth: 0 }}>
      <span style={{ fontSize: 12, color: COLORS.ink2 }}>{label}</span>
      {children}
    </div>
  );
}

// ─── Classification ────────────────────────────────────────────────────────

export function LossClassificationCard({
  analysis,
  analyzedAt,
  lost,
  declaredReason,
  analyzing,
  onReanalyze,
  reasonWrittenAt,
  writingReason,
  reasonError,
  onWriteReason,
}: {
  analysis: LossAnalysis;
  analyzedAt: string | null;
  lost: LostFacts | null;
  declaredReason: string;
  analyzing: boolean;
  onReanalyze: () => void;
  reasonWrittenAt: string | null;
  writingReason: boolean;
  reasonError: string;
  onWriteReason: () => void;
}) {
  const canWrite = !!analysis.primaryReason && !!analysis.hubspotReason;
  return (
    <Card padding={20} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <BlockTitle
        title="Loss classification"
        subtitle={sourcesLine(analysis, analyzedAt)}
        right={
          <button type="button" onClick={onReanalyze} disabled={analyzing} style={{ ...btnGhost, cursor: analyzing ? "default" : "pointer" }}>
            {analyzing && <RefreshCw size={13} className="animate-spin" />}
            {analyzing ? "Updating…" : "Reanalyze"}
          </button>
        }
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        <Tile label="Primary reason">
          <span
            style={{
              alignSelf: "flex-start",
              fontSize: 13,
              fontWeight: 600,
              padding: "5px 11px",
              borderRadius: 99,
              background: analysis.primaryReason ? COLORS.errBg : COLORS.bgSoft,
              color: analysis.primaryReason ? LOST_RED : COLORS.ink2,
            }}
          >
            {lossReasonLabel(analysis.primaryReason)}
          </span>
        </Tile>
        <Tile label="Secondary reason">
          <span style={{ fontSize: 14, fontWeight: 600, color: analysis.secondaryReason ? COLORS.ink0 : COLORS.ink3 }}>
            {analysis.secondaryReason ? lossReasonLabel(analysis.secondaryReason) : "None"}
          </span>
        </Tile>
        <Tile label="Controllable">
          <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0 }}>{CONTROLLABLE_LABELS[analysis.controllable]}</span>
        </Tile>
        <Tile label="Lost at stage">
          <span style={{ fontSize: 14, fontWeight: 600, color: lost?.lostAtStage ? COLORS.ink0 : COLORS.ink3 }}>
            {lost?.lostAtStage?.label ?? "Unknown"}
          </span>
          {lost?.lostAtStage && (
            <span style={{ fontSize: 12, color: COLORS.ink2 }}>{lost.lostAtStage.days} days there</span>
          )}
        </Tile>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 12, color: COLORS.ink2 }}>Reason list, the same for every lost deal</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {LOSS_REASONS.map((r) => {
            const primary = r.key === analysis.primaryReason;
            const secondary = r.key === analysis.secondaryReason;
            return (
              <span
                key={r.key}
                style={{
                  fontSize: 12,
                  fontWeight: primary || secondary ? 600 : 500,
                  padding: "5px 11px",
                  borderRadius: 99,
                  background: primary ? LOST_RED : secondary ? COLORS.bgCard : COLORS.bgSoft,
                  color: primary ? "#fff" : secondary ? LOST_RED : COLORS.ink2,
                  outline: secondary ? `1.5px solid ${LOST_RED}` : "none",
                  outlineOffset: -1.5,
                }}
              >
                {r.label}
              </span>
            );
          })}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 14,
          padding: "12px 14px",
          borderRadius: 10,
          background: COLORS.brandTintSoft,
          border: `1px solid ${COLORS.brandTint}`,
        }}
      >
        <div style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, color: COLORS.ink2 }}>
            Declared in HubSpot:{" "}
            {declaredReason ? (
              <strong style={{ color: COLORS.ink0 }}>{declaredReason}</strong>
            ) : (
              <em>nothing logged</em>
            )}
          </span>
          <span style={{ fontSize: 14, color: COLORS.ink0, lineHeight: 1.45 }}>
            {analysis.primaryReason ? (
              <>
                Suggested: <strong>{lossReasonLabel(analysis.primaryReason)}</strong>. {analysis.reasonExplanation}
              </>
            ) : (
              analysis.reasonExplanation || "Not enough exchanges to tell why this deal was lost."
            )}
          </span>
          {reasonError && <span style={{ fontSize: 12, color: COLORS.err }}>{reasonError}</span>}
        </div>
        {canWrite &&
          (reasonWrittenAt ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: COLORS.ok }}>
              <CheckCircle size={14} /> Written to HubSpot
            </span>
          ) : (
            <button
              type="button"
              onClick={onWriteReason}
              disabled={writingReason}
              title={`Sets Closed Lost Reason to "${analysis.hubspotReason}"`}
              style={{ ...btnDark, opacity: writingReason ? 0.7 : 1, cursor: writingReason ? "default" : "pointer" }}
            >
              {writingReason && <RefreshCw size={13} className="animate-spin" />}
              Write to HubSpot
            </button>
          ))}
      </div>
    </Card>
  );
}

// ─── Exécution ─────────────────────────────────────────────────────────────

export function LossExecutionCard({ execution }: { execution: LossExecution[] }) {
  const overall = executionOverall(execution);
  if (execution.length === 0) return null;
  const label = (key: string) => EXECUTION_AXES.find((a) => a.key === key)?.label ?? key;
  const cols = "minmax(150px, 190px) 100px 24px minmax(0, 1fr)";
  return (
    <Card padding={20} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <BlockTitle
        title="How we executed"
        subtitle="Rated 1 to 5 from the exchanges, each rating cites its evidence"
        right={
          overall !== null ? (
            <span style={{ fontSize: 13, color: COLORS.ink2 }}>
              Overall <strong style={{ fontSize: 18, color: COLORS.ink0, fontVariantNumeric: "tabular-nums" }}>{overall.toFixed(1)}</strong> / 5
            </span>
          ) : undefined
        }
      />
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 560 }}>
          <div style={{ display: "grid", gridTemplateColumns: cols, columnGap: 14, padding: "6px 0 8px", borderBottom: `1px solid ${COLORS.lineStrong}`, fontSize: 12, color: COLORS.ink2 }}>
            <span>Axis</span>
            <span>Rating</span>
            <span />
            <span>Evidence</span>
          </div>
          {execution.map((e) => (
            <div
              key={e.key}
              style={{ display: "grid", gridTemplateColumns: cols, columnGap: 14, alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${COLORS.line}` }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{label(e.key)}</span>
              <span style={{ display: "flex", gap: 4 }} role="img" aria-label={`${e.rating} out of 5`}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <span
                    key={i}
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: 4,
                      background: i <= e.rating ? COLORS.ink0 : COLORS.bgSoft,
                      outline: i <= e.rating ? "none" : `1px solid ${COLORS.lineStrong}`,
                      outlineOffset: -1,
                    }}
                  />
                ))}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0, fontVariantNumeric: "tabular-nums" }}>{e.rating}</span>
              <span style={{ fontSize: 13, color: COLORS.ink1, lineHeight: 1.45 }}>{e.evidence}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── Phases ────────────────────────────────────────────────────────────────

function replyTime(p: LossPhase): string {
  const d = p.metrics.medianReplyDays;
  if (d === null) return p.metrics.replies === 0 ? "none" : "-";
  return d < 1 ? "<1d" : `${Math.round(d)}d`;
}

export function LossPhasesCard({ phases }: { phases: LossPhase[] }) {
  if (phases.length === 0) return null;
  const total = daysBetween(`${phases[0].start}T00:00:00Z`, `${phases[phases.length - 1].end}T00:00:00Z`);
  return (
    <Card padding={20} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BlockTitle
        title="How the deal went"
        subtitle={`Phases read from the exchanges, figures counted from HubSpot and Claap. ${total} day${total > 1 ? "s" : ""} in total.`}
      />
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 8, minWidth: phases.length * 150 }}>
          {phases.map((p, i) => {
            const days = daysBetween(`${p.start}T00:00:00Z`, `${p.end}T00:00:00Z`);
            // Largeur proportionnelle à la durée, avec un plancher pour rester lisible.
            const weight = Math.max(days, total * 0.2, 1);
            return (
              <div key={`${p.kind}-${i}`} style={{ flex: `${weight} 1 0`, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ height: 10, borderRadius: 5, background: PHASE_COLOR[p.kind] }} aria-hidden="true" />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0 }}>{PHASE_LABELS[p.kind]}</span>
                  <span style={{ fontSize: 12, color: COLORS.ink2, fontVariantNumeric: "tabular-nums" }}>
                    {days} day{days > 1 ? "s" : ""}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: COLORS.ink2 }}>
                  {dayMonth(p.start)} → {dayMonth(p.end)}
                </span>
                <dl
                  style={{
                    margin: 0,
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 6,
                    padding: "8px 0",
                    borderTop: `1px solid ${COLORS.line}`,
                    borderBottom: `1px solid ${COLORS.line}`,
                  }}
                >
                  {[
                    ["Meetings", String(p.metrics.meetings)],
                    ["Replies", String(p.metrics.replies)],
                    ["Reply time", replyTime(p)],
                  ].map(([k, v]) => (
                    <div key={k} style={{ minWidth: 0 }}>
                      <dt style={{ fontSize: 11, color: COLORS.ink2 }}>{k}</dt>
                      <dd style={{ margin: "3px 0 0", fontSize: 15, fontWeight: 600, color: COLORS.ink0, fontVariantNumeric: "tabular-nums" }}>{v}</dd>
                    </div>
                  ))}
                </dl>
                {p.events.map((e, j) => (
                  <div key={j} style={{ display: "flex", gap: 8, fontSize: 12, lineHeight: 1.4 }}>
                    <span style={{ flexShrink: 0, width: 46, color: COLORS.ink2, fontVariantNumeric: "tabular-nums" }}>{dayMonth(e.date)}</span>
                    <span style={{ color: COLORS.ink1 }}>{e.label}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ─── Du symptôme à la cause racine ─────────────────────────────────────────

export function LossChainCard({ chain }: { chain: LossChainStep[] }) {
  if (chain.length === 0) return null;
  return (
    <Card padding={20} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <BlockTitle title="From the symptom to the root cause" subtitle="Each step is backed by an exchange" />
      <div style={{ display: "flex", flexDirection: "column" }}>
        {chain.map((step, i) => {
          const root = step.level === "root_cause";
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column" }}>
              {i > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0 5px 122px", fontSize: 12, fontWeight: 600, color: COLORS.ink2 }}>
                  <ArrowDown size={13} /> Why?
                </div>
              )}
              <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
                <span style={{ flexShrink: 0, width: 110, paddingTop: 13, fontSize: 12, fontWeight: 600, color: root ? COLORS.brand : COLORS.ink2 }}>
                  {CHAIN_LEVEL_LABELS[step.level]}
                </span>
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "11px 14px",
                    borderRadius: 10,
                    border: `1px solid ${root ? "#ffc2d6" : COLORS.line}`,
                    background: root ? "#fff1f6" : COLORS.bgCard,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink0, lineHeight: 1.45 }}>{step.text}</span>
                  {step.proof && <span style={{ fontSize: 12, color: COLORS.ink2 }}>{step.proof}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Relance ───────────────────────────────────────────────────────────────
// Un deal perdu vaut toujours une relance : la carte dit quand (date en grand)
// et comment (pourquoi cette date, qui, comment, signal à surveiller).

function untilLabel(date: string, today: string): { text: string; overdue: boolean } {
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5);
  if (days < 0) return { text: `Overdue since ${dayMonth(date)}`, overdue: true };
  if (days === 0) return { text: "Today", overdue: false };
  if (days < 45) return { text: `In ${days} day${days > 1 ? "s" : ""}`, overdue: false };
  const months = Math.round(days / 30.4);
  return { text: `In ${months} months`, overdue: false };
}

export function LossReopenCard({
  reopen,
  current,
  taskCreatedAt,
  creatingTask,
  taskError,
  onCreateTask,
}: {
  reopen: LossReopen;
  // false = analyse antérieure au plan de relance (verdict yes/maybe/no).
  current: boolean;
  taskCreatedAt: string | null;
  creatingTask: boolean;
  taskError: string;
  onCreateTask: () => void;
}) {
  if (!current) {
    return (
      <Card padding={20} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <BlockTitle title="When and how to reopen" />
        <span style={{ fontSize: 13, color: COLORS.ink2, lineHeight: 1.5 }}>
          This analysis predates the reopening plan. Reanalyze the loss to get when and how to reopen this account.
        </span>
      </Card>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const monthYear = reopen.date
    ? new Date(`${reopen.date}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
    : null;
  const until = reopen.date ? untilLabel(reopen.date, today) : null;
  const rows = [
    { label: "Why then", value: reopen.timing },
    { label: "Who", value: reopen.who },
    { label: "How", value: reopen.how },
    { label: "Watch for", value: reopen.watchFor },
  ].filter((r) => r.value);

  return (
    <Card padding={20} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <BlockTitle title="When and how to reopen" />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        {monthYear && until ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: COLORS.ink0 }}>{monthYear}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: until.overdue ? COLORS.warn : COLORS.ink2 }}>{until.text}</span>
          </div>
        ) : (
          <span style={{ fontSize: 13, color: COLORS.ink2 }}>No valid reopen date was suggested. Reanalyze the loss to get one.</span>
        )}
        {reopen.date && (
          taskCreatedAt ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: COLORS.ok }}>
              <CheckCircle size={14} /> HubSpot task created for {dayMonth(reopen.date)}
            </span>
          ) : until?.overdue ? (
            <span style={{ fontSize: 12, color: COLORS.ink2 }}>The suggested date has passed. Reanalyze to get a new one.</span>
          ) : (
            <button
              type="button"
              onClick={onCreateTask}
              disabled={creatingTask}
              style={{ ...btnDark, opacity: creatingTask ? 0.7 : 1, cursor: creatingTask ? "default" : "pointer" }}
            >
              {creatingTask && <RefreshCw size={13} className="animate-spin" />}
              Create a HubSpot task for {dayMonth(reopen.date)}
            </button>
          )
        )}
      </div>
      {rows.length > 0 && (
        <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: 16, rowGap: 10, margin: 0 }}>
          {rows.map((r) => (
            <React.Fragment key={r.label}>
              <dt style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink2, paddingTop: 1 }}>{r.label}</dt>
              <dd style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: COLORS.ink0 }}>{r.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {taskError && <span style={{ fontSize: 12, color: COLORS.err }}>{taskError}</span>}
    </Card>
  );
}
