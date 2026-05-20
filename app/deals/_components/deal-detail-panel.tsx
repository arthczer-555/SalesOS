"use client";

import * as React from "react";
import {
  X,
  Mail,
  Zap,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  CheckCircle2,
  XCircle,
  TrendingUp,
  RefreshCw,
  Linkedin,
  Copy,
  Check,
  Send,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import {
  scoreBadge,
  reliabilityLabel,
  reliabilityColor,
  type DealScore,
} from "@/lib/deal-scoring";
import { AskClaudePanel } from "@/components/ask-claude";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { ScoreGauge } from "@/components/ui/score-gauge";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import { IconButton } from "@/components/ui/icon-button";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { Analysis, DealDetails } from "../_helpers";
import { engagementTypeBadge, formatDealForSlack, timeAgo } from "../_helpers";
import { DealLinkedinCard } from "./deal-linkedin-card";
import { DealNewsCard } from "./deal-news-card";

interface Props {
  details: DealDetails | null;
  loading: boolean;
  onClose: () => void;
  onRescore: (dealId: string, score: DealScore, reasoning: string, next_action: string) => void;
  stageLabel: string;
  stageColor: string;
  slackName: string | null;
  lastGlobalScoringAt?: string | null;
}

const BANT_FIELDS: { key: string; label: string }[] = [
  { key: "budget", label: "Budget" },
  { key: "authority", label: "Authority" },
  { key: "need", label: "Need" },
  { key: "timeline", label: "Timeline" },
];

const EXTRA_QUAL_FIELDS: { key: string; label: string }[] = [
  { key: "estimatedBudget", label: "Budget estimé" },
  { key: "champion", label: "Champion interne" },
  { key: "needDetailed", label: "Besoin détaillé" },
  { key: "strategicFit", label: "Fit stratégique" },
];

export function DealDetailPanel({
  details,
  loading,
  onClose,
  onRescore,
  stageLabel,
  stageColor: color,
  slackName,
  lastGlobalScoringAt,
}: Props) {
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [analysisStale, setAnalysisStale] = React.useState(false);
  const [analyzeError, setAnalyzeError] = React.useState("");
  const [slackSending, setSlackSending] = React.useState(false);
  const [slackSent, setSlackSent] = React.useState(false);

  const [emailDraft, setEmailDraft] = React.useState<{ subject: string; body: string; toEmail: string } | null>(null);
  const [generating, setGenerating] = React.useState(false);
  const [emailSubject, setEmailSubject] = React.useState("");
  const [emailBody, setEmailBody] = React.useState("");
  const [emailTo, setEmailTo] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [showComposer, setShowComposer] = React.useState(false);
  const [showEngagements, setShowEngagements] = React.useState(false);
  const [showScoreDetails, setShowScoreDetails] = React.useState(false);
  const [claudeOpen, setClaudeOpen] = React.useState(false);
  const [rescoring, setRescoring] = React.useState(false);
  const [localScore, setLocalScore] = React.useState<{ score: DealScore; reasoning: string; next_action: string; scoredAt: string; qualification: Record<string, string | null> | null } | null>(null);

  React.useEffect(() => {
    setAnalysis(null);
    setAnalysisStale(false);
    setAnalyzeError("");
    setAnalyzing(false);
    setEmailDraft(null);
    setShowComposer(false);
    setSent(false);
    setShowEngagements(false);
    setShowScoreDetails(false);
    setClaudeOpen(false);
    setLocalScore(null);
    setSlackSent(false);
  }, [details?.id]);

  // À l'ouverture du deal, on récupère l'analyse précédente si elle existe.
  // Permet d'afficher instantanément la dernière analyse sans bouton.
  React.useEffect(() => {
    if (!details?.id) return;
    const dealId = details.id;
    let aborted = false;
    (async () => {
      try {
        const r = await fetch(`/api/deals/analyze?dealId=${encodeURIComponent(dealId)}`);
        if (!r.ok) return;
        const data = await r.json();
        if (aborted) return;
        if (data.status === "done" && data.analysis) {
          setAnalysis(data.analysis as Analysis);
          setAnalysisStale(!!data.stale);
        } else if (data.status === "analyzing") {
          setAnalyzing(true);
        }
      } catch {
        /* silent - l'utilisateur peut toujours relancer manuellement */
      }
    })();
    return () => { aborted = true; };
  }, [details?.id]);

  // Polling tant que l'analyse tourne en arrière-plan (background function).
  // Watchdog : on abandonne après 3 min - signe d'une analyse morte côté BG.
  React.useEffect(() => {
    if (!analyzing || !details?.id) return;
    const dealId = details.id;
    let cancelled = false;
    const startedAt = Date.now();
    const tick = async () => {
      if (Date.now() - startedAt > 180_000) {
        setAnalyzeError("L'analyse n'a pas répondu en 3 min. Relance via le bouton.");
        setAnalyzing(false);
        return;
      }
      try {
        const r = await fetch(`/api/deals/analyze?dealId=${encodeURIComponent(dealId)}`);
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        if (data.status === "done" && data.analysis) {
          setAnalysis(data.analysis as Analysis);
          setAnalysisStale(false);
          setAnalyzing(false);
        } else if (data.status === "error") {
          setAnalyzeError(data.error || "Erreur pendant l'analyse");
          setAnalyzing(false);
        }
      } catch {
        /* on retentera au prochain tick */
      }
    };
    const interval = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [analyzing, details?.id]);

  React.useEffect(() => {
    if (emailDraft) {
      setEmailSubject(emailDraft.subject);
      setEmailBody(emailDraft.body);
      setEmailTo(emailDraft.toEmail);
      setShowComposer(true);
    }
  }, [emailDraft]);

  const analyze = React.useCallback(async (opts?: { force?: boolean }) => {
    if (!details) return;
    setAnalyzeError("");
    setAnalyzing(true);
    try {
      const r = await fetch("/api/deals/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: details.id, force: opts?.force === true }),
      });
      const ct = r.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        throw new Error("Le serveur a renvoyé une réponse inattendue. Réessaie dans un moment.");
      }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");

      // Réponse "done" (cache frais OU dev inline qui vient de finir).
      if (data.status === "done" && data.analysis) {
        setAnalysis(data.analysis as Analysis);
        setAnalysisStale(false);
        setAnalyzing(false);
        return;
      }

      // Analyse en cours côté background function : afficher la stale si elle
      // existe et basculer en polling.
      if (data.analysis) {
        setAnalysis(data.analysis as Analysis);
        setAnalysisStale(!!data.stale);
      }
      setAnalyzing(true);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "Erreur");
      setAnalyzing(false);
    }
  }, [details]);

  const generateEmail = React.useCallback(async () => {
    if (!details) return;
    setGenerating(true);
    try {
      const r = await fetch("/api/deals/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: details.id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Erreur");
      setEmailDraft(data);
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  }, [details]);

  const sendEmail = React.useCallback(async () => {
    if (!emailTo || !emailSubject || !emailBody) return;
    setSending(true);
    try {
      const r = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: emailTo, subject: emailSubject, body: emailBody }),
      });
      if (r.ok) {
        setSent(true);
        setShowComposer(false);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  }, [emailTo, emailSubject, emailBody]);

  const rescore = React.useCallback(async () => {
    if (!details) return;
    setRescoring(true);
    try {
      const r = await fetch("/api/deals/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: details.id }),
      });
      const data = await r.json();
      if (r.ok) {
        const newScore: DealScore = { total: data.total, components: data.components, reliability: data.reliability };
        setLocalScore({
          score: newScore,
          reasoning: data.reasoning ?? "",
          next_action: data.next_action ?? "",
          scoredAt: new Date().toISOString(),
          qualification: data.qualification ?? null,
        });
        onRescore(details.id, newScore, data.reasoning ?? "", data.next_action ?? "");
      }
    } catch {
      /* ignore */
    } finally {
      setRescoring(false);
    }
  }, [details, onRescore]);

  const sendToSlack = React.useCallback(async () => {
    if (!details) return;
    setSlackSending(true);
    try {
      const activeScore = localScore?.score ?? details.score;
      const activeReasoning = localScore?.reasoning ?? details.reasoning;
      const activeNextAction = localScore?.next_action ?? details.next_action;
      const activeQualification = localScore?.qualification ?? details.qualification;
      const text = formatDealForSlack(details, stageLabel, activeScore, activeReasoning, activeNextAction, activeQualification);
      const r = await fetch("/api/deals/send-slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error ?? "Erreur");
      }
      setSlackSent(true);
    } catch (e) {
      console.error("send-slack error:", e);
    } finally {
      setSlackSending(false);
    }
  }, [details, localScore, stageLabel]);

  if (loading || !details) {
    return (
      <div
        style={{
          flex: 1,
          minWidth: 0,
          background: COLORS.bgCard,
          borderLeft: `1px solid ${COLORS.line}`,
          padding: 24,
          overflow: "auto",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[80, 60, 70, 50, 40].map((w, i) => (
            <div
              key={i}
              className="animate-pulse"
              style={{ height: 14, background: COLORS.line, borderRadius: 6, width: `${w}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  const activeScore = localScore?.score ?? details.score;
  const activeReasoning = localScore?.reasoning ?? details.reasoning;
  const activeNextAction = localScore?.next_action ?? details.next_action;
  const activeScoredAt = localScore?.scoredAt ?? details.scoredAt;
  const activeQualification = localScore?.qualification ?? details.qualification;
  const badge = activeScore ? scoreBadge(activeScore.total) : null;
  const relColor = activeScore ? reliabilityColor(activeScore.reliability) : null;
  const amountNum = parseFloat(details.amount);
  const amountStr = isNaN(amountNum) ? "—" : `${(amountNum / 1000).toFixed(0)}k€`;
  const companyName = details.company?.name || details.dealname;

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
      {/* Header */}
      <div
        style={{
          padding: "16px 20px",
          background: COLORS.bgCard,
          borderBottom: `1px solid ${COLORS.line}`,
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <CompanyAvatar name={companyName} size={48} rounded="md" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: COLORS.ink0,
              margin: 0,
              letterSpacing: "-0.01em",
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {details.dealname}
          </h2>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 4,
              fontSize: 12,
              color: COLORS.ink2,
              flexWrap: "wrap",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
              <span style={{ fontWeight: 500, color: COLORS.ink1 }}>{stageLabel}</span>
            </span>
            {details.amount && (
              <>
                <span>·</span>
                <span style={{ color: COLORS.ink0, fontWeight: 600 }}>
                  {parseFloat(details.amount).toLocaleString("fr-FR")} €
                </span>
              </>
            )}
            {details.closedate && (
              <>
                <span>·</span>
                <span>Clôture {new Date(details.closedate).toLocaleDateString("fr-FR")}</span>
              </>
            )}
            {details.ownerName && (
              <>
                <span>·</span>
                <span>{details.ownerName}</span>
              </>
            )}
          </div>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <IconButton
            icon={Mail}
            aria-label="Rédiger un email"
            onClick={generateEmail}
            disabled={generating}
            title="Email de suivi"
          />
          <button
            type="button"
            onClick={() => setClaudeOpen(true)}
            aria-label="Poser une question à Claude"
            title="Poser une question à Claude"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: 8,
              background: COLORS.bgCard,
              border: `1px solid ${COLORS.lineStrong}`,
              cursor: "pointer",
              padding: 0,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = COLORS.brand;
              e.currentTarget.style.background = COLORS.brandTintSoft;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = COLORS.lineStrong;
              e.currentTarget.style.background = COLORS.bgCard;
            }}
          >
            <img
              src="/3d-claude-ai-logo.jpg"
              alt="Claude"
              style={{ width: 22, height: 22, borderRadius: 4 }}
            />
          </button>
          <span style={{ width: 1, height: 22, background: COLORS.line, margin: "0 2px" }} />
          {slackName && (
            <button
              type="button"
              onClick={sendToSlack}
              disabled={slackSending || slackSent}
              aria-label="Envoyer en Slack"
              title="Envoyer en DM Slack"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 16px",
                borderRadius: 8,
                background: slackSent ? COLORS.ok : COLORS.ink0,
                color: "#fff",
                border: "none",
                cursor: slackSending || slackSent ? "default" : "pointer",
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "-0.005em",
                opacity: slackSending && !slackSent ? 0.7 : 1,
                transition: "background 0.15s, opacity 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!slackSending && !slackSent) e.currentTarget.style.background = COLORS.ink1;
              }}
              onMouseLeave={(e) => {
                if (!slackSending && !slackSent) e.currentTarget.style.background = COLORS.ink0;
              }}
            >
              {slackSending ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : slackSent ? (
                <CheckCircle size={14} />
              ) : (
                <Send size={14} />
              )}
              {slackSent ? "Envoyé" : "Slack"}
            </button>
          )}
          <button
            type="button"
            onClick={rescore}
            disabled={rescoring}
            aria-label="Rescorer ce deal"
            title={activeScoredAt ? `Scoré ${timeAgo(activeScoredAt)}` : "Rescorer ce deal"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 16px",
              borderRadius: 8,
              background: COLORS.ink0,
              color: "#fff",
              border: "none",
              cursor: rescoring ? "default" : "pointer",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "-0.005em",
              opacity: rescoring ? 0.7 : 1,
              transition: "background 0.15s, opacity 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!rescoring) e.currentTarget.style.background = COLORS.ink1;
            }}
            onMouseLeave={(e) => {
              if (!rescoring) e.currentTarget.style.background = COLORS.ink0;
            }}
          >
            {rescoring ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Zap size={14} />
            )}
            {rescoring ? "Scoring…" : "Rescorer"}
          </button>
          <span style={{ width: 1, height: 22, background: COLORS.line, margin: "0 2px" }} />
          <IconButton icon={X} aria-label="Fermer" onClick={onClose} variant="ghost" />
        </div>
      </div>

      {/* Body — 2-column layout: score/actions on the left, qualification stack on the right */}
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 360px",
            gap: 16,
            alignItems: "flex-start",
          }}
        >
          {/* LEFT COLUMN */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {/* Score + Montant */}
          {activeScore && badge ? (
            <Card padding={18}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                  <ScoreGauge value={activeScore.total} scale={100} size={120} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: COLORS.ink3,
                      }}
                    >
                      Score deal
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: badge.color }}>{badge.label}</span>
                    {relColor && (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                        <div style={{ display: "flex", gap: 2 }}>
                          {[0, 1, 2, 3, 4].map((i) => (
                            <span
                              key={i}
                              style={{
                                width: 7,
                                height: 7,
                                borderRadius: "50%",
                                background: i < activeScore.reliability ? relColor : COLORS.line,
                              }}
                            />
                          ))}
                        </div>
                        <span style={{ fontSize: 11, color: relColor, fontWeight: 500 }}>
                          {reliabilityLabel(activeScore.reliability)}
                        </span>
                      </div>
                    )}
                    {activeScoredAt && (
                      <span
                        style={{ fontSize: 10, color: COLORS.ink4 }}
                        title={new Date(activeScoredAt).toLocaleString("fr-FR")}
                      >
                        Ce deal : {timeAgo(activeScoredAt).toLowerCase()}
                      </span>
                    )}
                    {lastGlobalScoringAt && (
                      <span
                        style={{ fontSize: 10, color: COLORS.ink4 }}
                        title={new Date(lastGlobalScoringAt).toLocaleString("fr-FR")}
                      >
                        Scoring général : {timeAgo(lastGlobalScoringAt).toLowerCase()}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: COLORS.ink3,
                    }}
                  >
                    Montant
                  </span>
                  <span
                    style={{
                      fontSize: 32,
                      fontWeight: 800,
                      color: COLORS.ink0,
                      letterSpacing: "-0.02em",
                      lineHeight: 1,
                    }}
                  >
                    {amountStr}
                  </span>
                  {details.closedate && (
                    <span style={{ fontSize: 11, color: COLORS.ink3 }}>
                      Clôture {new Date(details.closedate).toLocaleDateString("fr-FR", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  )}
                </div>
              </div>

              {/* AI reasoning — stylized check/cross/warning icons + black text */}
              {activeReasoning && (
                <div style={{ marginTop: 14 }}>
                  {activeReasoning.includes("✓") || activeReasoning.includes("✗") || activeReasoning.includes("⚠") ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {activeReasoning.split("\n").filter(Boolean).map((line, i) => {
                        const isOk = line.startsWith("✓");
                        const isErr = line.startsWith("✗");
                        const isWarn = line.startsWith("⚠");
                        const text = line.replace(/^[✓✗⚠]\s*/, "");
                        const Icon = isOk ? CheckCircle2 : isErr ? XCircle : isWarn ? AlertTriangle : null;
                        const iconColor = isOk
                          ? COLORS.ok
                          : isErr
                            ? COLORS.err
                            : isWarn
                              ? COLORS.warn
                              : COLORS.ink3;
                        const iconBg = isOk
                          ? COLORS.okBg
                          : isErr
                            ? COLORS.errBg
                            : isWarn
                              ? COLORS.warnBg
                              : COLORS.bgSoft;
                        return (
                          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                            <span
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: 999,
                                background: iconBg,
                                color: iconColor,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                                marginTop: 1,
                              }}
                            >
                              {Icon ? <Icon size={14} strokeWidth={2.25} /> : null}
                            </span>
                            <p
                              style={{
                                fontSize: 13,
                                color: COLORS.ink0,
                                margin: 0,
                                lineHeight: 1.5,
                                flex: 1,
                              }}
                            >
                              {text}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        background: COLORS.bgSoft,
                        border: `1px solid ${COLORS.line}`,
                      }}
                    >
                      <p style={{ fontSize: 13, color: COLORS.ink0, margin: 0, lineHeight: 1.5 }}>
                        {activeReasoning}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Score components collapsible */}
              {activeScore.components.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => setShowScoreDetails((v) => !v)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      color: COLORS.ink3,
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    <ChevronDown
                      size={12}
                      style={{ transform: showScoreDetails ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
                    />
                    Détails du score
                  </button>
                  {showScoreDetails && (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                      {activeScore.components.map((c) => (
                        <div key={c.name}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                            <span style={{ fontSize: 12, color: COLORS.ink1 }}>{c.name}</span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink0 }}>
                              {c.earned}/{c.max}
                            </span>
                          </div>
                          <ProgressBar
                            value={(c.earned / c.max) * 100}
                            max={100}
                            height={4}
                            variant="brand"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          ) : (
            <Card padding={18}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <p style={{ fontSize: 13, color: COLORS.ink2, margin: 0 }}>Ce deal n&apos;a pas encore été scoré.</p>
                </div>
                <button
                  onClick={rescore}
                  disabled={rescoring}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 500,
                    padding: "7px 14px",
                    borderRadius: 8,
                    background: COLORS.brand,
                    color: "#fff",
                    border: "none",
                    cursor: rescoring ? "not-allowed" : "pointer",
                    opacity: rescoring ? 0.6 : 1,
                  }}
                >
                  {rescoring ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />}
                  {rescoring ? "Scoring…" : "Scorer ce deal"}
                </button>
              </div>
            </Card>
          )}

          {/* Deep AI analysis — prominent CTA in Coachello brand (placed right under the score) */}
          {!analysis && (
            <button
              type="button"
              onClick={() => analyze()}
              disabled={analyzing}
              style={{
                width: "100%",
                padding: "14px 20px",
                borderRadius: 10,
                background: analyzing ? COLORS.brandDark : COLORS.brand,
                color: "#fff",
                border: "none",
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                cursor: analyzing ? "default" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                boxShadow: "0 2px 8px rgba(240, 21, 99, 0.25)",
                transition: "background 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={(e) => {
                if (!analyzing) {
                  e.currentTarget.style.background = COLORS.brandDark;
                  e.currentTarget.style.boxShadow = "0 4px 14px rgba(240, 21, 99, 0.35)";
                }
              }}
              onMouseLeave={(e) => {
                if (!analyzing) {
                  e.currentTarget.style.background = COLORS.brand;
                  e.currentTarget.style.boxShadow = "0 2px 8px rgba(240, 21, 99, 0.25)";
                }
              }}
            >
              {analyzing ? (
                <RefreshCw size={16} className="animate-spin" />
              ) : (
                <Sparkles size={16} />
              )}
              {analyzing ? "Analyse en cours…" : "Analyse approfondie"}
            </button>
          )}
          {analyzeError && (
            <div
              style={{
                color: COLORS.err,
                fontSize: 12,
                padding: "10px 12px",
                background: COLORS.errBg,
                borderRadius: 8,
              }}
            >
              {analyzeError}
            </div>
          )}
          {analysis && (
            <Card padding={16}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <SectionHeader title="Analyse approfondie" />
                {(analyzing || analysisStale) && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      color: analyzing ? COLORS.brand : COLORS.ink3,
                      padding: "3px 8px",
                      borderRadius: 999,
                      background: analyzing ? COLORS.errBg : COLORS.bgSoft,
                    }}
                  >
                    {analyzing ? (
                      <>
                        <RefreshCw size={11} className="animate-spin" />
                        Mise à jour en cours
                      </>
                    ) : (
                      "Analyse périmée"
                    )}
                  </span>
                )}
              </div>
              <AnalysisView analysis={analysis} onReanalyze={() => analyze({ force: true })} />
            </Card>
          )}

          {/* Next action — single card */}
          {activeNextAction && (
            <Card padding={16} style={{ background: COLORS.okBg, borderColor: COLORS.okBg }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.6)",
                    color: COLORS.ok,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <TrendingUp size={14} />
                </span>
                <div style={{ flex: 1 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: COLORS.ok,
                    }}
                  >
                    Prochaine action
                  </span>
                  <p style={{ fontSize: 14, color: "#15803d", margin: 0, marginTop: 2, lineHeight: 1.5, fontWeight: 500 }}>
                    {activeNextAction}
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Contacts */}
          {details.contacts.length > 0 && (
            <Card padding={16} id="deal-contacts-section">
              <SectionHeader title={`Contacts (${details.contacts.length})`} />
              {details.contacts.map((c, i) => (
                <ContactRow key={c.id} contact={c} last={i === details.contacts.length - 1} />
              ))}
            </Card>
          )}

          {/* LinkedIn enrichment (Netrows) */}
          {details.contacts.length > 0 && details.id && <DealLinkedinCard dealId={details.id} />}

          {/* News Tavily (signaux business) */}
          {details.id && <DealNewsCard dealId={details.id} />}

          {/* Email composer */}
          {sent && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: COLORS.ok, fontSize: 13 }}>
              <CheckCircle size={14} /> Email envoyé avec succès
            </div>
          )}
          {showComposer && !sent && (
            <Card padding={14}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="À (email)"
                  style={{
                    fontSize: 13,
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: `1px solid ${COLORS.line}`,
                    outline: "none",
                  }}
                />
                <input
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Objet"
                  style={{
                    fontSize: 13,
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: `1px solid ${COLORS.line}`,
                    outline: "none",
                  }}
                />
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  rows={8}
                  style={{
                    fontSize: 13,
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: `1px solid ${COLORS.line}`,
                    outline: "none",
                    resize: "vertical",
                    fontFamily: "inherit",
                    lineHeight: 1.5,
                  }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={sendEmail}
                    disabled={sending || !emailTo}
                    style={{
                      flex: 1,
                      padding: 8,
                      borderRadius: 6,
                      background: sending || !emailTo ? COLORS.bgSoft : COLORS.brand,
                      color: sending || !emailTo ? COLORS.ink3 : "#fff",
                      border: "none",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: sending || !emailTo ? "not-allowed" : "pointer",
                    }}
                  >
                    {sending ? "Envoi…" : "Envoyer via Gmail"}
                  </button>
                  <button
                    onClick={() => setShowComposer(false)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 6,
                      background: "none",
                      border: `1px solid ${COLORS.line}`,
                      color: COLORS.ink2,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    Annuler
                  </button>
                </div>
              </div>
            </Card>
          )}

          {/* Recent activity collapsible */}
          {details.engagements.length > 0 && (
            <Card padding={14}>
              <button
                onClick={() => setShowEngagements((v) => !v)}
                style={{
                  width: "100%",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: COLORS.ink3,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Activité récente ({details.engagements.length})
                </span>
                <ChevronDown
                  size={12}
                  style={{
                    color: COLORS.ink3,
                    marginLeft: "auto",
                    transform: showEngagements ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.15s",
                  }}
                />
              </button>
              {showEngagements && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                  {details.engagements.map((e, i) => (
                    <div
                      key={i}
                      style={{
                        paddingBottom: 10,
                        borderBottom:
                          i < details.engagements.length - 1 ? `1px solid ${COLORS.line}` : "none",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <span
                          style={{
                            fontSize: 10,
                            padding: "1px 6px",
                            borderRadius: 999,
                            background: COLORS.bgSoft,
                            color: COLORS.ink1,
                            fontWeight: 600,
                          }}
                        >
                          {engagementTypeBadge(e.type)}
                        </span>
                        {e.date && (
                          <span style={{ fontSize: 10, color: COLORS.ink4 }}>{e.date}</span>
                        )}
                      </div>
                      <p
                        style={{
                          fontSize: 12,
                          color: COLORS.ink2,
                          margin: 0,
                          lineHeight: 1.5,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {e.body}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          </div>
          {/* /LEFT COLUMN */}

          {/* RIGHT COLUMN — Qualification cards stacked vertically */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {activeQualification && (() => {
              const missingBant = BANT_FIELDS.filter((f) => !activeQualification[f.key]);
              return (
                <>
                  <Card padding={18}>
                    <SectionHeader title="Qualification" />
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {[...BANT_FIELDS, ...EXTRA_QUAL_FIELDS]
                        .filter((f) => activeQualification[f.key])
                        .map((f) => (
                          <div
                            key={f.key}
                            style={{
                              padding: "12px 14px",
                              borderRadius: 8,
                              background: COLORS.bgCard,
                              border: `1px solid ${COLORS.line}`,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: "0.06em",
                                textTransform: "uppercase",
                                color: COLORS.ink3,
                              }}
                            >
                              {f.label}
                            </div>
                            <div
                              style={{
                                fontSize: 13,
                                color: COLORS.ink0,
                                marginTop: 4,
                                lineHeight: 1.45,
                              }}
                            >
                              {activeQualification[f.key]}
                            </div>
                          </div>
                        ))}
                      {[...BANT_FIELDS, ...EXTRA_QUAL_FIELDS].every((f) => !activeQualification[f.key]) && (
                        <div style={{ fontSize: 12, color: COLORS.ink3, fontStyle: "italic" }}>
                          Aucune information de qualification.
                        </div>
                      )}
                    </div>
                  </Card>
                  {missingBant.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "14px 16px",
                        marginTop: 4,
                        borderRadius: 10,
                        background: COLORS.warnBg,
                        border: `1px solid ${COLORS.warn}33`,
                        fontSize: 14,
                        fontWeight: 600,
                        color: COLORS.warn,
                        justifyContent: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <AlertTriangle size={18} strokeWidth={2.25} style={{ flexShrink: 0 }} />
                      <span>
                        {missingBant.map((f) => f.label).join(", ")}
                        {" "}
                        {missingBant.length === 1 ? "manquant" : "manquants"}
                      </span>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
          {/* /RIGHT COLUMN */}
        </div>
      </div>

      {/* Claude modal overlay — centered with backdrop */}
      {claudeOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setClaudeOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 640,
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              background: "#fff",
              borderRadius: 12,
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
              overflow: "hidden",
            }}
          >
            <AskClaudePanel
              context={{
                deal: {
                  name: details.dealname,
                  stage: stageLabel,
                  amount: details.amount,
                  closeDate: details.closedate,
                  probability: details.probability,
                  type: details.dealType,
                  description: details.description,
                  score: details.score,
                  reasoning: details.reasoning,
                  nextAction: details.next_action,
                  qualification: details.qualification,
                },
                contacts: details.contacts,
                company: details.company,
                engagements: details.engagements,
                analysis: analysis ?? undefined,
              }}
              placeholder="Poser une question sur ce deal…"
              onClose={() => setClaudeOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ContactRow({
  contact,
  last,
}: {
  contact: { id: string; name: string; jobTitle: string; email: string; linkedinUrl: string | null };
  last: boolean;
}) {
  const [msgState, setMsgState] = React.useState<"idle" | "loading" | "done">("idle");
  const [msg, setMsg] = React.useState("");
  const [copied, setCopied] = React.useState(false);

  async function generateMsg() {
    setMsgState("loading");
    try {
      const r = await fetch("/api/linkedin/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: contact.name, jobTitle: contact.jobTitle, company: "", industry: "" }),
      });
      const data = await r.json();
      setMsg(data.message ?? "");
      setMsgState("done");
    } catch {
      setMsgState("idle");
    }
  }

  async function copyMsg() {
    await navigator.clipboard.writeText(msg);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      style={{
        paddingTop: 10,
        paddingBottom: last ? 0 : 10,
        borderBottom: last ? "none" : `1px solid ${COLORS.line}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>{contact.name}</div>
          {contact.jobTitle && <div style={{ fontSize: 11, color: COLORS.ink2 }}>{contact.jobTitle}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {contact.linkedinUrl && (
            <a href={contact.linkedinUrl} target="_blank" rel="noreferrer" style={{ color: "#0a66c2", display: "flex" }} aria-label="Profil LinkedIn">
              <Linkedin size={14} />
            </a>
          )}
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              style={{ fontSize: 11, color: COLORS.brand, textDecoration: "none" }}
            >
              {contact.email}
            </a>
          )}
        </div>
      </div>
      {contact.linkedinUrl && msgState !== "done" && (
        <button
          onClick={generateMsg}
          disabled={msgState === "loading"}
          style={{
            marginTop: 6,
            fontSize: 11,
            padding: "3px 10px",
            borderRadius: 6,
            border: `1px solid ${COLORS.line}`,
            background: COLORS.bgCard,
            color: COLORS.ink1,
            cursor: msgState === "loading" ? "not-allowed" : "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {msgState === "loading" ? (
            <>
              <RefreshCw size={10} className="animate-spin" /> Génération…
            </>
          ) : (
            <>
              <Linkedin size={10} /> Message LinkedIn
            </>
          )}
        </button>
      )}
      {msgState === "done" && msg && (
        <div
          style={{
            marginTop: 6,
            padding: "8px 10px",
            background: COLORS.bgSoft,
            borderRadius: 6,
            border: `1px solid ${COLORS.line}`,
            position: "relative",
          }}
        >
          <p style={{ fontSize: 11, color: COLORS.ink1, margin: 0, lineHeight: 1.5, paddingRight: 24 }}>
            {msg}
          </p>
          <button
            onClick={copyMsg}
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              background: "none",
              border: "none",
              cursor: "pointer",
              color: copied ? COLORS.ok : COLORS.ink3,
            }}
            aria-label="Copier"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
      )}
    </div>
  );
}

function AnalysisView({ analysis, onReanalyze }: { analysis: Analysis; onReanalyze: () => void }) {
  const riskColors: Record<string, string> = {
    Faible: COLORS.ok,
    Moyen: COLORS.warn,
    "Élevé": COLORS.err,
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, color: COLORS.ink2 }}>Niveau de risque :</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 999,
            color: riskColors[analysis.riskLevel] ?? COLORS.ink1,
            background: (riskColors[analysis.riskLevel] ?? COLORS.ink1) + "18",
          }}
        >
          {analysis.riskLevel}
        </span>
      </div>
      <p style={{ fontSize: 13, color: COLORS.ink1, lineHeight: 1.6, margin: 0 }}>
        {analysis.synthese ?? analysis.summary}
      </p>

      {analysis.dynamique && (
        <div
          style={{
            padding: "10px 12px",
            background: COLORS.bgSoft,
            borderRadius: 8,
            border: `1px solid ${COLORS.line}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <TrendingUp size={11} style={{ color: COLORS.ink2 }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.ink1 }}>Dynamique du deal</span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "1px 7px",
                borderRadius: 999,
                color:
                  analysis.dynamique.momentum === "En accélération"
                    ? COLORS.ok
                    : analysis.dynamique.momentum === "En perte de vitesse"
                      ? COLORS.err
                      : COLORS.warn,
                background:
                  analysis.dynamique.momentum === "En accélération"
                    ? COLORS.okBg
                    : analysis.dynamique.momentum === "En perte de vitesse"
                      ? COLORS.errBg
                      : "#fef9c3",
              }}
            >
              {analysis.dynamique.momentum}
            </span>
          </div>
          <p style={{ fontSize: 12, color: COLORS.ink2, margin: 0, lineHeight: 1.5 }}>
            {analysis.dynamique.analyse}
          </p>
        </div>
      )}

      {analysis.qualification && (
        <div style={{ borderRadius: 8, border: `1px solid ${COLORS.line}`, overflow: "hidden" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: COLORS.ink1,
              padding: "6px 12px",
              background: COLORS.bgSoft,
              borderBottom: `1px solid ${COLORS.line}`,
            }}
          >
            Qualification (analyse)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            {[
              { key: "budget", label: "Budget", color: "#0369a1" },
              { key: "authority", label: "Autorité", color: "#7c3aed" },
              { key: "need", label: "Besoin", color: "#b45309" },
              { key: "timeline", label: "Timeline", color: "#0f766e" },
              { key: "fit", label: "Fit stratégique", color: COLORS.ok },
            ].map(({ key, label, color: c }) => {
              const val = analysis.qualification?.[key as keyof typeof analysis.qualification];
              if (!val) return null;
              return (
                <div
                  key={key}
                  style={{
                    padding: "6px 12px",
                    borderBottom: `1px solid ${COLORS.line}`,
                    borderRight: `1px solid ${COLORS.line}`,
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 700, color: c, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 12, color: COLORS.ink1, lineHeight: 1.4 }}>{val}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(analysis.scoreInsight ?? analysis.scoringInsight) && (
        <div
          style={{
            padding: "10px 12px",
            background: COLORS.infoBg,
            borderRadius: 8,
            border: "1px solid #c7d2fe",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.info, marginBottom: 3 }}>
            Insight score
          </div>
          <p style={{ fontSize: 12, color: COLORS.info, margin: 0, lineHeight: 1.5 }}>
            {analysis.scoreInsight ?? analysis.scoringInsight}
          </p>
        </div>
      )}

      {(analysis.signaux?.positifs ?? analysis.positiveSignals)?.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.ok, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
            <CheckCircle size={12} /> Signaux positifs
          </div>
          {(analysis.signaux?.positifs ?? analysis.positiveSignals ?? []).map((s, i) => (
            <div
              key={i}
              style={{
                fontSize: 12,
                color: COLORS.ink1,
                marginBottom: 3,
                paddingLeft: 12,
                position: "relative",
              }}
            >
              <span style={{ position: "absolute", left: 0, color: COLORS.ok }}>·</span>
              {s}
            </div>
          ))}
        </div>
      )}

      {(analysis.signaux?.negatifs ?? analysis.negativeSignals)?.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.err, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
            <AlertCircle size={12} /> Points d&apos;attention
          </div>
          {(analysis.signaux?.negatifs ?? analysis.negativeSignals ?? []).map((s, i) => (
            <div
              key={i}
              style={{
                fontSize: 12,
                color: COLORS.ink1,
                marginBottom: 3,
                paddingLeft: 12,
                position: "relative",
              }}
            >
              <span style={{ position: "absolute", left: 0, color: COLORS.err }}>·</span>
              {s}
            </div>
          ))}
        </div>
      )}

      {analysis.risques?.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: COLORS.warn,
              marginBottom: 4,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <AlertCircle size={12} /> Risques identifiés
          </div>
          {analysis.risques.map((r, i) => (
            <div
              key={i}
              style={{
                fontSize: 12,
                color: COLORS.ink1,
                marginBottom: 4,
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: "1px 5px",
                  borderRadius: 999,
                  marginTop: 2,
                  whiteSpace: "nowrap",
                  color:
                    r.severite === "Élevé"
                      ? COLORS.err
                      : r.severite === "Moyen"
                        ? COLORS.warn
                        : COLORS.ink2,
                  background:
                    r.severite === "Élevé"
                      ? COLORS.errBg
                      : r.severite === "Moyen"
                        ? "#fef9c3"
                        : COLORS.bgSoft,
                }}
              >
                {r.severite}
              </span>
              {r.risque}
            </div>
          ))}
        </div>
      )}

      {((analysis.prochaines_etapes?.length ?? 0) > 0 || (analysis.nextSteps?.length ?? 0) > 0) && (
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: COLORS.ink1,
              marginBottom: 4,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <TrendingUp size={12} /> Prochaines étapes
          </div>
          {analysis.prochaines_etapes
            ? analysis.prochaines_etapes.map((s, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 12,
                    color: COLORS.ink1,
                    marginBottom: 6,
                    paddingLeft: 14,
                    position: "relative",
                  }}
                >
                  <span style={{ position: "absolute", left: 0, color: COLORS.brand, fontWeight: 700 }}>{i + 1}.</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "1px 5px",
                        borderRadius: 999,
                        color:
                          s.priorite === "Urgent"
                            ? COLORS.err
                            : s.priorite === "Moyen"
                              ? COLORS.warn
                              : COLORS.ink2,
                        background:
                          s.priorite === "Urgent"
                            ? COLORS.errBg
                            : s.priorite === "Moyen"
                              ? "#fef9c3"
                              : COLORS.bgSoft,
                      }}
                    >
                      {s.priorite}
                    </span>
                    <span>{s.action}</span>
                  </div>
                  {s.impact && (
                    <div style={{ fontSize: 11, color: COLORS.ink2, marginTop: 1, fontStyle: "italic" }}>
                      {s.impact}
                    </div>
                  )}
                </div>
              ))
            : (analysis.nextSteps ?? []).map((s, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 12,
                    color: COLORS.ink1,
                    marginBottom: 3,
                    paddingLeft: 14,
                    position: "relative",
                  }}
                >
                  <span style={{ position: "absolute", left: 0, color: COLORS.brand }}>{i + 1}.</span>
                  {s}
                </div>
              ))}
        </div>
      )}

      <button
        onClick={onReanalyze}
        style={{
          padding: "6px 14px",
          borderRadius: 6,
          background: "none",
          border: `1px solid ${COLORS.line}`,
          color: COLORS.ink2,
          fontSize: 11,
          cursor: "pointer",
          alignSelf: "flex-start",
        }}
      >
        Re-analyser
      </button>
    </div>
  );
}
