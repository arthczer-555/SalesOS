"use client";

import { useState } from "react";
import useSWR from "swr";
import { Loader2, Video, ExternalLink, FileText, Trash2 } from "lucide-react";
import { COLORS } from "@/app/clients/_components/theme";
import { useToast } from "@/components/ui/toast";

type AnalyzedMeeting = {
  recording_id: string;
  meeting_title: string | null;
  meeting_started_at: string | null;
  meeting_kind: string | null;
  audience: string | null;
  hubspot_deal_id: string | null;
  claap_url: string | null;
  has_recap: boolean;
};

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "?";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Popup "info" : liste tous les meetings Claap qui ont contribué aux données
// de cette fiche (analysés par sales-coach + inclus via discovery). Utile pour
// vérifier ce que le pipeline a réellement pris en compte, notamment quand un
// meeting est rattaché à un deal HubSpot différent de celui de la fiche.
// Corbeille par meeting (confirmation inline) : exclusion définitive via
// decline-meeting, qui relance un refresh sans lui. onRemoved(refreshStarted)
// laisse la page suivre ce refresh.
export function AnalyzedMeetingsModal({
  clientId,
  dealId,
  onClose,
  onRemoved,
}: {
  clientId: string;
  dealId: string;
  onClose: () => void;
  onRemoved: (refreshStarted: boolean) => void;
}) {
  const { toast } = useToast();
  const { data, error, isLoading, mutate } = useSWR<{ meetings: AnalyzedMeeting[] }>(
    `/api/clients/${clientId}/analyzed-meetings`,
    fetcher,
    { revalidateOnFocus: false },
  );
  const meetings = data?.meetings ?? [];
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function remove(m: AnalyzedMeeting) {
    setRemovingId(m.recording_id);
    try {
      const res = await fetch(`/api/clients/${clientId}/decline-meeting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recording_id: m.recording_id }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; refresh_started?: boolean };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      await mutate(
        (cur) => (cur ? { meetings: cur.meetings.filter((x) => x.recording_id !== m.recording_id) } : cur),
        { revalidate: false },
      );
      const refreshStarted = body.refresh_started === true;
      toast(
        refreshStarted
          ? `"${m.meeting_title ?? "Meeting"}" removed. Refreshing the account without it.`
          : `"${m.meeting_title ?? "Meeting"}" removed, but the refresh could not start. Use the Refresh button.`,
        refreshStarted ? "success" : "info",
      );
      onRemoved(refreshStarted);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove the meeting", "error");
    } finally {
      setRemovingId(null);
      setConfirmingId(null);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.bgCard,
          borderRadius: 14,
          border: `1px solid ${COLORS.line}`,
          width: "100%",
          maxWidth: 560,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${COLORS.line}`,
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
          }}
        >
          <Video size={16} style={{ color: COLORS.primary, marginTop: 2, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: COLORS.ink0 }}>
              Claap meetings analyzed ({meetings.length})
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: COLORS.ink2 }}>
              Everything that has fed this client&apos;s data, most recent first. Remove a meeting that does not belong
              to this account and the page refreshes without it.
            </p>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "10px 20px 18px" }}>
          {isLoading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: COLORS.ink3, padding: "10px 0" }}>
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          )}
          {error && (
            <div style={{ fontSize: 12, color: COLORS.err, padding: "10px 0" }}>
              {error instanceof Error ? error.message : "Error"}
            </div>
          )}
          {!isLoading && !error && meetings.length === 0 && (
            <div style={{ fontSize: 12, color: COLORS.ink3, padding: "10px 0" }}>No Claap meeting found.</div>
          )}
          {meetings.map((m) => (
            <div
              key={m.recording_id}
              style={{
                display: "flex",
                gap: 8,
                padding: "10px 0",
                borderBottom: `1px solid ${COLORS.line}`,
                alignItems: "flex-start",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink0 }}>
                    {m.meeting_title ?? "Untitled meeting"}
                  </span>
                  {m.has_recap ? (
                    <span
                      title="Fully analyzed by Sales Coach (transcript + structured recap)"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                        fontSize: 10,
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: COLORS.brandTint,
                        color: COLORS.primary,
                        fontWeight: 600,
                      }}
                    >
                      <FileText size={9} /> analyzed
                    </span>
                  ) : (
                    <span
                      title="Included via discovery (matched by domain/title), no structured recap"
                      style={{
                        fontSize: 10,
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: COLORS.bgSoft,
                        color: COLORS.ink3,
                        fontWeight: 600,
                      }}
                    >
                      included
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: COLORS.ink3, marginTop: 2 }}>
                  {fmtDate(m.meeting_started_at)}
                  {m.meeting_kind ? ` · ${m.meeting_kind}` : ""}
                  {m.audience ? ` · ${m.audience}` : ""}
                  {m.hubspot_deal_id && m.hubspot_deal_id !== dealId ? ` · linked to deal ${m.hubspot_deal_id}` : ""}
                </div>
                {confirmingId === m.recording_id && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                      marginTop: 8,
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: COLORS.errBg,
                      fontSize: 11,
                      color: COLORS.ink1,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 180 }}>
                      Remove it from this account for good? The fields it supported are re-analyzed without it.
                    </span>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      disabled={removingId === m.recording_id}
                      style={{
                        fontSize: 11,
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: `1px solid ${COLORS.line}`,
                        background: COLORS.bgCard,
                        color: COLORS.ink2,
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(m)}
                      disabled={removingId === m.recording_id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: "none",
                        background: COLORS.err,
                        color: "#fff",
                        cursor: removingId === m.recording_id ? "default" : "pointer",
                      }}
                    >
                      {removingId === m.recording_id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      {removingId === m.recording_id ? "Removing…" : "Remove"}
                    </button>
                  </div>
                )}
              </div>
              {m.claap_url && (
                <a
                  href={m.claap_url}
                  target="_blank"
                  rel="noreferrer"
                  title="Open in Claap"
                  style={{ color: COLORS.ink4, marginTop: 2, flexShrink: 0 }}
                >
                  <ExternalLink size={13} />
                </a>
              )}
              <button
                type="button"
                title="Remove this meeting from the account"
                aria-label="Remove this meeting from the account"
                onClick={() => setConfirmingId(m.recording_id)}
                disabled={removingId !== null}
                style={{
                  display: "inline-flex",
                  padding: 0,
                  marginTop: 2,
                  border: "none",
                  background: "transparent",
                  color: confirmingId === m.recording_id ? COLORS.err : COLORS.ink4,
                  cursor: removingId !== null ? "default" : "pointer",
                  flexShrink: 0,
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>

        <div style={{ padding: "12px 20px", borderTop: `1px solid ${COLORS.line}`, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              fontSize: 12,
              padding: "8px 14px",
              borderRadius: 8,
              border: `1px solid ${COLORS.line}`,
              background: COLORS.bgCard,
              color: COLORS.ink2,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
