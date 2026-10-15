"use client";

import { useEffect, useRef, useState } from "react";
import {
  Send,
  CheckCircle2,
  AlertCircle,
  Target,
  TrendingUp,
  MessageSquare,
  FileText,
  RefreshCw,
  ExternalLink,
  Building2,
  Calendar,
  Users,
  History,
  Quote,
  Lightbulb,
  ClipboardCheck,
  Trash2,
  Info,
  ChevronDown,
  ArrowLeftRight,
} from "lucide-react";
import { MeddicBadge } from "@/components/ui/meddic-badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useSalesCoachDetail, useSalesCoachDealHistory } from "@/lib/hooks/use-sales-coach";
import type {
  AnySalesCoachAnalysis,
  AxisScore,
  ClientSalesCoachAnalysis,
  CustomerHealth,
  MeddicScore,
  SalesCoachAnalysis,
} from "@/lib/guides/sales-coach";
import {
  extractStringArray,
  getMeetingKindLabel,
  isAnalysisAudienceStale,
  isDiscoveryKind,
  repairAnalysis,
  resolveIsClient,
} from "@/lib/guides/sales-coach";
import { SynthesisTab } from "./synthesis-tab";
import { EmailDraftModal } from "./email-draft-modal";
import { ManualDealResolution } from "./manual-deal-resolution";
import { DealPicker, type DealSearchResult } from "./deal-picker";
import { Sparkles } from "lucide-react";
import { COLORS, scoreToColor } from "@/lib/design/tokens";
import { ScoreGauge } from "@/components/ui/score-gauge";
import { TabBar } from "@/components/ui/tab-bar";
import { useToast } from "@/components/ui/toast";

interface Props {
  analysisId: string;
  onSlackSent?: () => void;
  onDeleted?: () => void;
}

type TabId = "synthese" | "axes" | "meddic" | "bosche" | "customer_health" | "history" | "transcript";

function scoreColor(score: number): string {
  return scoreToColor(score, 10).fg;
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(10, score)) * 10;
  const color = scoreColor(score);
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 h-1.5 rounded-full" style={{ background: "#f0f0f0" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-semibold tabular-nums" style={{ color, minWidth: 36 }}>
        {score.toFixed(1)}/10
      </span>
    </div>
  );
}

const AXES_LABELS: { key: keyof SalesCoachAnalysis["axes"]; label: string }[] = [
  { key: "opening", label: "Opening & first impressions" },
  { key: "discovery", label: "Discovery quality" },
  { key: "active_listening", label: "Active listening" },
  { key: "value_articulation", label: "Value articulation" },
  { key: "objection_handling", label: "Objection handling" },
  { key: "next_steps", label: "Next steps & closing" },
];

const CLIENT_AXES_LABELS: { key: keyof ClientSalesCoachAnalysis["axes"]; label: string }[] = [
  { key: "opening", label: "Opening & relationship rapport" },
  { key: "discovery", label: "Discovery (goal evolution)" },
  { key: "active_listening", label: "Active listening" },
  { key: "value_reinforcement", label: "Value reinforcement (ROI delivered)" },
  { key: "expansion_discovery", label: "Expansion discovery" },
  { key: "next_steps", label: "Next steps & follow-through" },
];

const CUSTOMER_HEALTH_LABELS: { key: keyof CustomerHealth; label: string }[] = [
  { key: "relationship", label: "Relationship & multi-threading" },
  { key: "adoption", label: "Product adoption" },
  { key: "sentiment", label: "Sentiment" },
  { key: "expansion_signals", label: "Expansion signals" },
  { key: "risk_flags", label: "Risk signals" },
];

const MEDDIC_LABELS: { key: keyof SalesCoachAnalysis["meddic"]; label: string; short: string }[] = [
  { key: "metrics", label: "Metrics - quantifiable impact", short: "M" },
  { key: "economic_buyer", label: "Economic Buyer - budget holder", short: "EB" },
  { key: "decision_criteria", label: "Decision Criteria - selection criteria", short: "DC" },
  { key: "decision_process", label: "Decision Process - buying steps", short: "DP" },
  { key: "identify_pain", label: "Identify Pain - real pain", short: "IP" },
  { key: "champion", label: "Champion - internal advocate", short: "C" },
];

const EMPTY_AXIS: AxisScore = { score: 0, notes: "", evidence: "", explanation: "", recommendation: "" };

const BOSCHE_LABELS: { key: keyof SalesCoachAnalysis["bosche"]; label: string; short: string }[] = [
  { key: "business", label: "Business pressure", short: "B" },
  { key: "organization", label: "Organizational friction", short: "O" },
  { key: "skills", label: "Skills gap", short: "S" },
  { key: "consequences", label: "Consequences", short: "C" },
  { key: "human_economic", label: "Human & Economic impact", short: "H.E" },
];

function AxisCard({
  label,
  axis,
  collapsible = false,
}: {
  label: string;
  axis: AxisScore | MeddicScore;
  collapsible?: boolean;
}) {
  const score = typeof axis.score === "number" ? axis.score : 0;
  const notes = typeof axis.notes === "string" ? axis.notes : "";
  const isNA = score === 0 && /n\/?a/i.test(notes);
  const hasDetails = !!axis.evidence || !!axis.explanation || !!axis.recommendation;
  const [expanded, setExpanded] = useState(!collapsible);

  return (
    <div className="rounded-lg p-4" style={{ background: "#fff", border: "1px solid #eeeeee" }}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-sm font-medium" style={{ color: "#111" }}>{label}</div>
        {isNA ? (
          <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ color: "#888", background: "#f4f4f4" }}>N/A</span>
        ) : (
          <ScoreBar score={score} />
        )}
      </div>
      <p className="text-sm" style={{ color: "#333" }}>{notes}</p>

      {collapsible && hasDetails && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium"
          style={{ color: "#666", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
        >
          <ChevronDown
            size={13}
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
          />
          {expanded ? "Hide details" : "View details"}
        </button>
      )}

      {expanded && axis.evidence && (
        <div className="mt-3">
          <div className="flex items-center gap-1 mb-1 text-[11px] uppercase tracking-wider font-medium" style={{ color: "#888" }}>
            <Quote size={10} />
            Meeting quote
          </div>
          <div className="text-xs italic px-3 py-2 rounded border-l-2" style={{ color: "#555", background: "#fafafa", borderColor: "#f01563" }}>
            « {axis.evidence} »
          </div>
        </div>
      )}

      {expanded && axis.explanation && (
        <div className="mt-3">
          <div className="flex items-center gap-1 mb-1 text-[11px] uppercase tracking-wider font-medium" style={{ color: "#888" }}>
            <Lightbulb size={10} />
            Why this score
          </div>
          <p className="text-xs leading-relaxed" style={{ color: "#444" }}>{axis.explanation}</p>
        </div>
      )}

      {expanded && axis.recommendation && (
        <div className="mt-3 rounded-md px-3 py-2" style={{ background: "#fef2f4", border: "1px solid #fbd5de" }}>
          <div className="flex items-center gap-1 mb-1 text-[11px] uppercase tracking-wider font-semibold" style={{ color: "#f01563" }}>
            <ClipboardCheck size={11} />
            Tip for the next call
          </div>
          <p className="text-xs leading-relaxed" style={{ color: "#7a0e35" }}>{axis.recommendation}</p>
        </div>
      )}
    </div>
  );
}

function CompactScoreCard({
  label,
  axis,
  framework,
  dimension,
}: {
  label: string;
  axis: AxisScore | MeddicScore;
  framework: "meddic" | "bosche";
  dimension: string;
}) {
  const score = typeof axis.score === "number" ? axis.score : 0;
  const notes = typeof axis.notes === "string" ? axis.notes : "";
  const recommendation =
    "recommendation" in axis && typeof axis.recommendation === "string" ? axis.recommendation : "";
  const na = score === 0 && /n\/?a/i.test(notes);
  const sc = scoreToColor(score, 10);
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 10,
        border: `1px solid ${COLORS.line}`,
        background: COLORS.bgCard,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <MeddicBadge dimension={dimension} size={28} framework={framework} />
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: COLORS.ink0,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {label}
          </span>
        </div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: na ? COLORS.ink3 : sc.fg,
            fontVariantNumeric: "tabular-nums",
            flexShrink: 0,
          }}
        >
          {na ? "N/A" : `${score.toFixed(1)}/10`}
        </span>
      </div>
      {notes && !na && (
        <p
          style={{
            fontSize: 12,
            color: COLORS.ink2,
            margin: 0,
            lineHeight: 1.4,
          }}
        >
          {notes}
        </p>
      )}
      {recommendation && (
        <div
          style={{
            marginTop: 2,
            paddingTop: 6,
            borderTop: `1px dashed ${COLORS.line}`,
            fontSize: 12,
            color: COLORS.ink1,
            lineHeight: 1.4,
          }}
        >
          <span style={{ fontWeight: 600, color: COLORS.ink0 }}>Tip: </span>
          {recommendation}
        </div>
      )}
      {!na && <ProgressBar value={score * 10} max={100} height={4} variant="auto" scale={100} />}
    </div>
  );
}

function DealTopo({
  snapshot,
  companySnapshot,
  dealId,
  analysisId,
  onDealUpdated,
}: {
  snapshot: import("@/lib/hubspot").DealSnapshot | null;
  companySnapshot: import("@/lib/hubspot").CompanyMatchSnapshot | null;
  dealId: string | null;
  analysisId: string;
  onDealUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [autoResolving, setAutoResolving] = useState(false);
  const [autoResolveMsg, setAutoResolveMsg] = useState<string | null>(null);
  const [refreshingSnapshot, setRefreshingSnapshot] = useState(false);
  const snapshotFetchedRef = useRef<string | null>(null);
  const { toast } = useToast();

  // When the analysis has a deal but no snapshot yet (e.g. row created before
  // deal_snapshot was captured), silently backfill it so the UI shows the deal
  // name instead of the raw HubSpot ID. Guarded by a ref to avoid retry loops.
  useEffect(() => {
    if (!dealId || snapshot) return;
    if (snapshotFetchedRef.current === dealId) return;
    snapshotFetchedRef.current = dealId;
    setRefreshingSnapshot(true);
    fetch(`/api/sales-coach/${analysisId}/refresh-snapshot`, { method: "POST" })
      .then((res) => {
        if (res.ok) onDealUpdated();
      })
      .catch(() => {})
      .finally(() => setRefreshingSnapshot(false));
  }, [analysisId, dealId, snapshot, onDealUpdated]);

  async function autoResolve() {
    setAutoResolving(true);
    setAutoResolveMsg(null);
    try {
      const res = await fetch(`/api/sales-coach/${analysisId}/resolve-deal`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      if (data.dealId) {
        setAutoResolveMsg(`Deal found: ${data.name ?? data.dealId}`);
        onDealUpdated();
      } else {
        setAutoResolveMsg(data.reason === "no_match" ? "No matching deal found." : "Could not find a deal.");
      }
    } catch (e) {
      setAutoResolveMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setAutoResolving(false);
    }
  }

  // Rattache le meeting à un autre deal (ou à un premier deal) puis relance
  // l'analyse côté serveur, en un seul appel. La fiche repasse en "Analysis in
  // progress" au reload et se met à jour seule à la fin.
  async function changeDeal(deal: DealSearchResult) {
    setChanging(true);
    setChangeError(null);
    try {
      const res = await fetch(`/api/sales-coach/${analysisId}/change-deal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: deal.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Error while changing the deal");
      setEditing(false);
      toast(`Linked to ${deal.name || `deal ${deal.id}`}. Re-analysis started.`, "success");
      onDealUpdated();
    } catch (e) {
      setChangeError(e instanceof Error ? e.message : "Error");
    } finally {
      setChanging(false);
    }
  }

  function closeEditor() {
    setEditing(false);
    setChangeError(null);
  }

  const changePanel = editing ? (
    <div className="rounded-lg p-4 mt-2" style={{ background: "#fff", border: "1px solid #eeeeee" }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-sm font-semibold" style={{ color: "#111" }}>
            {dealId ? "Link this meeting to another deal" : "Link a deal"}
          </div>
          <div className="text-xs mt-0.5" style={{ color: "#888" }}>
            The meeting will be re-analyzed with this deal&apos;s context, and the Slack debrief and recap sent again.
          </div>
        </div>
        <button onClick={closeEditor} disabled={changing} className="text-xs disabled:opacity-50" style={{ color: "#888" }}>
          Cancel
        </button>
      </div>
      <DealPicker
        confirmLabel="Link and re-analyze"
        busyLabel="Linking…"
        busy={changing}
        error={changeError}
        onConfirm={changeDeal}
        onSelectionChange={() => setChangeError(null)}
        currentDealId={dealId}
      />
    </div>
  ) : null;

  const changeDealButton = (
    <button
      onClick={() => setEditing(true)}
      disabled={editing}
      className="flex items-center gap-1 text-[11px] font-medium disabled:opacity-50"
      style={{ color: "#888" }}
      title="Link this meeting to another HubSpot deal"
    >
      <ArrowLeftRight size={10} />
      Change deal
    </button>
  );

  async function reanalyze() {
    setReanalyzing(true);
    try {
      const res = await fetch(`/api/sales-coach/${analysisId}/reanalyze`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Error");
      }
      onDealUpdated();
      toast("Re-analysis started.", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", "error");
    } finally {
      setReanalyzing(false);
    }
  }

  async function refreshSnapshot() {
    setRefreshingSnapshot(true);
    try {
      const res = await fetch(`/api/sales-coach/${analysisId}/refresh-snapshot`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        audience?: string;
        pipeline_label?: string | null;
        stage_label?: string | null;
        is_closed_won?: boolean | null;
      };
      if (!res.ok) throw new Error(data.error ?? "Error");
      onDealUpdated();
      const closedWonLabel = data.is_closed_won === true ? "yes" : data.is_closed_won === false ? "no" : "?";
      toast(
        `Snapshot refreshed. Audience: ${data.audience ?? "?"}, pipeline: ${data.pipeline_label ?? "?"}, stage: ${data.stage_label ?? "?"}, closed won: ${closedWonLabel}.`,
        "success",
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", "error");
    } finally {
      setRefreshingSnapshot(false);
    }
  }

  // No deal linked at all
  if (!dealId) {
    return (
      <>
      <div className="rounded-lg p-4" style={{ background: "#fff", border: "1px dashed #e5e5e5" }}>
        <div className="flex items-center gap-2 text-xs flex-wrap" style={{ color: "#888" }}>
          <Building2 size={14} />
          <span>No HubSpot deal linked to this meeting.</span>
          {!editing && (
            <div className="ml-auto flex items-center gap-3">
              <button
                onClick={autoResolve}
                disabled={autoResolving}
                className="font-medium disabled:opacity-50 flex items-center gap-1"
                style={{ color: "#6d28d9" }}
                title="Find the deal via participant emails"
              >
                <RefreshCw size={11} className={autoResolving ? "animate-spin" : ""} />
                {autoResolving ? "Searching…" : "Find automatically"}
              </button>
              <button onClick={() => setEditing(true)} className="font-medium" style={{ color: "#f01563" }}>
                Link a deal
              </button>
            </div>
          )}
        </div>
        {autoResolveMsg && (
          <div className="mt-2 text-xs" style={{ color: autoResolveMsg.startsWith("Deal found") ? "#059669" : "#888" }}>
            {autoResolveMsg}
          </div>
        )}
      </div>
      {changePanel}
      </>
    );
  }

  // Deal linked but no snapshot yet (ancienne analyse ou HubSpot injoignable).
  // The useEffect above auto-backfills via /refresh-snapshot; show a spinner
  // while in flight, otherwise the failure message + manual ré-analyse fallback.
  if (!snapshot) {
    if (refreshingSnapshot) {
      return (
        <div className="rounded-lg p-3 flex items-center gap-2 text-xs" style={{ background: "#fff", border: "1px solid #eeeeee", color: "#888" }}>
          <RefreshCw size={13} className="animate-spin" />
          <span>Loading HubSpot deal…</span>
        </div>
      );
    }
    // Fallback : si on a une company matchée (via domaine ou title hint), on
    // affiche son nom + lifecycle pour donner du contexte plutôt qu'un ID brut.
    const notFoundChangeButton = (
      <button
        onClick={() => setEditing(true)}
        disabled={editing}
        className="font-medium px-2 py-1 rounded disabled:opacity-50"
        style={{ background: "#fff", color: "#92400e", border: "1px solid #fde68a" }}
        title="Link this meeting to another HubSpot deal"
      >
        <ArrowLeftRight size={11} className="inline mr-1" />
        Change deal
      </button>
    );
    if (companySnapshot?.name) {
      const lifecycle = companySnapshot.lifecyclestage;
      return (
        <>
        <div
          className="rounded-lg p-3 flex items-center gap-2 text-xs flex-wrap"
          style={{ background: "#fef3c7", border: "1px solid #fde68a", color: "#92400e" }}
        >
          <Building2 size={14} />
          <span>
            Account <strong>{companySnapshot.name}</strong>
            {lifecycle ? ` (lifecyclestage: ${lifecycle})` : ""} - HubSpot deal not found
            {dealId ? <> (id <code style={{ background: "#fde68a", padding: "0 4px", borderRadius: 3 }}>{dealId}</code>)</> : null}.
          </span>
          <div className="ml-auto flex items-center gap-2">
            {notFoundChangeButton}
            <button
              onClick={() => reanalyze()}
              disabled={reanalyzing}
              className="font-medium px-2 py-1 rounded disabled:opacity-50"
              style={{ background: "#fff", color: "#92400e", border: "1px solid #fde68a" }}
            >
              <RefreshCw size={11} className={`inline mr-1 ${reanalyzing ? "animate-spin" : ""}`} />
              {reanalyzing ? "Re-analyzing…" : "Re-analyze"}
            </button>
          </div>
        </div>
        {changePanel}
        </>
      );
    }
    return (
      <>
      <div className="rounded-lg p-3 flex items-center gap-2 text-xs" style={{ background: "#fef3c7", border: "1px solid #fde68a", color: "#92400e" }}>
        <Building2 size={14} />
        <span>HubSpot deal <strong>{dealId}</strong> not found on HubSpot (deal deleted or access unavailable).</span>
        <div className="ml-auto flex items-center gap-2">
          {notFoundChangeButton}
          <button
            onClick={() => reanalyze()}
            disabled={reanalyzing}
            className="font-medium px-2 py-1 rounded disabled:opacity-50"
            style={{ background: "#fff", color: "#92400e", border: "1px solid #fde68a" }}
          >
            <RefreshCw size={11} className={`inline mr-1 ${reanalyzing ? "animate-spin" : ""}`} />
            {reanalyzing ? "Re-analyzing…" : "Re-analyze"}
          </button>
        </div>
      </div>
      {changePanel}
      </>
    );
  }

  const close = snapshot.close_date ? new Date(snapshot.close_date).toLocaleDateString("en-GB") : null;
  const amount = snapshot.amount != null ? `${snapshot.amount.toLocaleString("en-GB")}€` : null;

  return (
    <>
    <div
      className="rounded-lg px-3 py-2 flex items-center gap-x-3 gap-y-1 flex-wrap text-xs"
      style={{ background: "#fff", border: "1px solid #eeeeee", color: "#555" }}
      title={snapshot.description ?? undefined}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <Building2 size={13} style={{ color: "#f01563" }} className="flex-shrink-0" />
        <span className="text-sm font-semibold truncate" style={{ color: "#111" }}>
          {snapshot.name || `Deal ${snapshot.id}`}
        </span>
      </div>
      {snapshot.stage_label && (
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#f01563" }} />
          {snapshot.stage_label}
        </span>
      )}
      {amount && <span>💰 {amount}</span>}
      {close && (
        <span className="inline-flex items-center gap-1">
          <Calendar size={10} />
          {close}
        </span>
      )}
      {snapshot.owner_name && <span>👤 {snapshot.owner_name}</span>}
      {snapshot.contacts.length > 0 && (
        <span className="inline-flex items-center gap-1 truncate max-w-[260px]">
          <Users size={11} className="flex-shrink-0" />
          <span className="truncate">
            {snapshot.contacts.slice(0, 2).map((c, i) => {
              const name = `${c.firstname} ${c.lastname}`.trim() || c.email || "?";
              return (
                <span key={c.id}>
                  {i > 0 && " · "}
                  <span style={{ color: "#111" }}>{name}</span>
                </span>
              );
            })}
            {snapshot.contacts.length > 2 && <span> +{snapshot.contacts.length - 2}</span>}
          </span>
        </span>
      )}
      <div className="ml-auto flex items-center gap-3">
        {changeDealButton}
        <button
          onClick={refreshSnapshot}
          disabled={refreshingSnapshot}
          className="flex items-center gap-1 text-[11px] font-medium disabled:opacity-50"
          style={{ color: "#888" }}
          title="Re-fetch HubSpot deal (without re-running Claude), recomputes prospect/client"
        >
          <RefreshCw size={10} className={refreshingSnapshot ? "animate-spin" : ""} />
          {refreshingSnapshot ? "Refreshing…" : "Refresh deal"}
        </button>
        <button
          onClick={() => reanalyze()}
          disabled={reanalyzing}
          className="flex items-center gap-1 text-[11px] font-medium disabled:opacity-50"
          style={{ color: "#888" }}
          title="Re-analyze the meeting with up-to-date deal data"
        >
          <RefreshCw size={10} className={reanalyzing ? "animate-spin" : ""} />
          {reanalyzing ? "Re-analyzing…" : "Re-analyze"}
        </button>
        <a
          href={`/deals?id=${snapshot.id}`}
          className="flex items-center gap-1 text-[11px] font-medium"
          style={{ color: "#f01563" }}
        >
          View deal <ExternalLink size={10} />
        </a>
      </div>
    </div>
    {changePanel}
    </>
  );
}

function MeetingKindBadge({ kind, size = "sm" }: { kind: string | null; size?: "sm" | "md" }) {
  if (!kind) return null;
  const label = getMeetingKindLabel(kind) ?? kind;
  const sizeClass = size === "md" ? "text-xs font-semibold px-2.5 py-1" : "text-[11px] font-semibold px-2 py-0.5";
  return (
    <span
      className={`${sizeClass} rounded-full`}
      style={{ background: "#ede9fe", color: "#6d28d9" }}
    >
      {label}
    </span>
  );
}

export default function AnalysisDetail({ analysisId, onSlackSent, onDeleted }: Props) {
  const { detail, isLoading, error, reload } = useSalesCoachDetail(analysisId);
  const { history } = useSalesCoachDealHistory(detail?.hubspot_deal_id ?? null, analysisId);
  const [tab, setTab] = useState<TabId>("synthese");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  const [emailModalOpen, setEmailModalOpen] = useState(false);

  async function resendSlack() {
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch(`/api/sales-coach/${analysisId}/resend-slack`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      setSendResult({ ok: true, msg: "Sent to Slack" });
      await reload();
      onSlackSent?.();
    } catch (e) {
      setSendResult({ ok: false, msg: e instanceof Error ? e.message : "Error" });
    } finally {
      setSending(false);
    }
  }

  async function deleteAnalysis() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/sales-coach/${analysisId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Error");
      toast("Analysis deleted.", "success");
      onDeleted?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", "error");
      setDeleting(false);
    }
  }

  const [forcing, setForcing] = useState(false);
  async function forceAnalyze() {
    setForcing(true);
    try {
      const res = await fetch(`/api/sales-coach/${analysisId}/reanalyze`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Error");
      toast("Re-analysis started.", "success");
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", "error");
    } finally {
      setForcing(false);
    }
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-sm" style={{ color: "#888" }}>Loading…</div>;
  }

  if (error || !detail) {
    return <div className="flex items-center justify-center h-full text-sm" style={{ color: "#dc2626" }}>{error || "Analysis not found"}</div>;
  }

  // Meeting Claap externe sans deal HubSpot résolu : on demande à l'utilisateur
  // d'associer manuellement un deal (ou de supprimer la ligne). L'analyse n'a
  // pas été lancée par le webhook.
  if (detail.status === "awaiting_manual_deal") {
    return (
      <ManualDealResolution
        analysisId={analysisId}
        meetingTitle={detail.meeting_title}
        meetingStartedAt={detail.meeting_started_at}
        recorderEmail={detail.recorder_email}
        participants={detail.participants}
        onResolved={reload}
        onDeleted={() => onDeleted?.()}
      />
    );
  }

  if (detail.status !== "done" || !detail.analysis) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        {detail.status === "analyzing" && (
          <>
            <RefreshCw size={28} className="animate-spin mb-3" style={{ color: "#f01563" }} />
            <div className="text-sm font-medium" style={{ color: "#111" }}>Analysis in progress…</div>
            <div className="text-xs mt-1" style={{ color: "#888" }}>The debrief will be available in a few moments.</div>
          </>
        )}
        {detail.status === "pending" && (
          <>
            <div className="text-sm font-medium" style={{ color: "#111" }}>Queued</div>
            <div className="text-xs mt-1" style={{ color: "#888" }}>The analysis is about to start.</div>
          </>
        )}
        {detail.status === "error" && (
          <>
            <AlertCircle size={28} className="mb-3" style={{ color: "#dc2626" }} />
            <div className="text-sm font-medium" style={{ color: "#111" }}>Error</div>
            <div className="text-xs mt-1" style={{ color: "#888" }}>{detail.error_message ?? "Unknown error"}</div>
          </>
        )}
        {detail.status === "skipped" && (
          <>
            <div className="text-sm font-medium" style={{ color: "#111" }}>Meeting not analyzed</div>
            <div className="text-xs mt-1" style={{ color: "#888" }}>Reason: {detail.error_message ?? "-"}</div>
          </>
        )}
        <div className="mt-4 flex items-center gap-2">
          {(detail.status === "skipped" ||
            detail.status === "error" ||
            detail.status === "pending") && (
            <button
              onClick={() => forceAnalyze()}
              disabled={forcing}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md disabled:opacity-50"
              style={{ background: "#f01563", color: "#fff" }}
            >
              <RefreshCw size={12} className={forcing ? "animate-spin" : ""} />
              {forcing
                ? "Starting…"
                : detail.status === "pending"
                  ? "Analyze now"
                  : "Analyze anyway"}
            </button>
          )}
          <button
            onClick={deleteAnalysis}
            disabled={deleting}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md disabled:opacity-50"
            style={{ background: "#fff", color: "#dc2626", border: "1px solid #fecaca" }}
          >
            <Trash2 size={12} />
            {deleting ? "Deleting…" : "Delete this analysis"}
          </button>
        </div>
      </div>
    );
  }

  // Defensive repair for the malformed shape Haiku 4.5 occasionally produces
  // (everything from `coaching_priorities` onwards stuffed as one string).
  const a = repairAnalysis(detail.analysis as AnySalesCoachAnalysis);
  // L'audience de la row (recalculée depuis le deal HubSpot) fait foi : un compte
  // passé en client ne doit jamais s'afficher en prospect (onglet MEDDIC), même
  // si le JSON stocké a encore la forme prospect. Cf. resolveIsClient.
  const isClient = resolveIsClient(detail.audience, a);
  // Analyse périmée : audience ≠ forme du JSON (ex : compte devenu client mais
  // analyse encore au format prospect). On invite à relancer l'analyse.
  const audienceStale = isAnalysisAudienceStale(detail.audience, a);
  const meetingDate = detail.meeting_started_at
    ? new Date(detail.meeting_started_at).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })
    : "";
  // BOSCHE n'a de sens que pour les discoveries prospect.
  const isDisco = !isClient && isDiscoveryKind(detail.meeting_kind as Parameters<typeof isDiscoveryKind>[0]);

  const coachingPriorities = extractStringArray(a.coaching_priorities);
  const risks = extractStringArray(a.risks);

  const participantNames = (detail.participants ?? [])
    .map((p) => p.name?.trim() || p.email.split("@")[0])
    .filter((s): s is string => !!s);
  const fallbackNames =
    participantNames.length === 0
      ? (detail.deal_snapshot?.contacts ?? [])
          .map((c) => `${c.firstname} ${c.lastname}`.trim() || c.email)
          .filter((s): s is string => !!s)
      : [];
  const names = participantNames.length > 0 ? participantNames : fallbackNames;
  const meetingKindLabel = getMeetingKindLabel(detail.meeting_kind);

  return (
    <div className="flex flex-col h-full" style={{ background: COLORS.bgPage }}>
      {/* Header */}
      <div
        style={{
          background: COLORS.bgCard,
          borderBottom: `1px solid ${COLORS.line}`,
          padding: "16px 24px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <ScoreGauge value={Number(detail.score_global ?? 0)} scale={10} size={72} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
              {meetingKindLabel && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "3px 10px",
                    borderRadius: 999,
                    background: COLORS.infoBg,
                    color: COLORS.info,
                  }}
                >
                  {meetingKindLabel}
                </span>
              )}
              {a.meeting_kind_reasoning && (
                <span title={`Classification: ${a.meeting_kind_reasoning}`} style={{ color: COLORS.ink3, cursor: "help" }}>
                  <Info size={13} />
                </span>
              )}
            </div>
            <h2
              style={{
                fontSize: 20,
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
              {detail.meeting_title ?? "Meeting"}
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
              <span>{meetingDate}</span>
              {(() => {
                // Prefer the deal owner (actual sales rep on HubSpot) over the
                // Claap recorder (= whoever started the bot, often a shared
                // account or the person who scheduled the call).
                const sellerLabel = detail.deal_snapshot?.owner_name || detail.recorder_email;
                return sellerLabel ? (
                  <>
                    <span>·</span>
                    <span>{sellerLabel}</span>
                  </>
                ) : null;
              })()}
              {names.length > 0 && (
                <>
                  <span>·</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Users size={11} />
                    with {names.slice(0, 3).join(", ")}
                    {names.length > 3 ? ` +${names.length - 3}` : ""}
                  </span>
                </>
              )}
            </div>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button
              onClick={resendSlack}
              disabled={sending}
              title={detail.slack_sent_at ? `Sent on ${new Date(detail.slack_sent_at).toLocaleDateString("en-GB")}` : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontWeight: 500,
                padding: "7px 12px",
                borderRadius: 10,
                border: `1px solid ${COLORS.lineStrong}`,
                background: COLORS.bgCard,
                color: COLORS.ink1,
                cursor: sending ? "not-allowed" : "pointer",
                opacity: sending ? 0.5 : 1,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                if (sending) return;
                e.currentTarget.style.borderColor = COLORS.brand;
                e.currentTarget.style.color = COLORS.brand;
              }}
              onMouseLeave={(e) => {
                if (sending) return;
                e.currentTarget.style.borderColor = COLORS.lineStrong;
                e.currentTarget.style.color = COLORS.ink1;
              }}
            >
              <Send size={13} />
              {sending ? "Sending…" : detail.slack_sent_at ? "Re-Slack" : "Slack"}
            </button>
            <button
              onClick={() => forceAnalyze()}
              disabled={forcing}
              title="Re-run the analysis for this meeting"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontWeight: 500,
                padding: "7px 12px",
                borderRadius: 10,
                border: `1px solid ${COLORS.lineStrong}`,
                background: COLORS.bgCard,
                color: COLORS.ink1,
                cursor: forcing ? "not-allowed" : "pointer",
                opacity: forcing ? 0.5 : 1,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                if (forcing) return;
                e.currentTarget.style.borderColor = COLORS.brand;
                e.currentTarget.style.color = COLORS.brand;
              }}
              onMouseLeave={(e) => {
                if (forcing) return;
                e.currentTarget.style.borderColor = COLORS.lineStrong;
                e.currentTarget.style.color = COLORS.ink1;
              }}
            >
              <RefreshCw size={13} className={forcing ? "animate-spin" : ""} />
              {forcing ? "Re-running…" : "Re-analyze"}
            </button>
            <button
              onClick={deleteAnalysis}
              disabled={deleting}
              aria-label="Delete analysis"
              title="Delete analysis"
              style={{
                width: 36,
                height: 36,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                border: "1px solid #fecaca",
                background: COLORS.bgCard,
                color: COLORS.err,
                cursor: deleting ? "not-allowed" : "pointer",
                opacity: deleting ? 0.5 : 1,
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {sendResult && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: sendResult.ok ? COLORS.ok : COLORS.err,
            }}
          >
            {sendResult.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
            {sendResult.msg}
          </div>
        )}
      </div>

      {/* Topo deal */}
      <div className="px-6 pt-2" style={{ background: "#f8f8f8" }}>
        <DealTopo
          snapshot={detail.deal_snapshot}
          companySnapshot={detail.company_snapshot}
          dealId={detail.hubspot_deal_id}
          analysisId={analysisId}
          onDealUpdated={reload}
        />
      </div>

      {/* Tabs */}
      <div style={{ background: COLORS.bgCard, padding: "0 24px" }}>
        <TabBar
          active={tab}
          onChange={(k) => setTab(k as TabId)}
          tabs={[
            { key: "synthese", label: "Summary", icon: Sparkles },
            { key: "axes", label: "6 axes", icon: Target },
            ...(isClient
              ? [{ key: "customer_health", label: "Customer Health", icon: TrendingUp }]
              : [
                  { key: "meddic", label: "MEDDIC", icon: TrendingUp },
                  ...(isDisco ? [{ key: "bosche", label: "BOSCHE", icon: TrendingUp }] : []),
                ]),
            { key: "history", label: `History${history.length > 0 ? ` (${history.length})` : ""}`, icon: History },
            { key: "transcript", label: "Transcript", icon: FileText },
          ]}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {audienceStale && (
          <div
            className="rounded-lg p-4 mb-4 text-sm flex items-start justify-between gap-3"
            style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}
          >
            <span>
              This account is now a <strong>{isClient ? "client" : "prospect"}</strong>, but this
              analysis was generated with the {isClient ? "prospect" : "client"} framework. Some
              sections may be empty or off-topic. Re-analyze to regenerate it with the{" "}
              {isClient ? "Customer Health" : "MEDDIC"} framework.
            </span>
            <button
              onClick={() => forceAnalyze()}
              disabled={forcing}
              className="shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md disabled:opacity-50"
              style={{ background: "#f01563", color: "#fff" }}
            >
              <RefreshCw size={12} className={forcing ? "animate-spin" : ""} />
              {forcing ? "Re-analyzing…" : "Re-analyze"}
            </button>
          </div>
        )}
        {tab === "synthese" && (
          <SynthesisTab
            analysis={a}
            audience={detail.audience}
            talkRatio={detail.talk_ratio}
            onOpenEmailDraft={() => setEmailModalOpen(true)}
            onGoToAxes={() => setTab("axes")}
            onGoToMeddic={() => setTab("meddic")}
            onGoToCustomerHealth={() => setTab("customer_health")}
          />
        )}

        {tab === "axes" && (
          <div className="space-y-3">
            {isClient
              ? CLIENT_AXES_LABELS.map(({ key, label }) => (
                  <AxisCard
                    key={key}
                    label={label}
                    axis={(a as ClientSalesCoachAnalysis).axes?.[key] ?? EMPTY_AXIS}
                    collapsible
                  />
                ))
              : AXES_LABELS.map(({ key, label }) => (
                  <AxisCard
                    key={key}
                    label={label}
                    axis={(a as SalesCoachAnalysis).axes?.[key] ?? EMPTY_AXIS}
                    collapsible
                  />
                ))}

            {coachingPriorities.length > 0 && (
              <div className="rounded-lg p-4" style={{ background: "#fef2f4", border: "1px solid #f01563" }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <TrendingUp size={14} style={{ color: "#f01563" }} />
                  <div className="text-sm font-semibold" style={{ color: "#f01563" }}>Top priorities for the next call</div>
                </div>
                <ol className="space-y-1.5 pl-1">
                  {coachingPriorities.map((p, i) => (
                    <li key={i} className="text-sm flex gap-2" style={{ color: "#333" }}>
                      <span className="font-semibold" style={{ color: "#f01563" }}>{i + 1}.</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {risks.length > 0 && (
              <div className="rounded-lg p-4" style={{ background: "#fff", border: "1px solid #eeeeee" }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertCircle size={14} style={{ color: "#dc2626" }} />
                  <div className="text-sm font-semibold" style={{ color: "#111" }}>Identified risks</div>
                </div>
                <ul className="space-y-1 text-sm" style={{ color: "#333" }}>
                  {risks.map((r, i) => <li key={i}>• {r}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === "meddic" && !isClient && (() => {
          const prospect = a as SalesCoachAnalysis;
          return (
            <div className="space-y-3">
              <div className="rounded-lg p-3 text-xs" style={{ background: "#eef2ff", border: "1px solid #c7d2fe", color: "#3730a3" }}>
                <strong>MEDDIC</strong> - qualification framework applied to all meeting types. Dimensions marked N/A are not observable in this type of call, but the recommendation still applies.
              </div>
              {!prospect.meddic && (
                <div className="rounded-lg p-4 text-sm" style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}>
                  MEDDIC analysis not available for this meeting (analysis generated before the framework was added, or incomplete). Re-analyze the meeting via &quot;Analyze a past meeting&quot; to get the MEDDIC scores.
                </div>
              )}
              {prospect.meddic && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 10,
                  }}
                >
                  {MEDDIC_LABELS.map(({ key, label }) => {
                    const dim = prospect.meddic[key];
                    if (!dim) return null;
                    return (
                      <CompactScoreCard
                        key={key}
                        label={label}
                        axis={dim}
                        framework="meddic"
                        dimension={key as string}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {tab === "customer_health" && isClient && (() => {
          const client = a as ClientSalesCoachAnalysis;
          const ch = client.customer_health;
          return (
            <div className="space-y-3">
              <div
                className="rounded-lg p-3 text-xs"
                style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#065f46" }}
              >
                <strong>Customer Health</strong> - qualitative read of the account state (relationship, adoption, sentiment, expansion signals, risks). Used to guide the next CS touchpoint, not to score the account.
              </div>
              {!ch && (
                <div className="rounded-lg p-4 text-sm" style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}>
                  Customer Health read not available. Re-run the analysis to generate it.
                </div>
              )}
              {ch && CUSTOMER_HEALTH_LABELS.map(({ key, label }) => {
                const value = (ch[key] ?? "").trim();
                const isEmpty = !value || /pas observable/i.test(value);
                return (
                  <div
                    key={key}
                    className="rounded-lg p-4"
                    style={{ background: "#fff", border: "1px solid #eeeeee" }}
                  >
                    <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "#065f46" }}>
                      {label}
                    </div>
                    <p
                      className="text-sm leading-relaxed"
                      style={{ color: isEmpty ? "#888" : "#333", fontStyle: isEmpty ? "italic" : "normal" }}
                    >
                      {value || "Not observable in this meeting"}
                    </p>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {tab === "bosche" && !isClient && isDisco && (() => {
          const prospect = a as SalesCoachAnalysis;
          const bosche = prospect.bosche;
          if (!bosche || typeof bosche !== "object") return null;
          return (
            <div className="space-y-3">
              {bosche.trigger_identified ? (
                <div className="rounded-lg p-4" style={{ background: "#fff", border: "1px solid #f01563" }}>
                  <div className="text-xs font-medium uppercase tracking-wider" style={{ color: "#f01563" }}>
                    Coachello trigger detected
                  </div>
                  <div className="text-base font-semibold mt-1" style={{ color: "#111" }}>
                    {bosche.trigger_identified}
                  </div>
                  <div className="text-xs mt-2 flex items-center gap-1.5" style={{ color: "#666" }}>
                    <span>Exit criteria:</span>
                    {bosche.exit_criteria_met ? (
                      <span className="font-medium" style={{ color: "#059669" }}>✓ met</span>
                    ) : (
                      <span className="font-medium" style={{ color: "#dc2626" }}>✗ not met</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg p-4 text-sm" style={{ background: "#fafafa", color: "#888", border: "1px dashed #e5e5e5" }}>
                  No BOSCHE trigger clearly identified.
                </div>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                  gap: 10,
                }}
              >
                {BOSCHE_LABELS.map(({ key, label }) => {
                  const dim = (bosche[key] ?? EMPTY_AXIS) as AxisScore;
                  return (
                    <CompactScoreCard
                      key={key}
                      label={label}
                      axis={dim}
                      framework="bosche"
                      dimension={key as string}
                    />
                  );
                })}
              </div>
            </div>
          );
        })()}

        {tab === "history" && (
          <div className="space-y-4">
            {/* Claap meetings past */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <History size={14} style={{ color: "#111" }} />
                <h3 className="text-sm font-semibold" style={{ color: "#111" }}>Previous Claap meetings on this deal</h3>
              </div>
              {history.length === 0 ? (
                <div className="rounded-lg p-3 text-xs" style={{ background: "#fafafa", color: "#888", border: "1px dashed #e5e5e5" }}>
                  No other meeting analyzed on this deal.
                </div>
              ) : (
                <div className="space-y-2">
                  {history.map((h) => {
                    const d = h.meeting_started_at ? new Date(h.meeting_started_at).toLocaleDateString("en-GB") : "?";
                    const kind = getMeetingKindLabel(h.meeting_kind);
                    return (
                      <a
                        key={h.id}
                        href={`?id=${h.id}`}
                        className="block rounded-lg p-3 transition-colors"
                        style={{ background: "#fff", border: "1px solid #eeeeee" }}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs" style={{ color: "#888" }}>{d}</span>
                            {kind && <MeetingKindBadge kind={h.meeting_kind} />}
                            <span className="text-sm truncate" style={{ color: "#111" }}>{h.meeting_title ?? "Meeting"}</span>
                          </div>
                          {h.score_global != null && (
                            <span className="text-xs font-semibold tabular-nums" style={{ color: scoreColor(Number(h.score_global)) }}>
                              {Number(h.score_global).toFixed(1)}/10
                            </span>
                          )}
                        </div>
                      </a>
                    );
                  })}
                </div>
              )}
            </div>

            {/* HubSpot engagements */}
            {detail.deal_snapshot && detail.deal_snapshot.engagements.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Building2 size={14} style={{ color: "#111" }} />
                  <h3 className="text-sm font-semibold" style={{ color: "#111" }}>HubSpot engagements ({detail.deal_snapshot.engagements.length})</h3>
                </div>
                <div className="space-y-2">
                  {detail.deal_snapshot.engagements.map((e, i) => {
                    const d = e.date ? new Date(e.date).toLocaleDateString("en-GB") : "?";
                    const typeColors: Record<string, { bg: string; fg: string }> = {
                      meeting: { bg: "#dbeafe", fg: "#1e40af" },
                      call: { bg: "#dcfce7", fg: "#166534" },
                      note: { bg: "#fef3c7", fg: "#92400e" },
                      engagement: { bg: "#f3f4f6", fg: "#374151" },
                    };
                    const color = typeColors[e.type] ?? typeColors.engagement;
                    return (
                      <div key={i} className="rounded-lg p-3" style={{ background: "#fff", border: "1px solid #eeeeee" }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: color.bg, color: color.fg }}>
                            {e.type}
                          </span>
                          <span className="text-xs" style={{ color: "#888" }}>{d}</span>
                          {e.title && <span className="text-xs font-medium" style={{ color: "#111" }}>{e.title}</span>}
                        </div>
                        {e.body && <p className="text-xs leading-relaxed" style={{ color: "#555" }}>{e.body}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "transcript" && (
          <div
            className="rounded-lg p-4 text-sm whitespace-pre-wrap"
            style={{
              background: "#fff",
              border: "1px solid #eeeeee",
              color: "#333",
              fontFamily: "ui-monospace, Menlo, Consolas, monospace",
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            {detail.transcript_text ? (
              <>
                {detail.transcript_text}
                <div className="mt-4 text-[11px]" style={{ color: "#888" }}>
                  {detail.transcript_text.length.toLocaleString("en-GB")} characters
                </div>
              </>
            ) : (
              <span style={{ color: "#888" }}>
                <MessageSquare size={14} className="inline mr-1" />
                Transcript not available.
              </span>
            )}
          </div>
        )}
      </div>

      <EmailDraftModal
        open={emailModalOpen}
        analysisId={analysisId}
        defaultRecipients={(detail.deal_snapshot?.contacts ?? [])
          .filter((c) => c.email)
          .map((c) => ({ name: `${c.firstname} ${c.lastname}`.trim() || null, email: c.email }))}
        initialDraft={detail.email_draft}
        onClose={() => setEmailModalOpen(false)}
      />
    </div>
  );
}
