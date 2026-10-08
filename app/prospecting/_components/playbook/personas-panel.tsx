"use client";

import * as React from "react";
import { Check, Plus, Save, Sparkles, Target, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TagInput } from "@/components/ui/tag-input";
import { Switch } from "@/components/ui/switch";
import { Banner } from "@/components/ui/banner";
import { Skeleton } from "@/components/ui/skeleton";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { COLORS } from "@/lib/design/tokens";
import { sendJson } from "@/lib/prospecting/client/http";
import { COMPANY_SIZE_OPTIONS, EMPTY_MESSAGING, EMPTY_TARGETING, SENIORITY_OPTIONS } from "@/lib/prospecting/personas";
import { useProspectingPersonas } from "@/lib/hooks/use-prospecting-personas";
import type { Persona, PersonaMessaging } from "@/lib/prospecting/types";
import { ObjectionsEditor, SourcedListEditor, StringListEditor } from "./list-editors";

const SWATCHES = ["#f01563", "#7c3aed", "#3b82f6", "#0891b2", "#16a34a", "#ca8a04", "#ea580c", "#111111"];

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 18, borderTop: `1px solid ${COLORS.line}` }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.ink0 }}>{title}</div>
        {hint ? <div style={{ fontSize: 12.5, color: COLORS.ink3, marginTop: 2, lineHeight: 1.45 }}>{hint}</div> : null}
      </div>
      {children}
    </section>
  );
}

function ChipToggles({ options, value, onChange }: { options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            className={`ds-chip ${on ? "ds-chip-brand" : ""}`}
            onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}
            style={{ cursor: "pointer", padding: "4px 10px", fontSize: 12, fontWeight: 600 }}
          >
            {on ? <Check size={11} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 36);
}

// Personas (cibles) : ciblage (presets Apollo) + messaging (seuls faits que
// l'IA peut citer). Partagés par toute l'équipe.
export function PersonasPanel() {
  const { toast } = useToast();
  const { personas, isLoading, error, loadError, save, mutate } = useProspectingPersonas({ all: true });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Persona | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [distilling, setDistilling] = React.useState(false);
  const [proposal, setProposal] = React.useState<PersonaMessaging | null>(null);

  React.useEffect(() => {
    if (!selectedId && personas[0]) setSelectedId(personas[0].id);
  }, [personas, selectedId]);
  React.useEffect(() => {
    const p = personas.find((x) => x.id === selectedId);
    if (p && (!draft || draft.id !== p.id)) setDraft(structuredClone(p));
  }, [selectedId, personas, draft]);

  const original = personas.find((p) => p.id === draft?.id) ?? null;
  const dirty = !!draft && (!original || JSON.stringify(original) !== JSON.stringify(draft));
  const set = (patch: Partial<Persona>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setT = (patch: Partial<Persona["targeting"]>) => setDraft((d) => (d ? { ...d, targeting: { ...d.targeting, ...patch } } : d));
  const setM = (patch: Partial<PersonaMessaging>) => setDraft((d) => (d ? { ...d, messaging: { ...d.messaging, ...patch } } : d));

  const create = () => {
    const name = "New persona";
    let id = slugify(name);
    let n = 2;
    while (personas.some((p) => p.id === id)) id = `${slugify(name)}_${n++}`;
    const p: Persona = { id, name, description: "", targeting: { ...EMPTY_TARGETING }, messaging: { ...EMPTY_MESSAGING }, color: SWATCHES[(personas.length + 2) % SWATCHES.length], is_active: true, position: personas.length };
    setDraft(p);
    setSelectedId(id);
  };

  const submit = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const clean: Persona = {
        ...draft,
        messaging: {
          ...draft.messaging,
          pains: draft.messaging.pains.filter((x) => x.trim()),
          valueProps: draft.messaging.valueProps.filter((x) => x.trim()),
          ctas: draft.messaging.ctas.filter((x) => x.trim()),
          examples: draft.messaging.examples.filter((x) => x.trim()),
          proofPoints: draft.messaging.proofPoints.filter((x) => x.text.trim()),
          insights: draft.messaging.insights.filter((x) => x.text.trim()),
          objections: draft.messaging.objections.filter((x) => x.objection.trim()),
        },
      };
      const saved = await save(clean);
      setDraft(structuredClone(saved));
      toast("Persona saved. New messages use it right away.", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "error");
    } finally {
      setSaving(false);
    }
  };

  const distill = async () => {
    if (!draft) return;
    setDistilling(true);
    try {
      const res = await sendJson<{ messaging: PersonaMessaging }>("/api/prospecting/knowledge/distill", "POST", { personaId: draft.id });
      setProposal(res.messaging);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not read the knowledge base", "error");
    } finally {
      setDistilling(false);
    }
  };

  if (error) return <Banner tone="err" title="Could not load personas" action={<Button size="sm" onClick={() => void mutate()}>Retry</Button>}>{error}</Banner>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      <div className="ds-card" style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2, position: "sticky", top: 12 }}>
        {isLoading
          ? [0, 1].map((i) => <Skeleton key={i} height={54} radius={10} style={{ margin: 4 }} />)
          : [...personas, ...(draft && !personas.some((p) => p.id === draft.id) ? [draft] : [])].map((p) => (
              <button key={p.id} type="button" className="pg-queue-row" aria-current={p.id === selectedId} onClick={() => setSelectedId(p.id)} style={{ borderRadius: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: 4, background: p.color ?? COLORS.brand, marginTop: 4, flexShrink: 0 }} />
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.ink0 }}>{p.name}</span>
                  <span style={{ fontSize: 11.5, color: COLORS.ink3 }}>
                    {p.targeting.titles.length} titles · {p.messaging.proofPoints.length} proof points{p.is_active ? "" : " · inactive"}
                  </span>
                </span>
              </button>
            ))}
        <div style={{ padding: 6 }}>
          <Button size="sm" variant="ghost" icon={Plus} onClick={create} fullWidth>
            New persona
          </Button>
        </div>
      </div>

      {draft ? (
        <div className="ds-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
          {loadError ? <Banner tone="warn">Showing default personas: {loadError}</Banner> : null}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <span style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: draft.color ?? COLORS.brand, color: "#fff", flexShrink: 0 }}>
              <Target size={18} />
            </span>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} style={{ fontSize: 16, fontWeight: 700 }} />
              <Input size="sm" value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Who they are and what they buy" />
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {SWATCHES.map((c) => (
                  <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => set({ color: c })} style={{ width: 18, height: 18, borderRadius: 6, background: c, border: draft.color === c ? `2px solid ${COLORS.ink0}` : "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,0.08)", cursor: "pointer" }} />
                ))}
                <div style={{ flex: 1 }} />
                <Switch checked={draft.is_active} onChange={(v) => set({ is_active: v })} />
                <span style={{ fontSize: 12, color: COLORS.ink3 }}>Active</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Button variant="primary" icon={Save} loading={saving} disabled={!dirty} onClick={submit}>
                Save
              </Button>
              <Button size="sm" variant="dark" icon={Wand2} loading={distilling} onClick={distill} title="Read the Notion knowledge base and suggest messaging for this persona">
                Suggest from Notion
              </Button>
            </div>
          </div>

          <Block title="Targeting" hint="Used as Apollo search presets and to match prospects to this persona.">
            <Field label="Job titles">
              <TagInput value={draft.targeting.titles} onChange={(v) => setT({ titles: v })} placeholder="Add a title and press Enter" />
            </Field>
            <Field label="Exclude titles">
              <TagInput value={draft.targeting.excludeTitles} onChange={(v) => setT({ excludeTitles: v })} placeholder="e.g. Intern, Assistant" />
            </Field>
            <Field label="Seniority">
              <ChipToggles options={SENIORITY_OPTIONS} value={draft.targeting.seniorities} onChange={(v) => setT({ seniorities: v })} />
            </Field>
            <Field label="Company size (employees)">
              <ChipToggles options={COMPANY_SIZE_OPTIONS.map((s) => ({ value: s, label: s }))} value={draft.targeting.companySizes} onChange={(v) => setT({ companySizes: v })} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Industries">
                <TagInput value={draft.targeting.industries} onChange={(v) => setT({ industries: v })} placeholder="Any" />
              </Field>
              <Field label="Locations">
                <TagInput value={draft.targeting.locations} onChange={(v) => setT({ locations: v })} placeholder="e.g. France" />
              </Field>
            </div>
            <Field label="Hiring signal" hint="Open roles that show a need (e.g. companies hiring SDRs need to ramp reps fast).">
              <TagInput value={draft.targeting.hiringTitles} onChange={(v) => setT({ hiringTitles: v })} placeholder="e.g. Account Executive" />
            </Field>
          </Block>

          <Block title="Messaging" hint="The AI may only cite the proof points and insights below, the client roster and facts found about the prospect. Nothing else.">
            <Field label="Pains">
              <StringListEditor value={draft.messaging.pains} onChange={(v) => setM({ pains: v })} addLabel="Add pain" placeholder="A problem this persona has" />
            </Field>
            <Field label="Value propositions">
              <StringListEditor value={draft.messaging.valueProps} onChange={(v) => setM({ valueProps: v })} addLabel="Add value proposition" />
            </Field>
            <Field label="Proof points (Coachello facts)" hint="Numbers, clients, results. Validated: check them against Notion > Client case studies.">
              <SourcedListEditor value={draft.messaging.proofPoints} onChange={(v) => setM({ proofPoints: v })} addLabel="Add proof point" />
            </Field>
            <Field label="Market insights" hint="Third-party stats the AI can use as a hook, always with a source.">
              <SourcedListEditor value={draft.messaging.insights} onChange={(v) => setM({ insights: v })} addLabel="Add insight" />
            </Field>
            <Field label="Objections">
              <ObjectionsEditor value={draft.messaging.objections} onChange={(v) => setM({ objections: v })} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Competitors">
                <TagInput value={draft.messaging.competitors} onChange={(v) => setM({ competitors: v })} />
              </Field>
              <Field label="Calls to action">
                <StringListEditor value={draft.messaging.ctas} onChange={(v) => setM({ ctas: v })} addLabel="Add CTA" />
              </Field>
            </div>
            <Field label="Tone">
              <Textarea value={draft.messaging.tone} onChange={(e) => setM({ tone: e.target.value })} minRows={2} />
            </Field>
            <Field label="Example messages" hint="Messages that worked. The AI imitates their style, never copies them.">
              <StringListEditor value={draft.messaging.examples} onChange={(v) => setM({ examples: v })} addLabel="Add example" multiline />
            </Field>
          </Block>
        </div>
      ) : null}

      <Modal
        open={!!proposal}
        onClose={() => setProposal(null)}
        icon={Sparkles}
        width={720}
        title="Suggestions from the Notion knowledge base"
        description="Pick what to add. Proof points come with their Notion source; nothing is saved until you click Save."
        footer={
          <>
            <Button variant="ghost" onClick={() => setProposal(null)}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!proposal || !draft) return;
                const merge = (a: string[], b: string[]) => Array.from(new Set([...a, ...b].map((x) => x.trim()).filter(Boolean)));
                setM({
                  pains: merge(draft.messaging.pains, proposal.pains),
                  valueProps: merge(draft.messaging.valueProps, proposal.valueProps),
                  ctas: merge(draft.messaging.ctas, proposal.ctas),
                  proofPoints: [...draft.messaging.proofPoints, ...proposal.proofPoints.filter((p) => !draft.messaging.proofPoints.some((x) => x.text === p.text))],
                  objections: [...draft.messaging.objections, ...proposal.objections.filter((o) => !draft.messaging.objections.some((x) => x.objection === o.objection))],
                  tone: draft.messaging.tone || proposal.tone,
                });
                setProposal(null);
                toast("Suggestions added. Review and save.", "info");
              }}
            >
              Add all suggestions
            </Button>
          </>
        }
      >
        {proposal ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13 }}>
            {([
              ["Pains", proposal.pains],
              ["Value propositions", proposal.valueProps],
              ["Calls to action", proposal.ctas],
            ] as [string, string[]][]).map(([t, list]) =>
              list.length ? (
                <div key={t}>
                  <div className="ds-kpi-label" style={{ marginBottom: 6 }}>{t}</div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                    {list.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
            {proposal.proofPoints.length ? (
              <div>
                <div className="ds-kpi-label" style={{ marginBottom: 6 }}>Proof points</div>
                {proposal.proofPoints.map((p, i) => (
                  <div key={i} style={{ padding: "6px 0", borderBottom: `1px solid ${COLORS.line}` }}>
                    {p.text} <span style={{ color: COLORS.ink3, fontSize: 12 }}>({p.source ?? "no source"})</span>
                  </div>
                ))}
              </div>
            ) : null}
            {proposal.objections.length ? (
              <div>
                <div className="ds-kpi-label" style={{ marginBottom: 6 }}>Objections</div>
                {proposal.objections.map((o, i) => (
                  <div key={i} style={{ padding: "6px 0", borderBottom: `1px solid ${COLORS.line}` }}>
                    <b>{o.objection}</b> {o.answer}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
