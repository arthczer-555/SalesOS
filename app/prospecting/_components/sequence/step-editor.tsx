"use client";

import * as React from "react";
import { CornerDownRight, Lightbulb, Mail, Sparkles, Trash2, Type } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { NumberStepper } from "@/components/ui/number-stepper";
import { Button } from "@/components/ui/button";
import { COLORS } from "@/lib/design/tokens";
import { lintMessage } from "@/lib/prospecting/lint";
import { ANGLE_KEYS, STEP_KINDS, stepHasContent } from "@/lib/prospecting/settings";
import { ANGLES, STEP_KIND_META } from "@/lib/prospecting/templates";
import { VARIABLES, variableToken } from "@/lib/prospecting/variables";
import type { AngleKey, LintIssue, StepConfig, StepDraft, StepKind, StepLength } from "@/lib/prospecting/types";
import { StepKindIcon } from "../shared/meta";

const LEVEL_TONE = { error: "ds-chip-err", warn: "ds-chip-warn", info: "ds-chip-info" } as const;

function tipFor(step: StepDraft, isFirstEmail: boolean, isLast: boolean): string {
  if (step.kind === "email" && isFirstEmail) return "58% of replies come from this first email. Keep it to 50 to 90 words, problem first, one light question.";
  if (step.kind === "email" && step.config.angle === "breakup") return "A short break-up often triggers the last wave of replies. Two or three lines, a yes/no question, no guilt.";
  if (step.kind === "email" && step.threadMode === "reply") return "Replying in the same thread lifts replies by about 30%. Bring a new angle: never 'just checking in'.";
  if (step.kind === "email") return "A new thread with a fresh subject works when you change angle. Under 70 words.";
  if (step.kind === "linkedin_invite") return "Send it 1 to 2 days after the first email. Keep the note under 200 characters, no pitch.";
  if (step.kind === "linkedin_message") return "Once connected: one idea or a useful offer, written like a DM, not an email.";
  if (step.kind === "call") return "Calls work best around day 5 to 8. The AI writes a 20-second opener, one question and a voicemail.";
  if (step.kind === "linkedin_visit") return "A profile visit is a soft touch: they see your name before your email.";
  return isLast ? "End the sequence with a clear last touch." : "Any manual action: comment on a post, send a short video, a gift...";
}

function placeholderFor(kind: StepKind): string {
  switch (kind) {
    case "email":
      return "What should this email do? e.g. Mention their SDR hiring and how new reps rehearse objections before real calls.";
    case "linkedin_invite":
      return "e.g. Reference their recent post on sales onboarding.";
    case "linkedin_message":
      return "e.g. Offer to build a sample roleplay on one of their real objections.";
    case "call":
      return "e.g. Ask how reps practice discovery today.";
    default:
      return "Instructions for this task";
  }
}

// Panneau d'édition de l'étape sélectionnée.
export function StepEditor({
  step,
  index,
  isFirstEmail,
  isLast,
  hasPreviousEmail,
  locked,
  issues,
  onChange,
  onDelete,
}: {
  step: StepDraft;
  index: number;
  isFirstEmail: boolean;
  isLast: boolean;
  hasPreviousEmail: boolean;
  locked: boolean;
  issues: LintIssue[];
  onChange: (next: StepDraft) => void;
  onDelete: () => void;
}) {
  const c = step.config;
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const subjectRef = React.useRef<HTMLInputElement>(null);
  const [lastFocus, setLastFocus] = React.useState<"subject" | "body">("body");

  const setConfig = (patch: Partial<StepConfig>) => onChange({ ...step, config: { ...c, ...patch } });

  const insertVariable = (key: string) => {
    const token = variableToken(key);
    const target = lastFocus === "subject" && step.kind === "email" ? subjectRef.current : bodyRef.current;
    const field = lastFocus === "subject" && step.kind === "email" ? "subject" : "body";
    const current = c.template[field];
    const start = target?.selectionStart ?? current.length;
    const end = target?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    setConfig({ template: { ...c.template, [field]: next } });
    requestAnimationFrame(() => {
      target?.focus();
      target?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const templateIssues =
    c.mode === "template" && stepHasContent(step.kind)
      ? lintMessage({
          kind: step.kind,
          position: index + 1,
          isReply: step.kind === "email" && step.threadMode === "reply",
          isFirstEmail,
          // Les variables seront résolues à l'envoi : on les neutralise pour le lint.
          subject: c.template.subject.replace(/\{\{[^}]*\}\}/g, "Name"),
          body: c.template.body.replace(/\{\{[^}]*\}\}/g, "Name"),
        })
      : [];
  const allIssues = [...issues, ...templateIssues.filter((t) => !issues.some((i) => i.code === t.code))];

  return (
    <div className="ds-card ds-rise" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${COLORS.line}` }}>
        <StepKindIcon kind={step.kind} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ds-kpi-label">Step {index + 1}</div>
          <Select
            size="sm"
            value={step.kind}
            disabled={locked}
            onChange={(e) => {
              const kind = e.target.value as StepKind;
              onChange({ ...step, kind, threadMode: kind === "email" ? step.threadMode : "new" });
            }}
            options={STEP_KINDS.map((k) => ({ value: k, label: STEP_KIND_META[k].label }))}
            style={{ marginTop: 4, fontWeight: 700 }}
          />
        </div>
        <Button size="sm" variant="ghost" icon={Trash2} onClick={onDelete} aria-label="Delete step" />
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        {index > 0 ? (
          <Field label="Wait before this step" hint="Counted in sending days (only the days enabled in Settings).">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <NumberStepper value={step.delayDays} min={0} max={60} onChange={(v) => onChange({ ...step, delayDays: v })} suffix="days" />
              {step.delayDays === 0 ? <span style={{ fontSize: 12, color: COLORS.ink3 }}>Same day, a few minutes later</span> : null}
            </div>
          </Field>
        ) : null}

        {step.kind === "email" ? (
          <Field label="Thread">
            <SegmentedControl
              fullWidth
              value={step.threadMode}
              onChange={(v) => onChange({ ...step, threadMode: v })}
              options={[
                { value: "new", label: "New email", icon: Mail },
                { value: "reply", label: "Reply in thread", icon: CornerDownRight, disabled: !hasPreviousEmail, title: hasPreviousEmail ? undefined : "Needs an email before it" },
              ]}
            />
          </Field>
        ) : null}

        {stepHasContent(step.kind) ? (
          <Field label="Content">
            <SegmentedControl
              fullWidth
              value={c.mode}
              onChange={(v) => setConfig({ mode: v })}
              options={[
                { value: "ai", label: "AI writes it per prospect", icon: Sparkles },
                { value: "template", label: "Fixed template", icon: Type },
              ]}
            />
          </Field>
        ) : null}

        {stepHasContent(step.kind) && c.mode === "ai" ? (
          <>
            <Field label="Angle" hint={ANGLES[c.angle].description}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {ANGLE_KEYS.map((k: AngleKey) => (
                  <button
                    key={k}
                    type="button"
                    title={ANGLES[k].description}
                    onClick={() => setConfig({ angle: k })}
                    className={`ds-chip ${c.angle === k ? "ds-chip-brand" : ""}`}
                    style={{ cursor: "pointer", padding: "4px 10px", fontSize: 12, fontWeight: 600, borderColor: c.angle === k ? "#f7b7cc" : undefined }}
                  >
                    {ANGLES[k].label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Instructions for the AI" hint="Optional. The AI already uses the persona, the research brief and the Coachello knowledge.">
              <Textarea value={c.instructions} onChange={(e) => setConfig({ instructions: e.target.value })} minRows={3} maxRows={10} placeholder={placeholderFor(step.kind)} />
            </Field>
            {step.kind === "email" ? (
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 12, alignItems: "end" }}>
                <Field label="Length">
                  <SegmentedControl<StepLength>
                    size="sm"
                    value={c.length}
                    onChange={(v) => setConfig({ length: v })}
                    options={[
                      { value: "short", label: "Short" },
                      { value: "standard", label: "Standard" },
                      { value: "long", label: "Long" },
                    ]}
                  />
                </Field>
                <Field label="Call to action">
                  <Input size="sm" value={c.cta} onChange={(e) => setConfig({ cta: e.target.value })} placeholder="Let the AI choose" />
                </Field>
              </div>
            ) : null}
          </>
        ) : null}

        {stepHasContent(step.kind) && c.mode === "template" ? (
          <>
            {step.kind === "email" && step.threadMode === "new" ? (
              <Field label="Subject">
                <Input
                  ref={subjectRef}
                  value={c.template.subject}
                  onFocus={() => setLastFocus("subject")}
                  onChange={(e) => setConfig({ template: { ...c.template, subject: e.target.value } })}
                  placeholder="e.g. {{company}} + roleplay"
                />
              </Field>
            ) : null}
            <Field
              label={step.kind === "call" ? "Talk track" : "Message"}
              right={<span style={{ fontSize: 11, color: COLORS.ink4 }}>Click a variable to insert it</span>}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 }}>
                {VARIABLES.map((v) => (
                  <button key={v.key} type="button" className="ds-chip" style={{ cursor: "pointer", fontFamily: "var(--font-geist-mono, monospace)", fontSize: 11 }} onClick={() => insertVariable(v.key)} title={`${v.label}, e.g. ${v.example}`}>
                    {`{{${v.key}}}`}
                  </button>
                ))}
              </div>
              <Textarea
                ref={bodyRef}
                value={c.template.body}
                onFocus={() => setLastFocus("body")}
                onChange={(e) => setConfig({ template: { ...c.template, body: e.target.value } })}
                minRows={6}
                maxRows={18}
                counter={step.kind === "linkedin_invite" ? "chars" : "words"}
                limit={step.kind === "linkedin_invite" ? 200 : step.kind === "email" ? (isFirstEmail ? 90 : 70) : undefined}
                placeholder={"Hi {{firstName}},\n\n..."}
              />
            </Field>
          </>
        ) : null}

        {STEP_KIND_META[step.kind].manual ? (
          <Switch
            checked={c.waitForCompletion}
            onChange={(v) => setConfig({ waitForCompletion: v })}
            label="Wait until the task is done"
            description="Off: the sequence keeps going even if you haven't done this task yet (recommended)."
          />
        ) : null}

        {allIssues.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {allIssues.map((i, k) => (
              <span key={`${i.code}-${k}`} className={`ds-chip ${LEVEL_TONE[i.level]}`} style={{ whiteSpace: "normal", lineHeight: 1.4, padding: "5px 10px", borderRadius: 10 }}>
                {i.message}
              </span>
            ))}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 10, padding: 12, borderRadius: 12, background: "#fffaf0", border: "1px solid #f6e3b4" }}>
          <Lightbulb size={15} style={{ color: "#d97706", flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 12, color: COLORS.ink1, lineHeight: 1.5 }}>{tipFor(step, isFirstEmail, isLast)}</span>
        </div>
      </div>
    </div>
  );
}
