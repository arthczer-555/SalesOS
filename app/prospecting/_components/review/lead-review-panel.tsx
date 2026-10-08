"use client";

import * as React from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Check, CheckCircle2, ExternalLink, Linkedin, MoreHorizontal, RefreshCw, SkipForward, Trash2, Undo2 } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { useToast } from "@/components/ui/toast";
import { COLORS, scoreToColor } from "@/lib/design/tokens";
import { useEnrollment } from "@/lib/hooks/use-prospecting-enrollment";
import { canApprove, stepDays } from "@/lib/prospecting/ai/review-utils";
import type { ReviewLintSummary, ReviewQueueItem } from "@/lib/prospecting/ai/types";
import type { StepRow, TouchRow } from "@/lib/prospecting/types";
import { fullName, hubspotContactUrl, linkedinHref } from "../shared/format";
import { CONTENT_STATUS, StatusTag } from "../shared/meta";
import { ResearchBriefCard } from "./research-brief-card";
import { StepReviewCard, type StepCardHandle } from "./step-review-card";

export interface LeadPanelHandle {
  flush: () => Promise<void>;
  focusFirst: () => void;
}

function summarize(touches: TouchRow[]): ReviewLintSummary {
  const s = { errors: 0, warns: 0, infos: 0 };
  for (const t of touches) {
    for (const i of t.lint ?? []) {
      if (i.level === "error") s.errors++;
      else if (i.level === "warn") s.warns++;
      else s.infos++;
    }
  }
  return s;
}

// Panneau de droite de la Review : un prospect, son brief de recherche et une
// carte éditable par étape, avec la barre d'actions collante.
export const LeadReviewPanel = React.forwardRef<
  LeadPanelHandle,
  {
    item: ReviewQueueItem;
    steps: StepRow[];
    approving: boolean;
    regenerating: boolean;
    position: { index: number; total: number };
    onApprove: () => void;
    onSkip: () => void;
    onPrev: () => void;
    onRegenerateAll: () => void;
    onRemoved: () => void;
    onUpdated: () => void;
    onLintChange: (enrollmentId: string, summary: ReviewLintSummary) => void;
  }
>(function LeadReviewPanel({ item, steps, approving, regenerating, position, onApprove, onSkip, onPrev, onRegenerateAll, onRemoved, onUpdated, onLintChange }, ref) {
  const { toast } = useToast();
  const { confirm, dialog } = useConfirm();
  const { detail, error, isLoading, mutate, act } = useEnrollment(item.enrollment.id);
  const cards = React.useRef(new Map<string, StepCardHandle>());
  const sorted = React.useMemo(() => [...steps].sort((a, b) => a.position - b.position), [steps]);
  const days = React.useMemo(() => stepDays(sorted), [sorted]);

  const enrollment = detail?.enrollment ?? item.enrollment;
  const contact = detail?.contact ?? null;
  const touches = React.useMemo(() => detail?.touches ?? [], [detail]);
  const writing = enrollment.content_status === "queued" || enrollment.content_status === "generating";

  // Le statut de contenu a changé côté serveur (fin de génération) : on recharge.
  const lastStatus = React.useRef(item.enrollment.content_status);
  React.useEffect(() => {
    if (lastStatus.current !== item.enrollment.content_status) {
      lastStatus.current = item.enrollment.content_status;
      void mutate();
    }
  }, [item.enrollment.content_status, mutate]);

  // Remonte le résumé de lint à la file (pastille + "Approve all").
  const summary = React.useMemo(() => summarize(touches), [touches]);
  const loaded = !!detail;
  const enrollmentId = item.enrollment.id;
  React.useEffect(() => {
    if (loaded) onLintChange(enrollmentId, summary);
  }, [loaded, enrollmentId, summary, onLintChange]);

  React.useImperativeHandle(ref, () => ({
    flush: async () => {
      await Promise.all(Array.from(cards.current.values()).map((c) => c.flush()));
    },
    focusFirst: () => {
      const first = sorted.find((s) => s.kind !== "linkedin_visit");
      if (first) cards.current.get(first.id)?.focus();
    },
  }));

  const onSaved = React.useCallback(
    (t: TouchRow) => {
      void mutate((d) => (d ? { ...d, touches: d.touches.map((x) => (x.id === t.id ? t : x)) } : d), { revalidate: false });
    },
    [mutate],
  );

  const remove = async () => {
    const ok = await confirm({
      title: `Remove ${fullName(item.contact)} from this campaign?`,
      description: "Their drafted messages are deleted. Anything already sent stays in Gmail and HubSpot.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await act("remove");
      toast("Prospect removed", "success");
      onRemoved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove", "error");
    }
  };

  const unapprove = async () => {
    try {
      await act("unapprove");
      toast("Approval removed", "success");
      onUpdated();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove the approval", "error");
    }
  };

  const c = item.contact;
  const hubspot = hubspotContactUrl(c.hubspot_contact_id);
  const approvable = canApprove(item);
  const fit = item.fitScore;
  const fitColors = fit !== null ? scoreToColor(fit, 100) : null;
  const touchByStep = new Map(touches.map((t) => [t.step_id, t]));
  const blockReason = item.enrollment.approved_at
    ? "Already approved"
    : writing
      ? "Messages are being written"
      : enrollment.content_status !== "ready"
        ? "Generate or update the messages first"
        : item.lint.errors
          ? "Fix the blocking issues first"
          : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {dialog}
      {/* En-tête prospect */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: `1px solid ${COLORS.line}`, background: "#fff" }}>
        <PersonAvatar name={fullName(c)} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: COLORS.ink0, letterSpacing: "-0.01em" }}>{fullName(c)}</span>
            <StatusTag map={CONTENT_STATUS} value={enrollment.content_status} size="sm" />
            {item.enrollment.approved_at ? (
              <Tag tone="ok" size="sm" icon={CheckCircle2}>
                Approved
              </Tag>
            ) : null}
            {fit !== null && fitColors ? (
              <span
                title="Persona fit from the research brief"
                style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: fitColors.bg, color: fitColors.fg }}
              >
                Fit {fit}
              </span>
            ) : null}
          </div>
          <div style={{ fontSize: 12.5, color: COLORS.ink2, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {[c.title, c.company_name].filter(Boolean).join(" at ") || "No title"}
            {c.email ? <span style={{ color: COLORS.ink4 }}> · {c.email}</span> : <span style={{ color: COLORS.warn }}> · no email</span>}
          </div>
        </div>
        <a href={linkedinHref(c)} target="_blank" rel="noopener noreferrer" className="ch-btn ch-btn-sm ch-btn-ghost" title="LinkedIn">
          <Linkedin size={13} /> LinkedIn
        </a>
        {hubspot ? (
          <a href={hubspot} target="_blank" rel="noopener noreferrer" className="ch-btn ch-btn-sm ch-btn-ghost" title="HubSpot">
            <ExternalLink size={13} /> HubSpot
          </a>
        ) : null}
        <DropdownMenu
          width={240}
          trigger={({ toggle, ref: triggerRef }) => (
            <button ref={triggerRef} type="button" onClick={toggle} className="ch-btn ch-btn-sm ch-btn-ghost ch-btn-icon-only" aria-label="More actions">
              <MoreHorizontal size={14} />
            </button>
          )}
          groups={[
            {
              items: [
                { key: "unapprove", label: "Remove approval", icon: Undo2, hidden: !item.enrollment.approved_at || item.enrollment.status !== "pending", onSelect: () => void unapprove() },
                { key: "remove", label: "Remove from campaign", icon: Trash2, danger: true, onSelect: () => void remove() },
              ],
            },
          ]}
        />
      </div>

      {/* Contenu */}
      <div className="thin-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 12, background: COLORS.bgPage }}>
        {error ? (
          <Banner tone="err" title="Could not load this prospect" action={<Button size="sm" onClick={() => void mutate()}>Retry</Button>}>
            {error}
          </Banner>
        ) : null}
        {enrollment.content_status === "error" && enrollment.content_error ? (
          <Banner tone="err" title="Writing failed" action={<Button size="sm" icon={RefreshCw} onClick={onRegenerateAll}>Retry</Button>}>
            {enrollment.content_error}
          </Banner>
        ) : null}
        {enrollment.content_status === "outdated" ? (
          <Banner tone="warn" title="The sequence changed since these messages were written" action={<Button size="sm" icon={RefreshCw} onClick={onRegenerateAll}>Update messages</Button>}>
            Updating rewrites the changed steps. Steps you edited are kept.
          </Banner>
        ) : null}

        {isLoading && !detail ? (
          <>
            <div className="ds-card" style={{ padding: 14 }}>
              <SkeletonText lines={3} />
            </div>
            {[0, 1, 2].map((i) => (
              <div key={i} className="ds-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <Skeleton width="40%" height={14} />
                <Skeleton height={80} />
              </div>
            ))}
          </>
        ) : (
          <>
            {contact ? <ResearchBriefCard contact={contact} enrollmentId={item.enrollment.id} onRefreshed={() => void mutate()} /> : null}
            {sorted.map((s) => (
              <StepReviewCard
                key={`${item.enrollment.id}:${s.id}`}
                ref={(h) => {
                  if (h) cards.current.set(s.id, h);
                  else cards.current.delete(s.id);
                }}
                step={s}
                steps={sorted}
                touch={touchByStep.get(s.id) ?? null}
                day={days.get(s.id) ?? 0}
                writing={writing}
                onSaved={onSaved}
              />
            ))}
          </>
        )}
      </div>

      {/* Barre d'actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          padding: "10px 18px",
          borderTop: `1px solid ${COLORS.line}`,
          background: "rgba(255,255,255,0.96)",
          backdropFilter: "blur(6px)",
        }}
      >
        <Button size="sm" variant="ghost" icon={ArrowUp} onClick={onPrev} disabled={position.index <= 0} title="Previous (K)" />
        <Button size="sm" variant="ghost" icon={ArrowDown} onClick={onSkip} disabled={position.index >= position.total - 1} title="Next (J)" />
        <span style={{ fontSize: 12, color: COLORS.ink3, fontVariantNumeric: "tabular-nums" }}>
          {position.total ? `${position.index + 1} of ${position.total}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        {blockReason && !item.enrollment.approved_at ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: item.lint.errors ? COLORS.err : COLORS.ink3 }}>
            {item.lint.errors ? <AlertTriangle size={12} /> : null}
            {blockReason}
          </span>
        ) : null}
        <Button size="sm" variant="ghost" icon={RefreshCw} loading={regenerating} disabled={writing} onClick={onRegenerateAll} title="Regenerate all (R)">
          Regenerate all <Kbd>R</Kbd>
        </Button>
        <Button size="sm" variant="secondary" icon={SkipForward} onClick={onSkip} title="Skip (S)">
          Skip <Kbd>S</Kbd>
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={Check}
          loading={approving}
          disabled={!approvable}
          onClick={onApprove}
          title={blockReason ?? "Approve and go to the next prospect (A)"}
        >
          Approve &amp; next <Kbd>A</Kbd>
        </Button>
      </div>
    </div>
  );
});
