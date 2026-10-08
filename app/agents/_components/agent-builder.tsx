"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Lock, Sparkles, Wand2 } from "lucide-react";
import { COLORS } from "@/lib/design/tokens";
import { agentsApi } from "@/lib/hooks/use-agents";
import { useToast } from "@/components/ui/toast";
import type { AgentSchedule } from "@/lib/agents/schedule";
import type { AgentDestination } from "@/lib/agents/types";
import { SchedulePicker } from "./schedule-picker";
import { DestinationPicker } from "./destination-picker";
import { AGENT_TEMPLATES, findTemplate } from "./templates";
import { Section, SharingToggle } from "./ui";

const MIN_REQUEST = 10;

const PLACEHOLDER =
  "e.g. Every Monday morning, list my open deals with no activity in the last 14 days, with the amount, the stage and a suggested next step.";

/**
 * Création d'un agent : l'utilisateur décrit ce qu'il veut, le designer IA
 * produit la spec (consignes, template, sources) et un aperçu réel sur la
 * page de l'agent, où il valide avant activation.
 */
export function AgentBuilder() {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const template = findTemplate(params.get("template"));

  const [request, setRequest] = React.useState(template?.request ?? "");
  const [mustInclude, setMustInclude] = React.useState("");
  const [name, setName] = React.useState(template?.name ?? "");
  const [schedule, setSchedule] = React.useState<AgentSchedule | null>(template?.schedule ?? null);
  // Modèle d'envoi à un groupe : l'audience est pré-remplie.
  const [destination, setDestination] = React.useState<AgentDestination>(template?.audience ?? { type: "dm" });
  // Personnel par défaut : partager avec l'équipe est un choix explicite.
  const [shared, setShared] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // En dessous, le designer n'a pas de quoi travailler. Le minimum est dit à
  // l'écran (sous la zone de texte et dans la barre d'action) : un bouton grisé
  // sans explication laisse croire à un bug.
  const missing = Math.max(0, MIN_REQUEST - request.trim().length);
  const canSubmit = missing === 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const { id } = await agentsApi<{ id: string }>("/api/agents", "POST", {
        request,
        mustInclude,
        name,
        schedule,
        destination,
        shared,
      });
      router.push(`/agents/${id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create the agent", "error");
      setSubmitting(false);
    }
  }

  return (
    <div className="ag-page ag-page-narrow" style={{ paddingBottom: 24 }}>
      <Link href="/agents" className="ag-btn ag-btn-ghost ag-btn-sm" style={{ marginLeft: -10 }}>
        <ArrowLeft size={14} /> Agents
      </Link>

      <div style={{ marginTop: 14, marginBottom: 22 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 750, letterSpacing: "-0.025em", color: COLORS.ink0 }}>
          Create an agent{" "}
          <span
            style={{
              background: `linear-gradient(100deg, ${COLORS.brand}, #a855f7)`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            in one sentence
          </span>
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: 14, color: COLORS.ink2, lineHeight: 1.6, maxWidth: 640 }}>
          Describe what you want to receive and when. CoachelloAI writes the instructions, picks the sources, drafts the message and runs a live preview. You review everything before it goes out.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 1. La demande */}
        <div className="ag-prompt">
          <div className="ag-prompt-inner">
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 20px 0", fontSize: 12.5, fontWeight: 700, color: COLORS.ink1 }}>
              <Wand2 size={14} style={{ color: COLORS.brand }} /> What should your agent do?
            </div>
            <textarea
              ref={textareaRef}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder={PLACEHOLDER}
              rows={4}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
              aria-label="What should your agent do?"
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "0 14px 12px 20px", flexWrap: "wrap" }}>
              {request.trim() && missing > 0 ? (
                <span style={{ fontSize: 11.5, fontWeight: 600, color: COLORS.warn }}>
                  A bit more detail: {missing} more character{missing > 1 ? "s" : ""} to design it.
                </span>
              ) : (
                <span style={{ fontSize: 11.5, color: COLORS.ink4 }}>Be specific: who, what, which threshold, how many items.</span>
              )}
              <span style={{ fontSize: 11.5, color: COLORS.ink4 }}>⌘ + Enter to design</span>
            </div>
          </div>
        </div>

        {!request.trim() && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: COLORS.ink3, marginRight: 2 }}>Try:</span>
            {AGENT_TEMPLATES.slice(0, 5).map((t) => (
              <button
                key={t.key}
                type="button"
                className="ag-example"
                onClick={() => {
                  setRequest(t.request);
                  setSchedule(t.schedule);
                  if (!name) setName(t.name);
                  textareaRef.current?.focus();
                }}
              >
                <span aria-hidden>{t.emoji}</span> {t.name}
              </button>
            ))}
          </div>
        )}

        <Section num={1} title="Details" description="Optional. Leave empty and CoachelloAI decides.">
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: 14 }} className="ag-details-grid">
            <label>
              <span className="ag-label">What must the message include?</span>
              <textarea
                className="ag-textarea"
                style={{ minHeight: 84 }}
                value={mustInclude}
                onChange={(e) => setMustInclude(e.target.value)}
                placeholder="Deal name with HubSpot link, amount, days without activity, next step…"
              />
            </label>
            <label>
              <span className="ag-label">Name</span>
              <input className="ag-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="We'll suggest one" />
              <span className="ag-hint" style={{ display: "block", marginTop: 6 }}>
                Shown in Slack above each message.
              </span>
            </label>
          </div>
        </Section>

        <Section num={2} title="When" description="How often the agent runs and posts.">
          <SchedulePicker value={schedule} onChange={setSchedule} allowSuggest />
        </Section>

        <Section num={3} title="Where" description="Where the message is posted in Slack: your DMs, a channel, or each person of a group.">
          <DestinationPicker value={destination} onChange={setDestination} />
        </Section>

        <Section num={4} title="Sharing" description="Who can see and use this agent.">
          <SharingToggle value={shared} onChange={setShared} />
        </Section>
      </div>

      {/* Barre d'action, collée en bas de la zone de scroll */}
      <div style={{ position: "sticky", bottom: 16, zIndex: 30, marginTop: 24 }}>
        <div
          className="ag-card"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "10px 10px 10px 16px",
            borderRadius: 16,
            boxShadow: "0 18px 50px rgba(20, 20, 30, 0.14), 0 2px 8px rgba(20, 20, 30, 0.06)",
            justifyContent: "space-between",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, color: COLORS.ink2, minWidth: 0 }}>
            <Lock size={14} style={{ color: COLORS.ink4, flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {missing > 0 ? "Describe what the agent should do (a sentence is enough) to design it." : "Nothing is sent until you activate the agent."}
            </span>
          </span>
          <button
            type="button"
            className="ag-btn ag-btn-primary ag-btn-lg"
            onClick={submit}
            disabled={!canSubmit}
            title={missing > 0 ? `Describe what the agent should do: at least ${MIN_REQUEST} characters` : undefined}
          >
            {submitting ? <Loader2 size={15} className="ag-spin" /> : <Sparkles size={15} />}
            {submitting ? "Starting…" : "Design my agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
