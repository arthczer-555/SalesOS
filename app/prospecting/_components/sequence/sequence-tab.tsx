"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, CircleStop, Flag, LayoutTemplate, Loader2, Lock, Save, Sparkles, Users, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Popover } from "@/components/ui/popover";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import { sendJson } from "@/lib/prospecting/client/http";
import { lintSequence } from "@/lib/prospecting/lint";
import { DEFAULT_STEP_CONFIG, normalizeStepDraft, stepDayOffsets } from "@/lib/prospecting/settings";
import { cloneSteps } from "@/lib/prospecting/templates";
import { useSequenceTemplates } from "@/lib/hooks/use-prospecting-personas";
import type { CampaignRow, LintIssue, Persona, SequenceHealth, StepDraft, StepKind, StepRow } from "@/lib/prospecting/types";
import { StepCard } from "./step-card";
import { StepEditor } from "./step-editor";
import { AddStepMenu } from "./add-step-menu";
import { StepPreview } from "./step-preview";
import { sequenceSummary } from "../shared/sequence-mini";

type LocalStep = StepDraft & { _key: string };

let keySeq = 0;
const newKey = () => `k${Date.now().toString(36)}${(keySeq++).toString(36)}`;

function fromRows(rows: StepRow[]): LocalStep[] {
  return rows.map((r) => ({ id: r.id, kind: r.kind, delayDays: r.delay_days, threadMode: r.thread_mode, config: r.config, _key: r.id }));
}

function strip(steps: LocalStep[]): StepDraft[] {
  return steps.map((s) => ({ id: s.id, kind: s.kind, delayDays: s.delayDays, threadMode: s.threadMode, config: s.config }));
}

function newStep(kind: StepKind, hasPreviousEmail: boolean, isFirst: boolean): LocalStep {
  return {
    _key: newKey(),
    kind,
    delayDays: isFirst ? 0 : kind === "linkedin_invite" || kind === "linkedin_visit" ? 1 : 3,
    threadMode: kind === "email" && hasPreviousEmail ? "reply" : "new",
    config: { ...DEFAULT_STEP_CONFIG, angle: kind === "email" ? (hasPreviousEmail ? "insight" : "problem") : "custom", template: { subject: "", body: "" } },
  };
}

type SaveState = { status: "idle" | "saving" | "saved" | "error"; error?: string };

// Éditeur de séquence : timeline verticale (glisser-déposer, délais), panneau
// d'édition de l'étape, score de santé, templates et brouillon IA. Autosave.
export function SequenceTab({
  campaign,
  steps: serverSteps,
  persona,
  saveSteps,
  onOutdated,
}: {
  campaign: CampaignRow;
  steps: StepRow[];
  persona: Persona | null;
  saveSteps: (steps: StepDraft[]) => Promise<{ steps: StepRow[]; health: SequenceHealth; outdated: number }>;
  onOutdated: (n: number) => void;
}) {
  const { toast } = useToast();
  const { confirm, dialog } = useConfirm();
  const { templates, saveTemplate } = useSequenceTemplates();
  const [steps, setSteps] = React.useState<LocalStep[]>(() => fromRows(serverSteps));
  const [selected, setSelected] = React.useState(0);
  const [save, setSave] = React.useState<SaveState>({ status: "idle" });
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [dropIndex, setDropIndex] = React.useState<number | null>(null);
  const [aiOpen, setAiOpen] = React.useState(false);
  const [saveTplOpen, setSaveTplOpen] = React.useState(false);

  const locked = campaign.status !== "draft";
  const lastSaved = React.useRef<string>(JSON.stringify(strip(fromRows(serverSteps))));
  const saving = React.useRef(false);

  // Resynchronise si le serveur change sans modif locale en attente.
  React.useEffect(() => {
    const server = JSON.stringify(strip(fromRows(serverSteps)));
    if (server !== lastSaved.current && JSON.stringify(strip(steps)) === lastSaved.current) {
      lastSaved.current = server;
      setSteps(fromRows(serverSteps));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSteps]);

  const doSave = React.useCallback(
    async (current: LocalStep[]) => {
      if (saving.current) return;
      const payload = strip(current);
      const snapshot = JSON.stringify(payload);
      if (snapshot === lastSaved.current) return;
      saving.current = true;
      setSave({ status: "saving" });
      try {
        const res = await saveSteps(payload);
        lastSaved.current = JSON.stringify(strip(fromRows(res.steps)));
        // Récupère les ids des nouvelles étapes (même ordre que l'envoi).
        const sentKeys = current.map((s) => s._key);
        setSteps((prev) =>
          prev.map((s) => {
            const i = sentKeys.indexOf(s._key);
            return i >= 0 && res.steps[i] && !s.id ? { ...s, id: res.steps[i].id } : s;
          }),
        );
        setSave({ status: "saved" });
        if (res.outdated > 0) onOutdated(res.outdated);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not save";
        setSave({ status: "error", error: msg });
        if (/reorder|deleted|type can't|after the existing/i.test(msg)) {
          toast(msg, "error");
          setSteps(fromRows(serverSteps));
        }
      } finally {
        saving.current = false;
      }
    },
    [saveSteps, onOutdated, toast, serverSteps],
  );

  // Autosave (debounce).
  React.useEffect(() => {
    if (JSON.stringify(strip(steps)) === lastSaved.current) return;
    const t = setTimeout(() => void doSave(steps), 900);
    return () => clearTimeout(t);
  }, [steps, doSave]);

  const health = React.useMemo(() => lintSequence(strip(steps), campaign.settings.window), [steps, campaign.settings.window]);
  const days = stepDayOffsets(steps);
  const firstEmailIdx = steps.findIndex((s) => s.kind === "email");

  const issuesFor = (i: number): LintIssue[] => health.issues.filter((x) => x.position === i + 1);

  const update = (i: number, next: StepDraft) => setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...next, _key: s._key } : s)));

  const insertAt = (index: number, kind: StepKind) => {
    if (locked && index < steps.length) {
      toast("Once launched, new steps can only be added at the end.", "info");
      return;
    }
    const hasPrevEmail = steps.slice(0, index).some((s) => s.kind === "email");
    setSteps((prev) => [...prev.slice(0, index), newStep(kind, hasPrevEmail, index === 0), ...prev.slice(index)]);
    setSelected(index);
  };

  const remove = async (i: number) => {
    const ok = await confirm({ title: `Delete step ${i + 1}?`, description: "Messages already generated for this step are removed.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    setSteps((prev) => prev.filter((_, j) => j !== i));
    setSelected((s) => Math.max(0, s >= i ? s - 1 : s));
  };

  const move = (from: number, to: number) => {
    if (from === to || from + 1 === to) return;
    setSteps((prev) => {
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to > from ? to - 1 : to, 0, it);
      return next.map((s, i) => (i === 0 ? { ...s, delayDays: 0 } : s));
    });
    setSelected(to > from ? to - 1 : to);
  };

  const replaceAll = async (next: StepDraft[], label: string) => {
    if (locked) {
      toast("The sequence of a launched campaign can't be replaced.", "error");
      return;
    }
    if (steps.length) {
      const ok = await confirm({ title: `Replace the sequence with "${label}"?`, description: "Your current steps are replaced.", confirmLabel: "Replace" });
      if (!ok) return;
    }
    setSteps(cloneSteps(next).map((s, i) => ({ ...normalizeStepDraft(s, i), _key: newKey() })));
    setSelected(0);
  };

  const dragHandlers = (i: number) =>
    locked
      ? {}
      : {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            setDragIndex(i);
            e.dataTransfer.effectAllowed = "move";
          },
          onDragOver: (e: React.DragEvent) => {
            if (dragIndex === null) return;
            e.preventDefault();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setDropIndex(e.clientY < rect.top + rect.height / 2 ? i : i + 1);
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            if (dragIndex !== null && dropIndex !== null) move(dragIndex, dropIndex);
            setDragIndex(null);
            setDropIndex(null);
          },
          onDragEnd: () => {
            setDragIndex(null);
            setDropIndex(null);
          },
        };

  const sel = steps[selected] ?? null;
  const errors = health.issues.filter((i) => i.level === "error").length;
  const warns = health.issues.filter((i) => i.level === "warn").length;
  const scoreColor = health.score >= 80 ? COLORS.ok : health.score >= 55 ? "#d97706" : COLORS.err;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Popover
          width={380}
          trigger={({ toggle }) => (
            <button type="button" onClick={toggle} className="ch-btn ch-btn-sm" style={{ gap: 8 }}>
              <span style={{ position: "relative", width: 26, height: 26 }}>
                <svg width={26} height={26} viewBox="0 0 36 36" style={{ transform: "rotate(-90deg)" }}>
                  <circle cx={18} cy={18} r={15} fill="none" stroke={COLORS.line} strokeWidth={4} />
                  <circle cx={18} cy={18} r={15} fill="none" stroke={scoreColor} strokeWidth={4} strokeDasharray={`${(health.score / 100) * 94.2} 94.2`} strokeLinecap="round" />
                </svg>
              </span>
              <span>
                Sequence health <b style={{ color: scoreColor }}>{health.score}</b>
              </span>
              {errors ? <span className="ds-chip ds-chip-err">{errors} errors</span> : warns ? <span className="ds-chip ds-chip-warn">{warns} tips</span> : null}
            </button>
          )}
        >
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflowY: "auto" }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Best-practice check</div>
            {health.issues.length === 0 ? (
              <div style={{ display: "flex", gap: 8, fontSize: 13, color: COLORS.ok, alignItems: "center" }}>
                <CheckCircle2 size={15} /> This sequence follows the benchmarks.
              </div>
            ) : (
              health.issues.map((i, k) => (
                <button
                  key={k}
                  type="button"
                  className="ch-menu-item"
                  onClick={() => i.position && setSelected(i.position - 1)}
                  style={{ fontSize: 12.5, lineHeight: 1.45, alignItems: "flex-start" }}
                >
                  <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2, color: i.level === "error" ? COLORS.err : i.level === "warn" ? "#d97706" : COLORS.info }} />
                  <span>
                    {i.position ? <b>Step {i.position}: </b> : null}
                    {i.message.replace(/^Step \d+: /, "")}
                  </span>
                </button>
              ))
            )}
          </div>
        </Popover>
        <span style={{ fontSize: 12.5, color: COLORS.ink3 }}>{sequenceSummary(steps)}</span>
        <div style={{ flex: 1 }} />
        <SaveIndicator state={save} onRetry={() => void doSave(steps)} />
        <Popover
          width={320}
          align="right"
          trigger={({ toggle }) => (
            <Button size="sm" icon={LayoutTemplate} onClick={toggle}>
              Templates
            </Button>
          )}
        >
          {({ close }) => (
            <div style={{ padding: 6, maxHeight: 380, overflowY: "auto" }}>
              <div className="ds-kpi-label" style={{ padding: "6px 8px" }}>
                Apply a template
              </div>
              {templates.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="ch-menu-item"
                  disabled={locked}
                  onClick={() => {
                    close();
                    void replaceAll(t.steps, t.name);
                  }}
                >
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</span>
                    <span style={{ fontSize: 11.5, color: COLORS.ink3 }}>{sequenceSummary(t.steps)}</span>
                  </span>
                </button>
              ))}
              <div style={{ borderTop: `1px solid ${COLORS.line}`, margin: "6px 0" }} />
              <button
                type="button"
                className="ch-menu-item"
                disabled={!steps.length}
                onClick={() => {
                  close();
                  setSaveTplOpen(true);
                }}
              >
                <Save size={14} /> <span style={{ fontSize: 13, fontWeight: 600 }}>Save this sequence as a template</span>
              </button>
            </div>
          )}
        </Popover>
        <Button size="sm" variant="dark" icon={Wand2} onClick={() => setAiOpen(true)} disabled={locked}>
          Build with AI
        </Button>
      </div>

      {locked ? (
        <Banner tone="neutral" icon={Lock} title="This campaign is live">
          Edits apply to prospects who haven&apos;t reached a step yet, and messages already written for a changed step are flagged for review. Steps can&apos;t be reordered; new steps go at the end.
        </Banner>
      ) : null}

      {steps.length === 0 ? (
        <div className="ds-card">
          <EmptyState
            icon={Flag}
            title="No steps yet"
            description="Start with an email, then add LinkedIn touches, calls and follow-ups. Or let the AI draft the whole sequence."
            action={
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <Button variant="primary" onClick={() => insertAt(0, "email")}>
                  Add a first email
                </Button>
                <Button variant="dark" icon={Wand2} onClick={() => setAiOpen(true)}>
                  Build with AI
                </Button>
              </div>
            }
          />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(360px, 460px)", gap: 18, alignItems: "start" }} className="pg-seq-grid">
          <div style={{ display: "flex", flexDirection: "column" }}>
            <Node icon={Users} title="Prospect starts the sequence" text="When the campaign runs and the prospect is approved" />
            {steps.map((s, i) => (
              <React.Fragment key={s._key}>
                <Connector
                  delay={i === 0 ? null : s.delayDays}
                  onDelay={(v) => update(i, { ...s, delayDays: v })}
                  add={<AddStepMenu onAdd={(k) => insertAt(i, k)} disabled={locked} />}
                />
                {dropIndex === i && dragIndex !== null ? <div className="pg-drop-indicator" /> : null}
                <StepCard
                  step={s}
                  index={i}
                  day={days[i]}
                  active={i === selected}
                  issues={issuesFor(i)}
                  locked={locked}
                  onSelect={() => setSelected(i)}
                  onDelete={() => void remove(i)}
                  dragHandlers={dragHandlers(i)}
                  dragging={dragIndex === i}
                />
              </React.Fragment>
            ))}
            {dropIndex === steps.length && dragIndex !== null ? <div className="pg-drop-indicator" /> : null}
            <div style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
              <span style={{ width: 2, height: 18, background: COLORS.line }} />
            </div>
            <AddStepMenu variant="button" onAdd={(k) => insertAt(steps.length, k)} />
            <div style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
              <span style={{ width: 2, height: 18, background: COLORS.line }} />
            </div>
            <Node
              icon={CircleStop}
              title={`Sequence ends on day ${days[days.length - 1] ?? 0}`}
              text="Stops automatically as soon as they reply, bounce or ask to opt out."
              muted
            />
          </div>
          <div style={{ position: "sticky", top: 12, display: "flex", flexDirection: "column", gap: 12 }}>
            {sel ? (
              <>
                <StepEditor
                  key={sel._key}
                  step={sel}
                  index={selected}
                  isFirstEmail={selected === firstEmailIdx}
                  isLast={selected === steps.length - 1}
                  hasPreviousEmail={steps.slice(0, selected).some((s) => s.kind === "email")}
                  locked={locked && !!sel.id}
                  issues={issuesFor(selected)}
                  onChange={(next) => update(selected, next)}
                  onDelete={() => void remove(selected)}
                />
                {sel.id ? <StepPreview campaignId={campaign.id} stepId={sel.id} /> : null}
              </>
            ) : null}
          </div>
        </div>
      )}

      <AiSequenceModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        persona={persona}
        defaultGoal={campaign.goal}
        onApply={(next) => {
          setAiOpen(false);
          void replaceAll(next, "AI draft");
        }}
      />
      <SaveTemplateModal
        open={saveTplOpen}
        onClose={() => setSaveTplOpen(false)}
        defaultName={campaign.name}
        onSave={async (name, description) => {
          await saveTemplate({ name, description, personaId: campaign.persona_id, steps: strip(steps) });
          toast("Template saved", "success");
          setSaveTplOpen(false);
        }}
      />
      {dialog}
    </div>
  );
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state.status === "saving")
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.ink3 }}>
        <Loader2 size={13} className="animate-spin" /> Saving
      </span>
    );
  if (state.status === "error")
    return (
      <button type="button" onClick={onRetry} className="ch-link" style={{ fontSize: 12, color: COLORS.err }} title={state.error}>
        Not saved. Retry
      </button>
    );
  if (state.status === "saved")
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.ok }}>
        <CheckCircle2 size={13} /> Saved
      </span>
    );
  return null;
}

function Node({ icon: Icon, title, text, muted }: { icon: React.ComponentType<{ size?: number | string }>; title: string; text: string; muted?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, border: `1px dashed ${COLORS.lineStrong}`, background: muted ? "transparent" : "#fff" }}>
      <span style={{ width: 30, height: 30, borderRadius: 10, display: "grid", placeItems: "center", background: muted ? COLORS.bgSoft : COLORS.ink0, color: muted ? COLORS.ink3 : "#fff" }}>
        <Icon size={15} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.ink0 }}>{title}</span>
        <span style={{ fontSize: 12, color: COLORS.ink3 }}>{text}</span>
      </span>
    </div>
  );
}

function Connector({ delay, onDelay, add }: { delay: number | null; onDelay: (v: number) => void; add: React.ReactNode }) {
  return (
    <div className="pg-connector" style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0 4px 26px", minHeight: 40 }}>
      <span style={{ width: 2, alignSelf: "stretch", background: COLORS.line, borderRadius: 2 }} />
      {delay !== null ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.ink2, background: "#fff", border: `1px solid ${COLORS.line}`, borderRadius: 999, padding: "2px 4px 2px 10px" }}>
          Wait
          <select
            value={delay}
            onChange={(e) => onDelay(Number(e.target.value))}
            aria-label="Days to wait"
            style={{ border: 0, background: "transparent", font: "inherit", fontWeight: 700, color: COLORS.ink0, cursor: "pointer", outline: "none" }}
          >
            {Array.from({ length: 31 }, (_, d) => (
              <option key={d} value={d}>
                {d === 0 ? "0 days (same day)" : `${d} ${d === 1 ? "day" : "days"}`}
              </option>
            ))}
          </select>
        </span>
      ) : (
        <span style={{ fontSize: 12, color: COLORS.ink4 }}>Right away</span>
      )}
      {add}
    </div>
  );
}

function AiSequenceModal({
  open,
  onClose,
  persona,
  defaultGoal,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  persona: Persona | null;
  defaultGoal: string;
  onApply: (steps: StepDraft[]) => void;
}) {
  const [goal, setGoal] = React.useState(defaultGoal);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<StepDraft[] | null>(null);
  React.useEffect(() => {
    if (open) {
      setGoal(defaultGoal);
      setDraft(null);
      setError(null);
    }
  }, [open, defaultGoal]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await sendJson<{ steps: StepDraft[] }>("/api/prospecting/ai/propose-sequence", "POST", { personaId: persona?.id ?? null, goal });
      setDraft(res.steps);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The AI could not draft a sequence");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Sparkles}
      title="Build the sequence with AI"
      description={`Describe the goal. The AI drafts a multichannel sequence for ${persona?.name ?? "your audience"} following outbound benchmarks.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {draft ? (
            <Button variant="primary" onClick={() => onApply(draft)}>
              Use this sequence
            </Button>
          ) : (
            <Button variant="dark" icon={Wand2} loading={busy} disabled={!goal.trim()} onClick={run}>
              Draft
            </Button>
          )}
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Goal">
          <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} minRows={3} placeholder="e.g. Book AI roleplay demos with Heads of Sales of SaaS scale-ups hiring SDRs." />
        </Field>
        {error ? <Banner tone="err">{error}</Banner> : null}
        {draft ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="ds-kpi-label">{sequenceSummary(draft)}</div>
            {draft.map((s, i) => (
              <div key={i} style={{ fontSize: 12.5, color: COLORS.ink1, padding: "8px 10px", background: COLORS.bgSoft, borderRadius: 10 }}>
                <b>
                  Day {stepDayOffsets(draft)[i]} · {s.kind.replace("_", " ")}
                </b>
                {s.config.instructions ? `: ${s.config.instructions}` : ""}
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={Wand2} onClick={run} loading={busy} style={{ alignSelf: "flex-start" }}>
              Draft again
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function SaveTemplateModal({ open, onClose, defaultName, onSave }: { open: boolean; onClose: () => void; defaultName: string; onSave: (name: string, description: string) => Promise<void> }) {
  const [name, setName] = React.useState(defaultName);
  const [description, setDescription] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setName(defaultName);
      setDescription("");
    }
  }, [open, defaultName]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={Save}
      title="Save as template"
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(name, description);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save template
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When to use it" />
        </Field>
      </div>
    </Modal>
  );
}
