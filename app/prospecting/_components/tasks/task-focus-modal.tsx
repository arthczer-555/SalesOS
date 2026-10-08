"use client";

import * as React from "react";
import { Check, ChevronRight, Copy, PartyPopper, SkipForward, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Kbd } from "@/components/ui/kbd";
import { Modal } from "@/components/ui/modal";
import { PersonAvatar } from "@/components/ui/person-avatar";
import { Tag } from "@/components/ui/tag";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import type { TaskListItem, TaskOutcome } from "@/lib/prospecting/types";
import { TaskContent, useCopy } from "./task-content";
import { TaskOpenButton } from "./task-row";
import {
  OUTCOME_LABELS,
  contactName,
  contactSubtitle,
  contentBlocks,
  isLinkedInTask,
  kindMeta,
  linkedinHref,
  outcomesFor,
  telHref,
} from "./task-utils";

/**
 * Mode focus : les tâches défilent une par une. Raccourcis : C copier,
 * O ouvrir (LinkedIn / appel), D fait, S sauter, N suivante.
 */
export function TaskFocusModal({
  open,
  onClose,
  tasks,
  onComplete,
  onSkip,
}: {
  open: boolean;
  onClose: () => void;
  /** File figée à l'ouverture (les tâches traitées sont retirées au fil de l'eau). */
  tasks: TaskListItem[];
  onComplete: (item: TaskListItem, outcome: TaskOutcome) => Promise<boolean>;
  onSkip: (item: TaskListItem) => Promise<boolean>;
}) {
  const { toast } = useToast();
  const { copy } = useCopy();
  const [queue, setQueue] = React.useState<TaskListItem[]>([]);
  const [index, setIndex] = React.useState(0);
  const [handled, setHandled] = React.useState(0);
  const [busy, setBusy] = React.useState(false);

  // File figée à chaque ouverture : une revalidation SWR ne fait pas sauter la tâche affichée.
  React.useEffect(() => {
    if (open) {
      setQueue(tasks);
      setIndex(0);
      setHandled(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const current = queue[index] ?? null;
  const total = queue.length + handled;

  const queueRef = React.useRef(queue);
  queueRef.current = queue;

  const removeById = React.useCallback((id: string) => {
    const q = queueRef.current;
    const pos = q.findIndex((t) => t.touch.id === id);
    if (pos < 0) return;
    const rest = q.filter((t) => t.touch.id !== id);
    setQueue(rest);
    setIndex((i) => (rest.length === 0 ? 0 : i > pos ? i - 1 : Math.min(i, rest.length - 1)));
    setHandled((h) => h + 1);
  }, []);

  const run = React.useCallback(
    async (item: TaskListItem, fn: (item: TaskListItem) => Promise<boolean>) => {
      if (busy) return;
      setBusy(true);
      const ok = await fn(item);
      setBusy(false);
      if (ok) removeById(item.touch.id);
    },
    [busy, removeById],
  );

  const next = React.useCallback(() => {
    setIndex((i) => (queue.length ? (i + 1) % queue.length : 0));
  }, [queue.length]);

  const blocks = React.useMemo(
    () => (current ? contentBlocks(current.touch.kind, current.touch.body, current.touch.subject) : []),
    [current],
  );

  const openCurrent = React.useCallback(() => {
    if (!current) return;
    if (current.touch.kind === "call") {
      const tel = telHref(current.contact.phone);
      if (tel) window.location.href = tel;
      else toast("No phone number on this prospect.", "info");
      return;
    }
    window.open(linkedinHref(current.contact).href, "_blank", "noopener,noreferrer");
  }, [current, toast]);

  const copyCurrent = React.useCallback(async () => {
    if (!current || blocks.length === 0) {
      toast("Nothing to copy for this task.", "info");
      return;
    }
    if (await copy(`focus:${current.touch.id}`, blocks[0].text)) toast(`${blocks[0].label} copied`, "success");
  }, [current, blocks, copy, toast]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!current) return;
      const k = e.key.toLowerCase();
      if (k === "c") {
        e.preventDefault();
        void copyCurrent();
      } else if (k === "o") {
        e.preventDefault();
        openCurrent();
      } else if (k === "d") {
        e.preventDefault();
        void run(current, (it) => onComplete(it, "done"));
      } else if (k === "s") {
        e.preventDefault();
        void run(current, onSkip);
      } else if (k === "n") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, current, copyCurrent, openCurrent, run, onComplete, onSkip, next]);

  const meta = current ? kindMeta(current.touch.kind) : null;
  const KindIcon = meta?.icon;

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Zap}
      width={680}
      title="Focus mode"
      description={current ? `Task ${handled + 1} of ${total}` : total ? `${handled} of ${total} done` : undefined}
      footer={
        current ? (
          <div style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", fontSize: 12, color: COLORS.ink3, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Kbd>C</Kbd> Copy</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Kbd>O</Kbd> Open</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Kbd>D</Kbd> Done</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Kbd>S</Kbd> Skip</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Kbd>N</Kbd> Next</span>
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <Button variant="primary" onClick={onClose}>Back to tasks</Button>
        )
      }
    >
      {!current ? (
        <EmptyState
          icon={PartyPopper}
          title="You're all caught up"
          description={handled ? `${handled} task${handled > 1 ? "s" : ""} handled. Nice work.` : "No task left in this queue."}
        />
      ) : (
        <div key={current.touch.id} className="ds-rise" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            className="pg-hero-gradient"
            style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, border: `1px solid ${COLORS.line}` }}
          >
            <PersonAvatar name={contactName(current.contact)} size={44} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.ink0 }}>{contactName(current.contact)}</div>
              <div style={{ fontSize: 12.5, color: COLORS.ink2, marginTop: 1 }}>{contactSubtitle(current.contact) || "No title"}</div>
              <div style={{ fontSize: 12, color: COLORS.ink3, marginTop: 3 }}>
                {current.campaign.name} · Step {current.stepPosition} of {current.stepCount || current.stepPosition}
              </div>
            </div>
            {meta && KindIcon ? (
              <Tag tone={current.touch.kind === "call" ? "info" : isLinkedInTask(current.touch.kind) ? "brand" : "neutral"} icon={KindIcon}>
                {meta.label}
              </Tag>
            ) : null}
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.ink4, marginBottom: 6 }}>
              {meta?.verb}
            </div>
            {blocks.length ? (
              <TaskContent blocks={blocks} clamp={false} idPrefix={`focus-${current.touch.id}`} />
            ) : (
              <div style={{ fontSize: 13, color: COLORS.ink2 }}>
                {current.touch.kind === "linkedin_visit"
                  ? "Open their profile so they see your visit, then mark it done."
                  : "No content was written for this step."}
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <TaskOpenButton item={current} size="md" />
            {blocks.length ? (
              <Button icon={Copy} onClick={() => void copyCurrent()}>
                Copy {blocks[0].label.toLowerCase()}
              </Button>
            ) : null}
            <div style={{ flex: 1 }} />
            <Button variant="ghost" icon={SkipForward} disabled={busy} onClick={() => void run(current, onSkip)}>
              Skip
            </Button>
            <Button variant="ghost" iconRight={ChevronRight} onClick={next} disabled={queue.length < 2}>
              Next
            </Button>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", borderTop: `1px solid ${COLORS.line}`, paddingTop: 14 }}>
            {outcomesFor(current.touch.kind).map((o, i) => (
              <Button
                key={o}
                size="sm"
                variant={i === 0 ? "primary" : "secondary"}
                icon={i === 0 ? Check : undefined}
                loading={busy && i === 0}
                disabled={busy}
                onClick={() => void run(current, (it) => onComplete(it, o))}
                title={o === "replied" || o === "meeting_booked" ? "Stops the sequence for this prospect" : undefined}
              >
                {OUTCOME_LABELS[o]}
              </Button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
