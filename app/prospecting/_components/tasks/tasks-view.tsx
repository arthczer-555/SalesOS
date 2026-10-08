"use client";

import * as React from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, Linkedin, ListTodo, PartyPopper, Phone, Play, Sun } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import { useProspectingTasks } from "@/lib/hooks/use-prospecting-tasks";
import type { TaskBucket, TaskKindFilter, TaskListItem, TaskOutcome } from "@/lib/prospecting/types";
import { TaskFocusModal } from "./task-focus-modal";
import { TaskRow, type TaskActions } from "./task-row";
import { OUTCOME_LABELS, SNOOZE_LABELS, contactName, snoozeUntil, type SnoozePreset } from "./task-utils";

type KindChoice = "all" | TaskKindFilter;

const GROUPS: { bucket: TaskBucket; title: string; icon: React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>; accent: string; empty: string }[] = [
  { bucket: "overdue", title: "Overdue", icon: AlertTriangle, accent: COLORS.err, empty: "" },
  { bucket: "today", title: "Today", icon: Sun, accent: COLORS.brand, empty: "" },
  { bucket: "upcoming", title: "Upcoming", icon: CalendarClock, accent: COLORS.info, empty: "No task scheduled in your active sequences yet." },
  { bucket: "done", title: "Done today", icon: CheckCircle2, accent: COLORS.ok, empty: "" },
];

const UPCOMING_PREVIEW = 8;

export function TasksView() {
  const { toast } = useToast();
  const [kind, setKind] = React.useState<KindChoice>("all");
  const [campaignId, setCampaignId] = React.useState<string>("");
  const [focusOpen, setFocusOpen] = React.useState(false);
  const [focusQueue, setFocusQueue] = React.useState<TaskListItem[]>([]);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [showAllUpcoming, setShowAllUpcoming] = React.useState(false);
  const [doneOpen, setDoneOpen] = React.useState(false);

  const { items, counts, hasData, error, isLoading, mutate, complete, skip, snooze } = useProspectingTasks({
    kind: kind === "all" ? null : kind,
    campaignId: campaignId || null,
  });

  // Campagnes présentes dans les tâches (filtre), mémorisées pour ne pas
  // disparaître quand on filtre.
  const [campaignOptions, setCampaignOptions] = React.useState<{ id: string; name: string }[]>([]);
  React.useEffect(() => {
    if (!items.length) return;
    setCampaignOptions((prev) => {
      const map = new Map(prev.map((c) => [c.id, c]));
      for (const it of items) map.set(it.campaign.id, it.campaign);
      const next = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
      return next.length === prev.length ? prev : next;
    });
  }, [items]);

  const byBucket = React.useMemo(() => {
    const out: Record<TaskBucket, TaskListItem[]> = { overdue: [], today: [], upcoming: [], done: [] };
    for (const it of items) out[it.bucket].push(it);
    return out;
  }, [items]);
  const actionable = React.useMemo(() => [...byBucket.overdue, ...byBucket.today], [byBucket]);

  const handleComplete = React.useCallback(
    async (item: TaskListItem, outcome: TaskOutcome): Promise<boolean> => {
      setBusyId(item.touch.id);
      try {
        await complete(item.touch.id, outcome);
        const stops = outcome === "replied" || outcome === "meeting_booked";
        toast(
          stops
            ? `${OUTCOME_LABELS[outcome]}: sequence stopped for ${contactName(item.contact)}`
            : `${OUTCOME_LABELS[outcome]}: ${contactName(item.contact)}`,
          "success",
        );
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not update the task.", "error");
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [complete, toast],
  );

  const handleSkip = React.useCallback(
    async (item: TaskListItem): Promise<boolean> => {
      setBusyId(item.touch.id);
      try {
        await skip(item.touch.id);
        toast(`Skipped: ${contactName(item.contact)}`, "info");
        return true;
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not skip the task.", "error");
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [skip, toast],
  );

  const handleSnooze = React.useCallback(
    async (item: TaskListItem, preset: SnoozePreset) => {
      setBusyId(item.touch.id);
      try {
        await snooze(item.touch.id, snoozeUntil(preset));
        toast(`Snoozed until ${SNOOZE_LABELS[preset].toLowerCase()}`, "info");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not snooze the task.", "error");
      } finally {
        setBusyId(null);
      }
    },
    [snooze, toast],
  );

  const actions: TaskActions = React.useMemo(
    () => ({
      onComplete: (item, outcome) => void handleComplete(item, outcome),
      onSkip: (item) => void handleSkip(item),
      onSnooze: (item, preset) => void handleSnooze(item, preset),
    }),
    [handleComplete, handleSkip, handleSnooze],
  );

  const startFocus = () => {
    setFocusQueue(actionable);
    setFocusOpen(true);
  };

  const kindOptions = [
    { value: "all" as const, label: "All" },
    { value: "linkedin" as const, label: "LinkedIn", icon: Linkedin },
    { value: "call" as const, label: "Calls", icon: Phone },
    { value: "other" as const, label: "Other", icon: ListTodo },
  ];

  const nothingToDo = hasData && actionable.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Résumé + filtres */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <CountCard label="Overdue" value={hasData ? counts.overdue : null} error={!!error} tone={counts.overdue > 0 ? "err" : "neutral"} icon={AlertTriangle} />
        <CountCard label="Today" value={hasData ? counts.today : null} error={!!error} tone="brand" icon={Sun} />
        <CountCard label="Upcoming" value={hasData ? counts.upcoming : null} error={!!error} tone="neutral" icon={CalendarClock} />
        <CountCard label="Done today" value={hasData ? counts.doneToday : null} error={!!error} tone="ok" icon={CheckCircle2} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <SegmentedControl<KindChoice> options={kindOptions} value={kind} onChange={setKind} size="sm" />
        <div style={{ width: 220 }}>
          <Select
            size="sm"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            options={[{ value: "", label: "All campaigns" }, ...campaignOptions.map((c) => ({ value: c.id, label: c.name }))]}
            aria-label="Filter by campaign"
          />
        </div>
        <div style={{ flex: 1 }} />
        <Button variant="primary" icon={Play} disabled={actionable.length === 0} onClick={startFocus} title="Work through your tasks one by one with keyboard shortcuts">
          Start ({actionable.length})
        </Button>
      </div>

      {error ? (
        <Banner tone="err" title="Could not load your tasks" action={<Button size="sm" onClick={() => void mutate()}>Retry</Button>}>
          {error}
        </Banner>
      ) : null}

      {isLoading && !hasData ? (
        <TasksSkeleton />
      ) : hasData ? (
        <>
          {nothingToDo ? (
            <div className="ds-card" style={{ borderRadius: 16 }}>
              <EmptyState
                icon={PartyPopper}
                title="You're all caught up"
                description={
                  counts.upcoming > 0
                    ? `No LinkedIn or call task due right now. ${counts.upcoming} more ${counts.upcoming > 1 ? "are" : "is"} coming up in your sequences.`
                    : "LinkedIn and call steps show up here as soon as a sequence reaches them."
                }
              />
            </div>
          ) : null}

          {GROUPS.map((g) => {
            const list = byBucket[g.bucket];
            if (g.bucket === "overdue" || g.bucket === "today") {
              if (!list.length) return null;
              return <TaskGroup key={g.bucket} group={g} count={list.length} items={list} actions={actions} busyId={busyId} />;
            }
            if (g.bucket === "upcoming") {
              if (!list.length) return null;
              const visible = showAllUpcoming ? list : list.slice(0, UPCOMING_PREVIEW);
              return (
                <TaskGroup
                  key={g.bucket}
                  group={g}
                  count={counts.upcoming}
                  items={visible}
                  actions={actions}
                  busyId={busyId}
                  footer={
                    list.length > UPCOMING_PREVIEW ? (
                      <Button size="sm" variant="ghost" onClick={() => setShowAllUpcoming((v) => !v)}>
                        {showAllUpcoming ? "Show less" : `Show all ${list.length}`}
                      </Button>
                    ) : null
                  }
                />
              );
            }
            if (!list.length) return null;
            return (
              <TaskGroup
                key={g.bucket}
                group={g}
                count={list.length}
                items={doneOpen ? list : []}
                actions={actions}
                busyId={busyId}
                collapsible
                open={doneOpen}
                onToggle={() => setDoneOpen((v) => !v)}
              />
            );
          })}
        </>
      ) : null}

      <TaskFocusModal
        open={focusOpen}
        onClose={() => setFocusOpen(false)}
        tasks={focusQueue}
        onComplete={handleComplete}
        onSkip={handleSkip}
      />
    </div>
  );
}

function CountCard({
  label,
  value,
  error,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number | null;
  error: boolean;
  tone: "err" | "brand" | "ok" | "neutral";
  icon: React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;
}) {
  const color = tone === "err" ? COLORS.err : tone === "brand" ? COLORS.brand : tone === "ok" ? COLORS.ok : COLORS.ink2;
  const bg = tone === "err" ? COLORS.errBg : tone === "brand" ? COLORS.brandTint : tone === "ok" ? COLORS.okBg : COLORS.bgSoft;
  return (
    <div className="ds-card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 14 }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: bg, color }}>
        <Icon size={16} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.ink4 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: value === null && error ? COLORS.err : COLORS.ink0, lineHeight: 1.2 }}>
          {value === null ? (error ? "Error" : <Skeleton width={28} height={18} />) : value}
        </div>
      </div>
    </div>
  );
}

function TaskGroup({
  group,
  count,
  items,
  actions,
  busyId,
  footer,
  collapsible,
  open = true,
  onToggle,
}: {
  group: (typeof GROUPS)[number];
  count: number;
  items: TaskListItem[];
  actions: TaskActions;
  busyId: string | null;
  footer?: React.ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const Icon = group.icon;
  const header = (
    <>
      <span style={{ width: 4, height: 16, borderRadius: 4, background: group.accent }} />
      <Icon size={14} style={{ color: group.accent }} />
      <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.ink0 }}>{group.title}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink3 }}>{count}</span>
      {collapsible ? (
        <span style={{ marginLeft: "auto", color: COLORS.ink3, display: "inline-flex" }}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      ) : null}
    </>
  );
  return (
    <section className="ds-card" style={{ borderRadius: 16, overflow: "hidden", padding: 0 }}>
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="interactive-row"
          style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "12px 16px", background: "transparent", border: 0, cursor: "pointer", textAlign: "left" }}
        >
          {header}
        </button>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px" }}>{header}</div>
      )}
      {open ? (
        <div>
          {items.map((it) => (
            <TaskRow key={it.touch.id} item={it} actions={actions} busy={busyId === it.touch.id} />
          ))}
          {items.length === 0 && group.empty ? (
            <div style={{ padding: "12px 16px", fontSize: 13, color: COLORS.ink3, borderTop: `1px solid ${COLORS.line}` }}>{group.empty}</div>
          ) : null}
        </div>
      ) : null}
      {footer ? <div style={{ padding: "8px 12px", borderTop: `1px solid ${COLORS.line}` }}>{footer}</div> : null}
    </section>
  );
}

function TasksSkeleton() {
  return (
    <section className="ds-card" style={{ borderRadius: 16, overflow: "hidden", padding: 0 }}>
      <div style={{ padding: "12px 16px" }}>
        <Skeleton width={120} height={14} />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} style={{ display: "flex", gap: 12, padding: "14px 16px", borderTop: `1px solid ${COLORS.line}` }}>
          <Skeleton width={36} height={36} radius={999} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton width="40%" height={13} />
            <Skeleton width="60%" height={11} />
            <Skeleton width="100%" height={46} radius={10} />
          </div>
        </div>
      ))}
    </section>
  );
}
