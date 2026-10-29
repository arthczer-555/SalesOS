"use client";

import * as React from "react";
import { RefreshCw, Search, X } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import { IconButton } from "@/components/ui/icon-button";
import { scoreBadge } from "@/lib/deal-scoring";
import { daysBetween, isCurrentLossAnalysis, type LossAnalysis } from "@/lib/deals/loss-analysis";
import type { DealDetails } from "../_helpers";
import { fmt } from "../_helpers";
import { DealEventsTimeline } from "./deal-timeline-card";
import {
  LossChainCard,
  LossClassificationCard,
  LossExecutionCard,
  LossPhasesCard,
  LossReopenCard,
} from "./deal-loss-cards";

// Fiche d'un deal closed lost. Rien n'est analysé automatiquement : la fiche
// montre les faits HubSpot (étape de la perte, cycle, dernière réponse) et un
// bouton "Analyze the loss". Le résultat est relu à chaque ouverture.

const SCORE_TEXT: Record<string, string> = {
  "High Priority": "#166534",
  "On Track": "#854d0e",
  Fragile: "#9a3412",
  "At Risk": "#b91c1c",
};
const POLL_MS = 3000;
const WATCHDOG_MS = 240_000;

const fullDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function Fact({ label, value, note }: { label: string; value: React.ReactNode; note?: string | null }) {
  return (
    <div style={{ minWidth: 0 }}>
      <dt style={{ fontSize: 12, color: COLORS.ink2 }}>{label}</dt>
      <dd style={{ margin: "5px 0 0", fontSize: 14, fontWeight: 600, color: COLORS.ink0, lineHeight: 1.35, overflowWrap: "anywhere" }}>
        {value}
        {note && <span style={{ fontWeight: 400, color: COLORS.ink2 }}> · {note}</span>}
      </dd>
    </div>
  );
}

export function DealLostPanel({
  details,
  loading,
  onClose,
  onChanged,
}: {
  details: DealDetails | null;
  loading: boolean;
  onClose: () => void;
  // Rafraîchit la colonne Closed lost (badge "Analyzed").
  onChanged?: () => void;
}) {
  const [analysis, setAnalysis] = React.useState<LossAnalysis | null>(null);
  const [analyzedAt, setAnalyzedAt] = React.useState<string | null>(null);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [reasonWrittenAt, setReasonWrittenAt] = React.useState<string | null>(null);
  const [writtenReason, setWrittenReason] = React.useState<string | null>(null);
  const [writingReason, setWritingReason] = React.useState(false);
  const [reasonError, setReasonError] = React.useState("");
  const [taskCreatedAt, setTaskCreatedAt] = React.useState<string | null>(null);
  const [creatingTask, setCreatingTask] = React.useState(false);
  const [taskError, setTaskError] = React.useState("");

  const dealId = details?.id ?? null;
  // Ref : le callback du parent change à chaque rendu et relancerait le polling.
  const onChangedRef = React.useRef(onChanged);
  React.useEffect(() => {
    onChangedRef.current = onChanged;
  });
  const notifyChanged = React.useCallback(() => onChangedRef.current?.(), []);

  type LossResponse = {
    status?: string;
    analysis?: LossAnalysis | null;
    updatedAt?: string | null;
    error?: string | null;
    hubspotReasonWrittenAt?: string | null;
    reopenTaskCreatedAt?: string | null;
  };

  const applyResponse = React.useCallback((data: LossResponse) => {
    if (data.analysis) setAnalysis(data.analysis);
    if (data.status === "done") setAnalyzedAt(data.updatedAt ?? null);
    setReasonWrittenAt(data.hubspotReasonWrittenAt ?? null);
    setTaskCreatedAt(data.reopenTaskCreatedAt ?? null);
  }, []);

  // Ouverture : relit l'analyse existante (aucune n'est lancée ici).
  React.useEffect(() => {
    setAnalysis(null);
    setAnalyzedAt(null);
    setAnalyzing(false);
    setError("");
    setReasonWrittenAt(null);
    setWrittenReason(null);
    setReasonError("");
    setTaskCreatedAt(null);
    setTaskError("");
    if (!dealId) return;
    let aborted = false;
    (async () => {
      try {
        const r = await fetch(`/api/deals/loss-analysis?dealId=${encodeURIComponent(dealId)}`);
        const data = (await r.json()) as LossResponse;
        if (aborted) return;
        if (!r.ok) {
          setError(data.error ?? "Could not load the loss analysis");
          return;
        }
        applyResponse(data);
        if (data.status === "analyzing") setAnalyzing(true);
        else if (data.status === "error") setError(data.error ?? "The last analysis failed");
      } catch {
        /* silencieux : le bouton reste disponible */
      }
    })();
    return () => {
      aborted = true;
    };
  }, [dealId, applyResponse]);

  // Polling tant que la background function tourne.
  React.useEffect(() => {
    if (!analyzing || !dealId) return;
    let cancelled = false;
    const startedAt = Date.now();
    const interval = setInterval(async () => {
      if (Date.now() - startedAt > WATCHDOG_MS) {
        setError("The analysis did not finish within 4 minutes. Run it again.");
        setAnalyzing(false);
        return;
      }
      try {
        const r = await fetch(`/api/deals/loss-analysis?dealId=${encodeURIComponent(dealId)}`);
        const data = (await r.json()) as LossResponse;
        if (cancelled) return;
        if (data.status === "done") {
          applyResponse(data);
          setAnalyzing(false);
          notifyChanged();
        } else if (data.status === "error") {
          setError(data.error ?? "The analysis failed");
          setAnalyzing(false);
          notifyChanged();
        }
      } catch {
        /* on retente au prochain tick */
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [analyzing, dealId, applyResponse, notifyChanged]);

  const analyze = React.useCallback(async (force: boolean) => {
    if (!dealId) return;
    setError("");
    setAnalyzing(true);
    try {
      const r = await fetch("/api/deals/loss-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, force }),
      });
      const data = (await r.json().catch(() => ({}))) as LossResponse;
      if (!r.ok) throw new Error(data.error ?? "Error");
      if (data.status === "done") {
        applyResponse(data);
        setAnalyzing(false);
        notifyChanged();
      } else {
        notifyChanged();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setAnalyzing(false);
    }
  }, [dealId, applyResponse, notifyChanged]);

  const writeReason = React.useCallback(async () => {
    if (!dealId || !analysis?.hubspotReason) return;
    setWritingReason(true);
    setReasonError("");
    try {
      const r = await fetch(`/api/deals/${dealId}/lost-reason`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: analysis.hubspotReason }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "HubSpot error");
      setReasonWrittenAt(data.writtenAt ?? new Date().toISOString());
      setWrittenReason(data.reason ?? analysis.hubspotReason);
      notifyChanged();
    } catch (e) {
      setReasonError(e instanceof Error ? e.message : "Error");
    } finally {
      setWritingReason(false);
    }
  }, [dealId, analysis, notifyChanged]);

  const createTask = React.useCallback(async () => {
    if (!dealId) return;
    setCreatingTask(true);
    setTaskError("");
    try {
      const r = await fetch(`/api/deals/${dealId}/reopen-task`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "HubSpot error");
      setTaskCreatedAt(data.createdAt ?? new Date().toISOString());
    } catch (e) {
      setTaskError(e instanceof Error ? e.message : "Error");
    } finally {
      setCreatingTask(false);
    }
  }, [dealId]);

  if (loading || !details) {
    return (
      <div style={{ flex: 1, minWidth: 0, background: COLORS.bgCard, borderLeft: `1px solid ${COLORS.line}`, padding: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[80, 60, 70, 50, 40].map((w, i) => (
            <div key={i} className="animate-pulse" style={{ height: 14, background: COLORS.line, borderRadius: 6, width: `${w}%` }} />
          ))}
        </div>
      </div>
    );
  }

  const lost = details.lost;
  const lostAt = lost?.lostAt || details.closedate;
  const declaredReason = writtenReason ?? lost?.declaredReason ?? "";
  const companyName = details.company?.name || details.dealname;
  const badge = details.score ? scoreBadge(details.score.total) : null;
  const daysAgo = lostAt ? daysBetween(lostAt, new Date().toISOString()) : null;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: COLORS.bgPage,
        borderLeft: `1px solid ${COLORS.line}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* En-tête : faits HubSpot, aucun calcul IA */}
      <div style={{ padding: "16px 20px 16px", background: COLORS.bgCard, borderBottom: `1px solid ${COLORS.line}`, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <CompanyAvatar name={companyName} size={48} rounded="md" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: COLORS.ink0, margin: 0, letterSpacing: "-0.01em", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {details.dealname}
              </h2>
              <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, padding: "3px 9px", borderRadius: 99, background: COLORS.errBg, color: "#b91c1c" }}>
                Closed lost
              </span>
            </div>
            <a
              href={`https://app.hubspot.com/contacts/_/deal/${details.id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 11, color: COLORS.ink3, textDecoration: "none" }}
            >
              Open in HubSpot ↗
            </a>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, fontSize: 12, color: COLORS.ink2, flexWrap: "wrap" }}>
              {[
                details.company?.industry ? details.company.industry.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : null,
                details.company?.employees ? `${parseInt(details.company.employees, 10).toLocaleString("en-GB")} employees` : null,
                details.ownerName ? `Owner ${details.ownerName}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {!analysis && (
              <button
                type="button"
                onClick={() => analyze(false)}
                disabled={analyzing}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: analyzing ? COLORS.brandDark : COLORS.brand,
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: analyzing ? "default" : "pointer",
                }}
              >
                {analyzing ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                {analyzing ? "Analyzing…" : "Analyze the loss"}
              </button>
            )}
            <IconButton icon={X} aria-label="Close" onClick={onClose} variant="ghost" />
          </div>
        </div>

        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "14px 20px", margin: 0 }}>
          <Fact label="Amount" value={fmt(details.amount)} />
          <Fact label="Lost on" value={lostAt ? fullDate(lostAt) : "Unknown"} note={daysAgo === null ? null : daysAgo === 0 ? "today" : `${daysAgo} days ago`} />
          <Fact
            label="Declared reason (HubSpot)"
            value={declaredReason || <span style={{ fontWeight: 500, fontStyle: "italic", color: COLORS.warn }}>No reason logged</span>}
          />
          <Fact
            label="Lost at stage"
            value={lost?.lostAtStage?.label ?? "Unknown"}
            note={lost?.lostAtStage ? `${lost.lostAtStage.days} days there` : null}
          />
          <Fact
            label="Sales cycle"
            value={details.createdate && lostAt ? `${daysBetween(details.createdate, lostAt)} days` : "Unknown"}
            note={details.createdate ? `from ${fullDate(details.createdate)}` : null}
          />
          <Fact
            label="Last reply from the prospect"
            value={lost?.lastProspectReplyAt ? fullDate(lost.lastProspectReplyAt) : "None logged"}
            note={
              lost?.lastProspectReplyAt && lostAt
                ? `${lost.lastProspectReplyVia === "meeting" ? "meeting, " : ""}${daysBetween(lost.lastProspectReplyAt, lostAt)} days before the loss`
                : null
            }
          />
        </dl>

        {badge && details.score && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: COLORS.ink2 }}>
            <span>Last score</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 99, background: badge.bg, color: SCORE_TEXT[badge.label] ?? badge.color }}>
              <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{details.score.total}</span>
              {badge.label}
            </span>
            {details.scoredAt && (
              <span>
                scored {fullDate(details.scoredAt)}
                {lostAt && details.scoredAt <= lostAt ? `, ${daysBetween(details.scoredAt, lostAt)} days before the loss` : ", after the loss"}
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {error && (
            <div style={{ color: COLORS.err, fontSize: 12, padding: "10px 12px", background: COLORS.errBg, borderRadius: 8, lineHeight: 1.45 }}>
              {error}
            </div>
          )}

          {!analysis && (
            <Card
              padding={20}
              style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, background: COLORS.brandTintSoft, borderColor: COLORS.brandTint }}
            >
              <div style={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: COLORS.ink0 }}>Why was this deal lost?</span>
                <span style={{ fontSize: 13, color: COLORS.ink1, lineHeight: 1.5 }}>
                  {analyzing
                    ? "Reading the HubSpot emails, calls and notes, the Claap meetings and Slack. About a minute."
                    : "Not analyzed yet. The analysis reads the HubSpot emails, calls and notes, the Claap meetings and Slack, then compares the declared reason with what actually happened."}
                </span>
              </div>
              <button
                type="button"
                onClick={() => analyze(false)}
                disabled={analyzing}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "11px 18px",
                  borderRadius: 10,
                  border: "none",
                  background: analyzing ? COLORS.brandDark : COLORS.brand,
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: analyzing ? "default" : "pointer",
                }}
              >
                {analyzing ? <RefreshCw size={15} className="animate-spin" /> : <Search size={15} />}
                {analyzing ? "Analyzing…" : "Analyze the loss"}
              </button>
            </Card>
          )}

          {analysis && (
            <>
              <LossClassificationCard
                analysis={analysis}
                analyzedAt={analyzedAt}
                lost={lost}
                declaredReason={declaredReason}
                analyzing={analyzing}
                onReanalyze={() => analyze(true)}
                reasonWrittenAt={reasonWrittenAt}
                writingReason={writingReason}
                reasonError={reasonError}
                onWriteReason={writeReason}
              />
              <LossExecutionCard execution={analysis.execution} />
              <LossPhasesCard phases={analysis.phases} />
              <LossChainCard chain={analysis.chain} />
              <LossReopenCard
                reopen={analysis.reopen}
                current={isCurrentLossAnalysis(analysis)}
                taskCreatedAt={taskCreatedAt}
                creatingTask={creatingTask}
                taskError={taskError}
                onCreateTask={createTask}
              />
            </>
          )}

          <DealEventsTimeline events={details.events} meetings={details.meetings} />
        </div>
      </div>
    </div>
  );
}
