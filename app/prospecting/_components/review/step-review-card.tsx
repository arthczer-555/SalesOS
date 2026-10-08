"use client";

import * as React from "react";
import { Check, ChevronDown, ChevronRight, CornerDownRight, ExternalLink, History, Loader2, PenLine, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import { editTouch, regenerateTouch } from "@/lib/hooks/use-prospecting-review";
import { stepLintFlags } from "@/lib/prospecting/ai/review-utils";
import { lintMessage } from "@/lib/prospecting/lint";
import { ANGLES, STEP_KIND_META } from "@/lib/prospecting/templates";
import type { AngleKey, StepRow, TouchRow } from "@/lib/prospecting/types";
import { StepKindIcon } from "../shared/meta";
import { timeAgo } from "../shared/format";
import { LintChips } from "./lint-chips";

const SAVE_DEBOUNCE_MS = 800;
const QUICK_INSTRUCTIONS = ["Shorter", "More casual", "Use the strongest hook", "Use the hiring signal", "Different opening", "Softer call to action"];
const EXECUTED = new Set(["sent", "done", "due", "skipped", "sending", "canceled", "failed"]);

const TOUCH_STATUS_LABEL: Record<string, { label: string; tone: "ok" | "info" | "neutral" | "err" | "warn" }> = {
  sent: { label: "Sent", tone: "ok" },
  done: { label: "Done", tone: "ok" },
  due: { label: "Task due", tone: "info" },
  skipped: { label: "Skipped", tone: "neutral" },
  sending: { label: "Sending", tone: "info" },
  canceled: { label: "Canceled", tone: "neutral" },
  failed: { label: "Failed", tone: "err" },
};

function limitFor(step: StepRow, isFirstEmail: boolean): { counter: "words" | "chars"; limit?: number } {
  if (step.kind === "linkedin_invite") return { counter: "chars", limit: 200 };
  if (step.kind === "linkedin_message") return { counter: "chars", limit: 400 };
  if (step.kind === "email") return { counter: "words", limit: isFirstEmail ? 120 : 90 };
  return { counter: "words" };
}

export interface StepCardHandle {
  flush: () => Promise<void>;
  focus: () => void;
}

// Carte d'une étape d'un prospect dans la Review : édition inline avec
// sauvegarde auto, lint en direct, régénération avec consigne, versions et
// provenance.
export const StepReviewCard = React.forwardRef<
  StepCardHandle,
  {
    step: StepRow;
    steps: StepRow[];
    touch: TouchRow | null;
    day: number;
    writing: boolean;
    onSaved: (t: TouchRow) => void;
  }
>(function StepReviewCard({ step, steps, touch, day, writing, onSaved }, ref) {
  const { toast } = useToast();
  const flags = stepLintFlags(steps, step);
  const executed = !!touch && EXECUTED.has(touch.status);
  const editable = !!touch && !executed && step.kind !== "linkedin_visit" && !writing;
  const hasSubject = step.kind === "email" && !flags.isReply;

  const [subject, setSubject] = React.useState(touch?.subject ?? "");
  const [body, setBody] = React.useState(touch?.body ?? "");
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [regenerating, setRegenerating] = React.useState(false);
  const [instruction, setInstruction] = React.useState("");
  const [showProvenance, setShowProvenance] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = React.useRef<Promise<void> | null>(null);
  const latest = React.useRef({ subject, body });
  latest.current = { subject, body };
  const subjectRef = React.useRef<HTMLInputElement>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  // Contenu serveur (génération, régénération, revert) : on le reprend tant
  // que l'utilisateur n'a pas de modification en attente.
  React.useEffect(() => {
    if (dirty) return;
    setSubject(touch?.subject ?? "");
    setBody(touch?.body ?? "");
  }, [dirty, touch?.id, touch?.subject, touch?.body, touch?.updated_at]);

  const save = React.useCallback(async () => {
    if (!touch) return;
    timer.current = null;
    const snapshot = { ...latest.current };
    setSaving(true);
    setSaveError(null);
    const p = (async () => {
      try {
        const res = await editTouch(touch.id, { subject: hasSubject ? snapshot.subject : undefined, body: snapshot.body });
        onSaved(res);
        // D'autres frappes ont pu arriver pendant la requête : on reste "dirty" dans ce cas.
        if (latest.current.subject === snapshot.subject && latest.current.body === snapshot.body) setDirty(false);
        setSavedAt(Date.now());
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Could not save");
      } finally {
        setSaving(false);
      }
    })();
    inflight.current = p;
    await p;
    inflight.current = null;
  }, [touch, hasSubject, onSaved]);

  const schedule = () => {
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  };

  const flush = React.useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      await save();
    } else if (inflight.current) {
      await inflight.current;
    }
  }, [save]);

  React.useImperativeHandle(ref, () => ({
    flush,
    focus: () => (hasSubject ? subjectRef.current : bodyRef.current)?.focus(),
  }));

  // Sauvegarde ce qui est en attente si la carte disparaît (changement de prospect).
  React.useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void save();
      }
    },
    [save],
  );

  const regenerate = async (ask: string, close?: () => void) => {
    if (!touch) return;
    close?.();
    await flush();
    setRegenerating(true);
    try {
      const res = await regenerateTouch(touch.id, ask);
      setDirty(false);
      setSubject(res.subject ?? "");
      setBody(res.body ?? "");
      onSaved(res);
      setInstruction("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Regeneration failed", "error");
    } finally {
      setRegenerating(false);
    }
  };

  // `index` dans l'ordre chronologique stocké (la dernière = la plus récente, cible de "revert").
  const restore = async (index: number, close: () => void) => {
    if (!touch) return;
    close();
    await flush();
    try {
      const list = touch.previous_versions ?? [];
      const v = list[index];
      if (!v) return;
      const res = index === list.length - 1 ? await editTouch(touch.id, { action: "revert" }) : await editTouch(touch.id, { subject: v.subject, body: v.body });
      setDirty(false);
      setSubject(res.subject ?? "");
      setBody(res.body ?? "");
      onSaved(res);
      toast("Previous version restored", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not restore", "error");
    }
  };

  const issues = React.useMemo(() => {
    if (!touch) return [];
    if (!dirty) return touch.lint ?? [];
    return lintMessage({ kind: step.kind, position: step.position, isReply: flags.isReply, isFirstEmail: flags.isFirstEmail, subject: hasSubject ? subject : null, body, stepId: step.id });
  }, [touch, dirty, step, flags.isReply, flags.isFirstEmail, hasSubject, subject, body]);

  const angleKey = (touch?.provenance?.angle && touch.provenance.angle in ANGLES ? touch.provenance.angle : step.config.angle) as AngleKey;
  const meta = STEP_KIND_META[step.kind];
  const statusTag = touch && EXECUTED.has(touch.status) ? TOUCH_STATUS_LABEL[touch.status] : null;
  const limits = limitFor(step, flags.isFirstEmail);
  const prov = touch?.provenance ?? null;
  const versions = touch?.previous_versions ?? [];

  return (
    <div className="ds-card ds-rise" style={{ padding: 0, overflow: "hidden", opacity: regenerating ? 0.7 : 1, transition: "opacity 0.15s" }}>
      {/* En-tête */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: `1px solid ${COLORS.line}`, background: COLORS.bgSoft }}>
        <StepKindIcon kind={step.kind} size={28} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.ink0 }}>
            Step {step.position} · {meta.label}
          </span>
          <span style={{ fontSize: 12, color: COLORS.ink3, fontWeight: 600 }}>Day {day}</span>
          {step.kind !== "linkedin_visit" ? (
            <Tag size="sm" tone="neutral">
              {step.config.mode === "template" ? "Template" : ANGLES[angleKey]?.label ?? "Custom"}
            </Tag>
          ) : null}
          {flags.isReply ? (
            <Tag size="sm" tone="info" icon={CornerDownRight}>
              Reply in thread
            </Tag>
          ) : null}
          {touch?.edited_by_user ? (
            <Tag size="sm" tone="brand" icon={PenLine}>
              Edited
            </Tag>
          ) : null}
          {statusTag ? (
            <Tag size="sm" tone={statusTag.tone} dot>
              {statusTag.label}
              {touch?.sent_at ? ` ${timeAgo(touch.sent_at)}` : ""}
            </Tag>
          ) : null}
        </div>
        <SaveIndicator saving={saving} dirty={dirty} savedAt={savedAt} error={saveError} />
        {editable ? (
          <>
            {versions.length ? (
              <Popover
                width={360}
                align="right"
                trigger={({ toggle }) => (
                  <Button size="sm" variant="ghost" icon={History} onClick={toggle} title="Previous versions">
                    {versions.length}
                  </Button>
                )}
              >
                {({ close }) => (
                  <div style={{ padding: 8, maxHeight: 360, overflowY: "auto" }} className="thin-scrollbar">
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.ink3, padding: "4px 6px 8px" }}>
                      Previous versions
                    </div>
                    {[...versions.entries()].reverse().map(([i, v]) => (
                      <div key={i} style={{ padding: "8px 8px", borderRadius: 10, border: `1px solid ${COLORS.line}`, marginBottom: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <Tag size="sm" tone={v.by === "user" ? "brand" : "neutral"}>
                            {v.by === "user" ? "Your edit" : "AI"}
                          </Tag>
                          <span style={{ fontSize: 11.5, color: COLORS.ink3, flex: 1 }}>{timeAgo(v.at)}</span>
                          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => void restore(i, close)}>
                            {i === versions.length - 1 ? "Revert" : "Restore"}
                          </Button>
                        </div>
                        {v.subject ? <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.ink1 }}>{v.subject}</div> : null}
                        <div style={{ fontSize: 12, color: COLORS.ink2, whiteSpace: "pre-wrap", maxHeight: 84, overflow: "hidden" }}>{v.body}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Popover>
            ) : null}
            <Popover
              width={340}
              align="right"
              trigger={({ toggle }) => (
                <Button size="sm" variant="ghost" icon={Wand2} loading={regenerating} onClick={toggle}>
                  Regenerate
                </Button>
              )}
            >
              {({ close }) => (
                <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.ink0 }}>Rewrite this step</div>
                  <Input
                    size="sm"
                    autoFocus
                    placeholder="Optional instruction, e.g. shorter"
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void regenerate(instruction, close);
                    }}
                  />
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {QUICK_INSTRUCTIONS.map((q) => (
                      <button key={q} type="button" className="ds-chip" style={{ cursor: "pointer" }} onClick={() => void regenerate(q, close)}>
                        {q}
                      </button>
                    ))}
                  </div>
                  <Button size="sm" variant="primary" icon={Sparkles} onClick={() => void regenerate(instruction, close)}>
                    Regenerate
                  </Button>
                </div>
              )}
            </Popover>
          </>
        ) : null}
      </div>

      {/* Corps */}
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {step.kind === "linkedin_visit" ? (
          <div style={{ fontSize: 13, color: COLORS.ink2 }}>Visit their LinkedIn profile so they see your name before the next touch. No message needed.</div>
        ) : !touch ? (
          writing ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: COLORS.ink3 }}>
                <Loader2 size={13} className="animate-spin" /> Writing this step...
              </div>
              <Skeleton height={14} width="45%" />
              <Skeleton height={70} />
            </div>
          ) : (
            <div style={{ fontSize: 13, color: COLORS.ink3 }}>Not written yet. Use Generate to write the missing steps.</div>
          )
        ) : (
          <>
            {hasSubject ? (
              <Input
                ref={subjectRef}
                value={subject}
                disabled={!editable}
                placeholder="Subject"
                onChange={(e) => {
                  setSubject(e.target.value);
                  schedule();
                }}
                style={{ fontWeight: 600 }}
              />
            ) : null}
            <Textarea
              ref={bodyRef}
              value={body}
              disabled={!editable}
              minRows={step.kind === "linkedin_invite" ? 3 : 5}
              maxRows={22}
              counter={limits.counter}
              limit={limits.limit}
              onChange={(e) => {
                setBody(e.target.value);
                schedule();
              }}
            />
            <LintChips issues={issues} showOk={editable} />
          </>
        )}

        {prov && touch ? (
          <div>
            <button
              type="button"
              onClick={() => setShowProvenance((v) => !v)}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, border: 0, background: "transparent", padding: 0, cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: COLORS.ink3 }}
            >
              {showProvenance ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              How this was written
            </button>
            {showProvenance ? (
              <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 10, background: COLORS.bgSoft, border: `1px solid ${COLORS.line}`, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {prov.model ? <Tag size="sm">{prov.model.replace(/^claude-/, "").replace(/-\d{8}$/, "")}</Tag> : null}
                  {prov.language ? <Tag size="sm">{prov.language === "fr" ? "French" : "English"}</Tag> : null}
                  {prov.knowledgeSource ? (
                    <Tag size="sm" tone={prov.knowledgeSource === "notion" ? "ok" : "warn"}>
                      {prov.knowledgeSource === "notion" ? "Notion knowledge" : "Fallback offer (Notion not synced)"}
                    </Tag>
                  ) : null}
                  {(prov.contexts ?? []).map((c) => (
                    <Tag key={c} size="sm" tone="neutral">
                      {c}
                    </Tag>
                  ))}
                </div>
                {prov.hookUsed ? (
                  <div style={{ fontSize: 12, color: COLORS.ink1 }}>
                    <span style={{ fontWeight: 700 }}>Hook used:</span> {prov.hookUsed}
                  </div>
                ) : null}
                {(prov.sources ?? []).filter((s) => s.url).length ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {(prov.sources ?? [])
                      .filter((s) => s.url)
                      .slice(0, 6)
                      .map((s, i) => (
                        <a
                          key={i}
                          href={s.url ?? undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: "flex", gap: 5, alignItems: "baseline", fontSize: 11.5, color: "#0a66c2", textDecoration: "none", minWidth: 0 }}
                        >
                          <ExternalLink size={10} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                        </a>
                      ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});

function SaveIndicator({ saving, dirty, savedAt, error }: { saving: boolean; dirty: boolean; savedAt: number | null; error: string | null }) {
  if (error) return <span style={{ fontSize: 11.5, fontWeight: 600, color: COLORS.err }} title={error}>Not saved</span>;
  if (saving || dirty)
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: COLORS.ink3 }}>
        <Loader2 size={11} className="animate-spin" /> Saving
      </span>
    );
  if (savedAt)
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: COLORS.ok }}>
        <Check size={11} /> Saved
      </span>
    );
  return null;
}
