"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, HelpCircle, Loader2, XCircle } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";

// Bascule HubSpot du 30/11 : quand le rapprochement meeting <-> carte n'est pas
// sûr, la carte ne bouge pas et le score n'est pas écrit tant qu'une personne
// présente au meeting n'a pas confirmé (✅ sur le DM Slack, ou ici).

interface ConfirmState {
  pending: { kind: "r1_move" | "deal_link" | "reactivation"; dealId: string | null; expiresAt: string | null } | null;
  deal: { id: string; name: string | null; url: string | null } | null;
  meeting: { title: string | null; startedAt: string | null; participants: string[] } | null;
  matchMethod: string | null;
  stageMoveResult: string | null;
  canEdit: boolean;
}

export function CardConfirmation({ analysisId, onDone }: { analysisId: string; onDone: () => void }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(() => {
    fetch(`/api/sales-coach/${analysisId}/confirm-deal`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ConfirmState | null) => setState(d))
      .catch(() => setState(null));
  }, [analysisId]);

  useEffect(() => {
    setResult(null);
    load();
  }, [load]);

  const awaiting =
    !!state?.pending || state?.stageMoveResult === "awaiting_confirmation" || (state?.stageMoveResult ?? "").startsWith("not_sure");
  if (!state || !state.canEdit || (!awaiting && !result)) return null;

  const answer = async (value: "yes" | "no") => {
    setBusy(value);
    setResult(null);
    try {
      const res = await fetch(`/api/sales-coach/${analysisId}/confirm-deal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: value }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
      setResult({ ok: !!data.ok, message: data.message ?? data.error ?? `HTTP ${res.status}` });
      load();
      onDone();
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setBusy(null);
    }
  };

  const isR1 = state.pending?.kind === "r1_move";
  return (
    <div
      style={{
        margin: "8px 0",
        padding: "10px 12px",
        borderRadius: 8,
        border: `1px solid ${COLORS.line}`,
        background: COLORS.bgCard,
        fontSize: 12,
        color: COLORS.ink1,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {awaiting && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: COLORS.ink0 }}>
            <HelpCircle size={14} />
            <span>
              {isR1 ? "Was this meeting the R1 of " : "Is this meeting about "}
              {state.deal?.name ? (
                state.deal.url ? (
                  <a href={state.deal.url} target="_blank" rel="noreferrer" style={{ color: COLORS.brand, textDecoration: "underline" }}>
                    {state.deal.name}
                  </a>
                ) : (
                  state.deal.name
                )
              ) : (
                "this card"
              )}
              ?
            </span>
          </div>
          {state.meeting && (state.meeting.title || state.meeting.startedAt) && (
            <div style={{ color: COLORS.ink1 }}>
              Meeting:{" "}
              {[
                state.meeting.title ? `"${state.meeting.title}"` : null,
                state.meeting.startedAt
                  ? new Date(state.meeting.startedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                  : null,
                state.meeting.participants.length ? `with ${state.meeting.participants.join(", ")}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
          <div style={{ color: COLORS.ink2 }}>
            The match is not sure, so nothing was written to HubSpot.{" "}
            {isR1 ? "Confirming moves the card to Scoping (SQL) and writes its score." : "Confirming writes the deal score to HubSpot."}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => answer("yes")}
              disabled={busy !== null}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 6, border: "none", background: COLORS.ok, color: "#fff", fontWeight: 600, cursor: busy ? "not-allowed" : "pointer" }}
            >
              {busy === "yes" ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Confirm this card
            </button>
            <button
              onClick={() => answer("no")}
              disabled={busy !== null}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 6, border: `1px solid ${COLORS.line}`, background: "#fff", color: COLORS.ink1, cursor: busy ? "not-allowed" : "pointer" }}
            >
              {busy === "no" ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />} Not this deal
            </button>
          </div>
        </>
      )}
      {result && <div style={{ whiteSpace: "pre-line", color: result.ok ? COLORS.ok : COLORS.err }}>{result.message}</div>}
    </div>
  );
}
