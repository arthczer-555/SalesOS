"use client";

import * as React from "react";
import {
  X,
  Mail,
  Zap,
  AlertCircle,
  CheckCircle,
  TrendingUp,
  RefreshCw,
  Linkedin,
  Copy,
  Check,
  Send,
  ChevronDown,
  Sparkles,
  Wand2,
  PenLine,
} from "lucide-react";
import Link from "next/link";
import { useUserMe } from "@/lib/hooks/use-user-me";
import {
  type DealScore,
} from "@/lib/deal-scoring";
import { AskClaudePanel } from "@/components/ask-claude";
import { COLORS } from "@/lib/design/tokens";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { CompanyAvatar } from "@/components/ui/company-avatar";
import { IconButton } from "@/components/ui/icon-button";
import type { DealCommittee, KunaEntry } from "@/lib/deals/kuna";
import type { Analysis, AnalysisEvent, DealDetails, Stage } from "../_helpers";
import { engagementTypeBadge, formatDealForSlack, timeAgo } from "../_helpers";
import { DealLinkedinCard } from "./deal-linkedin-card";
import { DealNewsCard } from "./deal-news-card";
import { DealEventsTimeline } from "./deal-timeline-card";
import { DealKunaCard } from "./deal-kuna-card";
import { DealHeaderSummary, DealScoreDetails } from "./deal-header-summary";
import { DealNextMove, DealPathToClose } from "./deal-path-to-close";
import {
  DealCommitteeCard,
  DealRetroplanningCard,
  DealStageStepper,
  DealThreadingCard,
} from "./deal-strategy-cards";

interface Props {
  details: DealDetails | null;
  loading: boolean;
  onClose: () => void;
  onRescore: (dealId: string, score: DealScore, reasoning: string, next_action: string) => void;
  stageLabel: string;
  stageColor: string;
  slackName: string | null;
  lastGlobalScoringAt?: string | null;
  // Étapes ouvertes du Sales Pipeline (hors nurture) pour le stepper.
  stages?: Stage[];
}

export function DealDetailPanel({
  details,
  loading,
  onClose,
  onRescore,
  stageLabel,
  stageColor: color,
  slackName,
  stages = [],
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
  const [emailInstructions, setEmailInstructions] = React.useState("");
  const [emailError, setEmailError] = React.useState("");

  // Signature perso (configurée dans Settings), injectée à l'envoi par /api/gmail/send.
  const { signature } = useUserMe();
  const hasSignature = Boolean(signature?.enabled);
  const [includeSignature, setIncludeSignature] = React.useState(true);
  const [showScoreDetails, setShowScoreDetails] = React.useState(false);
  const [showEngagements, setShowEngagements] = React.useState(false);
  const [engagementsShown, setEngagementsShown] = React.useState(5);
  const [claudeOpen, setClaudeOpen] = React.useState(false);
  const [rescoring, setRescoring] = React.useState(false);
  const [localScore, setLocalScore] = React.useState<{
    score: DealScore;
    reasoning: string;
    next_action: string;
    scoredAt: string;
    qualification: Record<string, string | null> | null;
    key_events: AnalysisEvent[];
    kuna: KunaEntry[] | null;
    committee: DealCommittee | null;
    goLiveDate: string | null;
  } | null>(null);

  React.useEffect(() => {
    setAnalysis(null);
    setAnalysisStale(false);
    setAnalyzeError("");
    setAnalyzing(false);
    setEmailDraft(null);
    setShowComposer(false);
    setSent(false);
    setEmailInstructions("");
    setEmailError("");
    setShowScoreDetails(false);
    setShowEngagements(false);
    setEngagementsShown(5);
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
        setAnalyzeError("The analysis did not respond within 3 min. Restart it with the button.");
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
          setAnalyzeError(data.error || "Error during analysis");
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
        throw new Error("The server returned an unexpected response. Try again in a moment.");
      }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Error");

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
      setAnalyzeError(e instanceof Error ? e.message : "Error");
      setAnalyzing(false);
    }
  }, [details]);

  /**
   * Sans argument : génère un brouillon de zéro. Avec `rewrite`, retouche le
   * brouillon courant (éditions manuelles comprises) selon les instructions.
   */
  const generateEmail = React.useCallback(async (rewrite?: string) => {
    if (!details) return;
    setGenerating(true);
    setEmailError("");
    try {
      const r = await fetch("/api/deals/generate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: details.id,
          ...(rewrite
            ? { instructions: rewrite, currentSubject: emailSubject, currentBody: emailBody }
            : {}),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Error");
      if (rewrite) {
        // Retouche : on ne touche pas au destinataire éventuellement édité.
        setEmailSubject(data.subject ?? "");
        setEmailBody(data.body ?? "");
        setEmailInstructions("");
      } else {
        setEmailDraft(data);
      }
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : "Error");
    } finally {
      setGenerating(false);
    }
  }, [details, emailSubject, emailBody]);

  const sendEmail = React.useCallback(async () => {
    if (!emailTo || !emailSubject || !emailBody) return;
    setSending(true);
    setEmailError("");
    try {
      // /api/gmail/send lit un FormData (pièces jointes possibles), pas du JSON.
      const fd = new FormData();
      fd.set("to", emailTo);
      fd.set("subject", emailSubject);
      fd.set("body", emailBody);
      fd.set("source", "deals_email");
      if (hasSignature && includeSignature) fd.set("include_signature", "1");
      const r = await fetch("/api/gmail/send", { method: "POST", body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Failed to send");
      setSent(true);
      setShowComposer(false);
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : "Error");
    } finally {
      setSending(false);
    }
  }, [emailTo, emailSubject, emailBody, hasSignature, includeSignature]);

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
          key_events: Array.isArray(data.key_events) ? data.key_events : [],
          kuna: Array.isArray(data.kuna) ? data.kuna : null,
          committee: data.committee ?? null,
          goLiveDate: data.go_live_date ?? null,
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
        throw new Error(data.error ?? "Error");
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
  // Un rescore sans KUNA lisible garde la qualification précédente (cf persistDealScore).
  const activeKuna = localScore?.kuna ?? details.kuna;
  const activeCommittee = localScore?.kuna ? localScore.committee : details.committee;
  const activeGoLive = localScore?.kuna ? localScore.goLiveDate : details.goLiveDate;
  const threading = details.threading ?? { active: [], windowDays: 30 };
  const stepperVisible = stages.some((st) => st.id === details.dealstage);
  const amountNum = parseFloat(details.amount);
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
          padding: "16px 20px 14px",
          background: COLORS.bgCard,
          borderBottom: `1px solid ${COLORS.line}`,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
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
          {/* La forme /_/ laisse HubSpot résoudre le portail actif : pas de
              dépendance à une variable d'environnement. */}
          <a
            href={`https://app.hubspot.com/contacts/_/deal/${details.id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 11, color: COLORS.ink3, textDecoration: "none" }}
            title="Open this deal in HubSpot"
          >
            Open in HubSpot ↗
          </a>
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
            {/* Montant et close date sont dans la ligne de résumé, l'étape dans
                le stepper : ici l'étape ne s'affiche que hors Sales Pipeline. */}
            {[
              !stepperVisible && stageLabel ? (
                <span key="stage" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                  <span style={{ fontWeight: 500, color: COLORS.ink1 }}>{stageLabel}</span>
                </span>
              ) : null,
              details.company?.industry ? <span key="industry">{details.company.industry.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</span> : null,
              details.company?.employees ? <span key="employees">{parseInt(details.company.employees, 10).toLocaleString("en-GB")} employees</span> : null,
              details.ownerName ? <span key="owner">Owner {details.ownerName}</span> : null,
            ]
              .filter(Boolean)
              .flatMap((el, i) => (i === 0 ? [el] : [<span key={`sep-${i}`} aria-hidden="true">·</span>, el]))}
          </div>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <IconButton
            icon={Mail}
            aria-label="Write an email"
            onClick={() => generateEmail()}
            disabled={generating}
            title="Follow-up email"
          />
          <button
            type="button"
            onClick={() => setClaudeOpen(true)}
            aria-label="Ask Claude a question"
            title="Ask Claude a question"
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
              aria-label="Send to Slack"
              title="Send as Slack DM"
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
              {slackSent ? "Sent" : "Slack"}
            </button>
          )}
          <button
            type="button"
            onClick={rescore}
            disabled={rescoring}
            aria-label="Rescore this deal"
            title={activeScoredAt ? `Scored ${timeAgo(activeScoredAt)}` : "Rescore this deal"}
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
            {rescoring ? "Scoring…" : "Rescore"}
          </button>
          <span style={{ width: 1, height: 22, background: COLORS.line, margin: "0 2px" }} />
          <IconButton icon={X} aria-label="Close" onClick={onClose} variant="ghost" />
        </div>
      </div>
      <DealHeaderSummary
        score={activeScore}
        scoredAt={activeScoredAt}
        detailsOpen={showScoreDetails}
        onToggleDetails={() => setShowScoreDetails((v) => !v)}
        onRescore={rescore}
        rescoring={rescoring}
        amountNum={isNaN(amountNum) ? 0 : amountNum}
        closedate={details.closedate}
        createdate={details.createdate}
        stageLabel={stageLabel}
        events={details.events}
        threading={threading}
      />
      {stepperVisible && <DealStageStepper stages={stages} currentStageId={details.dealstage} />}
      </div>

      {/* Body : score, puis stratégie du deal (Path to close, KUNA, committee,
          threading, retroplanning), puis les sections historiques. */}
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {showScoreDetails && activeScore && <DealScoreDetails score={activeScore} reasoning={activeReasoning} />}

          {/* Stratégie du deal : Path to close + Next move */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {activeKuna ? (
              <DealPathToClose kuna={activeKuna} activeThreads={threading.active.length} amount={isNaN(amountNum) ? 0 : amountNum} />
            ) : (
              <Card padding={20} style={{ flex: "999 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.ink0 }}>KUNA qualification not generated yet</span>
                <span style={{ fontSize: 13, color: COLORS.ink2, lineHeight: 1.5 }}>
                  Rescore this deal to read the budget, decision date, Economic Buyer, buying committee and 7 other dimensions from the exchanges.
                </span>
                <button
                  type="button"
                  onClick={rescore}
                  disabled={rescoring}
                  style={{
                    alignSelf: "flex-start",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "none",
                    background: COLORS.ink0,
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: rescoring ? "default" : "pointer",
                    opacity: rescoring ? 0.7 : 1,
                  }}
                >
                  {rescoring ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={13} />}
                  {rescoring ? "Scoring…" : "Rescore"}
                </button>
              </Card>
            )}
            {activeNextAction && <DealNextMove text={activeNextAction} />}
          </div>

          {activeKuna && <DealKunaCard kuna={activeKuna} scoredAt={activeScoredAt} />}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, alignItems: "start" }}>
            {activeCommittee && <DealCommitteeCard committee={activeCommittee} />}
            <DealThreadingCard threading={threading} amount={isNaN(amountNum) ? 0 : amountNum} />
            <DealRetroplanningCard goLiveDate={activeGoLive} />
          </div>

          {/* Timeline — étapes pipeline + réunions Claap + événements clés extraits
              par l'IA (scoring + analyse approfondie, fusionnés) */}
          <DealEventsTimeline
            events={details.events}
            meetings={details.meetings}
            analysisEvents={[
              ...((localScore?.key_events ?? details.keyEvents) ?? []),
              ...(analysis?.evenements_cles ?? []),
            ]}
          />

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
              {analyzing ? "Analyzing…" : "Deep analysis"}
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
                <SectionHeader title="Deep analysis" />
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
                        Updating
                      </>
                    ) : (
                      "Analysis outdated"
                    )}
                  </span>
                )}
              </div>
              <AnalysisView analysis={analysis} onReanalyze={() => analyze({ force: true })} />
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

          {/* LinkedIn enrichment (Bright Data) */}
          {details.contacts.length > 0 && details.id && <DealLinkedinCard dealId={details.id} />}

          {/* News Tavily (signaux business) */}
          {details.id && <DealNewsCard dealId={details.id} />}

          {/* Email composer */}
          {sent && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: COLORS.ok, fontSize: 13 }}>
              <CheckCircle size={14} /> Email sent successfully
            </div>
          )}
          {showComposer && !sent && (
            <Card padding={14}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="To (email)"
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
                  placeholder="Subject"
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

                {/* Reprompt : retouche le brouillon courant plutôt que de tout refaire */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: 10,
                    borderRadius: 6,
                    background: COLORS.bgSoft,
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: COLORS.ink0 }}>
                    <Sparkles size={12} style={{ color: COLORS.brand }} />
                    Ask Claude to rewrite
                  </span>
                  <textarea
                    value={emailInstructions}
                    onChange={(e) => setEmailInstructions(e.target.value)}
                    rows={2}
                    disabled={generating}
                    placeholder="e.g. Make it shorter, warmer tone, push for a meeting next week…"
                    style={{
                      fontSize: 12,
                      padding: "7px 9px",
                      borderRadius: 6,
                      border: `1px solid ${COLORS.line}`,
                      outline: "none",
                      resize: "none",
                      fontFamily: "inherit",
                      background: "#fff",
                    }}
                  />
                  <button
                    onClick={() => generateEmail(emailInstructions.trim())}
                    disabled={generating || !emailInstructions.trim()}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 5,
                      padding: 7,
                      borderRadius: 6,
                      background: generating || !emailInstructions.trim() ? COLORS.bgSoft : COLORS.brand,
                      color: generating || !emailInstructions.trim() ? COLORS.ink3 : "#fff",
                      border: generating || !emailInstructions.trim() ? `1px solid ${COLORS.line}` : "none",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: generating || !emailInstructions.trim() ? "not-allowed" : "pointer",
                    }}
                  >
                    <Wand2 size={12} />
                    {generating ? "Rewriting…" : "Rewrite"}
                  </button>
                </div>

                {hasSignature ? (
                  <button
                    onClick={() => setIncludeSignature((v) => !v)}
                    title={includeSignature ? "Signature added to this email" : "Signature disabled for this email"}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      alignSelf: "flex-start",
                      background: "none",
                      border: "none",
                      padding: 0,
                      fontSize: 12,
                      color: includeSignature ? COLORS.brand : COLORS.ink3,
                      cursor: "pointer",
                    }}
                  >
                    <PenLine size={13} />
                    {includeSignature ? "Signature on" : "Signature off"}
                  </button>
                ) : (
                  <Link
                    href="/settings"
                    title="Set up your signature in Settings"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, alignSelf: "flex-start", fontSize: 12, color: COLORS.ink3 }}
                  >
                    <PenLine size={13} />
                    Add signature
                  </Link>
                )}

                {emailError && (
                  <div style={{ fontSize: 12, color: COLORS.err }}>{emailError}</div>
                )}

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
                    {sending ? "Sending…" : "Send via Gmail"}
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
                    Cancel
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
                  Recent activity ({details.engagements.length})
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
                <>
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                    {details.engagements.slice(0, engagementsShown).map((e, i, shown) => (
                      <div
                        key={i}
                        style={{
                          paddingBottom: 10,
                          borderBottom:
                            i < shown.length - 1 ? `1px solid ${COLORS.line}` : "none",
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
                  {engagementsShown < details.engagements.length && (
                    <button
                      type="button"
                      onClick={() => setEngagementsShown((n) => n + 5)}
                      style={{
                        marginTop: 12,
                        fontSize: 12,
                        fontWeight: 600,
                        color: COLORS.brand,
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      Load more ({details.engagements.length - engagementsShown})
                    </button>
                  )}
                </>
              )}
            </Card>
          )}

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
                  kuna: activeKuna,
                  buyingCommittee: activeCommittee,
                  goLiveDate: activeGoLive,
                  activeContactsLast30Days: threading.active,
                },
                contacts: details.contacts,
                company: details.company,
                engagements: details.engagements,
                analysis: analysis ?? undefined,
              }}
              placeholder="Ask a question about this deal…"
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
            <a href={contact.linkedinUrl} target="_blank" rel="noreferrer" style={{ color: "#0a66c2", display: "flex" }} aria-label="LinkedIn profile">
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
              <RefreshCw size={10} className="animate-spin" /> Generating…
            </>
          ) : (
            <>
              <Linkedin size={10} /> LinkedIn message
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
            aria-label="Copy"
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
  // Display-only FR->EN maps (the raw values come from the AI and are kept as the
  // color/comparison keys above; we only translate what is shown on screen).
  const RISK_EN: Record<string, string> = { Faible: "Low", Moyen: "Medium", "Élevé": "High" };
  const MOMENTUM_EN: Record<string, string> = { "En accélération": "Accelerating", Stable: "Stable", "En perte de vitesse": "Losing momentum" };
  const PRIORITY_EN: Record<string, string> = { Urgent: "Urgent", Moyen: "Medium", Faible: "Low" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, color: COLORS.ink2 }}>Risk level:</span>
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
          {RISK_EN[analysis.riskLevel] ?? analysis.riskLevel}
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
            <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.ink1 }}>Deal momentum</span>
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
              {MOMENTUM_EN[analysis.dynamique.momentum] ?? analysis.dynamique.momentum}
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
            Qualification (analysis)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            {[
              { key: "budget", label: "Budget", color: "#0369a1" },
              { key: "authority", label: "Authority", color: "#7c3aed" },
              { key: "need", label: "Need", color: "#b45309" },
              { key: "timeline", label: "Timeline", color: "#0f766e" },
              { key: "fit", label: "Strategic fit", color: COLORS.ok },
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
            Score insight
          </div>
          <p style={{ fontSize: 12, color: COLORS.info, margin: 0, lineHeight: 1.5 }}>
            {analysis.scoreInsight ?? analysis.scoringInsight}
          </p>
        </div>
      )}

      {(analysis.signaux?.positifs ?? analysis.positiveSignals)?.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.ok, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
            <CheckCircle size={12} /> Positive signals
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
            <AlertCircle size={12} /> Points of attention
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
            <AlertCircle size={12} /> Identified risks
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
                {RISK_EN[r.severite] ?? r.severite}
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
            <TrendingUp size={12} /> Next steps
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
                      {PRIORITY_EN[s.priorite] ?? s.priorite}
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
        Re-analyze
      </button>
    </div>
  );
}
