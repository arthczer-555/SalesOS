"use client";

import * as React from "react";
import {
  Ban,
  CalendarCheck,
  ShieldBan,
  CheckCircle2,
  Clock,
  CornerDownRight,
  ExternalLink,
  Linkedin,
  Mail,
  MessageCircleReply,
  Pause,
  Play,
  SkipForward,
  Square,
  ThumbsDown,
  Wand2,
} from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import { useEnrollment } from "@/lib/hooks/use-prospecting-enrollment";
import { sendJson } from "@/lib/prospecting/client/http";
import { STEP_KIND_META } from "@/lib/prospecting/templates";
import type { EventRow, StepRow, TouchRow } from "@/lib/prospecting/types";
import { ResearchBriefCard } from "../review/research-brief-card";
import { QuickEmailModal } from "../review/quick-email-modal";
import { CONTENT_STATUS, ENROLLMENT_STATUS, StatusTag, StepKindIcon } from "../shared/meta";
import { fmtDateTime, fullName, hubspotContactUrl, linkedinHref, timeAgo } from "../shared/format";

const TOUCH_LABEL: Record<TouchRow["status"], { label: string; tone: "neutral" | "ok" | "warn" | "err" | "info" | "brand" }> = {
  draft: { label: "Draft", tone: "neutral" },
  approved: { label: "Approved", tone: "brand" },
  sending: { label: "Sending", tone: "info" },
  sent: { label: "Sent", tone: "ok" },
  due: { label: "To do", tone: "warn" },
  done: { label: "Done", tone: "ok" },
  skipped: { label: "Skipped", tone: "neutral" },
  canceled: { label: "Canceled", tone: "neutral" },
  failed: { label: "Failed", tone: "err" },
};

const EVENT_LABEL: Record<string, string> = {
  enrolled: "Added to the campaign",
  generated: "Messages written",
  approved: "Approved",
  activated: "Sequence started",
  sent: "Email sent",
  send_failed: "Send failed",
  task_due: "Task created",
  task_done: "Task done",
  task_skipped: "Step skipped",
  replied: "Replied",
  auto_replied: "Auto-reply received",
  bounced: "Email bounced",
  paused: "Paused",
  resumed: "Resumed",
  stopped: "Stopped",
  completed: "Sequence finished",
  meeting_booked: "Meeting booked",
  hubspot_logged: "Logged in HubSpot",
  hubspot_failed: "HubSpot logging failed",
  blocked: "Send blocked",
  error: "Error",
};

// Fiche d'un prospect dans une campagne : recherche, séquence étape par étape,
// journal, et actions (approuver, pause, stop, issue, email ponctuel).
export function ProspectDrawer({
  enrollmentId,
  onClose,
  onChanged,
  onOpenReview,
}: {
  enrollmentId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onOpenReview?: (enrollmentId: string) => void;
}) {
  const { detail, error, isLoading, act, mutate } = useEnrollment(enrollmentId);
  const { toast } = useToast();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [quickOpen, setQuickOpen] = React.useState(false);

  const run = async (action: string, label: string, danger?: string) => {
    if (danger) {
      const ok = await confirm({ title: danger, confirmLabel: label, danger: true });
      if (!ok) return;
    }
    setBusy(action);
    try {
      const res = await act(action);
      toast(`${label}: done`, "success");
      onChanged();
      if (res.removed) onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Action failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const e = detail?.enrollment;
  const c = detail?.contact;

  // Demande de ne plus être contacté : liste de suppression d'équipe + arrêt de la séquence.
  const doNotContact = async () => {
    if (!c?.email) return;
    const ok = await confirm({ title: `Never contact ${c.email} again?`, description: "Added to the team do-not-contact list. Any running sequence stops.", confirmLabel: "Do not contact", danger: true });
    if (!ok) return;
    setBusy("dnc");
    try {
      await sendJson("/api/prospecting/suppressions", "POST", { value: c.email, reason: "unsubscribe", note: "Marked from the prospect" });
      await sendJson(`/api/prospecting/prospects/${c.id}`, "PATCH", { status: "do_not_contact" });
      if (e && ["pending", "active", "paused", "error"].includes(e.status)) await act("stop");
      toast("Added to the do-not-contact list", "success");
      onChanged();
      void mutate();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Action failed", "error");
    } finally {
      setBusy(null);
    }
  };
  const tz = detail?.campaign?.settings.window.timezone;
  const hs = hubspotContactUrl(c?.hubspot_contact_id);

  return (
    <Drawer
      open={!!enrollmentId}
      onClose={onClose}
      width={640}
      headerLeft={c ? <PersonAvatar name={fullName(c)} size={38} /> : <Skeleton width={38} height={38} radius={999} />}
      title={c ? fullName(c) : "Prospect"}
      subtitle={c ? [c.title, c.company_name].filter(Boolean).join(" @ ") || c.email || undefined : undefined}
      headerRight={
        c ? (
          <div style={{ display: "flex", gap: 4 }}>
            {c.email ? (
              <a className="ch-btn ch-btn-ghost ch-btn-sm ch-btn-icon-only" href={`mailto:${c.email}`} title={c.email}>
                <Mail size={14} />
              </a>
            ) : null}
            <a className="ch-btn ch-btn-ghost ch-btn-sm ch-btn-icon-only" href={linkedinHref(c)} target="_blank" rel="noreferrer" title="LinkedIn">
              <Linkedin size={14} />
            </a>
            {hs ? (
              <a className="ch-btn ch-btn-ghost ch-btn-sm ch-btn-icon-only" href={hs} target="_blank" rel="noreferrer" title="Open in HubSpot">
                <ExternalLink size={14} />
              </a>
            ) : null}
          </div>
        ) : null
      }
      footer={
        e ? (
          <div style={{ display: "flex", gap: 8, width: "100%", flexWrap: "wrap" }}>
            {e.status === "pending" && !e.approved_at ? (
              <Button variant="primary" icon={CheckCircle2} loading={busy === "approve"} disabled={e.content_status !== "ready"} onClick={() => run("approve", "Approve")}>
                Approve
              </Button>
            ) : null}
            {e.status === "active" ? (
              <Button icon={Pause} loading={busy === "pause"} onClick={() => run("pause", "Pause")}>
                Pause
              </Button>
            ) : null}
            {e.status === "paused" ? (
              <Button variant="primary" icon={Play} loading={busy === "resume"} onClick={() => run("resume", "Resume")}>
                Resume
              </Button>
            ) : null}
            {c ? (
              <Button icon={Wand2} onClick={() => setQuickOpen(true)} disabled={!c.email}>
                Quick email
              </Button>
            ) : null}
            <div style={{ flex: 1 }} />
            <DropdownMenu
              width={250}
              align="right"
              trigger={({ toggle, ref }) => (
                <button ref={ref} type="button" className="ch-btn" onClick={toggle}>
                  More
                </button>
              )}
              groups={[
                {
                  label: "Outcome",
                  items: [
                    { key: "replied", label: "Mark as replied", description: "They answered on LinkedIn, by phone or another address", icon: MessageCircleReply, hidden: !!e.replied_at, onSelect: () => void run("mark_replied", "Marked as replied") },
                    { key: "meeting", label: "Meeting booked", icon: CalendarCheck, onSelect: () => void run("meeting_booked", "Meeting booked") },
                    { key: "ni", label: "Not interested", icon: ThumbsDown, onSelect: () => void run("not_interested", "Not interested") },
                  ],
                },
                {
                  label: "Sequence",
                  items: [
                    { key: "skip", label: "Skip next step", icon: SkipForward, hidden: !["pending", "active", "paused"].includes(e.status), onSelect: () => void run("skip_step", "Step skipped") },
                    { key: "review", label: "Edit messages in Review", icon: CornerDownRight, hidden: !onOpenReview, onSelect: () => onOpenReview?.(e.id) },
                    { key: "stop", label: "Stop sequence", icon: Square, danger: true, hidden: !["pending", "active", "paused", "error"].includes(e.status), onSelect: () => void run("stop", "Stop", "Stop the sequence for this prospect?") },
                    { key: "remove", label: "Remove from campaign", icon: Ban, danger: true, onSelect: () => void run("remove", "Remove", "Remove this prospect from the campaign?") },
                    {
                      key: "dnc",
                      label: "Do not contact",
                      description: "Never email them again, in any campaign (whole team)",
                      icon: ShieldBan,
                      danger: true,
                      hidden: !c?.email,
                      onSelect: () => void doNotContact(),
                    },
                  ],
                },
              ]}
            />
          </div>
        ) : null
      }
    >
      {error ? (
        <Banner tone="err" title="Could not load this prospect" action={<Button size="sm" onClick={() => void mutate()}>Retry</Button>}>
          {error}
        </Banner>
      ) : isLoading || !detail ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Skeleton height={80} radius={14} />
          <SkeletonText lines={5} />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {e ? <StatusTag map={ENROLLMENT_STATUS} value={e.status} /> : null}
            {e ? <StatusTag map={CONTENT_STATUS} value={e.content_status} /> : null}
            {e?.approved_at ? <Tag tone="brand" icon={CheckCircle2}>Approved</Tag> : null}
            {e?.outcome ? <Tag tone={e.outcome === "meeting_booked" || e.outcome === "interested" ? "ok" : "neutral"}>{e.outcome.replace("_", " ")}</Tag> : null}
            {c?.email ? (
              <span style={{ fontSize: 12, color: COLORS.ink3 }}>
                {c.email}
                {c.email_status ? ` · ${c.email_status}` : ""}
              </span>
            ) : (
              <Tag tone="warn">No email</Tag>
            )}
          </div>

          {e?.status === "active" && e.next_run_at ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: COLORS.ink1, background: COLORS.brandTintSoft, border: "1px solid #f9d3e1", borderRadius: 12, padding: "9px 12px" }}>
              <Clock size={14} style={{ color: COLORS.brand }} /> Next step {fmtDateTime(e.next_run_at, tz)} ({timeAgo(e.next_run_at)})
            </div>
          ) : null}
          {e?.paused_until ? (
            <Banner tone="warn">Paused until {fmtDateTime(e.paused_until, tz)}{e.pause_reason ? ` (${e.pause_reason.replace(/_/g, " ")})` : ""}.</Banner>
          ) : null}
          {e?.error || e?.content_error ? <Banner tone="err">{e.error ?? e.content_error}</Banner> : null}

          {c ? <ResearchBriefCard contact={c} enrollmentId={e?.id} onRefreshed={() => void mutate()} /> : null}

          <section>
            <div className="ds-section-header">Sequence</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {detail.steps.map((s) => (
                <TouchRowView key={s.id} step={s} touch={detail.touches.find((t) => t.step_id === s.id) ?? null} tz={tz} />
              ))}
            </div>
          </section>

          <section>
            <div className="ds-section-header">Activity</div>
            <Timeline events={detail.events} tz={tz} />
          </section>
        </div>
      )}
      {c ? <QuickEmailModal open={quickOpen} onClose={() => setQuickOpen(false)} contact={c} /> : null}
      {dialog}
    </Drawer>
  );
}

function TouchRowView({ step, touch, tz }: { step: StepRow; touch: TouchRow | null; tz?: string }) {
  const [open, setOpen] = React.useState(false);
  const meta = STEP_KIND_META[step.kind];
  const st = touch ? TOUCH_LABEL[touch.status] : null;
  const when = touch?.sent_at ?? touch?.completed_at ?? touch?.due_at ?? null;
  return (
    <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 12, background: "#fff" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px", background: "transparent", border: 0, cursor: "pointer", font: "inherit", textAlign: "left" }}
      >
        <StepKindIcon kind={step.kind} size={28} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink0 }}>
            {step.position}. {meta.label}
            {step.kind === "email" && step.thread_mode === "reply" ? <span style={{ color: COLORS.ink3, fontWeight: 500 }}> · in thread</span> : null}
          </span>
          <span style={{ display: "block", fontSize: 12, color: COLORS.ink3, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {touch?.subject || touch?.body?.split("\n")[0] || (step.kind === "linkedin_visit" ? "Profile visit" : "Not written yet")}
          </span>
        </span>
        {when ? <span style={{ fontSize: 11.5, color: COLORS.ink3, whiteSpace: "nowrap" }}>{fmtDateTime(when, tz)}</span> : null}
        {st ? <Tag tone={st.tone} size="sm">{st.label}</Tag> : <Tag size="sm">Pending</Tag>}
      </button>
      {open && touch ? (
        <div style={{ padding: "0 12px 12px 50px" }}>
          {touch.subject ? <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{touch.subject}</div> : null}
          <div style={{ fontSize: 13, color: COLORS.ink1, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{touch.body || "No content."}</div>
          {touch.last_error ? <div style={{ fontSize: 12, color: COLORS.err, marginTop: 8 }}>{touch.last_error}</div> : null}
          {touch.task_outcome ? <div style={{ fontSize: 12, color: COLORS.ink3, marginTop: 8 }}>Outcome: {touch.task_outcome}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function Timeline({ events, tz }: { events: EventRow[]; tz?: string }) {
  if (!events.length) return <div style={{ fontSize: 12.5, color: COLORS.ink3 }}>No activity yet.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {events.map((ev, i) => (
        <div key={ev.id} style={{ display: "flex", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: ev.type.includes("fail") || ev.type === "bounced" || ev.type === "error" ? COLORS.err : ev.type === "replied" || ev.type === "meeting_booked" ? COLORS.ok : COLORS.lineStrong, marginTop: 5 }} />
            {i < events.length - 1 ? <span style={{ width: 1.5, flex: 1, background: COLORS.line }} /> : null}
          </div>
          <div style={{ paddingBottom: 12, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: COLORS.ink0, fontWeight: 600 }}>
              {EVENT_LABEL[ev.type] ?? ev.type.replace(/_/g, " ")}
              {ev.step_position ? <span style={{ color: COLORS.ink3, fontWeight: 500 }}> · step {ev.step_position}</span> : null}
            </div>
            <div style={{ fontSize: 11.5, color: COLORS.ink3 }}>
              {fmtDateTime(ev.occurred_at, tz)}
              {typeof ev.data?.reason === "string" ? ` · ${String(ev.data.reason).replace(/_/g, " ")}` : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
