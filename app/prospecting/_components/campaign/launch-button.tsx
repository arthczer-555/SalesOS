"use client";

import * as React from "react";
import { CheckCircle2, Circle, Rocket, XCircle } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import { ApiError } from "@/lib/prospecting/client/http";
import { firstRunAt } from "@/lib/prospecting/schedule";
import type { CampaignRow, CampaignStats, MailboxHealth, SequenceHealth, StepRow } from "@/lib/prospecting/types";
import { fmtDateTime } from "../shared/format";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Bouton de lancement + checklist (séquence, boîte d'envoi, prospects prêts,
// fenêtre, quotas) avec estimation du premier envoi.
export function LaunchButton({
  campaign,
  steps,
  stats,
  health,
  mailbox,
  onLaunch,
  onGoTo,
}: {
  campaign: CampaignRow;
  steps: StepRow[];
  stats: CampaignStats | null;
  health: SequenceHealth | null;
  mailbox: MailboxHealth | null;
  onLaunch: () => Promise<{ activated?: number; conflicts?: number }>;
  onGoTo: (tab: string) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [blockers, setBlockers] = React.useState<string[]>([]);
  const s = campaign.settings;
  const hasEmail = steps.some((x) => x.kind === "email");
  const mailboxOk = !hasEmail || (mailbox?.mailbox?.provider === "gmail_sender" ? mailbox.senderConnected : !!mailbox?.gmailConnected);
  const seqOk = steps.length > 0 && !(health?.issues ?? []).some((i) => i.level === "error");
  const ready = s.requireApproval ? stats?.leads_approved ?? 0 : (stats?.leads_to_review ?? 0) + (stats?.leads_approved ?? 0);
  const readyOk = ready > 0;
  const days = s.window.days.map((d) => DAY_LABELS[d - 1]).join(", ");
  const first = firstRunAt(new Date(), s.window, s.startDate);

  const items: { ok: boolean; label: string; detail: string; tab?: string }[] = [
    { ok: seqOk, label: "Sequence", detail: seqOk ? `${steps.length} steps, no blocking issue` : "Fix the errors in the sequence", tab: "sequence" },
    { ok: mailboxOk, label: "Gmail connected", detail: mailboxOk ? mailbox?.mailbox?.email_address ?? "Connected" : "Connect Gmail to send emails" },
    {
      ok: readyOk,
      label: s.requireApproval ? "Prospects approved" : "Messages ready",
      detail: readyOk ? `${ready} of ${stats?.leads_total ?? 0} prospects will start` : s.requireApproval ? "Approve prospects in Review" : "Write messages first",
      tab: s.requireApproval ? "review" : "prospects",
    },
    { ok: true, label: "Sending window", detail: `${days}, ${s.window.start} to ${s.window.end} (${s.window.timezone})`, tab: "settings" },
    { ok: true, label: "Daily limits", detail: `${s.newLeadsPerDay} new prospects and ${s.maxEmailsPerDay} emails a day`, tab: "settings" },
  ];
  const allOk = items.every((i) => i.ok);

  const launch = async (close: () => void) => {
    setBusy(true);
    setBlockers([]);
    try {
      const res = await onLaunch();
      toast(`Campaign launched: ${res.activated ?? 0} prospects in sequence${res.conflicts ? `, ${res.conflicts} already in another sequence` : ""}`, "success");
      close();
    } catch (e) {
      if (e instanceof ApiError && e.body && typeof e.body === "object" && Array.isArray((e.body as { blockers?: unknown }).blockers)) {
        setBlockers((e.body as { blockers: string[] }).blockers);
      } else toast(e instanceof Error ? e.message : "Launch failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      width={400}
      align="right"
      trigger={({ toggle }) => (
        <Button variant="primary" icon={Rocket} onClick={toggle}>
          Launch
        </Button>
      )}
    >
      {({ close }) => (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Ready to launch?</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {items.map((i) => (
              <button
                key={i.label}
                type="button"
                className="ch-menu-item"
                onClick={() => {
                  if (i.tab) {
                    onGoTo(i.tab);
                    close();
                  }
                }}
                style={{ alignItems: "flex-start" }}
              >
                {i.ok ? <CheckCircle2 size={16} style={{ color: COLORS.ok, flexShrink: 0, marginTop: 1 }} /> : <Circle size={16} style={{ color: COLORS.ink4, flexShrink: 0, marginTop: 1 }} />}
                <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{i.label}</span>
                  <span style={{ fontSize: 12, color: i.ok ? COLORS.ink3 : COLORS.warn }}>{i.detail}</span>
                </span>
              </button>
            ))}
          </div>
          {mailbox?.sendMode && mailbox.sendMode !== "live" ? (
            <Banner tone="warn">
              {mailbox.sendMode === "off"
                ? "Sending is disabled on this environment: the sequence will run (tasks, schedule) but no email leaves."
                : "Test mode: only allowlisted recipients receive emails."}
            </Banner>
          ) : null}
          {blockers.length ? (
            <Banner tone="err" icon={XCircle} title="Can't launch yet">
              {blockers.join(" ")}
            </Banner>
          ) : null}
          <div style={{ fontSize: 12.5, color: COLORS.ink2, background: COLORS.bgSoft, borderRadius: 10, padding: "9px 12px" }}>
            First emails from <b>{fmtDateTime(first.toISOString(), s.window.timezone)}</b>, then spread through the day. Each sequence stops as soon as the prospect replies.
          </div>
          <Button variant="primary" icon={Rocket} fullWidth loading={busy} disabled={!allOk} onClick={() => void launch(close)}>
            Launch {ready ? `with ${ready} prospects` : ""}
          </Button>
        </div>
      )}
    </Popover>
  );
}
