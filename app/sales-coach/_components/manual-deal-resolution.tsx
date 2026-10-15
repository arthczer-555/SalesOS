"use client";

import { useState } from "react";
import {
  Calendar,
  HelpCircle,
  Loader2,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import type { MeetingParticipant } from "@/lib/hooks/use-sales-coach";
import { useToast } from "@/components/ui/toast";
import { DealPicker, type DealSearchResult } from "./deal-picker";

interface Props {
  analysisId: string;
  meetingTitle: string | null;
  meetingStartedAt: string | null;
  recorderEmail: string | null;
  participants: MeetingParticipant[] | null;
  onResolved: () => void;
  onDeleted: () => void;
}

export function ManualDealResolution({
  analysisId,
  meetingTitle,
  meetingStartedAt,
  recorderEmail,
  participants,
  onResolved,
  onDeleted,
}: Props) {
  const [choice, setChoice] = useState<"unset" | "yes" | "no">("unset");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const { toast } = useToast();

  async function submitDeal(selectedDeal: DealSearchResult) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/sales-coach/${analysisId}/resolve-deal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: selectedDeal.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Error while linking the deal");
      onResolved();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Error");
      setSubmitting(false);
    }
  }

  async function confirmNoDeal() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/sales-coach/${analysisId}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Error while deleting");
      toast("Meeting deleted.", "success");
      onDeleted();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", "error");
      setDeleting(false);
    }
  }

  // Lance l'analyse sans deal HubSpot. La route passe la ligne en `pending` et
  // déclenche l'analyse ; onResolved() revalide le SWR → l'écran bascule sur
  // l'état analyzing/pending.
  async function analyzeWithoutDeal() {
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/sales-coach/${analysisId}/analyze-without-deal`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Error while starting the analysis");
      toast("Analysis started without a deal.", "success");
      onResolved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error", "error");
      setAnalyzing(false);
    }
  }

  const dateStr = meetingStartedAt
    ? new Date(meetingStartedAt).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })
    : null;

  const participantList = (participants ?? [])
    .map((p) => p.name?.trim() || p.email)
    .filter((s): s is string => !!s);

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: COLORS.bgPage }}>
      <div style={{ padding: "32px 24px", maxWidth: 720, margin: "0 auto", width: "100%" }}>
        {/* Bandeau d'info sur le meeting */}
        <div
          style={{
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            borderRadius: 12,
            padding: "16px 18px",
            marginBottom: 24,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <HelpCircle size={16} style={{ color: "#c2410c" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#9a3412" }}>
              No HubSpot deal found for this meeting
            </span>
          </div>
          <p style={{ fontSize: 13, color: "#7c2d12", margin: 0, lineHeight: 1.5 }}>
            The automatic resolver could not link this meeting to a deal (participant emails,
            domain, title, semantic search: all empty). Indicate whether this meeting is linked to a deal
            to start the analysis, or delete it.
          </p>

          {/* Récap meeting */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #fed7aa", fontSize: 12, color: "#7c2d12", lineHeight: 1.7 }}>
            <div style={{ fontWeight: 600 }}>{meetingTitle ?? "Untitled"}</div>
            {dateStr && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Calendar size={11} /> {dateStr}
              </div>
            )}
            {recorderEmail && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: dateStr ? 12 : 0 }}>
                <User size={11} /> Recorder: {recorderEmail}
              </div>
            )}
            {participantList.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <strong>External participants:</strong> {participantList.join(", ")}
              </div>
            )}
          </div>
        </div>

        {/* Question Oui/Non */}
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: COLORS.ink0, marginBottom: 12 }}>
            Is this meeting linked to a deal?
          </h3>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => setChoice("yes")}
              disabled={submitting || deleting}
              style={{
                flex: 1,
                padding: "10px 16px",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                cursor: submitting || deleting ? "not-allowed" : "pointer",
                background: choice === "yes" ? COLORS.brand : "#fff",
                color: choice === "yes" ? "#fff" : COLORS.ink0,
                border: `1px solid ${choice === "yes" ? COLORS.brand : COLORS.lineStrong}`,
                transition: "all 0.15s",
              }}
            >
              Yes - link a deal
            </button>
            <button
              onClick={() => { setChoice("no"); confirmNoDeal(); }}
              disabled={submitting || deleting}
              style={{
                flex: 1,
                padding: "10px 16px",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                cursor: submitting || deleting ? "not-allowed" : "pointer",
                background: "#fff",
                color: "#dc2626",
                border: "1px solid #fecaca",
                transition: "all 0.15s",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Trash2 size={14} />
              {deleting ? "Deleting…" : "No - delete"}
            </button>
          </div>

          {/* Alternative : analyser sans deal */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 14 }}>
            <span style={{ fontSize: 12, color: COLORS.ink1 }}>or</span>
            <button
              onClick={analyzeWithoutDeal}
              disabled={submitting || deleting || analyzing}
              style={{
                width: "100%",
                padding: "10px 16px",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                cursor: submitting || deleting || analyzing ? "not-allowed" : "pointer",
                background: "#fff",
                color: COLORS.ink0,
                border: `1px solid ${COLORS.lineStrong}`,
                transition: "all 0.15s",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {analyzing ? "Starting…" : "Analyze anyway (no deal)"}
            </button>
          </div>
        </div>

        {/* Autocomplete (choice = yes) */}
        {choice === "yes" && (
          <div style={{ background: "#fff", border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: 16 }}>
            <DealPicker
              confirmLabel="Link and start the analysis"
              busyLabel="Linking…"
              busy={submitting}
              error={submitError}
              onConfirm={submitDeal}
              onSelectionChange={() => setSubmitError(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
