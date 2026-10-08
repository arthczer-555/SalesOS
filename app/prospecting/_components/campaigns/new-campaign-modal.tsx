"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, FilePlus2, LayoutTemplate, Rocket, Sparkles, Users, Wand2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import { sendJson } from "@/lib/prospecting/client/http";
import { useProspectingCampaigns } from "@/lib/hooks/use-prospecting-campaigns";
import { useProspectingPersonas, useSequenceTemplates } from "@/lib/hooks/use-prospecting-personas";
import { templateForPersona } from "@/lib/prospecting/templates";
import type { Persona, SequenceTemplate, StepDraft } from "@/lib/prospecting/types";
import { SequenceMini, sequenceSummary } from "../shared/sequence-mini";
import type { NewCampaignOptions } from "../shell/shell-context";

type Start = "recommended" | "ai" | "template" | "blank";

function defaultName(persona: Persona | null): string {
  const month = new Date().toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  return `${persona ? persona.name.replace(/\s*\(.*\)$/, "") : "New campaign"} · ${month}`;
}

// Création de campagne en 3 temps : cible (persona), point de départ de la
// séquence (recommandée, IA, template, vide), nom + objectif.
export function NewCampaignModal({ open, onClose, options }: { open: boolean; onClose: () => void; options: NewCampaignOptions | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const { personas, isLoading: personasLoading } = useProspectingPersonas();
  const { templates } = useSequenceTemplates();
  const { create } = useProspectingCampaigns();

  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [personaId, setPersonaId] = React.useState<string | null>(null);
  const [start, setStart] = React.useState<Start>("recommended");
  const [templateKey, setTemplateKey] = React.useState<string | null>(null);
  const [goal, setGoal] = React.useState("");
  const [aiSteps, setAiSteps] = React.useState<StepDraft[] | null>(null);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiError, setAiError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setStep(1);
    setPersonaId(options?.personaId ?? null);
    setStart("recommended");
    setTemplateKey(null);
    setGoal("");
    setAiSteps(null);
    setAiError(null);
    setName(options?.name ?? "");
  }, [open, options]);

  const persona = personas.find((p) => p.id === personaId) ?? null;
  const recommended = templateForPersona(personaId);
  const chosenTemplate: SequenceTemplate | null =
    start === "recommended" ? recommended : start === "template" ? templates.find((t) => t.key === templateKey) ?? null : null;
  const previewSteps: StepDraft[] = start === "ai" ? aiSteps ?? [] : chosenTemplate?.steps ?? [];

  const proposeWithAi = async () => {
    if (!goal.trim()) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const res = await sendJson<{ name: string; steps: StepDraft[] }>("/api/prospecting/ai/propose-sequence", "POST", { personaId, goal });
      setAiSteps(res.steps);
      if (!name && res.name) setName(res.name);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "The AI could not propose a sequence");
    } finally {
      setAiBusy(false);
    }
  };

  const canContinue2 =
    start === "blank" || (start === "recommended" && !!recommended) || (start === "template" && !!chosenTemplate) || (start === "ai" && !!aiSteps?.length);

  const submit = async () => {
    setCreating(true);
    try {
      const campaign = await create({
        name: name.trim() || defaultName(persona),
        personaId,
        goal,
        sourceListId: options?.sourceListId ?? null,
        ...(start === "ai" ? { steps: aiSteps ?? [] } : start === "blank" ? { templateKey: null } : { templateKey: chosenTemplate?.key ?? null }),
      });
      onClose();
      const qs = new URLSearchParams();
      if (start === "blank") qs.set("tab", "sequence");
      else {
        qs.set("tab", "prospects");
        qs.set("add", "1");
        if (options?.sourceListId) qs.set("listId", options.sourceListId);
        if (options?.scopeCompanyId) qs.set("scopeCompanyId", options.scopeCompanyId);
      }
      router.push(`/prospecting/campaigns/${campaign.id}?${qs.toString()}`);
      toast("Campaign created", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create the campaign", "error");
    } finally {
      setCreating(false);
    }
  };

  const footer = (
    <>
      {step > 1 ? (
        <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep((s) => (s === 3 ? 2 : 1))} style={{ marginRight: "auto" }}>
          Back
        </Button>
      ) : null}
      <StepDots step={step} />
      {step === 1 ? (
        <Button variant="primary" iconRight={ArrowRight} onClick={() => setStep(2)}>
          Continue
        </Button>
      ) : step === 2 ? (
        <Button
          variant="primary"
          iconRight={ArrowRight}
          disabled={!canContinue2}
          onClick={() => {
            if (!name) setName(defaultName(persona));
            setStep(3);
          }}
        >
          Continue
        </Button>
      ) : (
        <Button variant="primary" icon={Rocket} loading={creating} onClick={submit}>
          Create campaign
        </Button>
      )}
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={760}
      icon={step === 1 ? Users : step === 2 ? LayoutTemplate : FilePlus2}
      title={step === 1 ? "Who are you reaching out to?" : step === 2 ? "How do you want to start?" : "Name your campaign"}
      description={
        step === 1
          ? "The persona drives Apollo filters, the pains and proof points the AI can use, and the recommended sequence."
          : step === 2
            ? "Start from a proven sequence, let the AI draft one from your goal, or build it yourself."
            : "You can change everything later. Next, you'll add prospects."
      }
      footer={footer}
    >
      {step === 1 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10 }}>
          {personasLoading
            ? [0, 1].map((i) => <Skeleton key={i} height={140} radius={14} />)
            : personas.map((p) => (
                <button key={p.id} type="button" className="pg-option-card" aria-pressed={personaId === p.id} onClick={() => setPersonaId(p.id)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 4, background: p.color ?? COLORS.brand }} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.ink0 }}>{p.name}</span>
                    {personaId === p.id ? <Check size={15} style={{ marginLeft: "auto", color: COLORS.brand }} /> : null}
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.ink2, marginTop: 6, lineHeight: 1.45 }}>{p.description}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 }}>
                    {p.targeting.titles.slice(0, 4).map((t) => (
                      <span key={t} className="ds-chip" style={{ fontSize: 10.5 }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
          <button type="button" className="pg-option-card" aria-pressed={personaId === null} onClick={() => setPersonaId(null)}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 4, border: `1.5px dashed ${COLORS.ink4}` }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.ink0 }}>Custom audience</span>
              {personaId === null ? <Check size={15} style={{ marginLeft: "auto", color: COLORS.brand }} /> : null}
            </div>
            <div style={{ fontSize: 12, color: COLORS.ink2, marginTop: 6, lineHeight: 1.45 }}>
              No persona: you describe the audience and the angle in the campaign goal.
            </div>
          </button>
        </div>
      ) : step === 2 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            <StartCard
              active={start === "recommended"}
              disabled={!recommended}
              icon={Sparkles}
              title="Recommended sequence"
              text={recommended ? `${recommended.name}: ${recommended.description}` : "No recommended sequence for a custom audience."}
              onClick={() => setStart("recommended")}
            />
            <StartCard active={start === "ai"} icon={Wand2} title="Build with AI" text="Describe your goal, the AI drafts a multichannel sequence following best practices." onClick={() => setStart("ai")} />
            <StartCard active={start === "template"} icon={LayoutTemplate} title="From a template" text="Reuse a system template or one you saved." onClick={() => setStart("template")} />
            <StartCard active={start === "blank"} icon={FilePlus2} title="Start from scratch" text="Empty sequence, you add each step." onClick={() => setStart("blank")} />
          </div>

          {start === "ai" ? (
            <div className="ds-card ds-rise" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <Field label="What do you want to achieve?" hint="e.g. Book demos of AI roleplay with Heads of Sales at scale-ups hiring SDRs in France.">
                <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} minRows={2} maxRows={6} placeholder="Your goal, audience, angle, constraints..." />
              </Field>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button variant="dark" icon={Wand2} loading={aiBusy} disabled={!goal.trim()} onClick={proposeWithAi}>
                  {aiSteps ? "Draft again" : "Draft the sequence"}
                </Button>
              </div>
              {aiError ? <Banner tone="err">{aiError}</Banner> : null}
            </div>
          ) : null}

          {start === "template" ? (
            <div className="ds-rise" style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
              {templates.map((t) => (
                <button key={t.key} type="button" className="pg-option-card" aria-pressed={templateKey === t.key} onClick={() => setTemplateKey(t.key)} style={{ padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.ink0 }}>{t.name}</span>
                    <span className={`ds-chip ${t.system ? "ds-chip-brand" : ""}`}>{t.system ? "Coachello" : "Saved"}</span>
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.ink3, marginTop: 4 }}>{t.description || sequenceSummary(t.steps)}</div>
                </button>
              ))}
            </div>
          ) : null}

          {previewSteps.length ? (
            <div style={{ background: COLORS.bgSoft, border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span className="ds-kpi-label">Sequence preview</span>
                <span style={{ fontSize: 12, color: COLORS.ink3 }}>{sequenceSummary(previewSteps)}</span>
              </div>
              <SequenceMini steps={previewSteps} size={28} />
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Campaign name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName(persona)} data-autofocus />
          </Field>
          <Field label="Goal and context for the AI" hint="Optional. Used in every message: who, why now, what you want. The AI never invents facts.">
            <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} minRows={3} maxRows={8} placeholder="e.g. Open conversations about AI roleplay for SDR onboarding. Mention our SKO follow-up offer when relevant." />
          </Field>
          <Banner tone="neutral" title="What happens next">
            Add prospects, let the AI research each one and write the whole sequence, review and approve, then launch. Emails only go out after your approval.
          </Banner>
        </div>
      )}
    </Modal>
  );
}

function StartCard({
  active,
  disabled,
  icon: Icon,
  title,
  text,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: React.ComponentType<{ size?: number | string }>;
  title: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="pg-option-card" aria-pressed={active} disabled={disabled} onClick={onClick} style={{ opacity: disabled ? 0.5 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: active ? COLORS.brand : COLORS.bgSoft, color: active ? "#fff" : COLORS.ink2 }}>
          <Icon size={15} />
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.ink0 }}>{title}</span>
      </div>
      <div style={{ fontSize: 12, color: COLORS.ink2, marginTop: 8, lineHeight: 1.45 }}>{text}</div>
    </button>
  );
}

function StepDots({ step }: { step: number }) {
  return (
    <div style={{ display: "flex", gap: 5, marginRight: 8 }}>
      {[1, 2, 3].map((i) => (
        <span key={i} style={{ width: i === step ? 18 : 6, height: 6, borderRadius: 999, background: i <= step ? COLORS.brand : COLORS.lineStrong, transition: "width 0.2s" }} />
      ))}
    </div>
  );
}
