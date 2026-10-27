"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Hash, Link2, Loader2, Lock, Search, Unlink, X } from "lucide-react";
import { COLORS, SHADOWS } from "@/app/clients/_components/theme";
import { useToast } from "@/components/ui/toast";
import { SLACK_APP_NAME, type ClientSlackChannel, type SlackChannelOption, type SlackChannelsResponse } from "@/lib/clients/types";
import { Tag, fmtDay } from "./ui";

// Canaux Slack dédiés de la fiche (cf. lib/clients/slack-context.ts) : ceux
// reliés (trouvés par le refresh ou reliés à la main), avec Unlink, puis le
// sélecteur. Seul un canal où l'app CoachelloHQ est membre peut être relié ;
// les autres sont listés grisés avec la marche à suivre. Ouvert depuis le
// header, le bandeau de refresh et le popup "Last refresh".

async function fetcher(url: string): Promise<SlackChannelsResponse> {
  const res = await fetch(url);
  const body = (await res.json().catch(() => ({}))) as SlackChannelsResponse & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

const INVITE_HINT = `Type /invite @${SLACK_APP_NAME} in the channel, then link it here.`;

function ChannelName({ name, isPrivate }: { name: string; isPrivate?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: COLORS.ink0 }}>
      {isPrivate ? <Lock size={12} style={{ color: COLORS.ink3, flexShrink: 0 }} /> : <Hash size={13} style={{ color: COLORS.ink3, flexShrink: 0 }} />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
    </span>
  );
}

function linkedDetail(c: ClientSlackChannel): string {
  if (c.source === "auto") return `Found by the refresh on ${fmtDay(c.linked_at, true)}`;
  return `Linked${c.linked_by ? ` by ${c.linked_by}` : ""} on ${fmtDay(c.linked_at, true)}`;
}

export function SlackChannelModal({
  clientId,
  clientName,
  onClose,
  onLinked,
  onUnlinked,
}: {
  clientId: string;
  clientName: string;
  onClose: () => void;
  // refreshStarted : le lien a lancé un refresh qui lit le canal.
  onLinked: (refreshStarted: boolean) => void;
  onUnlinked: () => void;
}) {
  const { toast } = useToast();
  const { data, error, isLoading, mutate } = useSWR<SlackChannelsResponse>(`/api/clients/${clientId}/slack-channels`, fetcher, {
    revalidateOnFocus: false,
  });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const linked = data?.linked ?? [];
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, "");
    const linkedIds = new Set((data?.linked ?? []).map((c) => c.id));
    const list = (data?.channels ?? []).filter((c) => !linkedIds.has(c.id) && (!q || c.name.includes(q)));
    // Canaux où l'app est membre d'abord : ce sont les seuls reliables.
    const byMembership = (a: SlackChannelOption, b: SlackChannelOption) => Number(b.is_member) - Number(a.is_member) || a.name.localeCompare(b.name);
    return [
      { label: `Looks like ${clientName}`, rows: list.filter((c) => c.suggested).sort(byMembership) },
      { label: "All channels", rows: list.filter((c) => !c.suggested).sort(byMembership) },
    ].filter((s) => s.rows.length > 0);
  }, [data, query, clientName]);

  async function post(channel: { id: string; name: string }, action: "link" | "unlink") {
    setBusy(channel.id);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/slack-channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channel.id, action }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; refresh?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (action === "link") {
        const refreshStarted = body.refresh === "inline" || body.refresh === "background";
        toast(`#${channel.name} linked.${refreshStarted ? " Refreshing the account to read it…" : ""}`, "success");
        onLinked(refreshStarted);
        onClose();
        return;
      }
      toast(`#${channel.name} unlinked. The refresh no longer reads it.`, "success");
      await mutate();
      onUnlinked();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  const sectionLabel: React.CSSProperties = {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: COLORS.ink3,
    padding: "10px 12px 4px",
  };
  const row: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 12,
    alignItems: "center",
    padding: "8px 12px",
    borderBottom: `1px solid ${COLORS.line}`,
  };

  return (
    <div
      role="presentation"
      onClick={() => !busy && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(17,17,24,0.42)", display: "grid", placeItems: "center", padding: 20, zIndex: 80 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="slack-channel-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 560,
          background: COLORS.bgCard,
          borderRadius: 16,
          boxShadow: SHADOWS.pop,
          maxHeight: "calc(100vh - 40px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "20px 22px 0" }}>
          <span style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: "grid", placeItems: "center", background: COLORS.sand, color: COLORS.primary }}>
            <Hash size={17} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 id="slack-channel-title" style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" }}>
              Slack channel of {clientName}
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: COLORS.ink2, lineHeight: 1.45 }}>
              Every refresh reads the linked channels in full, threads included. Only a channel where the {SLACK_APP_NAME} app is a member can be linked.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ch-btn ch-btn-sm ch-btn-ghost" style={{ padding: 4 }} disabled={!!busy}>
            <X size={16} />
          </button>
        </div>

        <div className="thin-scrollbar" style={{ padding: "16px 22px", overflowY: "auto", flex: 1 }}>
          {isLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: COLORS.ink3, fontSize: 13 }}>
              <Loader2 size={14} className="animate-spin" /> Reading the Slack channels…
            </div>
          ) : error ? (
            <div style={{ fontSize: 13, color: COLORS.err }}>{error instanceof Error ? error.message : "Could not read the Slack channels"}</div>
          ) : (
            <>
              {data && !data.supported && (
                <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: COLORS.warnTint, border: `1px solid ${COLORS.warnLine}`, fontSize: 12.5, color: COLORS.ink1 }}>
                  The database update for Slack channels is not applied yet: linking is not available.
                </div>
              )}

              <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 12, overflow: "hidden" }}>
                <div style={sectionLabel}>Linked</div>
                {linked.length === 0 ? (
                  <div style={{ ...row, gridTemplateColumns: "1fr", fontSize: 13, color: COLORS.ink2 }}>
                    No dedicated channel. The refresh only reads #12-everything-clients and the mentions of the account.
                  </div>
                ) : (
                  linked.map((c) => (
                    <div key={c.id} style={row}>
                      <span style={{ minWidth: 0 }}>
                        <ChannelName name={c.name} />
                        <span style={{ display: "block", fontSize: 11.5, color: COLORS.ink3, marginTop: 2 }}>{linkedDetail(c)}</span>
                      </span>
                      <button type="button" className="ch-btn ch-btn-sm ch-btn-ghost" disabled={!!busy} onClick={() => void post(c, "unlink")} title="Stop reading this channel for this account">
                        {busy === c.id ? <Loader2 size={12} className="animate-spin" /> : <Unlink size={12} />}
                        Unlink
                      </button>
                    </div>
                  ))
                )}
              </div>

              <label className="ds-input ds-input-sm ds-input-wrap" style={{ width: "100%", padding: "7px 11px", marginTop: 14 }}>
                <Search size={14} style={{ color: COLORS.ink3, flexShrink: 0 }} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a channel…" aria-label="Search a channel" autoFocus />
              </label>
              <div style={{ marginTop: 12, border: `1px solid ${COLORS.line}`, borderRadius: 12, overflow: "hidden" }}>
                {sections.map((s) => (
                  <div key={s.label}>
                    <div style={sectionLabel}>{s.label}</div>
                    {s.rows.map((c) => (
                      <div key={c.id} style={{ ...row, opacity: c.is_member ? 1 : 0.75 }}>
                        <span style={{ minWidth: 0 }}>
                          <ChannelName name={c.name} isPrivate={c.is_private} />
                          {!c.is_member && (
                            <span style={{ display: "block", fontSize: 11.5, color: COLORS.ink3, marginTop: 2 }}>{SLACK_APP_NAME} is not in this channel</span>
                          )}
                        </span>
                        {c.is_member ? (
                          <button type="button" className="ch-btn ch-btn-sm" disabled={!!busy || !data?.supported} onClick={() => void post(c, "link")}>
                            {busy === c.id ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
                            Link
                          </button>
                        ) : (
                          <Tag title={INVITE_HINT}>Invite {SLACK_APP_NAME} first</Tag>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                {sections.length === 0 && <div style={{ padding: 14, fontSize: 13, color: COLORS.ink3 }}>No channel matches this search.</div>}
              </div>
            </>
          )}
          {submitError && <div style={{ marginTop: 12, fontSize: 12.5, color: COLORS.err }}>{submitError}</div>}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 22px", borderTop: `1px solid ${COLORS.line}`, background: COLORS.bgSoft }}>
          <span style={{ flex: 1, fontSize: 12, color: COLORS.ink3, lineHeight: 1.4 }}>
            Channel missing or greyed out? {INVITE_HINT} Private channels only show up once the app is in them.
          </span>
          <button type="button" className="ch-btn" onClick={onClose} disabled={!!busy}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
