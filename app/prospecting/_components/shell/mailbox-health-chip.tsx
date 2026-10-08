"use client";

import * as React from "react";
import { AlertTriangle, ExternalLink, Mail, Pause, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { NumberStepper } from "@/components/ui/number-stepper";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import { sendJson } from "@/lib/prospecting/client/http";
import type { MailboxHealth } from "@/lib/prospecting/types";
import { timeAgo } from "../shared/format";

type Level = "ok" | "warn" | "err";

export function mailboxLevel(h: MailboxHealth | null): { level: Level; label: string; detail: string } {
  if (!h) return { level: "warn", label: "Mailbox", detail: "Loading mailbox status" };
  const connected = h.mailbox?.provider === "gmail_sender" ? h.senderConnected : h.gmailConnected;
  if (!connected) return { level: "err", label: "Gmail not connected", detail: "Connect Gmail to send emails and detect replies." };
  if (h.mailbox?.status === "disconnected") return { level: "err", label: "Mailbox disconnected", detail: "Google access was revoked or expired. Reconnect it." };
  if (h.sendMode === "off") return { level: "warn", label: "Sending off", detail: "Sending is disabled on this environment (PROSPECTING_SEND_MODE)." };
  if (h.mailbox?.status === "paused") {
    const why =
      h.mailbox.paused_reason === "bounce_guard"
        ? "Paused automatically: bounce rate above 3% this week."
        : h.mailbox.paused_reason === "gmail_quota"
          ? "Paused: Gmail sending limit reached. Resumes tomorrow."
          : "Sending is paused.";
    return { level: "warn", label: "Sending paused", detail: why };
  }
  if (h.mailbox?.sync_error) return { level: "warn", label: "Reply sync issue", detail: h.mailbox.sync_error };
  if (h.sendMode === "allowlist") return { level: "warn", label: "Test mode", detail: "Only allowlisted recipients receive emails." };
  return { level: "ok", label: "Sending on", detail: "Emails go out from your Gmail inside each campaign's window." };
}

const DOT: Record<Level, string> = { ok: COLORS.ok, warn: "#d97706", err: COLORS.err };

// Pastille d'état de la boîte d'envoi dans la barre Prospecting + popover de
// réglages rapides (limite quotidienne, pause, synchro des réponses).
export function MailboxHealthChip({ health, onChanged }: { health: MailboxHealth | null; onChanged: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const { level, label, detail } = mailboxLevel(health);
  const mb = health?.mailbox ?? null;

  const patch = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      await sendJson("/api/prospecting/mailbox", "PATCH", body);
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Update failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    try {
      const res = await sendJson<{ replies?: number; newReplies?: number }>("/api/prospecting/mailbox/sync", "POST");
      const n = res.newReplies ?? res.replies ?? 0;
      toast(n ? `${n} new ${n === 1 ? "reply" : "replies"} found` : "Replies are up to date", "success");
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Sync failed", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Popover
      width={340}
      align="right"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className="ch-btn ch-btn-sm ch-btn-subtle"
          style={{ gap: 8 }}
          title={detail}
        >
          <span style={{ width: 8, height: 8, borderRadius: 999, background: DOT[level], boxShadow: `0 0 0 3px ${DOT[level]}22` }} />
          {label}
          {health ? <span style={{ color: COLORS.ink3, fontWeight: 500 }}>{health.sentToday}/{mb?.daily_limit ?? 30} today</span> : null}
        </button>
      )}
    >
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: level === "ok" ? COLORS.okBg : level === "warn" ? COLORS.warnBg : COLORS.errBg, color: DOT[level] }}>
            {level === "ok" ? <ShieldCheck size={16} /> : <AlertTriangle size={16} />}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.ink0 }}>{label}</div>
            <div style={{ fontSize: 12, color: COLORS.ink2, lineHeight: 1.45, marginTop: 2 }}>{detail}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Metric label="Sender" value={mb?.email_address ?? "Not set"} />
          <Metric label="Mailbox" value={mb?.provider === "gmail_sender" ? "Dedicated" : "Main Gmail"} />
          <Metric label="Sent today" value={`${health?.sentToday ?? 0} / ${mb?.daily_limit ?? 30}`} />
          <Metric
            label="Bounces (7d)"
            value={health?.bounceRate7d === null || health?.bounceRate7d === undefined ? "No data" : `${(health.bounceRate7d * 100).toFixed(1)}%`}
            warn={(health?.bounceRate7d ?? 0) > 0.02}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink1 }}>Daily limit</div>
            <div style={{ fontSize: 11, color: COLORS.ink3 }}>30 to 50 keeps the domain safe.</div>
          </div>
          <NumberStepper value={mb?.daily_limit ?? 30} min={1} max={100} step={5} size="sm" onChange={(v) => patch({ dailyLimit: v }, "limit")} disabled={busy === "limit"} />
        </div>

        <div style={{ fontSize: 12, color: COLORS.ink3, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span>Replies checked {timeAgo(mb?.last_synced_at)}</span>
          <Button size="sm" variant="ghost" icon={RefreshCw} loading={busy === "sync"} onClick={sync}>
            Check now
          </Button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {mb?.status === "paused" ? (
            <Button size="sm" icon={Play} loading={busy === "pause"} onClick={() => patch({ paused: false }, "pause")}>
              Resume sending
            </Button>
          ) : (
            <Button size="sm" icon={Pause} loading={busy === "pause"} onClick={() => patch({ paused: true }, "pause")}>
              Pause all sending
            </Button>
          )}
          {!health?.gmailConnected || mb?.status === "disconnected" ? (
            <a className="ch-btn ch-btn-sm ch-btn-primary" href="/api/gmail/connect">
              <Mail size={13} /> Connect Gmail
            </a>
          ) : null}
          <a className="ch-btn ch-btn-sm ch-btn-ghost" href="/api/gmail/connect?purpose=sender" title="Recommended: send cold emails from a secondary domain to protect coachello.io">
            <ExternalLink size={13} /> {health?.senderConnected ? "Reconnect dedicated mailbox" : "Use a dedicated mailbox"}
          </a>
        </div>
      </div>
    </Popover>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ background: COLORS.bgSoft, border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "7px 9px", minWidth: 0 }}>
      <div className="ds-kpi-label">{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: warn ? COLORS.warn : COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}
