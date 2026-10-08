"use client";

import * as React from "react";
import { CheckCheck, Inbox, Keyboard, Search, Sparkles, Users } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Modal } from "@/components/ui/modal";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import { approveEnrollment, approveReady, useGenerate, useReviewQueue } from "@/lib/hooks/use-prospecting-review";
import { canApprove, matchesFilter } from "@/lib/prospecting/ai/review-utils";
import type { GenerateScope, ReviewFilter, ReviewLintSummary, ReviewQueueItem, ReviewQueueResponse } from "@/lib/prospecting/ai/types";
import type { CampaignRow, Persona, StepRow } from "@/lib/prospecting/types";
import { fullName, plural } from "../shared/format";
import { JobProgress } from "../shared/job-progress";
import { CONTENT_STATUS, StatusTag } from "../shared/meta";
import { LeadReviewPanel, type LeadPanelHandle } from "./lead-review-panel";
import { LintDot } from "./lint-chips";

const FILTERS: { value: ReviewFilter; label: string }[] = [
  { value: "to_review", label: "To review" },
  { value: "approved", label: "Approved" },
  { value: "attention", label: "Needs attention" },
  { value: "all", label: "All" },
];

const SHORTCUTS: [string, string][] = [
  ["A", "Approve and go to the next prospect"],
  ["S", "Skip to the next prospect"],
  ["J / K", "Next / previous prospect"],
  ["E", "Edit the first message"],
  ["R", "Regenerate all messages of this prospect"],
  ["Esc", "Leave the editor"],
  ["?", "Show this help"],
];

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function CountBadge({ n, active }: { n: number | undefined; active: boolean }) {
  if (n === undefined) return null;
  return (
    <span
      style={{
        marginLeft: 4,
        fontSize: 10.5,
        fontWeight: 700,
        padding: "0 5px",
        borderRadius: 999,
        background: active ? COLORS.brandTint : "#ececf0",
        color: active ? COLORS.brandDark : COLORS.ink2,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {n}
    </span>
  );
}

function QueueRow({ item, active, onClick }: { item: ReviewQueueItem; active: boolean; onClick: () => void }) {
  const c = item.contact;
  const e = item.enrollment;
  return (
    <button type="button" className="pg-queue-row" aria-current={active} onClick={onClick} data-enrollment={e.id}>
      <PersonAvatar name={fullName(c)} size={30} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 650, color: COLORS.ink0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
            {fullName(c)}
          </span>
          {e.content_status === "ready" ? <LintDot errors={item.lint.errors} warns={item.lint.warns} /> : null}
        </div>
        <div style={{ fontSize: 12, color: COLORS.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {[c.company_name, c.title].filter(Boolean).join(" · ") || c.email || "No details"}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 5, alignItems: "center" }}>
          {e.approved_at ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, color: COLORS.ok }}>
              <CheckCheck size={12} /> Approved
            </span>
          ) : (
            <StatusTag map={CONTENT_STATUS} value={e.content_status} size="sm" />
          )}
          {item.editedTouches ? <span style={{ fontSize: 11, color: COLORS.ink3 }}>{plural(item.editedTouches, "edit")}</span> : null}
        </div>
      </div>
    </button>
  );
}

// Onglet Review d'une campagne : file des prospects à gauche, séquence du
// prospect sélectionné à droite, navigation et validation au clavier.
export function ReviewTab({
  campaignId,
  campaign,
  steps,
  persona,
  onChanged,
}: {
  campaignId: string;
  campaign: CampaignRow;
  steps: StepRow[];
  persona: Persona | null;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const { confirm, dialog } = useConfirm();
  const { items, counts, contentSteps, running: queueRunning, error, isLoading, mutate } = useReviewQueue(campaignId);
  const { generate, running: genRunning, refresh: refreshGenerate } = useGenerate(campaignId);
  const [filter, setFilter] = React.useState<ReviewFilter>("to_review");
  const [q, setQ] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [approving, setApproving] = React.useState(false);
  const [regenId, setRegenId] = React.useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [starting, setStarting] = React.useState<GenerateScope | null>(null);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [dismissedJobs, setDismissedJobs] = React.useState<string[]>([]);
  const panelRef = React.useRef<LeadPanelHandle>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const running = genRunning ?? queueRunning;
  const sortedSteps = React.useMemo(() => [...steps].sort((a, b) => a.position - b.position), [steps]);

  const visible = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((it) => {
      if (!matchesFilter(it, filter)) return false;
      if (!needle) return true;
      const c = it.contact;
      return [c.first_name, c.last_name, c.company_name, c.title, c.email].some((v) => (v ?? "").toLowerCase().includes(needle));
    });
  }, [items, filter, q]);

  // Sélection : reste sur le prospect courant tant qu'il est visible, sinon le premier.
  React.useEffect(() => {
    if (selectedId && visible.some((i) => i.enrollment.id === selectedId)) return;
    setSelectedId(visible.length ? visible[0].enrollment.id : null);
  }, [visible, selectedId]);

  const current = items.find((i) => i.enrollment.id === selectedId) ?? null;
  const index = current ? visible.findIndex((i) => i.enrollment.id === current.enrollment.id) : -1;

  const select = React.useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) requestAnimationFrame(() => listRef.current?.querySelector(`[data-enrollment="${id}"]`)?.scrollIntoView({ block: "nearest" }));
  }, []);

  const neighbor = React.useCallback(
    (delta: 1 | -1): string | null => {
      if (!visible.length) return null;
      if (index < 0) return visible[0].enrollment.id;
      const next = visible[index + delta];
      return next ? next.enrollment.id : null;
    },
    [visible, index],
  );

  const refreshAll = React.useCallback(() => {
    void mutate();
    onChanged();
  }, [mutate, onChanged]);

  const onLintChange = React.useCallback(
    (enrollmentId: string, summary: ReviewLintSummary) => {
      void mutate(
        (d: ReviewQueueResponse | undefined) => {
          if (!d) return d;
          const it = d.items.find((x) => x.enrollment.id === enrollmentId);
          if (!it || (it.lint.errors === summary.errors && it.lint.warns === summary.warns && it.lint.infos === summary.infos)) return d;
          return { ...d, items: d.items.map((x) => (x.enrollment.id === enrollmentId ? { ...x, lint: summary } : x)) };
        },
        { revalidate: false },
      );
    },
    [mutate],
  );

  const startGenerate = async (scope: GenerateScope) => {
    setStarting(scope);
    try {
      await generate({ scope });
      toast("The AI is researching each prospect and writing their sequence. You can keep reviewing.", "info");
      refreshAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not start generation", "error");
    } finally {
      setStarting(null);
    }
  };

  const approveCurrent = async () => {
    if (!current || approving) return;
    if (!canApprove(current)) {
      toast(current.lint.errors ? "Fix the blocking issues before approving." : "This prospect can't be approved yet.", "error");
      return;
    }
    await panelRef.current?.flush();
    const id = current.enrollment.id;
    const next = neighbor(1) ?? neighbor(-1);
    setApproving(true);
    try {
      await approveEnrollment(id);
      void mutate(
        (d: ReviewQueueResponse | undefined) =>
          d ? { ...d, items: d.items.map((x) => (x.enrollment.id === id ? { ...x, enrollment: { ...x.enrollment, approved_at: new Date().toISOString() } } : x)) } : d,
        { revalidate: true },
      );
      onChanged();
      if (filter === "to_review" || filter === "attention") select(next);
      else select(neighbor(1) ?? id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not approve", "error");
    } finally {
      setApproving(false);
    }
  };

  const skip = () => {
    const next = neighbor(1);
    if (next) select(next);
  };
  const prev = () => {
    const p = neighbor(-1);
    if (p) select(p);
  };

  const regenerateCurrent = async () => {
    if (!current) return;
    const edited = current.editedTouches;
    const ok = await confirm({
      title: `Regenerate all messages for ${fullName(current.contact)}?`,
      description: edited
        ? `The AI rewrites every step that was not sent yet. Your ${plural(edited, "edited step")} ${edited > 1 ? "are" : "is"} kept: use Regenerate on a step to rewrite it.`
        : "The AI researches the prospect again if needed and rewrites every step that was not sent yet. Current drafts stay in the version history.",
      confirmLabel: "Regenerate",
    });
    if (!ok) return;
    await panelRef.current?.flush();
    setRegenId(current.enrollment.id);
    try {
      await generate({ enrollmentIds: [current.enrollment.id] });
      refreshAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not regenerate", "error");
    } finally {
      setRegenId(null);
    }
  };

  const approvable = items.filter(canApprove);
  const approveAll = async () => {
    if (!approvable.length) return;
    const ok = await confirm({
      title: `Approve ${plural(approvable.length, "prospect")}?`,
      description: "Only prospects with ready messages and no blocking issue are approved. Their emails will go out on schedule once the campaign runs.",
      confirmLabel: "Approve all",
    });
    if (!ok) return;
    await panelRef.current?.flush();
    setBulkBusy(true);
    try {
      const res = await approveReady(approvable.map((i) => i.enrollment.id));
      toast(`${plural(res.updated, "prospect")} approved${res.errors.length ? `. ${res.errors[0]}` : ""}`, res.errors.length ? "info" : "success");
      refreshAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Bulk approval failed", "error");
    } finally {
      setBulkBusy(false);
    }
  };

  // Raccourcis clavier (désactivés pendant la saisie et quand une modale est ouverte).
  const handlers = React.useRef({ approveCurrent, skip, prev, regenerateCurrent });
  handlers.current = { approveCurrent, skip, prev, regenerateCurrent };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      const k = e.key;
      if (k === "?") {
        e.preventDefault();
        setHelpOpen(true);
      } else if (k === "j" || k === "ArrowDown") {
        e.preventDefault();
        handlers.current.skip();
      } else if (k === "k" || k === "ArrowUp") {
        e.preventDefault();
        handlers.current.prev();
      } else if (k === "a") {
        e.preventDefault();
        void handlers.current.approveCurrent();
      } else if (k === "s") {
        e.preventDefault();
        handlers.current.skip();
      } else if (k === "r") {
        e.preventDefault();
        void handlers.current.regenerateCurrent();
      } else if (k === "e") {
        e.preventDefault();
        panelRef.current?.focusFirst();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const outdated = items.filter((i) => i.enrollment.content_status === "outdated").length;
  const failed = items.filter((i) => i.enrollment.content_status === "error").length;
  const reviewable = counts ? counts.to_review + counts.approved + counts.attention : 0;
  const approvedCount = counts?.approved ?? 0;
  const showJob = running && !dismissedJobs.includes(running.id);

  // ── Rendu ──
  if (error && !items.length) {
    return (
      <Banner tone="err" title="Could not load the review queue" action={<Button size="sm" onClick={() => void mutate()}>Retry</Button>}>
        {error}
      </Banner>
    );
  }

  if (!isLoading && counts && counts.all === 0) {
    return (
      <div className="ds-card">
        <EmptyState
          icon={Users}
          title="No prospects in this campaign yet"
          description="Add prospects from the Prospects tab. The AI then researches each one and writes their whole sequence here for you to review."
        />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {dialog}

      {showJob && running ? (
        <JobProgress
          key={running.id}
          jobId={running.id}
          onDone={() => {
            refreshAll();
            void refreshGenerate();
          }}
          onDismiss={() => setDismissedJobs((d) => [...d, running.id])}
        />
      ) : null}

      {!running && counts && counts.noContent > 0 ? (
        <Banner
          tone="info"
          icon={Sparkles}
          title={`${plural(counts.noContent, "prospect")} ${counts.noContent > 1 ? "have" : "has"} no messages yet`}
          action={
            <Button size="sm" variant="primary" icon={Sparkles} loading={starting === "missing"} onClick={() => void startGenerate("missing")}>
              Generate
            </Button>
          }
        >
          The AI researches each prospect (LinkedIn, news, open roles, CRM) and writes the full sequence in one go.
        </Banner>
      ) : null}
      {!running && outdated > 0 ? (
        <Banner
          tone="warn"
          title={`${plural(outdated, "prospect")} ${outdated > 1 ? "have" : "has"} outdated messages`}
          action={
            <Button size="sm" loading={starting === "outdated"} onClick={() => void startGenerate("outdated")}>
              Update messages
            </Button>
          }
        >
          The sequence changed after their messages were written. Edited steps are kept.
        </Banner>
      ) : null}
      {!running && failed > 0 ? (
        <Banner
          tone="err"
          title={`Writing failed for ${plural(failed, "prospect")}`}
          action={
            <Button size="sm" loading={starting === "errors"} onClick={() => void startGenerate("errors")}>
              Retry
            </Button>
          }
        />
      ) : null}
      {!persona ? (
        <Banner tone="neutral" title="No persona on this campaign">
          Messages stay on the general Coachello offer, without proof points. Pick a persona in Settings for sharper messages.
        </Banner>
      ) : null}

      <div
        className="ds-card"
        style={{
          padding: 0,
          display: "grid",
          gridTemplateColumns: "minmax(300px, 360px) minmax(0, 1fr)",
          height: "calc(100vh - 240px)",
          minHeight: 540,
          overflow: "hidden",
        }}
      >
        {/* File */}
        <aside style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: `1px solid ${COLORS.line}` }}>
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, borderBottom: `1px solid ${COLORS.line}` }}>
            <div className="thin-scrollbar" style={{ overflowX: "auto" }}>
              <SegmentedControl
                size="sm"
                fullWidth
                value={filter}
                onChange={setFilter}
                options={FILTERS.map((f) => ({
                  value: f.value,
                  title: f.label,
                  label: (
                    <span style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap" }}>
                      {f.value === "attention" ? "Attention" : f.label}
                      <CountBadge n={counts?.[f.value]} active={filter === f.value} />
                    </span>
                  ),
                }))}
              />
            </div>
            <Input size="sm" icon={Search} placeholder="Search prospects" value={q} onChange={(e) => setQ(e.target.value)} />
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: COLORS.ink2, marginBottom: 5 }}>
                <span>
                  <strong style={{ color: COLORS.ink0 }}>{approvedCount}</strong> of {reviewable} approved
                </span>
                {contentSteps ? <span style={{ color: COLORS.ink3 }}>{plural(contentSteps, "message")} each</span> : null}
              </div>
              <div style={{ height: 5, borderRadius: 999, background: COLORS.line, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${reviewable ? Math.round((approvedCount / reviewable) * 100) : 0}%`,
                    background: `linear-gradient(90deg, ${COLORS.ok}, #34d399)`,
                    borderRadius: 999,
                    transition: "width 0.3s",
                  }}
                />
              </div>
            </div>
            <Button size="sm" variant="secondary" icon={CheckCheck} fullWidth loading={bulkBusy} disabled={!approvable.length} onClick={() => void approveAll()}>
              Approve all without errors ({approvable.length})
            </Button>
          </div>

          <div ref={listRef} className="thin-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {isLoading && !items.length ? (
              <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 14 }}>
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} style={{ display: "flex", gap: 10 }}>
                    <Skeleton width={30} height={30} radius={999} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                      <Skeleton width="60%" />
                      <Skeleton width="85%" height={10} />
                    </div>
                  </div>
                ))}
              </div>
            ) : visible.length ? (
              visible.map((it) => <QueueRow key={it.enrollment.id} item={it} active={it.enrollment.id === selectedId} onClick={() => select(it.enrollment.id)} />)
            ) : (
              <EmptyState
                icon={filter === "to_review" ? CheckCheck : Inbox}
                title={q ? "No match" : filter === "to_review" ? "All caught up" : "Nothing here"}
                description={
                  q
                    ? "Try another name or company."
                    : filter === "to_review"
                      ? "Every prospect with messages is reviewed. New prospects show up here once their messages are written."
                      : undefined
                }
                style={{ padding: "36px 16px" }}
              />
            )}
          </div>

          <div style={{ padding: "8px 12px", borderTop: `1px solid ${COLORS.line}`, display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: COLORS.ink3 }}>
            <Keyboard size={12} />
            <span>
              <Kbd>J</Kbd> <Kbd>K</Kbd> navigate, <Kbd>A</Kbd> approve, <Kbd>?</Kbd> all shortcuts
            </span>
          </div>
        </aside>

        {/* Prospect */}
        <section style={{ minWidth: 0, minHeight: 0 }}>
          {current ? (
            <LeadReviewPanel
              key={current.enrollment.id}
              ref={panelRef}
              item={current}
              steps={sortedSteps}
              approving={approving}
              regenerating={regenId === current.enrollment.id}
              position={{ index: Math.max(0, index), total: visible.length }}
              onApprove={() => void approveCurrent()}
              onSkip={skip}
              onPrev={prev}
              onRegenerateAll={() => void regenerateCurrent()}
              onRemoved={() => {
                const next = neighbor(1) ?? neighbor(-1);
                select(next);
                refreshAll();
              }}
              onUpdated={refreshAll}
              onLintChange={onLintChange}
            />
          ) : isLoading ? (
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
              <Skeleton width="40%" height={18} />
              <Skeleton height={120} radius={12} />
              <Skeleton height={160} radius={12} />
            </div>
          ) : (
            <EmptyState icon={Users} title="Select a prospect" description={`Pick someone in the list to review their ${campaign.name} sequence.`} style={{ height: "100%" }} />
          )}
        </section>
      </div>

      <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="Keyboard shortcuts" icon={Keyboard} width={420}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SHORTCUTS.map(([k, label]) => (
            <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 13, color: COLORS.ink1 }}>
              <span>{label}</span>
              <span style={{ display: "inline-flex", gap: 4 }}>
                {k.split(" / ").map((x) => (
                  <Kbd key={x}>{x}</Kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
